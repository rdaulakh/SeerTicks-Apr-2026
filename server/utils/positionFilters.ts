/**
 * Position Filters - Test/Production Separation
 * 
 * PURPOSE: Cleanly separate test positions from production positions
 * in all performance calculations, metrics, and reporting.
 * 
 * CONVENTION: Positions with strategy containing "test" (case-insensitive) 
 * are considered test positions and excluded from production metrics.
 */

// Strategy names that indicate test positions
const TEST_STRATEGY_PATTERNS = [
  'test',
  'demo',
  'simulation',
  'backtest',
  'paper_test',
];

/**
 * Check if a position is a test position based on its strategy name
 */
export function isTestPosition(strategy: string | null | undefined): boolean {
  if (!strategy) return false;
  const lowerStrategy = strategy.toLowerCase().trim();
  return TEST_STRATEGY_PATTERNS.some(pattern => lowerStrategy.includes(pattern));
}

/**
 * Check if a position is a production position
 */
export function isProductionPosition(strategy: string | null | undefined): boolean {
  return !isTestPosition(strategy);
}

/**
 * Filter an array of positions to only include production positions
 */
export function filterProductionPositions<T extends { strategy: string }>(positions: T[]): T[] {
  return positions.filter(p => isProductionPosition(p.strategy));
}

/**
 * Filter an array of positions to only include test positions
 */
export function filterTestPositions<T extends { strategy: string }>(positions: T[]): T[] {
  return positions.filter(p => isTestPosition(p.strategy));
}

/**
 * Get a SQL WHERE clause fragment for excluding test positions
 * Use in raw SQL queries: WHERE strategy NOT LIKE '%test%' AND strategy NOT LIKE '%demo%'
 */
export function getProductionFilterSQL(): string {
  return TEST_STRATEGY_PATTERNS
    .map(p => `strategy NOT LIKE '%${p}%'`)
    .join(' AND ');
}

/**
 * Separate positions into test and production buckets
 */
export function separatePositions<T extends { strategy: string }>(positions: T[]): {
  production: T[];
  test: T[];
} {
  const production: T[] = [];
  const test: T[] = [];
  
  for (const pos of positions) {
    if (isTestPosition(pos.strategy)) {
      test.push(pos);
    } else {
      production.push(pos);
    }
  }
  
  return { production, test };
}

export default {
  isTestPosition,
  isProductionPosition,
  filterProductionPositions,
  filterTestPositions,
  getProductionFilterSQL,
  separatePositions,
};
