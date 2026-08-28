/**
 * ChangeQueue - Persistent queue for sync operations with offline support
 */

import { App, Plugin } from 'obsidian';
import { StateStore } from '../storage/StateStore';
import { Change, ChangeSet } from '../models/Change';
import { Logger } from '../utils/logger';

const QUEUE_KEY = 'changeQueue';
const QUEUE_STATE_KEY = 'queueState';

export interface QueueState {
  pending: string[]; // Change IDs
  processing: string[]; // Change IDs currently being processed
  failed: string[]; // Change IDs that failed
  lastProcessed: number;
}

export class ChangeQueue {
  private app: App;
  private plugin: Plugin | null = null;
  private store: StateStore;
  private logger: Logger;
  private queue: Map<string, Change> = new Map();
  private state: QueueState = {
    pending: [],
    processing: [],
    failed: [],
    lastProcessed: 0,
  };
  private initialized = false;
  private persistDebounce: NodeJS.Timeout | null = null;
  private readonly PERSIST_DELAY = 500;

  constructor(app: App, logger: Logger) {
    this.app = app;
    this.logger = logger;
    this.store = new StateStore(app, null as any, 'queue', logger);
  }

  setPlugin(plugin: Plugin): void {
    this.plugin = plugin;
    this.store = new StateStore(app, plugin, 'queue', logger);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await this.store.initialize();
    
    // Load queue
    const savedQueue = this.store.get<any>(QUEUE_KEY);
    if (savedQueue) {
      for (const [id, changeData] of Object.entries(savedQueue)) {
        this.queue.set(id, Change.fromJSON(changeData));
      }
    }
    
    // Load state
    const savedState = this.store.get<QueueState>(QUEUE_STATE_KEY);
    if (savedState) {
      this.state = savedState;
    }
    
    // Clean up processing items (they were interrupted)
    for (const id of this.state.processing) {
      const change = this.queue.get(id);
      if (change) {
        change.clearError();
        this.state.pending.push(id);
      }
    }
    this.state.processing = [];
    
    this.initialized = true;
    this.logger.info(`ChangeQueue initialized: ${this.queue.size} changes, ${this.state.pending.length} pending`);
  }

  /**
   * Add a change to the queue
   */
  enqueue(change: Change): void {
    if (!this.initialized) {
      this.logger.warn('ChangeQueue not initialized, change dropped');
      return;
    }
    
    // Check for duplicate (same path, same type, similar timestamp)
    const existing = this.findSimilarChange(change);
    if (existing) {
      this.logger.debug(`Merging duplicate change for ${change.path}`);
      // Keep the newer change
      if (change.timestamp > existing.timestamp) {
        this.queue.set(change.id, change);
        // Update state references
        this.replaceInState(existing.id, change.id);
      }
      return;
    }
    
    this.queue.set(change.id, change);
    this.state.pending.push(change.id);
    this.schedulePersist();
    
    this.logger.debug(`Enqueued change: ${change.type} ${change.path} (${this.state.pending.length} pending)`);
  }

  /**
   * Add multiple changes at once
   */
  enqueueBatch(changes: Change[]): void {
    for (const change of changes) {
      this.enqueue(change);
    }
  }

  /**
   * Get next pending change
   */
  dequeue(): Change | null {
    if (this.state.pending.length === 0) return null;
    
    const id = this.state.pending.shift()!;
    const change = this.queue.get(id);
    
    if (!change) {
      this.logger.warn(`Change ${id} not found in queue`);
      return this.dequeue(); // Try next
    }
    
    this.state.processing.push(id);
    this.schedulePersist();
    
    return change;
  }

  /**
   * Mark change as completed successfully
   */
  complete(changeId: string): void {
    const index = this.state.processing.indexOf(changeId);
    if (index >= 0) {
      this.state.processing.splice(index, 1);
    }
    
    this.queue.delete(changeId);
    this.state.lastProcessed = Date.now();
    this.schedulePersist();
  }

  /**
   * Mark change as failed, will be retried
   */
  fail(changeId: string, error: string): void {
    const index = this.state.processing.indexOf(changeId);
    if (index >= 0) {
      this.state.processing.splice(index, 1);
    }
    
    const change = this.queue.get(changeId);
    if (change) {
      change.setError(error);
      change.incrementRetry();
    }
    
    // Move back to pending for retry (RetryManager will handle timing)
    this.state.pending.unshift(changeId);
    this.schedulePersist();
  }

  /**
   * Mark change as permanently failed
   */
  failPermanently(changeId: string, error: string): void {
    const index = this.state.processing.indexOf(changeId);
    if (index >= 0) {
      this.state.processing.splice(index, 1);
    }
    
    const change = this.queue.get(changeId);
    if (change) {
      change.setError(error);
    }
    
    this.state.failed.push(changeId);
    this.schedulePersist();
    
    this.logger.error(`Change permanently failed: ${changeId}`, { error });
  }

  /**
   * Requeue a failed change for retry
   */
  requeue(changeId: string): boolean {
    const index = this.state.failed.indexOf(changeId);
    if (index >= 0) {
      this.state.failed.splice(index, 1);
      this.state.pending.push(changeId);
      
      const change = this.queue.get(changeId);
      if (change) {
        change.clearError();
      }
      
      this.schedulePersist();
      return true;
    }
    return false;
  }

  /**
   * Get all pending changes
   */
  getPending(): Change[] {
    return this.state.pending
      .map(id => this.queue.get(id))
      .filter((c): c is Change => c !== undefined);
  }

  /**
   * Get all failed changes
   */
  getFailed(): Change[] {
    return this.state.failed
      .map(id => this.queue.get(id))
      .filter((c): c is Change => c !== undefined);
  }

  /**
   * Get changes by backend target
   */
  getByBackend(backendId: string): Change[] {
    const allChanges = [...this.state.pending, ...this.state.processing]
      .map(id => this.queue.get(id))
      .filter((c): c is Change => c !== undefined);
    
    return allChanges.filter(c => c.backendTargets.includes(backendId));
  }

  /**
   * Get queue statistics
   */
  getStats(): { pending: number; processing: number; failed: number; total: number } {
    return {
      pending: this.state.pending.length,
      processing: this.state.processing.length,
      failed: this.state.failed.length,
      total: this.queue.size,
    };
  }

  /**
   * Clear completed changes older than specified time
   */
  cleanup(maxAgeMs = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;
    
    // Only clean up completed changes (not in any state array)
    for (const [id, change] of this.queue.entries()) {
      const inPending = this.state.pending.includes(id);
      const inProcessing = this.state.processing.includes(id);
      const inFailed = this.state.failed.includes(id);
      
      if (!inPending && !inProcessing && !inFailed) {
        if (now - change.timestamp > maxAgeMs) {
          this.queue.delete(id);
          cleaned++;
        }
      }
    }
    
    if (cleaned > 0) {
      this.schedulePersist();
    }
    
    return cleaned;
  }

  /**
   * Clear all failed changes
   */
  clearFailed(): number {
    const count = this.state.failed.length;
    for (const id of this.state.failed) {
      this.queue.delete(id);
    }
    this.state.failed = [];
    this.schedulePersist();
    return count;
  }

  /**
   * Persist queue to storage
   */
  async persist(): Promise<void> {
    if (this.persistDebounce) {
      clearTimeout(this.persistDebounce);
      this.persistDebounce = null;
    }
    
    try {
      const queueData: Record<string, any> = {};
      for (const [id, change] of this.queue.entries()) {
        queueData[id] = change.toJSON();
      }
      
      this.store.set(QUEUE_KEY, queueData);
      this.store.set(QUEUE_STATE_KEY, this.state);
      await this.store.persist();
    } catch (error) {
      this.logger.error('ChangeQueue: Failed to persist', error);
    }
  }

  private schedulePersist(): void {
    if (this.persistDebounce) return;
    
    this.persistDebounce = setTimeout(() => {
      this.persistDebounce = null;
      this.persist().catch(err => this.logger.error('ChangeQueue: Debounced persist failed', err));
    }, this.PERSIST_DELAY);
  }

  private findSimilarChange(change: Change): Change | null {
    for (const existing of this.queue.values()) {
      if (existing.path === change.path && 
          existing.type === change.type &&
          Math.abs(existing.timestamp - change.timestamp) < 5000) { // Within 5 seconds
        return existing;
      }
    }
    return null;
  }

  private replaceInState(oldId: string, newId: string): void {
    const replaceInArray = (arr: string[]) => {
      const idx = arr.indexOf(oldId);
      if (idx >= 0) arr[idx] = newId;
    };
    
    replaceInArray(this.state.pending);
    replaceInArray(this.state.processing);
    replaceInArray(this.state.failed);
  }
}
