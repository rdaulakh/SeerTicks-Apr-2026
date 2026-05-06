/**
 * Dedicated Authentication Router
 * 
 * This module handles all authentication endpoints with:
 * - Static imports for fast startup
 * - Direct database queries (no ORM overhead)
 * - Minimal dependencies
 * - Fast response times
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import { getSharedPool } from './sharedPool';
import { COOKIE_NAME } from '@shared/const';
import { ENV } from './env';
import { authLogger } from '../utils/logger';
import { getSessionCookieOptions } from './cookies';

// Use shared connection pool to prevent connection exhaustion
function getAuthPool(): mysql.Pool {
  return getSharedPool();
}

const JWT_SECRET = ENV.jwtSecret;
// Phase 48 — cookie `secure` flag must adapt to the request protocol, not
// NODE_ENV. Production deployment is currently reachable over plain HTTP at
// the EC2 IP (DNS for seerticks.com is misrouted), so a hardcoded
// `secure: true` made browsers silently drop the cookie and login bounced
// back to the sign-in page. `getSessionCookieOptions(req)` checks
// req.protocol / x-forwarded-proto with trust proxy enabled — flips on
// when behind HTTPS, off otherwise.
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
function loginCookieOptions(req: Request) {
  return { ...getSessionCookieOptions(req), maxAge: SEVEN_DAYS_MS };
}

export const authRouter = Router();

/**
 * POST /api/auth/login
 * Email/password login
 */
authRouter.post('/login', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and password required' 
      });
    }
    
    const pool = getAuthPool();
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id, email, passwordHash, name, role, openId FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid email or password' 
      });
    }
    
    const user = rows[0];
    
    if (!user.passwordHash) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid email or password' 
      });
    }
    
    const isValid = await bcrypt.compare(password, user.passwordHash);
    
    if (!isValid) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid email or password' 
      });
    }
    
    // Update last signed in (non-blocking)
    pool.execute(
      'UPDATE users SET lastSignedIn = NOW() WHERE id = ?',
      [user.id]
    ).catch(err => authLogger.warn('Failed to update lastSignedIn', { error: err.message }));
    
    // Create JWT
    const token = jwt.sign(
      { 
        userId: user.id, 
        openId: user.openId || `local_${user.id}`, 
        email: user.email 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    // Set cookie
    res.cookie(COOKIE_NAME, token, loginCookieOptions(req));

    const responseTime = Date.now() - startTime;
    authLogger.info('Login successful', { email, responseTime });
    
    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
    
  } catch (error: any) {
    authLogger.error('Login error', { error: error.message });
    return res.status(500).json({ 
      success: false, 
      error: `Login failed: ${error.message}` 
    });
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
authRouter.get('/me', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const token = req.cookies?.[COOKIE_NAME];
    
    if (!token) {
      return res.json({ user: null });
    }
    
    let decoded: { userId: number; email: string };
    try {
      decoded = jwt.verify(token, JWT_SECRET) as { userId: number; email: string };
    } catch (jwtError) {
      // Invalid or expired token
      return res.json({ user: null });
    }
    
    // Check for undefined userId to prevent SQL bind parameter error
    if (decoded.userId === undefined || decoded.userId === null) {
      authLogger.warn('Token decoded but userId is undefined');
      return res.json({ user: null });
    }
    
    const pool = getAuthPool();
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id, openId, name, email, role, createdAt, updatedAt, lastSignedIn FROM users WHERE id = ? LIMIT 1',
      [decoded.userId]
    );
    
    if (rows.length === 0) {
      return res.json({ user: null });
    }
    
    const user = rows[0];
    const responseTime = Date.now() - startTime;
    authLogger.debug('Auth check', { userId: user.id, responseTime });
    
    return res.json({
      user: {
        id: user.id,
        openId: user.openId,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastSignedIn: user.lastSignedIn,
      },
    });
    
  } catch (error: any) {
    authLogger.error('Auth check error', { error: error?.message });
    return res.json({ user: null });
  }
});

/**
 * POST /api/auth/logout
 * Logout current user
 */
authRouter.post('/logout', (req: Request, res: Response) => {
  try {
    // Clear the cookie by setting it to empty with immediate expiration.
    // Use the same secure flag the cookie was set with — otherwise the
    // clear request is ignored by the browser and the user appears logged in.
    res.cookie(COOKIE_NAME, '', {
      ...getSessionCookieOptions(req),
      maxAge: 0,
      expires: new Date(0),
    });
    
    authLogger.info('User logged out');
    return res.json({ success: true });
    
  } catch (error: any) {
    authLogger.error('Logout error', { error: error?.message });
    return res.status(500).json({ success: false, error: 'Logout failed' });
  }
});

/**
 * POST /api/auth/register
 * Register new user
 */
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and password required' 
      });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password must be at least 8 characters' 
      });
    }
    
    const pool = getAuthPool();
    
    // Check if user exists
    const [existing] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email already registered' 
      });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    const openId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create user
    const [result] = await pool.execute<mysql.ResultSetHeader>(
      'INSERT INTO users (email, passwordHash, name, openId, role, emailVerified, createdAt, updatedAt, lastSignedIn) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())',
      [email, passwordHash, name || null, openId, 'user', true]
    );
    
    const userId = result.insertId;
    
    // Create JWT
    const token = jwt.sign(
      { userId, openId, email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    // Set cookie
    res.cookie(COOKIE_NAME, token, loginCookieOptions(req));

    return res.json({
      success: true,
      user: {
        id: userId,
        email,
        name: name || null,
        role: 'user',
      },
    });
    
  } catch (error: any) {
    authLogger.error('Register error', { error: error?.message });
    return res.status(500).json({
      success: false,
      error: 'Registration failed. Please try again.'
    });
  }
});

/**
 * POST /api/auth/forgot-password — Phase 54
 *
 * Body: { email }
 *
 * Always returns 200 with `{ success: true }` so the form can't be used
 * for account enumeration. If the user exists, generates a 32-byte random
 * token, stores its SHA-256 hash with a 60-min expiry, and sends the
 * plaintext token to the user via email as part of the reset URL.
 */
authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Email required' });
    }

    const pool = getAuthPool();
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id, email, name FROM users WHERE email = ? LIMIT 1',
      [email],
    );

    // Generic success regardless of whether the email exists — anti-enumeration.
    if (rows.length === 0) {
      authLogger.info('forgot-password: unknown email', { email });
      return res.json({ success: true });
    }

    const user = rows[0];
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresInMinutes = 60;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    await pool.execute(
      'INSERT INTO passwordResetTokens (userId, tokenHash, expiresAt, createdAt) VALUES (?, ?, ?, NOW())',
      [user.id, tokenHash, expiresAt],
    );

    const appOrigin = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${appOrigin}/reset-password?token=${encodeURIComponent(token)}`;

    // Send asynchronously — don't block the HTTP response on Brevo latency,
    // and don't leak email-system failures to the unauthenticated caller.
    void (async () => {
      try {
        const { sendPasswordResetEmail } = await import('../services/emailService');
        const result = await sendPasswordResetEmail(
          { email: user.email, name: user.name },
          resetUrl,
          expiresInMinutes,
        );
        if (!result.success) {
          authLogger.error('forgot-password: email send failed', { email: user.email, error: result.error });
        } else {
          authLogger.info('forgot-password: reset email sent', { email: user.email });
        }
      } catch (e: any) {
        authLogger.error('forgot-password: email exception', { email: user.email, error: e?.message });
      }
    })();

    return res.json({ success: true });
  } catch (error: any) {
    authLogger.error('forgot-password error', { error: error?.message });
    // Even on internal errors, return success to avoid revealing infra state.
    return res.json({ success: true });
  }
});

/**
 * POST /api/auth/reset-password — Phase 54
 *
 * Body: { token, newPassword }
 *
 * Hashes the supplied token, looks up the row, verifies it's unused and
 * unexpired, then bcrypt-hashes the new password, sets it on the user,
 * marks the token used, and forces loginMethod='email' so federated
 * accounts can also log in via email/password after a reset.
 */
authRouter.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || typeof token !== 'string' || token.length < 32) {
      return res.status(400).json({ success: false, error: 'Invalid reset link' });
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const crypto = await import('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const pool = getAuthPool();
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id, userId FROM passwordResetTokens WHERE tokenHash = ? AND usedAt IS NULL AND expiresAt > NOW() LIMIT 1',
      [tokenHash],
    );
    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Reset link is invalid or has expired. Request a new one.',
      });
    }

    const tokenId = rows[0].id;
    const userId = rows[0].userId;
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await pool.execute(
      'UPDATE users SET passwordHash = ?, loginMethod = ? WHERE id = ?',
      [passwordHash, 'email', userId],
    );
    await pool.execute(
      'UPDATE passwordResetTokens SET usedAt = NOW() WHERE id = ?',
      [tokenId],
    );

    authLogger.info('reset-password: success', { userId });
    return res.json({ success: true });
  } catch (error: any) {
    authLogger.error('reset-password error', { error: error?.message });
    return res.status(500).json({ success: false, error: 'Reset failed. Please try again.' });
  }
});
