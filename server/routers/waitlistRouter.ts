import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { waitlist } from "../../drizzle/schema";
import { eq, desc, sql } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { sendWaitlistWelcomeEmail, sendEmail } from "../services/emailService";
import { ENV } from "../_core/env";
import { TRPCError } from "@trpc/server";

// ============================================
// RATE LIMITING - Max 3 submissions per hour per IP
// ============================================
const waitlistRateLimits = new Map<string, { count: number; firstRequest: number }>();
const WAITLIST_RATE_LIMIT = { maxRequests: 3, windowMs: 60 * 60 * 1000 };

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of waitlistRateLimits.entries()) {
    if (now - entry.firstRequest > WAITLIST_RATE_LIMIT.windowMs) waitlistRateLimits.delete(ip);
  }
}, 5 * 60 * 1000);

function checkWaitlistRateLimit(ip: string): { allowed: boolean; message?: string } {
  const now = Date.now();
  const entry = waitlistRateLimits.get(ip);
  if (!entry || now - entry.firstRequest > WAITLIST_RATE_LIMIT.windowMs) return { allowed: true };
  if (entry.count >= WAITLIST_RATE_LIMIT.maxRequests) {
    const minutesRemaining = Math.ceil((entry.firstRequest + WAITLIST_RATE_LIMIT.windowMs - now) / 60000);
    return { allowed: false, message: `Too many submissions. Please try again in ${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}.` };
  }
  return { allowed: true };
}

function recordWaitlistRequest(ip: string): void {
  const now = Date.now();
  const entry = waitlistRateLimits.get(ip);
  if (!entry || now - entry.firstRequest > WAITLIST_RATE_LIMIT.windowMs) {
    waitlistRateLimits.set(ip, { count: 1, firstRequest: now });
  } else {
    entry.count++;
  }
}

// ============================================
// GOOGLE reCAPTCHA v3 VERIFICATION
// ============================================
async function verifyRecaptcha(token: string): Promise<{ success: boolean; score?: number; error?: string }> {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  if (!secretKey) {
    console.warn('[Waitlist] reCAPTCHA secret key not configured, skipping verification');
    return { success: true };
  }
  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secretKey}&response=${token}`,
    });
    const data = await response.json();
    if (!data.success) return { success: false, error: 'reCAPTCHA verification failed' };
    if (data.score < 0.5) {
      console.log(`[Waitlist] Low reCAPTCHA score: ${data.score}`);
      return { success: false, score: data.score, error: 'Suspicious activity detected' };
    }
    return { success: true, score: data.score };
  } catch (error) {
    console.error('[Waitlist] reCAPTCHA verification error:', error);
    return { success: true };
  }
}

// Waitlist submission schema
const waitlistSubmissionSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  country: z.string().min(2, "Please select your country"),
  userType: z.enum(["retail_trader", "institutional", "fund_manager", "other"]),
  selectedPlan: z.enum(["starter", "professional", "enterprise"]).optional(),
  source: z.string().optional(),
  recaptchaToken: z.string().optional(),
});

export const waitlistRouter = router({
  // Submit waitlist entry (public - no auth required)
  submit: publicProcedure
    .input(waitlistSubmissionSchema)
    .mutation(async ({ input, ctx }) => {
      // Get client IP
      const clientIp = (ctx.req as any).ip || (ctx.req as any).headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
      
      // Check rate limit
      const rateLimitCheck = checkWaitlistRateLimit(clientIp);
      if (!rateLimitCheck.allowed) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: rateLimitCheck.message || 'Too many requests.' });
      }
      
      // Verify reCAPTCHA if token provided
      if (input.recaptchaToken) {
        const recaptchaResult = await verifyRecaptcha(input.recaptchaToken);
        if (!recaptchaResult.success) {
          console.log(`[Waitlist] reCAPTCHA failed for IP ${clientIp}: ${recaptchaResult.error}`);
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Security verification failed. Please try again.' });
        }
      }
      
      // Record request for rate limiting
      recordWaitlistRequest(clientIp);
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      try {
        // Check if email already exists
        const existing = await db
          .select()
          .from(waitlist)
          .where(eq(waitlist.email, input.email))
          .limit(1);

        if (existing.length > 0) {
          // Update existing entry instead of creating duplicate
          await db
            .update(waitlist)
            .set({
              name: input.name,
              phone: input.phone || null,
              country: input.country,
              userType: input.userType,
              selectedPlan: input.selectedPlan || null,
              source: input.source || null,
            })
            .where(eq(waitlist.email, input.email));

          return {
            success: true,
            message: "Your information has been updated! You're already on our waitlist.",
            isUpdate: true,
          };
        }

        // Insert new waitlist entry
        await db.insert(waitlist).values({
          name: input.name,
          email: input.email,
          phone: input.phone || null,
          country: input.country,
          userType: input.userType,
          selectedPlan: input.selectedPlan || null,
          source: input.source || null,
          status: "pending",
        });

        // Get waitlist position
        const countResult = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(waitlist);
        const position = countResult[0]?.count || 1;

        // Notify owner about new waitlist signup
        const userTypeLabels: Record<string, string> = {
          retail_trader: "Retail Trader",
          institutional: "Institutional",
          fund_manager: "Fund Manager",
          other: "Other",
        };

        const planLabels: Record<string, string> = {
          starter: "Starter ($49/mo)",
          professional: "Professional ($149/mo)",
          enterprise: "Enterprise (Custom)",
        };

        await notifyOwner({
          title: `🎉 New Waitlist Signup: ${input.name}`,
          content: `
**New Interest Received!**

**Name:** ${input.name}
**Email:** ${input.email}
**Phone:** ${input.phone || "Not provided"}
**Country:** ${input.country}
**User Type:** ${userTypeLabels[input.userType] || input.userType}
**Interested Plan:** ${input.selectedPlan ? planLabels[input.selectedPlan] : "Not selected"}
**Source:** ${input.source || "Direct"}

**Waitlist Position:** #${position}

---
*This notification was sent automatically from SEER Trading Platform.*
          `.trim(),
        });

        // Send welcome email to the applicant
        try {
          const emailResult = await sendWaitlistWelcomeEmail(
            { email: input.email, name: input.name },
            position,
            input.userType,
            input.selectedPlan
          );
          if (!emailResult.success) {
            console.error("[Waitlist] Failed to send welcome email:", emailResult.error);
          } else {
            console.log("[Waitlist] Welcome email sent successfully to:", input.email);
          }
        } catch (emailError) {
          console.error("[Waitlist] Error sending welcome email:", emailError);
          // Don't fail the submission if email fails
        }

        // Send email notification to owner (in addition to in-app notification)
        try {
          const ownerEmailContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>New Waitlist Signup</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(6, 182, 212, 0.1)); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 16px; padding: 30px;">
    <h1 style="color: #8b5cf6; margin: 0 0 20px 0;">🎉 New Waitlist Signup!</h1>
    <table style="width: 100%; color: #e5e5e5; font-size: 14px;">
      <tr><td style="padding: 8px 0; color: #a1a1aa;">Name:</td><td style="padding: 8px 0;">${input.name}</td></tr>
      <tr><td style="padding: 8px 0; color: #a1a1aa;">Email:</td><td style="padding: 8px 0;"><a href="mailto:${input.email}" style="color: #06b6d4;">${input.email}</a></td></tr>
      <tr><td style="padding: 8px 0; color: #a1a1aa;">Phone:</td><td style="padding: 8px 0;">${input.phone || "Not provided"}</td></tr>
      <tr><td style="padding: 8px 0; color: #a1a1aa;">Country:</td><td style="padding: 8px 0;">${input.country}</td></tr>
      <tr><td style="padding: 8px 0; color: #a1a1aa;">User Type:</td><td style="padding: 8px 0;">${userTypeLabels[input.userType] || input.userType}</td></tr>
      <tr><td style="padding: 8px 0; color: #a1a1aa;">Interested Plan:</td><td style="padding: 8px 0;">${input.selectedPlan ? planLabels[input.selectedPlan] : "Not selected"}</td></tr>
      <tr><td style="padding: 8px 0; color: #a1a1aa;">Waitlist Position:</td><td style="padding: 8px 0; color: #8b5cf6; font-weight: bold;">#${position}</td></tr>
    </table>
    <p style="color: #71717a; font-size: 12px; margin: 20px 0 0 0;">This notification was sent automatically from SEER Trading Platform.</p>
  </div>
</body>
</html>
          `.trim();

          await sendEmail({
            to: [{ email: 'rd@seerticks.com', name: 'SEER Owner' }],
            sender: { name: 'SEER AI Trading', email: 'noreply@seerticks.com' },
            subject: `🎉 New Waitlist Signup: ${input.name} (#${position})`,
            htmlContent: ownerEmailContent,
            textContent: `New Waitlist Signup!\n\nName: ${input.name}\nEmail: ${input.email}\nPhone: ${input.phone || "Not provided"}\nCountry: ${input.country}\nUser Type: ${userTypeLabels[input.userType] || input.userType}\nInterested Plan: ${input.selectedPlan ? planLabels[input.selectedPlan] : "Not selected"}\nWaitlist Position: #${position}`,
          });
          console.log("[Waitlist] Owner email notification sent");
        } catch (ownerEmailError) {
          console.error("[Waitlist] Error sending owner email notification:", ownerEmailError);
          // Don't fail the submission if owner email fails
        }

        return {
          success: true,
          message: "You've been added to our waitlist! Check your email for confirmation.",
          position,
          isUpdate: false,
        };
      } catch (error: any) {
        console.error("[Waitlist] Error submitting:", error);
        
        // Handle duplicate email error
        if (error.code === "ER_DUP_ENTRY") {
          return {
            success: true,
            message: "You're already on our waitlist! We'll be in touch soon.",
            isUpdate: true,
          };
        }
        
        throw new Error("Failed to join waitlist. Please try again.");
      }
    }),

  // Get waitlist stats (public)
  getStats: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return { totalSignups: 0, recentSignups: 0 };
    }

    try {
      const totalResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(waitlist);

      const recentResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(waitlist)
        .where(sql`${waitlist.createdAt} > DATE_SUB(NOW(), INTERVAL 7 DAY)`);

      return {
        totalSignups: totalResult[0]?.count || 0,
        recentSignups: recentResult[0]?.count || 0,
      };
    } catch (error) {
      console.error("[Waitlist] Error getting stats:", error);
      return { totalSignups: 0, recentSignups: 0 };
    }
  }),

  // Admin: Get all waitlist entries (protected - admin only)
  getAll: protectedProcedure
    .input(z.object({
      status: z.enum(["pending", "contacted", "invited", "converted", "all"]).optional(),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      // Check if user is admin
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }

      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const limit = input?.limit || 50;
      const offset = input?.offset || 0;

      let query = db.select().from(waitlist);

      if (input?.status && input.status !== "all") {
        query = query.where(eq(waitlist.status, input.status)) as any;
      }

      const entries = await query
        .orderBy(desc(waitlist.createdAt))
        .limit(limit)
        .offset(offset);

      const totalResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(waitlist);

      return {
        entries,
        total: totalResult[0]?.count || 0,
        limit,
        offset,
      };
    }),

  // Admin: Update waitlist entry status
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "contacted", "invited", "converted"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }

      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const updateData: any = {
        status: input.status,
      };

      if (input.notes) {
        updateData.notes = input.notes;
      }

      if (input.status === "invited") {
        updateData.invitedAt = new Date();
      } else if (input.status === "converted") {
        updateData.convertedAt = new Date();
      }

      await db.update(waitlist).set(updateData).where(eq(waitlist.id, input.id));

      return { success: true };
    }),
});
