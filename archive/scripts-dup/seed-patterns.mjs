import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

// Create database connection
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

// 14 validated patterns from VALIDATED_PATTERNS.md
const patterns = [
  // 1d timeframe patterns (4 patterns)
  {
    patternName: 'Double Bottom',
    symbol: 'BTCUSDT',
    timeframe: '1d',
    patternDescription: 'Double bottom pattern on daily timeframe - highest win rate',
    totalTrades: 2,
    winningTrades: 2,
    winRate: '1.0000', // 100%
    avgPnl: '0.03000000', // 3%
    profitFactor: '99.99', // Infinity (no losses)
    confidenceScore: 100,
    stopLoss: '1.50',
    takeProfit: '3.00',
    maxHold: 5,
    isActive: true,
    alphaDecayFlag: false,
  },
  {
    patternName: 'Bullish Engulfing',
    symbol: 'BTCUSDT',
    timeframe: '1d',
    patternDescription: 'Bullish engulfing candlestick pattern on daily timeframe',
    totalTrades: 39,
    winningTrades: 31,
    winRate: '0.7950', // 79.5%
    avgPnl: '0.03000000', // 3%
    profitFactor: '5.50',
    confidenceScore: 95,
    stopLoss: '1.50',
    takeProfit: '3.00',
    maxHold: 5,
    isActive: true,
    alphaDecayFlag: false,
  },
  {
    patternName: 'Double Top',
    symbol: 'BTCUSDT',
    timeframe: '1d',
    patternDescription: 'Double top pattern on daily timeframe',
    totalTrades: 9,
    winningTrades: 7,
    winRate: '0.7780', // 77.8%
    avgPnl: '0.03000000', // 3%
    profitFactor: '5.50',
    confidenceScore: 90,
    stopLoss: '1.50',
    takeProfit: '3.00',
    maxHold: 5,
    isActive: true,
    alphaDecayFlag: false,
  },
  {
    patternName: 'Bearish Engulfing',
    symbol: 'BTCUSDT',
    timeframe: '1d',
    patternDescription: 'Bearish engulfing candlestick pattern on daily timeframe',
    totalTrades: 25,
    winningTrades: 15,
    winRate: '0.6000', // 60%
    avgPnl: '0.03000000', // 3%
    profitFactor: '2.00',
    confidenceScore: 75,
    stopLoss: '1.50',
    takeProfit: '3.00',
    maxHold: 5,
    isActive: true,
    alphaDecayFlag: false,
  },
  
  // 4h timeframe patterns (6 patterns)
  {
    patternName: 'Double Bottom',
    symbol: 'BTCUSDT',
    timeframe: '4h',
    patternDescription: 'Double bottom pattern on 4-hour timeframe - excellent performance',
    totalTrades: 30,
    winningTrades: 27,
    winRate: '0.9000', // 90%
    avgPnl: '0.02937000', // 2.937%
    profitFactor: '9.00',
    confidenceScore: 95,
    stopLoss: '1.50',
    takeProfit: '3.00',
    maxHold: 20,
    isActive: true,
    alphaDecayFlag: false,
  },
  {
    patternName: 'Ascending Triangle',
    symbol: 'BTCUSDT',
    timeframe: '4h',
    patternDescription: 'Ascending triangle chart pattern on 4-hour timeframe',
    totalTrades: 22,
    winningTrades: 19,
    winRate: '0.8640', // 86.4%
    avgPnl: '0.02937000', // 2.937%
    profitFactor: '7.50',
    confidenceScore: 90,
    stopLoss: '1.50',
    takeProfit: '3.00',
    maxHold: 20,
    isActive: true,
    alphaDecayFlag: false,
  },
  {
    patternName: 'Descending Triangle',
    symbol: 'BTCUSDT',
    timeframe: '4h',
    patternDescription: 'Descending triangle chart pattern on 4-hour timeframe',
    totalTrades: 14,
    winningTrades: 10,
    winRate: '0.7140', // 71.4%
    avgPnl: '0.02937000', // 2.937%
    profitFactor: '3.50',
    confidenceScore: 80,
    stopLoss: '1.50',
    takeProfit: '3.00',
    maxHold: 20,
    isActive: true,
    alphaDecayFlag: false,
  },
  {
    patternName: 'Double Top',
    symbol: 'BTCUSDT',
    timeframe: '4h',
    patternDescription: 'Double top pattern on 4-hour timeframe',
    totalTrades: 30,
    winningTrades: 20,
    winRate: '0.6670', // 66.7%
    avgPnl: '0.02937000', // 2.937%
    profitFactor: '2.80',
    confidenceScore: 75,
    stopLoss: '1.50',
    takeProfit: '3.00',
    maxHold: 20,
    isActive: true,
    alphaDecayFlag: false,
  },
  {
    patternName: 'Bullish Engulfing',
    symbol: 'BTCUSDT',
    timeframe: '4h',
    patternDescription: 'Bullish engulfing candlestick pattern on 4-hour timeframe',
    totalTrades: 197,
    winningTrades: 114,
    winRate: '0.5790', // 57.9%
    avgPnl: '0.02937000', // 2.937%
    profitFactor: '2.00',
    confidenceScore: 70,
    stopLoss: '1.50',
    takeProfit: '3.00',
    maxHold: 20,
    isActive: true,
    alphaDecayFlag: false,
  },
  {
    patternName: 'Bearish Engulfing',
    symbol: 'BTCUSDT',
    timeframe: '4h',
    patternDescription: 'Bearish engulfing candlestick pattern on 4-hour timeframe',
    totalTrades: 183,
    winningTrades: 105,
    winRate: '0.5740', // 57.4%
    avgPnl: '0.02937000', // 2.937%
    profitFactor: '1.95',
    confidenceScore: 70,
    stopLoss: '1.50',
    takeProfit: '3.00',
    maxHold: 20,
    isActive: true,
    alphaDecayFlag: false,
  },
  
  // 5m timeframe patterns (4 patterns)
  {
    patternName: 'Bullish Engulfing',
    symbol: 'BTCUSDT',
    timeframe: '5m',
    patternDescription: 'Bullish engulfing candlestick pattern on 5-minute timeframe for scalping',
    totalTrades: 8663,
    winningTrades: 4938,
    winRate: '0.5700', // 57%
    avgPnl: '0.02000000', // 2%
    profitFactor: '1.80',
    confidenceScore: 65,
    stopLoss: '1.00',
    takeProfit: '2.00',
    maxHold: 50,
    isActive: true,
    alphaDecayFlag: false,
  },
  {
    patternName: 'Bearish Engulfing',
    symbol: 'BTCUSDT',
    timeframe: '5m',
    patternDescription: 'Bearish engulfing candlestick pattern on 5-minute timeframe for scalping',
    totalTrades: 8540,
    winningTrades: 4868,
    winRate: '0.5700', // 57%
    avgPnl: '0.02000000', // 2%
    profitFactor: '1.80',
    confidenceScore: 65,
    stopLoss: '1.00',
    takeProfit: '2.00',
    maxHold: 50,
    isActive: true,
    alphaDecayFlag: false,
  },
  {
    patternName: 'Hammer',
    symbol: 'BTCUSDT',
    timeframe: '5m',
    patternDescription: 'Hammer candlestick pattern on 5-minute timeframe',
    totalTrades: 3576,
    winningTrades: 1967,
    winRate: '0.5500', // 55%
    avgPnl: '0.02000000', // 2%
    profitFactor: '1.60',
    confidenceScore: 60,
    stopLoss: '1.00',
    takeProfit: '2.00',
    maxHold: 50,
    isActive: true,
    alphaDecayFlag: false,
  },
  {
    patternName: 'Shooting Star',
    symbol: 'BTCUSDT',
    timeframe: '5m',
    patternDescription: 'Shooting star candlestick pattern on 5-minute timeframe',
    totalTrades: 2587,
    winningTrades: 1423,
    winRate: '0.5500', // 55%
    avgPnl: '0.02000000', // 2%
    profitFactor: '1.60',
    confidenceScore: 60,
    stopLoss: '1.00',
    takeProfit: '2.00',
    maxHold: 50,
    isActive: true,
    alphaDecayFlag: false,
  },
];

// Insert patterns
console.log('Seeding validated patterns...');

for (const pattern of patterns) {
  try {
    await connection.execute(
      `INSERT INTO winningPatterns (
        patternName, symbol, timeframe, patternDescription, totalTrades, winningTrades,
        winRate, avgPnl, profitFactor, confidenceScore, stopLoss, takeProfit,
        maxHold, isActive, alphaDecayFlag
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pattern.patternName,
        pattern.symbol,
        pattern.timeframe,
        pattern.patternDescription,
        pattern.totalTrades,
        pattern.winningTrades,
        pattern.winRate,
        pattern.avgPnl,
        pattern.profitFactor,
        pattern.confidenceScore,
        pattern.stopLoss,
        pattern.takeProfit,
        pattern.maxHold,
        pattern.isActive,
        pattern.alphaDecayFlag,
      ]
    );
    console.log(`✓ Inserted: ${pattern.patternName} (${pattern.timeframe})`);
  } catch (error) {
    console.error(`✗ Failed to insert ${pattern.patternName} (${pattern.timeframe}):`, error.message);
  }
}

console.log('\nSeeding complete!');
await connection.end();
