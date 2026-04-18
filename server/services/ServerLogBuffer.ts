/**
 * Server Log Buffer — Ring buffer for server-side log capture
 * 
 * Intercepts console.log/warn/error and stores in a ring buffer.
 * Provides API for the System Logs page to query recent logs.
 * 
 * Categories are auto-detected from log prefixes:
 * [WebSocket], [Trading], [Agent], [ProcessManager], etc.
 */

export interface LogEntry {
  id: number;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  category: string;
  message: string;
  source?: string;
}

const MAX_BUFFER_SIZE = 2000; // Keep last 2000 log entries

class ServerLogBuffer {
  private buffer: LogEntry[] = [];
  private nextId = 1;
  private initialized = false;

  /**
   * Initialize log interception.
   * Call ONCE at server startup, before any other code runs.
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    const originalLog = console.log.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);
    const originalDebug = console.debug.bind(console);

    // Intercept console.log
    console.log = (...args: any[]) => {
      originalLog(...args);
      this.addEntry('info', args);
    };

    // Intercept console.warn
    console.warn = (...args: any[]) => {
      originalWarn(...args);
      this.addEntry('warn', args);
    };

    // Intercept console.error
    console.error = (...args: any[]) => {
      originalError(...args);
      this.addEntry('error', args);
    };

    // Intercept console.debug
    console.debug = (...args: any[]) => {
      originalDebug(...args);
      this.addEntry('debug', args);
    };
  }

  /**
   * Add a log entry to the buffer
   */
  private addEntry(level: LogEntry['level'], args: any[]): void {
    const message = args.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.message}\n${arg.stack || ''}`;
      try { return JSON.stringify(arg); } catch { return String(arg); }
    }).join(' ');

    const category = this.detectCategory(message);
    const source = this.detectSource(message);

    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: Date.now(),
      level,
      category,
      message: message.substring(0, 2000), // Limit message size
      source,
    };

    this.buffer.push(entry);

    // Trim buffer if over max size
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer = this.buffer.slice(-MAX_BUFFER_SIZE);
    }
  }

  /**
   * Auto-detect log category from message prefix
   */
  private detectCategory(message: string): string {
    const lower = message.toLowerCase();
    
    // Match [Prefix] patterns
    const prefixMatch = message.match(/^\[([^\]]+)\]/);
    if (prefixMatch) {
      const prefix = prefixMatch[1].toLowerCase();
      if (prefix.includes('websocket') || prefix.includes('ws')) return 'websocket';
      if (prefix.includes('trading') || prefix.includes('trade') || prefix.includes('position')) return 'trading';
      if (prefix.includes('agent') || prefix.includes('consensus')) return 'agents';
      if (prefix.includes('process') || prefix.includes('signal')) return 'system';
      if (prefix.includes('health') || prefix.includes('monitor')) return 'health';
      if (prefix.includes('database') || prefix.includes('db')) return 'database';
      if (prefix.includes('price') || prefix.includes('tick') || prefix.includes('candle')) return 'market_data';
      if (prefix.includes('exit') || prefix.includes('entry')) return 'trading';
      if (prefix.includes('engine') || prefix.includes('global')) return 'engine';
      if (prefix.includes('oauth') || prefix.includes('auth')) return 'auth';
      if (prefix.includes('api') || prefix.includes('rate')) return 'api';
      return 'general';
    }

    // Fallback pattern matching
    if (lower.includes('trade') || lower.includes('position') || lower.includes('order')) return 'trading';
    if (lower.includes('websocket') || lower.includes('ws ')) return 'websocket';
    if (lower.includes('agent') || lower.includes('consensus')) return 'agents';
    if (lower.includes('price') || lower.includes('tick')) return 'market_data';
    if (lower.includes('error') || lower.includes('fatal') || lower.includes('crash')) return 'error';
    
    return 'general';
  }

  /**
   * Detect source file/module from log message
   */
  private detectSource(message: string): string | undefined {
    const prefixMatch = message.match(/^\[([^\]]+)\]/);
    return prefixMatch ? prefixMatch[1] : undefined;
  }

  /**
   * Get recent logs with optional filtering
   */
  getLogs(options?: {
    limit?: number;
    afterId?: number;
    level?: LogEntry['level'];
    category?: string;
    search?: string;
  }): { logs: LogEntry[]; totalCount: number; oldestId: number; newestId: number } {
    let filtered = this.buffer;

    if (options?.afterId) {
      filtered = filtered.filter(e => e.id > options.afterId!);
    }

    if (options?.level) {
      filtered = filtered.filter(e => e.level === options.level);
    }

    if (options?.category) {
      filtered = filtered.filter(e => e.category === options.category);
    }

    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      filtered = filtered.filter(e => e.message.toLowerCase().includes(searchLower));
    }

    const limit = options?.limit || 200;
    const logs = filtered.slice(-limit);

    return {
      logs,
      totalCount: this.buffer.length,
      oldestId: this.buffer.length > 0 ? this.buffer[0].id : 0,
      newestId: this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].id : 0,
    };
  }

  /**
   * Get log statistics for the health dashboard
   */
  getStats(): {
    totalEntries: number;
    byLevel: Record<string, number>;
    byCategory: Record<string, number>;
    errorsLast5Min: number;
    warningsLast5Min: number;
  } {
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;

    const byLevel: Record<string, number> = { info: 0, warn: 0, error: 0, debug: 0 };
    const byCategory: Record<string, number> = {};
    let errorsLast5Min = 0;
    let warningsLast5Min = 0;

    for (const entry of this.buffer) {
      byLevel[entry.level] = (byLevel[entry.level] || 0) + 1;
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
      if (entry.timestamp >= fiveMinAgo) {
        if (entry.level === 'error') errorsLast5Min++;
        if (entry.level === 'warn') warningsLast5Min++;
      }
    }

    return {
      totalEntries: this.buffer.length,
      byLevel,
      byCategory,
      errorsLast5Min,
      warningsLast5Min,
    };
  }

  /**
   * Get available categories
   */
  getCategories(): string[] {
    const categories = new Set<string>();
    for (const entry of this.buffer) {
      categories.add(entry.category);
    }
    return Array.from(categories).sort();
  }
}

// Singleton
let instance: ServerLogBuffer | null = null;

export function getServerLogBuffer(): ServerLogBuffer {
  if (!instance) {
    instance = new ServerLogBuffer();
  }
  return instance;
}

export function initializeLogBuffer(): void {
  getServerLogBuffer().initialize();
}
