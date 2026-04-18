/**
 * Email Service using Brevo (formerly Sendinblue)
 * Handles transactional emails for waitlist confirmations and notifications
 */

import { ENV } from '../_core/env';

interface EmailRecipient {
  email: string;
  name?: string;
}

interface SendEmailParams {
  to: EmailRecipient[];
  subject: string;
  htmlContent: string;
  textContent?: string;
  sender?: {
    name: string;
    email: string;
  };
}

interface BrevoResponse {
  messageId?: string;
  code?: string;
  message?: string;
}

const DEFAULT_SENDER = {
  name: 'SEER AI Trading',
  email: 'noreply@seerticks.com'
};

/**
 * Send an email using Brevo API
 */
export async function sendEmail(params: SendEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  
  if (!apiKey) {
    console.error('[EmailService] BREVO_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: params.sender || DEFAULT_SENDER,
        to: params.to,
        subject: params.subject,
        htmlContent: params.htmlContent,
        textContent: params.textContent,
      }),
    });

    const data: BrevoResponse = await response.json();

    if (response.ok) {
      console.log(`[EmailService] Email sent successfully to ${params.to.map(r => r.email).join(', ')}`);
      return { success: true, messageId: data.messageId };
    } else {
      console.error('[EmailService] Failed to send email:', data.message || data.code);
      return { success: false, error: data.message || 'Failed to send email' };
    }
  } catch (error) {
    console.error('[EmailService] Error sending email:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Send waitlist welcome email to new applicant
 */
export async function sendWaitlistWelcomeEmail(
  recipient: { email: string; name: string },
  position: number,
  userType: string,
  selectedPlan?: string
): Promise<{ success: boolean; error?: string }> {
  const userTypeLabels: Record<string, string> = {
    retail_trader: 'Retail Trader',
    institutional: 'Institutional Investor',
    fund_manager: 'Fund Manager',
    other: 'Trader',
  };

  const planLabels: Record<string, string> = {
    starter: 'Starter',
    professional: 'Professional',
    enterprise: 'Enterprise',
  };

  const userTypeLabel = userTypeLabels[userType] || 'Trader';
  const planLabel = selectedPlan ? planLabels[selectedPlan] || selectedPlan : null;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to SEER</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0a0a0f;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px;">
          
          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom: 30px;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align: middle; padding-right: 12px;">
                    <img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663149383478/SoUKqJRempqTNGSl.png" alt="SEER" width="56" height="56" style="display: block; border-radius: 12px;" />
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="color: white; font-size: 28px; font-weight: bold; letter-spacing: -0.5px;">SEER</span>
                    <br />
                    <span style="color: #71717a; font-size: 11px; letter-spacing: 2px;">AI TRADING</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(6, 182, 212, 0.1)); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 16px; padding: 40px;">
              
              <h1 style="color: white; font-size: 28px; font-weight: 700; margin: 0 0 20px 0; text-align: center;">
                Welcome to the Future of Trading
              </h1>
              
              <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0; text-align: center;">
                Hi ${recipient.name},
              </p>
              
              <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Thank you for joining the SEER waitlist! You're now part of an exclusive group of ${userTypeLabel}s who will be among the first to experience AI-powered autonomous trading.
              </p>

              <!-- Position Badge -->
              <div style="background: rgba(139, 92, 246, 0.2); border: 1px solid rgba(139, 92, 246, 0.4); border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #a1a1aa; font-size: 14px; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 1px;">Your Waitlist Position</p>
                <p style="color: #8b5cf6; font-size: 48px; font-weight: 700; margin: 0;">#${position}</p>
                ${planLabel ? `<p style="color: #06b6d4; font-size: 14px; margin: 8px 0 0 0;">Interested in: ${planLabel} Plan</p>` : ''}
              </div>

              <h2 style="color: white; font-size: 20px; font-weight: 600; margin: 32px 0 16px 0;">What's Next?</h2>
              
              <ul style="color: #a1a1aa; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
                <li style="margin-bottom: 8px;">We're onboarding users in batches to ensure the best experience</li>
                <li style="margin-bottom: 8px;">You'll receive an exclusive invitation email when it's your turn</li>
                <li style="margin-bottom: 8px;">Early access members get special founding member benefits</li>
              </ul>

              <h2 style="color: white; font-size: 20px; font-weight: 600; margin: 32px 0 16px 0;">What You'll Get</h2>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50%" style="padding: 8px;">
                    <div style="background: rgba(6, 182, 212, 0.1); border-radius: 8px; padding: 16px; text-align: center;">
                      <p style="color: #06b6d4; font-size: 24px; margin: 0;">11</p>
                      <p style="color: #a1a1aa; font-size: 12px; margin: 4px 0 0 0;">AI Agents</p>
                    </div>
                  </td>
                  <td width="50%" style="padding: 8px;">
                    <div style="background: rgba(139, 92, 246, 0.1); border-radius: 8px; padding: 16px; text-align: center;">
                      <p style="color: #8b5cf6; font-size: 24px; margin: 0;">24/7</p>
                      <p style="color: #a1a1aa; font-size: 12px; margin: 4px 0 0 0;">Monitoring</p>
                    </div>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top: 30px; text-align: center;">
              <p style="color: #71717a; font-size: 14px; margin: 0 0 16px 0;">
                Have questions? Reply to this email or visit <a href="https://seerticks.com" style="color: #8b5cf6; text-decoration: none;">seerticks.com</a>
              </p>
              <p style="color: #52525b; font-size: 12px; margin: 0;">
                © 2025 SEER AI Trading. All rights reserved.<br>
                You're receiving this because you signed up for the SEER waitlist.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const textContent = `
Welcome to SEER, ${recipient.name}!

Thank you for joining the SEER waitlist. You're now #${position} in line.

As a ${userTypeLabel}, you'll be among the first to experience AI-powered autonomous trading with 11 specialized agents working 24/7.

What's Next:
- We're onboarding users in batches to ensure the best experience
- You'll receive an exclusive invitation email when it's your turn
- Early access members get special founding member benefits

Have questions? Visit https://seerticks.com

© 2025 SEER AI Trading
  `.trim();

  return sendEmail({
    to: [{ email: recipient.email, name: recipient.name }],
    subject: `Welcome to SEER - You're #${position} on the Waitlist!`,
    htmlContent,
    textContent,
  });
}

/**
 * Validate Brevo API key by making a lightweight API call
 */
export async function validateBrevoApiKey(): Promise<{ valid: boolean; error?: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  
  if (!apiKey) {
    return { valid: false, error: 'BREVO_API_KEY not configured' };
  }

  try {
    // Use the account endpoint to validate the API key
    const response = await fetch('https://api.brevo.com/v3/account', {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`[EmailService] Brevo API key validated. Account: ${data.email}`);
      return { valid: true };
    } else {
      const error = await response.json();
      return { valid: false, error: error.message || 'Invalid API key' };
    }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Connection error' };
  }
}
