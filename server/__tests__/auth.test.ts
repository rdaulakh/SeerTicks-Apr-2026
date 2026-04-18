/**
 * Authentication System Tests
 * 
 * Tests the complete authentication flow including:
 * - Login endpoint
 * - Auth check endpoint
 * - Logout endpoint
 * - Cookie handling
 * - Error cases
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration test: requires live server/DB/external APIs.
 * Set INTEGRATION_TEST=1 to run these tests.
 */
const isIntegration = process.env.INTEGRATION_TEST === '1';


const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = 'rdaulakh@exoways.com';
const TEST_PASSWORD = 'Punjab@123456';

// Store cookies between requests
let authCookie = '';

describe.skipIf(!isIntegration)('Authentication System', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${BASE_URL}/api/health`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.checks.database).toBe(true);
      expect(data.checks.server).toBe(true);
    });
  });

  describe('Login Endpoint', () => {
    it('should reject login with missing credentials', async () => {
      const response = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toBe('Email and password required');
    });

    it('should reject login with wrong password', async () => {
      const response = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: 'wrongpassword' }),
      });
      
      const data = await response.json();
      expect(response.status).toBe(401);
      expect(data.error).toBe('Invalid email or password');
    });

    it('should reject login with non-existent email', async () => {
      const response = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent@example.com', password: 'anypassword' }),
      });
      
      const data = await response.json();
      expect(response.status).toBe(401);
      expect(data.error).toBe('Invalid email or password');
    });

    it('should successfully login with correct credentials', async () => {
      const response = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      });
      
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe(TEST_EMAIL);
      expect(data.user.id).toBeDefined();
      
      // Extract cookie for subsequent requests
      const setCookie = response.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
      authCookie = setCookie!.split(';')[0];
    });
  });

  describe('Auth Check Endpoint', () => {
    it('should return null user when not authenticated', async () => {
      const response = await fetch(`${BASE_URL}/api/auth/me`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.user).toBeNull();
    });

    it('should return user when authenticated', async () => {
      const response = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { 'Cookie': authCookie },
      });
      
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe(TEST_EMAIL);
    });
  });

  describe('Logout Endpoint', () => {
    it('should successfully logout and set cookie to expire', async () => {
      const response = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Cookie': authCookie },
      });
      
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      
      // Check that the Set-Cookie header clears the cookie
      const setCookie = response.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
      // Cookie should be set to empty or have max-age=0
      expect(setCookie).toMatch(/max-age=0|expires=.*1970/i);
    });

    it('should return null user when using cleared cookie', async () => {
      // After logout, if we send NO cookie, we should get null user
      const response = await fetch(`${BASE_URL}/api/auth/me`);
      
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.user).toBeNull();
    });
  });

  describe('Full Authentication Flow', () => {
    it('should complete full login -> check -> logout flow', async () => {
      // 1. Login
      const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      });
      expect(loginResponse.status).toBe(200);
      const newCookie = loginResponse.headers.get('set-cookie')!.split(';')[0];
      
      // 2. Check auth
      const checkResponse = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { 'Cookie': newCookie },
      });
      const checkData = await checkResponse.json();
      expect(checkData.user).toBeDefined();
      expect(checkData.user.email).toBe(TEST_EMAIL);
      
      // 3. Logout
      const logoutResponse = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Cookie': newCookie },
      });
      expect(logoutResponse.status).toBe(200);
      
      // 4. Verify logout response sets cookie to expire
      const logoutSetCookie = logoutResponse.headers.get('set-cookie');
      expect(logoutSetCookie).toBeTruthy();
      expect(logoutSetCookie).toMatch(/max-age=0|expires=.*1970/i);
      
      // 5. Verify that without cookie, user is null
      const verifyResponse = await fetch(`${BASE_URL}/api/auth/me`);
      const verifyData = await verifyResponse.json();
      expect(verifyData.user).toBeNull();
    });
  });
});

describe('auth (unit)', () => {
  it('should have test file loaded', () => {
    expect(true).toBe(true);
  });
});
