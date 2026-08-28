/**
 * Network utilities for connectivity detection and retry logic
 */

export interface NetworkStatus {
  online: boolean;
  lastCheck: number;
  latency?: number;
}

let cachedStatus: NetworkStatus = { online: true, lastCheck: 0 };
const STATUS_CACHE_MS = 30000; // 30 seconds

export async function checkConnectivity(timeoutMs = 5000): Promise<NetworkStatus> {
  const now = Date.now();
  
  // Return cached status if recent
  if (now - cachedStatus.lastCheck < STATUS_CACHE_MS) {
    return cachedStatus;
  }
  
  try {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    // Try to fetch a small resource
    await fetch('https://www.github.com/favicon.ico', {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-cache',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - start;
    
    cachedStatus = { online: true, lastCheck: now, latency };
    return cachedStatus;
  } catch {
    cachedStatus = { online: false, lastCheck: now };
    return cachedStatus;
  }
}

export function isOnline(): boolean {
  return navigator.onLine;
}

export function addOnlineListener(callback: () => void): () => void {
  window.addEventListener('online', callback);
  return () => window.removeEventListener('online', callback);
}

export function addOfflineListener(callback: () => void): () => void {
  window.addEventListener('offline', callback);
  return () => window.removeEventListener('offline', callback);
}

export function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: boolean
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  
  if (jitter) {
    // Add ±25% jitter
    const jitterAmount = delay * 0.25;
    return delay + (Math.random() * 2 - 1) * jitterAmount;
  }
  
  return delay;
}

export function isRetryableError(error: any): boolean {
  if (!error) return false;
  
  // Network errors
  if (error.name === 'TypeError' && error.message.includes('fetch')) return true;
  if (error.name === 'AbortError') return true;
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') return true;
  
  // Generic network error messages
  const networkMessages = ['network', 'timeout', 'connection', 'econnreset', 'etimedout', 'econnrefused'];
  const message = error.message?.toLowerCase() || '';
  if (networkMessages.some(m => message.includes(m))) return true;
  
  // HTTP status codes
  if (error.status) {
    const retryableStatuses = [408, 429, 500, 502, 503, 504];
    if (retryableStatuses.includes(error.status)) return true;
  }
  
  // AWS SDK errors
  if (error.$metadata?.httpStatusCode) {
    const retryableStatuses = [408, 429, 500, 502, 503, 504];
    if (retryableStatuses.includes(error.$metadata.httpStatusCode)) return true;
  }
  
  // GitHub API errors
  if (error.response?.status) {
    const retryableStatuses = [408, 429, 500, 502, 503, 504];
    if (retryableStatuses.includes(error.response.status)) return true;
  }
  
  return false;
}

export function getRetryAfter(error: any): number | null {
  // Check Retry-After header
  if (error.response?.headers?.['retry-after']) {
    const retryAfter = parseInt(error.response.headers['retry-after'], 10);
    if (!isNaN(retryAfter)) return retryAfter * 1000;
  }
  
  // Check AWS SDK retryAfter
  if (error.$metadata?.retryAfter) {
    return error.$metadata.retryAfter * 1000;
  }
  
  return null;
}

export class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private windowMs: number;
  
  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }
  
  async acquire(): Promise<void> {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      const oldest = this.requests[0];
      const waitTime = this.windowMs - (now - oldest);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.acquire();
    }
    
    this.requests.push(now);
  }
  
  getRemainingRequests(): number {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.windowMs);
    return Math.max(0, this.maxRequests - this.requests.length);
  }
  
  reset(): void {
    this.requests = [];
  }
}
