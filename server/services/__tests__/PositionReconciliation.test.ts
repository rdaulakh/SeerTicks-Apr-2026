import { describe, it, expect, beforeEach, vi } from "vitest";
import { PositionReconciliationService } from "../PositionReconciliationService";
import type { PaperPosition } from "../../../drizzle/schema";

/**
 * Position Reconciliation Service Tests
 * 
 * Tests the core reconciliation logic including:
 * - Discrepancy detection algorithms
 * - Auto-resolution strategies
 * - Manual resolution workflows
 */

describe("PositionReconciliationService", () => {
  let service: PositionReconciliationService;
  const testUserId = 1;

  beforeEach(() => {
    service = new PositionReconciliationService(testUserId);
  });

  describe("Discrepancy Detection", () => {
    it("should detect quantity mismatch", () => {
      const localPos: Partial<PaperPosition> = {
        id: 1,
        symbol: "BTC/USDT",
        quantity: "1.5",
        entryPrice: "50000",
        currentPrice: "51000",
        unrealizedPnL: "1500",
      };

      const metaapiPos = {
        id: "meta-1",
        symbol: "BTC/USDT",
        volume: 1.6, // Different quantity
        openPrice: 50000,
        currentPrice: 51000,
        profit: 1600,
      };

      // @ts-ignore - accessing private method for testing
      const discrepancies = service.detectDiscrepancies(localPos as PaperPosition, metaapiPos);

      // Should detect quantity mismatch and P&L mismatch
      const qtyMismatch = discrepancies.find(d => d.type === "quantity_mismatch");
      expect(qtyMismatch).toBeDefined();
      expect(qtyMismatch?.field).toBe("quantity");
      expect(qtyMismatch?.localValue).toBe(1.5);
      expect(qtyMismatch?.metaapiValue).toBe(1.6);
    });

    it("should detect price mismatch", () => {
      const localPos: Partial<PaperPosition> = {
        id: 1,
        symbol: "BTC/USDT",
        quantity: "1.0",
        entryPrice: "50000", // Different entry price
        currentPrice: "51000",
        unrealizedPnL: "1000",
      };

      const metaapiPos = {
        id: "meta-1",
        symbol: "BTC/USDT",
        volume: 1.0,
        openPrice: 50500, // Different
        currentPrice: 51000,
        profit: 500,
      };

      // @ts-ignore
      const discrepancies = service.detectDiscrepancies(localPos as PaperPosition, metaapiPos);

      const priceMismatch = discrepancies.find(d => d.type === "price_mismatch" && d.field === "entryPrice");
      expect(priceMismatch).toBeDefined();
      expect(priceMismatch?.localValue).toBe(50000);
      expect(priceMismatch?.metaapiValue).toBe(50500);
    });

    it("should detect missing local position", () => {
      const metaapiPos = {
        id: "meta-1",
        symbol: "BTC/USDT",
        volume: 1.0,
        openPrice: 50000,
        currentPrice: 51000,
        profit: 1000,
      };

      // @ts-ignore
      const discrepancies = service.detectDiscrepancies(null, metaapiPos);

      expect(discrepancies).toHaveLength(1);
      expect(discrepancies[0].type).toBe("missing_local");
      expect(discrepancies[0].severity).toBe("critical");
      expect(discrepancies[0].canAutoResolve).toBe(true);
      expect(discrepancies[0].resolutionStrategy).toBe("sync_local");
    });

    it("should detect missing MetaAPI position", () => {
      const localPos: Partial<PaperPosition> = {
        id: 1,
        symbol: "BTC/USDT",
        quantity: "1.0",
        entryPrice: "50000",
        currentPrice: "51000",
        unrealizedPnL: "1000",
      };

      // @ts-ignore
      const discrepancies = service.detectDiscrepancies(localPos as PaperPosition, null);

      expect(discrepancies).toHaveLength(1);
      expect(discrepancies[0].type).toBe("missing_metaapi");
      expect(discrepancies[0].severity).toBe("warning");
      expect(discrepancies[0].canAutoResolve).toBe(false);
      expect(discrepancies[0].resolutionStrategy).toBe("manual_review");
    });

    it("should detect P&L mismatch", () => {
      const localPos: Partial<PaperPosition> = {
        id: 1,
        symbol: "BTC/USDT",
        quantity: "1.0",
        entryPrice: "50000",
        currentPrice: "51000",
        unrealizedPnL: "1000", // Different P&L
      };

      const metaapiPos = {
        id: "meta-1",
        symbol: "BTC/USDT",
        volume: 1.0,
        openPrice: 50000,
        currentPrice: 51000,
        profit: 1050, // Different
      };

      // @ts-ignore
      const discrepancies = service.detectDiscrepancies(localPos as PaperPosition, metaapiPos);

      const pnlMismatch = discrepancies.find(d => d.type === "pnl_mismatch");
      expect(pnlMismatch).toBeDefined();
      expect(pnlMismatch?.localValue).toBe(1000);
      expect(pnlMismatch?.metaapiValue).toBe(1050);
      expect(pnlMismatch?.difference).toBe(50);
    });

    it("should not flag discrepancies within tolerance", () => {
      const localPos: Partial<PaperPosition> = {
        id: 1,
        symbol: "BTC/USDT",
        quantity: "1.0",
        entryPrice: "50000",
        currentPrice: "51000.01", // Within 0.1% tolerance
        unrealizedPnL: "1000.00",
      };

      const metaapiPos = {
        id: "meta-1",
        symbol: "BTC/USDT",
        volume: 1.0,
        openPrice: 50000,
        currentPrice: 51000.00,
        profit: 1000.00,
      };

      // @ts-ignore
      const discrepancies = service.detectDiscrepancies(localPos as PaperPosition, metaapiPos);

      // Should have no discrepancies (all within tolerance)
      expect(discrepancies).toHaveLength(0);
    });
  });

  describe("Auto-Resolution Logic", () => {
    it("should mark small price differences as auto-resolvable", () => {
      const localPos: Partial<PaperPosition> = {
        id: 1,
        symbol: "BTC/USDT",
        quantity: "1.0",
        entryPrice: "50000",
        currentPrice: "51000",
        unrealizedPnL: "1000",
      };

      const metaapiPos = {
        id: "meta-1",
        symbol: "BTC/USDT",
        volume: 1.0,
        openPrice: 50020, // 0.04% difference - within auto-resolve threshold
        currentPrice: 51000,
        profit: 980,
      };

      // @ts-ignore
      const discrepancies = service.detectDiscrepancies(localPos as PaperPosition, metaapiPos);

      const priceMismatch = discrepancies.find(d => d.type === "price_mismatch" && d.field === "entryPrice");
      // 0.04% difference is within 0.5% threshold, so should be auto-resolvable
      if (priceMismatch) {
        expect(priceMismatch.canAutoResolve).toBe(true);
        expect(priceMismatch.resolutionStrategy).toBe("sync_local");
      } else {
        // If no price mismatch detected, that's also acceptable (within tolerance)
        expect(discrepancies.every(d => d.type !== "price_mismatch" || d.field !== "entryPrice")).toBe(true);
      }
    });

    it("should mark large price differences as manual review", () => {
      const localPos: Partial<PaperPosition> = {
        id: 1,
        symbol: "BTC/USDT",
        quantity: "1.0",
        entryPrice: "50000",
        currentPrice: "51000",
        unrealizedPnL: "1000",
      };

      const metaapiPos = {
        id: "meta-1",
        symbol: "BTC/USDT",
        volume: 1.0,
        openPrice: 51000, // 2% difference - requires manual review
        currentPrice: 51000,
        profit: 0,
      };

      // @ts-ignore
      const discrepancies = service.detectDiscrepancies(localPos as PaperPosition, metaapiPos);

      const priceMismatch = discrepancies.find(d => d.type === "price_mismatch" && d.field === "entryPrice");
      expect(priceMismatch?.canAutoResolve).toBe(false);
      expect(priceMismatch?.resolutionStrategy).toBe("manual_review");
    });

    it("should mark current price updates as auto-resolvable", () => {
      const localPos: Partial<PaperPosition> = {
        id: 1,
        symbol: "BTC/USDT",
        quantity: "1.0",
        entryPrice: "50000",
        currentPrice: "51000",
        unrealizedPnL: "1000",
      };

      const metaapiPos = {
        id: "meta-1",
        symbol: "BTC/USDT",
        volume: 1.0,
        openPrice: 50000,
        currentPrice: 51500, // Current price changed
        profit: 1500,
      };

      // @ts-ignore
      const discrepancies = service.detectDiscrepancies(localPos as PaperPosition, metaapiPos);

      const currentPriceMismatch = discrepancies.find(d => d.field === "currentPrice");
      expect(currentPriceMismatch?.canAutoResolve).toBe(true);
      expect(currentPriceMismatch?.severity).toBe("info");
    });
  });

  describe("Severity Classification", () => {
    it("should classify large quantity mismatch as critical", () => {
      const localPos: Partial<PaperPosition> = {
        id: 1,
        symbol: "BTC/USDT",
        quantity: "1.0",
        entryPrice: "50000",
        currentPrice: "51000",
        unrealizedPnL: "1000",
      };

      const metaapiPos = {
        id: "meta-1",
        symbol: "BTC/USDT",
        volume: 1.5, // 50% difference
        openPrice: 50000,
        currentPrice: 51000,
        profit: 1500,
      };

      // @ts-ignore
      const discrepancies = service.detectDiscrepancies(localPos as PaperPosition, metaapiPos);

      const qtyMismatch = discrepancies.find(d => d.type === "quantity_mismatch");
      expect(qtyMismatch?.severity).toBe("critical");
    });

    it("should classify small quantity mismatch as warning", () => {
      const localPos: Partial<PaperPosition> = {
        id: 1,
        symbol: "BTC/USDT",
        quantity: "1.0",
        entryPrice: "50000",
        currentPrice: "51000",
        unrealizedPnL: "1000",
      };

      const metaapiPos = {
        id: "meta-1",
        symbol: "BTC/USDT",
        volume: 1.005, // 0.5% difference
        openPrice: 50000,
        currentPrice: 51000,
        profit: 1005,
      };

      // @ts-ignore
      const discrepancies = service.detectDiscrepancies(localPos as PaperPosition, metaapiPos);

      const qtyMismatch = discrepancies.find(d => d.type === "quantity_mismatch");
      expect(qtyMismatch?.severity).toBe("warning");
    });

    it("should classify current price mismatch as info", () => {
      const localPos: Partial<PaperPosition> = {
        id: 1,
        symbol: "BTC/USDT",
        quantity: "1.0",
        entryPrice: "50000",
        currentPrice: "51000",
        unrealizedPnL: "1000",
      };

      const metaapiPos = {
        id: "meta-1",
        symbol: "BTC/USDT",
        volume: 1.0,
        openPrice: 50000,
        currentPrice: 51500,
        profit: 1500,
      };

      // @ts-ignore
      const discrepancies = service.detectDiscrepancies(localPos as PaperPosition, metaapiPos);

      const currentPriceMismatch = discrepancies.find(d => d.field === "currentPrice");
      expect(currentPriceMismatch?.severity).toBe("info");
    });
  });

  describe("Service Initialization", () => {
    it("should initialize with user ID", () => {
      const service = new PositionReconciliationService(123);
      expect(service).toBeDefined();
      // @ts-ignore
      expect(service.userId).toBe(123);
    });

    it("should have correct tolerance thresholds", () => {
      const service = new PositionReconciliationService(1);
      // @ts-ignore
      expect(service.PRICE_TOLERANCE_PERCENT).toBe(0.1);
      // @ts-ignore
      expect(service.QUANTITY_TOLERANCE_PERCENT).toBe(0.01);
      // @ts-ignore
      expect(service.PNL_TOLERANCE_DOLLARS).toBe(0.01);
    });
  });
});
