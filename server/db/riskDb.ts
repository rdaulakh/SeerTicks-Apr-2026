/**
 * Database helpers for risk management tables
 */

import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { getDb } from '../db';
import {
  strategies,
  riskMetrics,
  capitalAllocations,
  riskEvents,
  portfolioSnapshots,
  positionRiskMetrics,
  type Strategy,
  type InsertStrategy,
  type RiskMetric,
  type InsertRiskMetric,
  type CapitalAllocation,
  type InsertCapitalAllocation,
  type RiskEvent,
  type InsertRiskEvent,
  type PortfolioSnapshot,
  type InsertPortfolioSnapshot,
  type PositionRiskMetric,
  type InsertPositionRiskMetric,
} from '../../drizzle/schema';

// ============================================================================
// STRATEGIES
// ============================================================================

export async function createStrategy(strategy: InsertStrategy): Promise<Strategy> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.insert(strategies).values(strategy);
  const insertedId = Number(result[0].insertId);

  const inserted = await db.select().from(strategies).where(eq(strategies.id, insertedId)).limit(1);
  return inserted[0];
}

export async function getStrategyById(id: number): Promise<Strategy | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(strategies).where(eq(strategies.id, id)).limit(1);
  return result[0];
}

export async function getStrategiesByUserId(userId: number): Promise<Strategy[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(strategies).where(eq(strategies.userId, userId));
}

export async function getActiveStrategies(userId: number): Promise<Strategy[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(strategies)
    .where(and(eq(strategies.userId, userId), eq(strategies.status, 'active')));
}

export async function updateStrategy(
  id: number,
  updates: Partial<InsertStrategy>
): Promise<Strategy | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  await db.update(strategies).set(updates).where(eq(strategies.id, id));

  return getStrategyById(id);
}

// ============================================================================
// RISK METRICS
// ============================================================================

export async function createRiskMetric(metric: InsertRiskMetric): Promise<RiskMetric> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.insert(riskMetrics).values(metric);
  const insertedId = Number(result[0].insertId);

  const inserted = await db.select().from(riskMetrics).where(eq(riskMetrics.id, insertedId)).limit(1);
  return inserted[0];
}

export async function getLatestRiskMetric(userId: number): Promise<RiskMetric | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(riskMetrics)
    .where(eq(riskMetrics.userId, userId))
    .orderBy(desc(riskMetrics.timestamp))
    .limit(1);

  return result[0];
}

export async function getRiskMetricsHistory(
  userId: number,
  startDate: Date,
  endDate: Date
): Promise<RiskMetric[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(riskMetrics)
    .where(
      and(
        eq(riskMetrics.userId, userId),
        gte(riskMetrics.timestamp, startDate),
        lte(riskMetrics.timestamp, endDate)
      )
    )
    .orderBy(riskMetrics.timestamp);
}

// ============================================================================
// CAPITAL ALLOCATIONS
// ============================================================================

export async function createCapitalAllocation(
  allocation: InsertCapitalAllocation
): Promise<CapitalAllocation> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.insert(capitalAllocations).values(allocation);
  const insertedId = Number(result[0].insertId);

  const inserted = await db
    .select()
    .from(capitalAllocations)
    .where(eq(capitalAllocations.id, insertedId))
    .limit(1);
  return inserted[0];
}

export async function getLatestCapitalAllocation(
  userId: number
): Promise<CapitalAllocation | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(capitalAllocations)
    .where(eq(capitalAllocations.userId, userId))
    .orderBy(desc(capitalAllocations.timestamp))
    .limit(1);

  return result[0];
}

export async function getCapitalAllocationHistory(
  userId: number,
  limit: number = 30
): Promise<CapitalAllocation[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(capitalAllocations)
    .where(eq(capitalAllocations.userId, userId))
    .orderBy(desc(capitalAllocations.timestamp))
    .limit(limit);
}

// ============================================================================
// RISK EVENTS
// ============================================================================

export async function createRiskEvent(event: InsertRiskEvent): Promise<RiskEvent> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.insert(riskEvents).values(event);
  const insertedId = Number(result[0].insertId);

  const inserted = await db.select().from(riskEvents).where(eq(riskEvents.id, insertedId)).limit(1);
  return inserted[0];
}

export async function getUnresolvedRiskEvents(userId: number): Promise<RiskEvent[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(riskEvents)
    .where(and(eq(riskEvents.userId, userId), eq(riskEvents.resolved, false)))
    .orderBy(desc(riskEvents.timestamp));
}

export async function getRiskEventsHistory(
  userId: number,
  limit: number = 50
): Promise<RiskEvent[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(riskEvents)
    .where(eq(riskEvents.userId, userId))
    .orderBy(desc(riskEvents.timestamp))
    .limit(limit);
}

export async function resolveRiskEvent(
  id: number,
  resolutionNotes: string
): Promise<RiskEvent | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  await db
    .update(riskEvents)
    .set({
      resolved: true,
      resolvedAt: new Date(),
      resolutionNotes,
    })
    .where(eq(riskEvents.id, id));

  const result = await db.select().from(riskEvents).where(eq(riskEvents.id, id)).limit(1);
  return result[0];
}

// ============================================================================
// PORTFOLIO SNAPSHOTS
// ============================================================================

export async function createPortfolioSnapshot(
  snapshot: InsertPortfolioSnapshot
): Promise<PortfolioSnapshot> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.insert(portfolioSnapshots).values(snapshot);
  const insertedId = Number(result[0].insertId);

  const inserted = await db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.id, insertedId))
    .limit(1);
  return inserted[0];
}

export async function getPortfolioSnapshotsHistory(
  userId: number,
  days: number = 90
): Promise<PortfolioSnapshot[]> {
  const db = await getDb();
  if (!db) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return db
    .select()
    .from(portfolioSnapshots)
    .where(
      and(eq(portfolioSnapshots.userId, userId), gte(portfolioSnapshots.snapshotDate, startDate))
    )
    .orderBy(portfolioSnapshots.snapshotDate);
}

export async function getLatestPortfolioSnapshot(
  userId: number
): Promise<PortfolioSnapshot | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.userId, userId))
    .orderBy(desc(portfolioSnapshots.snapshotDate))
    .limit(1);

  return result[0];
}

// ============================================================================
// POSITION RISK METRICS
// ============================================================================

export async function createPositionRiskMetric(
  metric: InsertPositionRiskMetric
): Promise<PositionRiskMetric> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.insert(positionRiskMetrics).values(metric);
  const insertedId = Number(result[0].insertId);

  const inserted = await db
    .select()
    .from(positionRiskMetrics)
    .where(eq(positionRiskMetrics.id, insertedId))
    .limit(1);
  return inserted[0];
}

export async function getLatestPositionRiskMetric(
  positionId: number
): Promise<PositionRiskMetric | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(positionRiskMetrics)
    .where(eq(positionRiskMetrics.positionId, positionId))
    .orderBy(desc(positionRiskMetrics.timestamp))
    .limit(1);

  return result[0];
}

export async function getPositionRiskMetricsForUser(
  userId: number
): Promise<PositionRiskMetric[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(positionRiskMetrics)
    .where(eq(positionRiskMetrics.userId, userId))
    .orderBy(desc(positionRiskMetrics.timestamp));
}
