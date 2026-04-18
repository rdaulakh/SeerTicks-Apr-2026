/**
 * Structured Logger for SEER Trading Platform
 *
 * Zero-overhead when below threshold — no object allocation on hot path.
 * Uses synchronous console.log (no I/O blocking) with JSON structure.
 *
 * Log levels: error=0, warn=1, info=2, debug=3, trace=4
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.info('Trade executed', { symbol: 'BTCUSDT', pnl: 0.5 });
 *   logger.error('Connection failed', { exchange: 'coinbase', error: err.message });
 *
 * For agent-specific logging:
 *   const agentLog = logger.child({ agent: 'TechnicalAnalyst' });
 *   agentLog.info('Signal generated', { signal: 'bullish', confidence: 0.85 });
 */

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LEVEL_VALUES: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const ENV_LEVEL = (process.env.LOG_LEVEL || 'info') as LogLevel;
const THRESHOLD = LEVEL_VALUES[ENV_LEVEL] ?? 2;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

interface LogEntry {
  level: LogLevel;
  ts: string;
  msg: string;
  [key: string]: unknown;
}

class Logger {
  private context: Record<string, unknown>;

  constructor(context: Record<string, unknown> = {}) {
    this.context = context;
  }

  /** Create a child logger with additional context fields */
  child(ctx: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...ctx });
  }

  error(msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_VALUES.error > THRESHOLD) return;
    this.write('error', msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_VALUES.warn > THRESHOLD) return;
    this.write('warn', msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_VALUES.info > THRESHOLD) return;
    this.write('info', msg, data);
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_VALUES.debug > THRESHOLD) return;
    this.write('debug', msg, data);
  }

  trace(msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_VALUES.trace > THRESHOLD) return;
    this.write('trace', msg, data);
  }

  private write(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (IS_PRODUCTION) {
      // Structured JSON for production log aggregation
      const entry: LogEntry = {
        level,
        ts: new Date().toISOString(),
        msg,
        ...this.context,
        ...data,
      };
      const output = JSON.stringify(entry);
      if (level === 'error') {
        process.stderr.write(output + '\n');
      } else {
        process.stdout.write(output + '\n');
      }
    } else {
      // Human-readable for development
      const prefix = `[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}]`;
      const ctxStr = Object.keys(this.context).length > 0
        ? ` ${Object.entries(this.context).map(([k, v]) => `${k}=${v}`).join(' ')}`
        : '';
      const dataStr = data
        ? ` ${Object.entries(data).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')}`
        : '';
      const line = `${prefix}${ctxStr} ${msg}${dataStr}`;
      if (level === 'error') {
        console.error(line);
      } else if (level === 'warn') {
        console.warn(line);
      } else {
        console.log(line);
      }
    }
  }
}

/** Global logger instance */
export const logger = new Logger();

/** Pre-built child loggers for high-frequency subsystems */
export const tradingLogger = logger.child({ subsystem: 'trading' });
export const authLogger = logger.child({ subsystem: 'auth' });
export const agentLogger = logger.child({ subsystem: 'agents' });
export const wsLogger = logger.child({ subsystem: 'websocket' });
export const engineLogger = logger.child({ subsystem: 'engine' });
export const exitLogger = logger.child({ subsystem: 'exits' });
export const riskLogger = logger.child({ subsystem: 'risk' });
export const executionLogger = logger.child({ subsystem: 'execution' });
export const orchestratorLogger = logger.child({ subsystem: 'orchestrator' });
export const mlLogger = logger.child({ subsystem: 'ml' });
