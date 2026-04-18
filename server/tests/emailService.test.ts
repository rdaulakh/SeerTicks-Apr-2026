/**
 * Email Service Tests
 * Tests for Brevo email integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
import { validateBrevoApiKey, sendEmail, sendWaitlistWelcomeEmail } from '../services/emailService';

describe('Email Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up environment variable for tests
    process.env.BREVO_API_KEY = 'test-api-key';
  });

  describe('validateBrevoApiKey', () => {
    it('should return valid when API key is correct', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ email: 'test@example.com', companyName: 'Test' }),
      });

      const result = await validateBrevoApiKey();
      
      expect(result.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.brevo.com/v3/account',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'api-key': 'test-api-key',
          }),
        })
      );
    });

    it('should return invalid when API key is wrong', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Invalid API key' }),
      });

      const result = await validateBrevoApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('should handle missing API key', async () => {
      delete process.env.BREVO_API_KEY;
      
      const result = await validateBrevoApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe('BREVO_API_KEY not configured');
    });
  });

  describe('sendEmail', () => {
    beforeEach(() => {
      process.env.BREVO_API_KEY = 'test-api-key';
    });

    it('should send email successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messageId: 'msg-123' }),
      });

      const result = await sendEmail({
        to: [{ email: 'test@example.com', name: 'Test User' }],
        subject: 'Test Subject',
        htmlContent: '<p>Test content</p>',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.brevo.com/v3/smtp/email',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'api-key': 'test-api-key',
            'content-type': 'application/json',
          }),
        })
      );
    });

    it('should handle send failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Rate limit exceeded' }),
      });

      const result = await sendEmail({
        to: [{ email: 'test@example.com' }],
        subject: 'Test',
        htmlContent: '<p>Test</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Rate limit exceeded');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await sendEmail({
        to: [{ email: 'test@example.com' }],
        subject: 'Test',
        htmlContent: '<p>Test</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('sendWaitlistWelcomeEmail', () => {
    beforeEach(() => {
      process.env.BREVO_API_KEY = 'test-api-key';
    });

    it('should send welcome email with correct content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messageId: 'msg-456' }),
      });

      const result = await sendWaitlistWelcomeEmail(
        { email: 'trader@example.com', name: 'John Doe' },
        42,
        'retail_trader',
        'professional'
      );

      expect(result.success).toBe(true);
      
      // Verify the email content
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      
      expect(body.to[0].email).toBe('trader@example.com');
      expect(body.to[0].name).toBe('John Doe');
      expect(body.subject).toContain('#42');
      expect(body.subject).toContain('Waitlist');
      expect(body.htmlContent).toContain('John Doe');
      expect(body.htmlContent).toContain('#42');
      expect(body.htmlContent).toContain('Retail Trader');
      expect(body.htmlContent).toContain('Professional Plan');
    });

    it('should handle different user types', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messageId: 'msg-789' }),
      });

      await sendWaitlistWelcomeEmail(
        { email: 'fund@example.com', name: 'Jane Smith' },
        100,
        'fund_manager'
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      
      expect(body.htmlContent).toContain('Fund Manager');
    });
  });
});

describe('Brevo API Key Validation (Live)', () => {
  it('should validate the configured Brevo API key', async () => {
    // This test uses the real API key from environment
    // Reset mock to use real fetch
    vi.restoreAllMocks();
    
    // Skip if no API key configured
    if (!process.env.BREVO_API_KEY || process.env.BREVO_API_KEY === 'test-api-key') {
      console.log('Skipping live API test - no real API key configured');
      return;
    }

    const result = await validateBrevoApiKey();
    expect(result.valid).toBe(true);
  });
});
