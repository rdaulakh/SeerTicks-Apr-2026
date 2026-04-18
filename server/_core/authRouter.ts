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

// Use shared connection pool to prevent connection exhaustion
function getAuthPool(): mysql.Pool {
  return getSharedPool();
}

const JWT_SECRET = ENV.jwtSecret;
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

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
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    
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
    // Clear the cookie by setting it to empty with immediate expiration
    res.cookie(COOKIE_NAME, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 0, // Expire immediately
      expires: new Date(0), // Set to past date
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
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    
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
