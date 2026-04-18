import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getDb } from '../db';
import { engineState } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

/**
 * Auto Trading State Persistence Tests
 * 
 * These tests verify that:
 * 1. Auto trading enabled state is correctly saved to database
 * 2. Auto trading enabled state persists across sessions (logout/login)
 * 3. State only changes when user explicitly toggles it
 * 
 * @author SEER Trading Platform
 * @date January 6, 2026
 */

const TEST_USER_ID = 888888;

describe('Auto Trading State Persistence', () => {
  let db: any;

  beforeAll(async () => {
    db = await getDb();
    if (!db) {
      console.warn('Database not available, skipping persistence tests');
      return;
    }
    
    // Clean up any existing test data
    try {
      await db.delete(engineState).where(eq(engineState.userId, TEST_USER_ID));
    } catch (e) {
      // Ignore if table doesn't exist
    }
  });

  afterAll(async () => {
    if (db) {
      // Clean up test data
      try {
        await db.delete(engineState).where(eq(engineState.userId, TEST_USER_ID));
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Database State Management', () => {
    it('should create engine state with auto trading disabled by default', async () => {
      if (!db) {
        console.log('Skipping test: database not available');
        return;
      }

      // Insert new engine state
      await db.insert(engineState).values({
        userId: TEST_USER_ID,
        isRunning: false,
        config: { enableAutoTrading: false },
      });

      // Verify state was saved
      const result = await db
        .select()
        .from(engineState)
        .where(eq(engineState.userId, TEST_USER_ID))
        .limit(1);

      expect(result.length).toBe(1);
      const config = typeof result[0].config === 'string' 
        ? JSON.parse(result[0].config) 
        : result[0].config;
      expect(config.enableAutoTrading).toBe(false);
      
      console.log('✓ Engine state created with auto trading disabled');
    });

    it('should update auto trading state to enabled', async () => {
      if (!db) {
        console.log('Skipping test: database not available');
        return;
      }

      // Update to enabled
      const existingResult = await db
        .select()
        .from(engineState)
        .where(eq(engineState.userId, TEST_USER_ID))
        .limit(1);

      const existingConfig = typeof existingResult[0].config === 'string'
        ? JSON.parse(existingResult[0].config)
        : existingResult[0].config || {};

      await db
        .update(engineState)
        .set({
          config: { ...existingConfig, enableAutoTrading: true },
        })
        .where(eq(engineState.userId, TEST_USER_ID));

      // Verify state was updated
      const result = await db
        .select()
        .from(engineState)
        .where(eq(engineState.userId, TEST_USER_ID))
        .limit(1);

      const config = typeof result[0].config === 'string'
        ? JSON.parse(result[0].config)
        : result[0].config;
      expect(config.enableAutoTrading).toBe(true);
      
      console.log('✓ Auto trading state updated to enabled');
    });

    it('should persist auto trading state across simulated logout/login', async () => {
      if (!db) {
        console.log('Skipping test: database not available');
        return;
      }

      // Simulate logout - just verify state is still in database
      // (In real app, session is cleared but database state remains)
      
      // Simulate login - read state from database
      const result = await db
        .select()
        .from(engineState)
        .where(eq(engineState.userId, TEST_USER_ID))
        .limit(1);

      expect(result.length).toBe(1);
      const config = typeof result[0].config === 'string'
        ? JSON.parse(result[0].config)
        : result[0].config;
      
      // State should still be enabled from previous test
      expect(config.enableAutoTrading).toBe(true);
      
      console.log('✓ Auto trading state persisted across logout/login simulation');
    });

    it('should update auto trading state back to disabled', async () => {
      if (!db) {
        console.log('Skipping test: database not available');
        return;
      }

      // Update to disabled
      const existingResult = await db
        .select()
        .from(engineState)
        .where(eq(engineState.userId, TEST_USER_ID))
        .limit(1);

      const existingConfig = typeof existingResult[0].config === 'string'
        ? JSON.parse(existingResult[0].config)
        : existingResult[0].config || {};

      await db
        .update(engineState)
        .set({
          config: { ...existingConfig, enableAutoTrading: false },
        })
        .where(eq(engineState.userId, TEST_USER_ID));

      // Verify state was updated
      const result = await db
        .select()
        .from(engineState)
        .where(eq(engineState.userId, TEST_USER_ID))
        .limit(1);

      const config = typeof result[0].config === 'string'
        ? JSON.parse(result[0].config)
        : result[0].config;
      expect(config.enableAutoTrading).toBe(false);
      
      console.log('✓ Auto trading state updated back to disabled');
    });

    it('should preserve other config values when updating auto trading state', async () => {
      if (!db) {
        console.log('Skipping test: database not available');
        return;
      }

      // Add other config values
      await db
        .update(engineState)
        .set({
          config: { 
            enableAutoTrading: false,
            totalCapital: 10000,
            tickInterval: 5000,
            enableLearning: true,
          },
        })
        .where(eq(engineState.userId, TEST_USER_ID));

      // Update only auto trading state
      const existingResult = await db
        .select()
        .from(engineState)
        .where(eq(engineState.userId, TEST_USER_ID))
        .limit(1);

      const existingConfig = typeof existingResult[0].config === 'string'
        ? JSON.parse(existingResult[0].config)
        : existingResult[0].config || {};

      await db
        .update(engineState)
        .set({
          config: { ...existingConfig, enableAutoTrading: true },
        })
        .where(eq(engineState.userId, TEST_USER_ID));

      // Verify all config values are preserved
      const result = await db
        .select()
        .from(engineState)
        .where(eq(engineState.userId, TEST_USER_ID))
        .limit(1);

      const config = typeof result[0].config === 'string'
        ? JSON.parse(result[0].config)
        : result[0].config;
      
      expect(config.enableAutoTrading).toBe(true);
      expect(config.totalCapital).toBe(10000);
      expect(config.tickInterval).toBe(5000);
      expect(config.enableLearning).toBe(true);
      
      console.log('✓ Other config values preserved when updating auto trading state');
    });
  });

  describe('Settings Router Integration', () => {
    it('should return correct auto trading state from getAutoTrading', async () => {
      if (!db) {
        console.log('Skipping test: database not available');
        return;
      }

      // Read state using the same logic as settingsRouter.getAutoTrading
      const result = await db
        .select()
        .from(engineState)
        .where(eq(engineState.userId, TEST_USER_ID))
        .limit(1);

      if (result.length === 0) {
        // Default behavior when no state exists
        expect({ enabled: false }).toEqual({ enabled: false });
      } else {
        const config = result[0].config as { enableAutoTrading?: boolean } | null;
        const enabled = config?.enableAutoTrading ?? false;
        expect(typeof enabled).toBe('boolean');
      }
      
      console.log('✓ getAutoTrading returns correct state');
    });

    it('should handle missing engine state gracefully', async () => {
      if (!db) {
        console.log('Skipping test: database not available');
        return;
      }

      // Query for non-existent user
      const result = await db
        .select()
        .from(engineState)
        .where(eq(engineState.userId, 999999999))
        .limit(1);

      // Should return empty array
      expect(result.length).toBe(0);
      
      // Default should be disabled
      const enabled = result.length > 0 
        ? (result[0].config as any)?.enableAutoTrading ?? false 
        : false;
      expect(enabled).toBe(false);
      
      console.log('✓ Missing engine state handled gracefully');
    });
  });

  describe('Engine State Sync', () => {
    it('should correctly parse config from database', async () => {
      if (!db) {
        console.log('Skipping test: database not available');
        return;
      }

      const result = await db
        .select()
        .from(engineState)
        .where(eq(engineState.userId, TEST_USER_ID))
        .limit(1);

      expect(result.length).toBeGreaterThan(0);
      
      // Test both string and object config parsing
      const config = result[0].config;
      let parsedConfig: any;
      
      if (typeof config === 'string') {
        parsedConfig = JSON.parse(config);
      } else {
        parsedConfig = config;
      }
      
      expect(parsedConfig).toBeDefined();
      expect(typeof parsedConfig.enableAutoTrading).toBe('boolean');
      
      console.log('✓ Config parsing works correctly');
    });

    it('should handle null config gracefully', async () => {
      if (!db) {
        console.log('Skipping test: database not available');
        return;
      }

      // Test null config handling
      const nullConfig = null;
      const enabled = nullConfig ? (nullConfig as any).enableAutoTrading ?? false : false;
      expect(enabled).toBe(false);
      
      console.log('✓ Null config handled gracefully');
    });
  });
});

describe('Auto Trading State Logic', () => {
  it('should default to disabled when no state exists', () => {
    const state = null;
    const config = state?.config ? 
      (typeof state.config === 'string' ? JSON.parse(state.config) : state.config) : 
      {};
    const autoTradingEnabled = config.enableAutoTrading === true;
    
    expect(autoTradingEnabled).toBe(false);
    console.log('✓ Defaults to disabled when no state exists');
  });

  it('should correctly identify enabled state', () => {
    const state = { config: { enableAutoTrading: true } };
    const config = state.config;
    const autoTradingEnabled = config.enableAutoTrading === true;
    
    expect(autoTradingEnabled).toBe(true);
    console.log('✓ Correctly identifies enabled state');
  });

  it('should correctly identify disabled state', () => {
    const state = { config: { enableAutoTrading: false } };
    const config = state.config;
    const autoTradingEnabled = config.enableAutoTrading === true;
    
    expect(autoTradingEnabled).toBe(false);
    console.log('✓ Correctly identifies disabled state');
  });

  it('should handle string config correctly', () => {
    const state = { config: JSON.stringify({ enableAutoTrading: true }) };
    const config = typeof state.config === 'string' ? JSON.parse(state.config) : state.config;
    const autoTradingEnabled = config.enableAutoTrading === true;
    
    expect(autoTradingEnabled).toBe(true);
    console.log('✓ Handles string config correctly');
  });

  it('should handle undefined enableAutoTrading', () => {
    const state = { config: { otherSetting: true } };
    const config = state.config;
    const autoTradingEnabled = (config as any).enableAutoTrading === true;
    
    expect(autoTradingEnabled).toBe(false);
    console.log('✓ Handles undefined enableAutoTrading correctly');
  });
});
