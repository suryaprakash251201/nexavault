import { describe, it, expect } from 'vitest';
import { Change, createChangeSet } from '../models/Change';

describe('Change', () => {
  it('should create a create change', () => {
    const change = Change.create('test.md', 'hash123', 100, Date.now());
    expect(change.type).toBe('create');
    expect(change.path).toBe('test.md');
    expect(change.hash).toBe('hash123');
    expect(change.size).toBe(100);
  });

  it('should create a modify change', () => {
    const change = Change.modify('test.md', 'hash456', 200, Date.now());
    expect(change.type).toBe('modify');
    expect(change.path).toBe('test.md');
    expect(change.hash).toBe('hash456');
  });

  it('should create a delete change', () => {
    const change = Change.delete('test.md');
    expect(change.type).toBe('delete');
    expect(change.path).toBe('test.md');
    expect(change.hash).toBeUndefined();
  });

  it('should create a rename change', () => {
    const change = Change.rename('old.md', 'new.md', 'hash789', 300, Date.now());
    expect(change.type).toBe('rename');
    expect(change.path).toBe('new.md');
    expect(change.oldPath).toBe('old.md');
  });

  it('should track retry count', () => {
    const change = Change.create('test.md', 'hash', 100, Date.now());
    expect(change.retryCount).toBe(0);
    
    change.incrementRetry();
    expect(change.retryCount).toBe(1);
    expect(change.lastAttempt).toBeDefined();
  });

  it('should set and clear errors', () => {
    const change = Change.create('test.md', 'hash', 100, Date.now());
    change.setError('Some error');
    expect(change.error).toBe('Some error');
    
    change.clearError();
    expect(change.error).toBeUndefined();
  });

  it('should determine retryable errors', () => {
    const change = Change.create('test.md', 'hash', 100, Date.now());
    change.setError('network error');
    expect(change.isRetryable()).toBe(true);
    
    change.setError('authentication failed');
    expect(change.isRetryable()).toBe(false);
    
    change.setError('permission denied');
    expect(change.isRetryable()).toBe(false);
  });

  it('should serialize and deserialize', () => {
    const change = Change.create('test.md', 'hash123', 100, Date.now(), ['github', 's3']);
    const json = change.toJSON();
    const restored = Change.fromJSON(json);
    
    expect(restored.id).toBe(change.id);
    expect(restored.type).toBe(change.type);
    expect(restored.path).toBe(change.path);
    expect(restored.hash).toBe(change.hash);
    expect(restored.backendTargets).toEqual(['github', 's3']);
  });

  it('should create change set', () => {
    const changes = [
      Change.create('a.md', 'hash1', 100, Date.now()),
      Change.modify('b.md', 'hash2', 200, Date.now()),
    ];
    const deviceId = 'device-123';
    const changeSet = createChangeSet(changes, deviceId);
    
    expect(changeSet.changes).toHaveLength(2);
    expect(changeSet.deviceId).toBe(deviceId);
    expect(changeSet.source).toBe('local');
  });
});
