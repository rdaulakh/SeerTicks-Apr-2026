import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { COOKIE_NAME } from "@shared/const";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { getSharedPool } from "./sharedPool";
import { ENV } from './env';

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

// JWT secret from centralized ENV (no hardcoded fallback)
const JWT_SECRET = ENV.jwtSecret;

// Use shared connection pool to prevent connection exhaustion
function getAuthPool(): mysql.Pool {
  return getSharedPool();
}

/**
 * Try to authenticate using local JWT (email/password login)
 * Returns user if successful, null otherwise
 */
async function authenticateLocalJwt(token: string): Promise<User | null> {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; email: string; openId?: string };
    
    // Check for valid userId
    if (!decoded.userId) {
      return null;
    }
    
    const pool = getAuthPool();
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id, openId, name, email, role, createdAt, updatedAt, lastSignedIn FROM users WHERE id = ? LIMIT 1',
      [decoded.userId]
    );
    
    if (rows.length === 0) {
      return null;
    }
    
    const user = rows[0];
    return {
      id: user.id,
      openId: user.openId,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastSignedIn: user.lastSignedIn,
    } as User;
    
  } catch (error) {
    // JWT verification failed or DB error
    return null;
  }
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // Get the session cookie
  const cookieHeader = opts.req.headers.cookie;
  let sessionCookie: string | undefined;
  
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, string>);
    sessionCookie = cookies[COOKIE_NAME];
  }

  if (sessionCookie) {
    // Try local JWT authentication first (faster, no external calls)
    user = await authenticateLocalJwt(sessionCookie);
    
    // If local auth failed, try Manus OAuth
    if (!user) {
      try {
        user = await sdk.authenticateRequest(opts.req);
      } catch (error) {
        // Manus OAuth also failed
        user = null;
      }
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
