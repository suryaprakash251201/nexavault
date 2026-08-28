import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryManager } from '../core/RetryManager';
import { Change } from '../models/Change';

describe('RetryManager', () => {
  let retryManager: RetryManager;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    retryManager = new RetryManager(mockLogger, {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      jitter: false,
    });
  });

  it('should allow retry for network errors', () => {
    const change = Change.create('test.md', 'hash', 100, Date.now());
    const error = new Error('network error');
    error.name = 'TypeError';
    
    const decision = retryManager.shouldRetry(change, error);
    
    expect(decision.shouldRetry).toBe(true);
    expect(decision.delayMs).toBeGreaterThan(0);
  });

  it('should not retry authentication errors', () => {
    const change = Change.create('test.md', 'hash', 100, Date.now());
    const error: any = new Error('authentication failed');
    error.status = 401;
    
    const decision = retryManager.shouldRetry(change, error);
    
    expect(decision.shouldRetry).toBe(false);
  });

  it('should not retry permission errors', () => {
    const change = Change.create('test.md', 'hash', 100, Date.now());
    const error: any = new Error('permission denied');
    error.status = 403;
    
    const decision = retryManager.shouldRetry(change, error);
    
    expect(decision.shouldRetry).toBe(false);
  });

  it('should not retry not found errors', () => {
    const change = Change.create('test.md', 'hash', 100, Date.now());
    const error: any = new Error('not found');
    error.status = 404;
    
    const decision = retryManager.shouldRetry(change, error);
    
    expect(decision.shouldRetry).toBe(false);
  });

  it('should respect Retry-After header', () => {
    const change = Change.create('test.md', 'hash', 100, Date.now());
    const error: any = new Error('rate limited');
    error.status = 429; // Make it retryable
    error.response = { headers: { 'retry-after': '5' } };
    
    const decision = retryManager.shouldRetry(change, error);
    
    expect(decision.shouldRetry).toBe(true);
    expect(decision.delayMs).toBe(5000);
  });

  it('should track attempt counts', () => {
    const change = Change.create('test.md', 'hash', 100, Date.now());
    
    retryManager.recordAttempt(change.id);
    retryManager.recordAttempt(change.id);
    
    expect(retryManager.getAttempts(change.id)).toBe(2);
  });

  it('should reset attempts after success', () => {
    const change = Change.create('test.md', 'hash', 100, Date.now());
    
    retryManager.recordAttempt(change.id);
    retryManager.resetAttempts(change.id);
    
    expect(retryManager.getAttempts(change.id)).toBe(0);
  });

  it('should execute with retry and succeed on second attempt', async () => {
    const change = Change.create('test.md', 'hash', 100, Date.now());
    let attempts = 0;
    
    const result = await retryManager.executeWithRetry(
      async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('network error');
        }
        return 'success';
      },
      change
    );
    
    expect(result).toBe('success');
    expect(attempts).toBe(2);
  });

  it('should fail after max attempts', async () => {
    const change = Change.create('test.md', 'hash', 100, Date.now());
    
    await expect(
      retryManager.executeWithRetry(
        async () => {
          throw new Error('network error');
        },
        change
      )
    ).rejects.toThrow('network error');
  });

  it('should use exponential backoff', () => {
    const change = Change.create('test.md', 'hash', 100, Date.now());
    change.retryCount = 0;
    
    const decision1 = retryManager.shouldRetry(change, new Error('network error'));
    change.retryCount = 1;
    const decision2 = retryManager.shouldRetry(change, new Error('network error'));
    change.retryCount = 2;
    const decision3 = retryManager.shouldRetry(change, new Error('network error'));
    
    expect(decision2.delayMs).toBeGreaterThan(decision1.delayMs);
    expect(decision3.delayMs).toBeGreaterThan(decision2.delayMs);
  });
});
