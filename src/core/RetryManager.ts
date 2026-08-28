/**
 * RetryManager - Exponential backoff with jitter for retry logic
 */

import { Logger } from '../utils/logger';
import { isRetryableError, getRetryAfter, calculateBackoff } from '../utils/network';
import { Change } from '../models/Change';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  reason: string;
}

export class RetryManager {
  private logger: Logger;
  private policy: RetryPolicy;
  private attemptCounts: Map<string, number> = new Map();

  constructor(logger: Logger, policy?: Partial<RetryPolicy>) {
    this.logger = logger;
    this.policy = {
      maxAttempts: policy?.maxAttempts ?? 5,
      baseDelayMs: policy?.baseDelayMs ?? 2000,
      maxDelayMs: policy?.maxDelayMs ?? 60000,
      jitter: policy?.jitter ?? true,
    };
  }

  updatePolicy(policy: Partial<RetryPolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }

  /**
   * Determine if a change should be retried and calculate delay
   */
  shouldRetry(change: Change, error: any): RetryDecision {
    const attempt = this.attemptCounts.get(change.id) || change.retryCount;
    
    // Check max attempts
    if (attempt >= this.policy.maxAttempts) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: `Max retry attempts (${this.policy.maxAttempts}) exceeded`,
      };
    }
    
    // Check if change is retryable
    if (!change.isRetryable()) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Change marked as non-retryable (permanent error)',
      };
    }
    
    // Check if error is retryable
    if (!isRetryableError(error)) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Error is not retryable',
      };
    }
    
    // Check for Retry-After header
    const retryAfter = getRetryAfter(error);
    if (retryAfter !== null) {
      return {
        shouldRetry: true,
        delayMs: retryAfter,
        reason: `Server requested retry after ${retryAfter}ms`,
      };
    }
    
    // Calculate exponential backoff
    const delay = calculateBackoff(
      attempt,
      this.policy.baseDelayMs,
      this.policy.maxDelayMs,
      this.policy.jitter
    );
    
    return {
      shouldRetry: true,
      delayMs: delay,
      reason: `Retry attempt ${attempt + 1}/${this.policy.maxAttempts} after ${delay}ms`,
    };
  }

  /**
   * Record a retry attempt
   */
  recordAttempt(changeId: string): void {
    const current = this.attemptCounts.get(changeId) || 0;
    this.attemptCounts.set(changeId, current + 1);
  }

  /**
   * Reset attempt count for a change (after success)
   */
  resetAttempts(changeId: string): void {
    this.attemptCounts.delete(changeId);
  }

  /**
   * Get current attempt count
   */
  getAttempts(changeId: string): number {
    return this.attemptCounts.get(changeId) || 0;
  }

  /**
   * Execute an operation with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    change: Change,
    onRetry?: (attempt: number, delay: number, error: any) => void
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= this.policy.maxAttempts; attempt++) {
      try {
        const result = await operation();
        this.resetAttempts(change.id);
        return result;
      } catch (error) {
        lastError = error;
        
        const decision = this.shouldRetry(change, error);
        
        if (!decision.shouldRetry) {
          this.logger.warn(`Retry aborted for ${change.id}: ${decision.reason}`);
          throw error;
        }
        
        this.recordAttempt(change.id);
        
        this.logger.info(`Retry ${attempt + 1}/${this.policy.maxAttempts} for ${change.id} after ${decision.delayMs}ms: ${decision.reason}`);
        
        if (onRetry) {
          onRetry(attempt + 1, decision.delayMs, error);
        }
        
        await this.sleep(decision.delayMs);
      }
    }
    
    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a retryable promise wrapper
   */
  createRetryablePromise<T>(
    operation: () => Promise<T>,
    change: Change
  ): Promise<T> {
    return this.executeWithRetry(operation, change);
  }
}

/**
 * CircuitBreaker - Prevents cascade failures
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private threshold: number = 5,
    private timeout: number = 30000, // 30 seconds
    private logger: Logger
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.timeout) {
        this.state = 'half-open';
        this.logger.info('Circuit breaker: half-open, attempting request');
      } else {
        throw new Error('Circuit breaker is open');
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'open';
      this.logger.warn(`Circuit breaker opened after ${this.failures} failures`);
    }
  }

  getState(): string {
    return this.state;
  }

  reset(): void {
    this.failures = 0;
    this.state = 'closed';
  }
}
