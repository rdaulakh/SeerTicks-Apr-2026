/**
 * Signal Buffer Service
 * 
 * Buffers trading signals during connection disruptions to prevent signal loss.
 * Signals are stored temporarily and replayed when connections recover.
 * 
 * Key Features:
 * 1. Circular buffer with configurable size
 * 2. Automatic expiration of stale signals
 * 3. Priority-based signal ordering
 * 4. Deduplication to prevent duplicate trades
 * 5. Metrics for monitoring buffer health
 */

import { EventEmitter } from 'events';

export interface BufferedSignal {
  id: string;
  timestamp: number;
  type: 'entry' | 'exit' | 'adjustment';
  symbol: string;
  direction: 'long' | 'short';
  confidence: number;
  source: string;
  data: any;
  priority: number; // 1-10, higher = more urgent
  expiresAt: number;
  retryCount: number;
}

export interface SignalBufferConfig {
  maxSize: number;
  defaultTTLMs: number;
  highPriorityTTLMs: number;
  maxRetries: number;
  deduplicationWindowMs: number;
}

export interface SignalBufferStats {
  totalBuffered: number;
  totalProcessed: number;
  totalExpired: number;
  totalDropped: number;
  currentSize: number;
  oldestSignalAge: number;
  avgProcessingTime: number;
}

const DEFAULT_CONFIG: SignalBufferConfig = {
  maxSize: 500,
  defaultTTLMs: 60000,        // 1 minute default TTL
  highPriorityTTLMs: 300000,  // 5 minutes for high priority
  maxRetries: 3,
  deduplicationWindowMs: 5000, // 5 second dedup window
};

export class SignalBuffer extends EventEmitter {
  private config: SignalBufferConfig;
  private buffer: BufferedSignal[] = [];
  private processedSignals: Map<string, number> = new Map(); // id -> timestamp
  private stats: SignalBufferStats = {
    totalBuffered: 0,
    totalProcessed: 0,
    totalExpired: 0,
    totalDropped: 0,
    currentSize: 0,
    oldestSignalAge: 0,
    avgProcessingTime: 0,
  };
  private processingTimes: number[] = [];
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;

  constructor(config: Partial<SignalBufferConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the buffer service
   */
  start(): void {
    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSignals();
      this.cleanupProcessedHistory();
    }, 10000); // Every 10 seconds

    console.log('[SignalBuffer] Started with config:', {
      maxSize: this.config.maxSize,
      defaultTTLMs: this.config.defaultTTLMs,
    });
  }

  /**
   * Stop the buffer service
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    console.log('[SignalBuffer] Stopped');
  }

  /**
   * Add a signal to the buffer
   */
  addSignal(signal: Omit<BufferedSignal, 'id' | 'expiresAt' | 'retryCount'>): boolean {
    const now = Date.now();
    
    // Generate unique ID
    const id = `${signal.symbol}_${signal.type}_${signal.direction}_${now}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Check for duplicates
    if (this.isDuplicate(signal)) {
      console.log(`[SignalBuffer] Duplicate signal detected for ${signal.symbol}, skipping`);
      return false;
    }

    // Calculate TTL based on priority
    const ttl = signal.priority >= 7 ? this.config.highPriorityTTLMs : this.config.defaultTTLMs;
    
    const bufferedSignal: BufferedSignal = {
      ...signal,
      id,
      expiresAt: now + ttl,
      retryCount: 0,
    };

    // Check buffer capacity
    if (this.buffer.length >= this.config.maxSize) {
      // Remove lowest priority signal
      this.removeLowestPriority();
    }

    // Add to buffer (sorted by priority, then timestamp)
    this.insertSorted(bufferedSignal);
    
    this.stats.totalBuffered++;
    this.stats.currentSize = this.buffer.length;
    
    console.log(`[SignalBuffer] Buffered signal: ${signal.symbol} ${signal.type} ${signal.direction} (priority: ${signal.priority}, buffer size: ${this.buffer.length})`);
    
    this.emit('signal_buffered', bufferedSignal);
    return true;
  }

  /**
   * Get next signal to process (highest priority, oldest first)
   */
  getNextSignal(): BufferedSignal | null {
    if (this.buffer.length === 0) return null;
    
    // Clean up expired signals first
    this.cleanupExpiredSignals();
    
    if (this.buffer.length === 0) return null;
    
    // Return highest priority signal (first in sorted buffer)
    return this.buffer[0];
  }

  /**
   * Mark a signal as processed
   */
  markProcessed(signalId: string, processingTimeMs: number): void {
    const index = this.buffer.findIndex(s => s.id === signalId);
    if (index !== -1) {
      const signal = this.buffer[index];
      this.buffer.splice(index, 1);
      
      // Track processed signals for deduplication
      this.processedSignals.set(signalId, Date.now());
      
      // Update stats
      this.stats.totalProcessed++;
      this.stats.currentSize = this.buffer.length;
      this.processingTimes.push(processingTimeMs);
      if (this.processingTimes.length > 100) {
        this.processingTimes.shift();
      }
      this.stats.avgProcessingTime = this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length;
      
      console.log(`[SignalBuffer] Signal processed: ${signal.symbol} ${signal.type} (${processingTimeMs}ms)`);
      this.emit('signal_processed', signal);
    }
  }

  /**
   * Mark a signal as failed (will retry if under max retries)
   */
  markFailed(signalId: string, error: string): boolean {
    const index = this.buffer.findIndex(s => s.id === signalId);
    if (index !== -1) {
      const signal = this.buffer[index];
      signal.retryCount++;
      
      if (signal.retryCount >= this.config.maxRetries) {
        // Remove from buffer
        this.buffer.splice(index, 1);
        this.stats.totalDropped++;
        this.stats.currentSize = this.buffer.length;
        
        console.warn(`[SignalBuffer] Signal dropped after ${signal.retryCount} retries: ${signal.symbol} ${signal.type} - ${error}`);
        this.emit('signal_dropped', { signal, error });
        return false;
      } else {
        // Move to end of same priority group for retry
        console.log(`[SignalBuffer] Signal will retry (attempt ${signal.retryCount + 1}/${this.config.maxRetries}): ${signal.symbol}`);
        this.emit('signal_retry', signal);
        return true;
      }
    }
    return false;
  }

  /**
   * Flush all signals (returns all buffered signals and clears buffer)
   */
  flush(): BufferedSignal[] {
    const signals = [...this.buffer];
    this.buffer = [];
    this.stats.currentSize = 0;
    
    console.log(`[SignalBuffer] Flushed ${signals.length} signals`);
    return signals;
  }

  /**
   * Get all pending signals without removing them
   */
  getPendingSignals(): BufferedSignal[] {
    return [...this.buffer];
  }

  /**
   * Get buffer statistics
   */
  getStats(): SignalBufferStats {
    const now = Date.now();
    
    // Calculate oldest signal age
    if (this.buffer.length > 0) {
      const oldest = this.buffer.reduce((min, s) => s.timestamp < min.timestamp ? s : min, this.buffer[0]);
      this.stats.oldestSignalAge = now - oldest.timestamp;
    } else {
      this.stats.oldestSignalAge = 0;
    }
    
    return { ...this.stats };
  }

  /**
   * Check if a signal is a duplicate
   */
  private isDuplicate(signal: Omit<BufferedSignal, 'id' | 'expiresAt' | 'retryCount'>): boolean {
    const now = Date.now();
    
    // Check against buffered signals
    const duplicateInBuffer = this.buffer.some(s => 
      s.symbol === signal.symbol &&
      s.type === signal.type &&
      s.direction === signal.direction &&
      (now - s.timestamp) < this.config.deduplicationWindowMs
    );
    
    if (duplicateInBuffer) return true;
    
    // Check against recently processed signals
    for (const [id, timestamp] of this.processedSignals.entries()) {
      if ((now - timestamp) < this.config.deduplicationWindowMs) {
        if (id.startsWith(`${signal.symbol}_${signal.type}_${signal.direction}_`)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Insert signal in sorted order (by priority desc, then timestamp asc)
   */
  private insertSorted(signal: BufferedSignal): void {
    let insertIndex = this.buffer.length;
    
    for (let i = 0; i < this.buffer.length; i++) {
      const existing = this.buffer[i];
      
      // Higher priority comes first
      if (signal.priority > existing.priority) {
        insertIndex = i;
        break;
      }
      
      // Same priority: older timestamp comes first
      if (signal.priority === existing.priority && signal.timestamp < existing.timestamp) {
        insertIndex = i;
        break;
      }
    }
    
    this.buffer.splice(insertIndex, 0, signal);
  }

  /**
   * Remove lowest priority signal to make room
   */
  private removeLowestPriority(): void {
    if (this.buffer.length === 0) return;
    
    // Find lowest priority signal (last in sorted buffer)
    const removed = this.buffer.pop();
    if (removed) {
      this.stats.totalDropped++;
      console.log(`[SignalBuffer] Dropped low priority signal to make room: ${removed.symbol}`);
      this.emit('signal_dropped', { signal: removed, error: 'Buffer full' });
    }
  }

  /**
   * Clean up expired signals
   */
  private cleanupExpiredSignals(): void {
    const now = Date.now();
    const expiredCount = this.buffer.filter(s => s.expiresAt <= now).length;
    
    if (expiredCount > 0) {
      this.buffer = this.buffer.filter(s => {
        if (s.expiresAt <= now) {
          this.stats.totalExpired++;
          this.emit('signal_expired', s);
          return false;
        }
        return true;
      });
      
      this.stats.currentSize = this.buffer.length;
      console.log(`[SignalBuffer] Cleaned up ${expiredCount} expired signals`);
    }
  }

  /**
   * Clean up old processed signal history
   */
  private cleanupProcessedHistory(): void {
    const now = Date.now();
    const cutoff = now - this.config.deduplicationWindowMs * 2;
    
    for (const [id, timestamp] of this.processedSignals.entries()) {
      if (timestamp < cutoff) {
        this.processedSignals.delete(id);
      }
    }
  }
}

// Singleton instance
export const signalBuffer = new SignalBuffer();
