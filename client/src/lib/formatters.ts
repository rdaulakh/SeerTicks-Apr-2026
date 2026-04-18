/**
 * Number formatting utilities for consistent display across the app
 */

/**
 * Format percentage with 1 decimal place
 * @param value - Number to format (can be 0-1 or 0-100 scale)
 * @param isDecimal - If true, treats value as 0-1 and multiplies by 100
 */
export function formatPercentage(value: number, isDecimal = false): string {
  const percentage = isDecimal ? value * 100 : value;
  return `${percentage.toFixed(1)}%`;
}

/**
 * Format execution score (0-100) with no decimals
 */
export function formatExecutionScore(score: number): string {
  return Math.round(score).toString();
}

/**
 * Format confidence score (0-100) with 1 decimal place
 */
export function formatConfidence(confidence: number): string {
  return confidence.toFixed(1);
}

/**
 * Format weight (0-100) with 1 decimal place
 */
export function formatWeight(weight: number): string {
  return weight.toFixed(1);
}
