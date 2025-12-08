/**
 * Tests for lifecycle module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isStale, markAsOffline, runGarbageCollection, startGarbageCollector, stopGarbageCollector } from './lifecycle.js';
import type { RegistryEntry } from './types.js';
import * as kv from './kv.js';

// Mock the KV module
vi.mock('./kv.js', () => ({
  getRegistryEntry: vi.fn(),
  putRegistryEntry: vi.fn(),
  deleteRegistryEntry: vi.fn(),
  listRegistryEntries: vi.fn(),
}));

describe('isStale', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return false for recent heartbeat', () => {
    const now = new Date('2025-12-07T12:00:00.000Z');
    vi.setSystemTime(now);

    const entry: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'online',
      currentTaskCount: 0,
      registeredAt: '2025-12-07T11:58:00.000Z',
      lastHeartbeat: '2025-12-07T11:59:00.000Z', // 1 minute ago
    };

    expect(isStale(entry)).toBe(false);
  });

  it('should return true for stale heartbeat (older than default threshold)', () => {
    const now = new Date('2025-12-07T12:00:00.000Z');
    vi.setSystemTime(now);

    const entry: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'online',
      currentTaskCount: 0,
      registeredAt: '2025-12-07T11:50:00.000Z',
      lastHeartbeat: '2025-12-07T11:56:00.000Z', // 4 minutes ago
    };

    // Default threshold is 3 minutes (180000 ms)
    expect(isStale(entry)).toBe(true);
  });

  it('should return false for heartbeat exactly at threshold', () => {
    const now = new Date('2025-12-07T12:00:00.000Z');
    vi.setSystemTime(now);

    const entry: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'online',
      currentTaskCount: 0,
      registeredAt: '2025-12-07T11:54:00.000Z',
      lastHeartbeat: '2025-12-07T11:57:00.000Z', // Exactly 3 minutes ago
    };

    // At threshold should not be stale (only > threshold)
    expect(isStale(entry, 180000)).toBe(false);
  });

  it('should respect custom threshold', () => {
    const now = new Date('2025-12-07T12:00:00.000Z');
    vi.setSystemTime(now);

    const entry: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'online',
      currentTaskCount: 0,
      registeredAt: '2025-12-07T11:58:00.000Z',
      lastHeartbeat: '2025-12-07T11:59:00.000Z', // 1 minute ago
    };

    // Custom threshold of 30 seconds
    expect(isStale(entry, 30000)).toBe(true);
    // Custom threshold of 2 minutes
    expect(isStale(entry, 120000)).toBe(false);
  });

  it('should handle entries with very old heartbeats', () => {
    const now = new Date('2025-12-07T12:00:00.000Z');
    vi.setSystemTime(now);

    const entry: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'offline',
      currentTaskCount: 0,
      registeredAt: '2025-12-06T12:00:00.000Z',
      lastHeartbeat: '2025-12-06T12:00:00.000Z', // 24 hours ago
    };

    expect(isStale(entry)).toBe(true);
  });
});

describe('markAsOffline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should mark an online entry as offline', async () => {
    const entry: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'online',
      currentTaskCount: 0,
      registeredAt: '2025-12-07T11:50:00.000Z',
      lastHeartbeat: '2025-12-07T11:55:00.000Z',
    };

    vi.mocked(kv.getRegistryEntry).mockResolvedValue(entry);
    vi.mocked(kv.putRegistryEntry).mockResolvedValue();

    await markAsOffline(entry.guid);

    expect(kv.getRegistryEntry).toHaveBeenCalledWith(entry.guid);
    expect(kv.putRegistryEntry).toHaveBeenCalledWith(entry.guid, {
      ...entry,
      status: 'offline',
    });
  });

  it('should mark a busy entry as offline', async () => {
    const entry: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'busy',
      currentTaskCount: 3,
      registeredAt: '2025-12-07T11:50:00.000Z',
      lastHeartbeat: '2025-12-07T11:55:00.000Z',
    };

    vi.mocked(kv.getRegistryEntry).mockResolvedValue(entry);
    vi.mocked(kv.putRegistryEntry).mockResolvedValue();

    await markAsOffline(entry.guid);

    expect(kv.putRegistryEntry).toHaveBeenCalledWith(entry.guid, {
      ...entry,
      status: 'offline',
    });
  });

  it('should not update entry already offline', async () => {
    const entry: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'offline',
      currentTaskCount: 0,
      registeredAt: '2025-12-07T11:50:00.000Z',
      lastHeartbeat: '2025-12-07T11:55:00.000Z',
    };

    vi.mocked(kv.getRegistryEntry).mockResolvedValue(entry);

    await markAsOffline(entry.guid);

    expect(kv.getRegistryEntry).toHaveBeenCalledWith(entry.guid);
    expect(kv.putRegistryEntry).not.toHaveBeenCalled();
  });

  it('should handle entry not found', async () => {
    vi.mocked(kv.getRegistryEntry).mockResolvedValue(null);

    await markAsOffline('nonexistent-guid');

    expect(kv.getRegistryEntry).toHaveBeenCalledWith('nonexistent-guid');
    expect(kv.putRegistryEntry).not.toHaveBeenCalled();
  });

  it('should throw error if putRegistryEntry fails', async () => {
    const entry: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'online',
      currentTaskCount: 0,
      registeredAt: '2025-12-07T11:50:00.000Z',
      lastHeartbeat: '2025-12-07T11:55:00.000Z',
    };

    vi.mocked(kv.getRegistryEntry).mockResolvedValue(entry);
    vi.mocked(kv.putRegistryEntry).mockRejectedValue(new Error('KV store error'));

    await expect(markAsOffline(entry.guid)).rejects.toThrow('Failed to mark entry');
  });
});

describe('runGarbageCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should scan all entries and return counts', async () => {
    const now = new Date('2025-12-07T12:00:00.000Z');
    vi.setSystemTime(now);

    const entries: RegistryEntry[] = [
      {
        guid: '123e4567-e89b-42d3-a456-426614174000',
        agentType: 'developer',
        handle: 'Agent1',
        hostname: 'host1',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: ['typescript'],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-12-07T11:58:00.000Z',
        lastHeartbeat: '2025-12-07T11:59:00.000Z', // Fresh
      },
      {
        guid: '223e4567-e89b-42d3-a456-426614174000',
        agentType: 'developer',
        handle: 'Agent2',
        hostname: 'host2',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: ['typescript'],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-12-07T11:50:00.000Z',
        lastHeartbeat: '2025-12-07T11:55:00.000Z', // Stale (5 min old)
      },
    ];

    vi.mocked(kv.listRegistryEntries).mockResolvedValue(entries);
    vi.mocked(kv.getRegistryEntry).mockImplementation(async (guid) => {
      return entries.find((e) => e.guid === guid) || null;
    });
    vi.mocked(kv.putRegistryEntry).mockResolvedValue();

    const result = await runGarbageCollection();

    expect(result.scanned).toBe(2);
    expect(result.markedOffline).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('should mark stale entries as offline', async () => {
    const now = new Date('2025-12-07T12:00:00.000Z');
    vi.setSystemTime(now);

    const staleEntry: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'StaleAgent',
      hostname: 'host1',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'online',
      currentTaskCount: 0,
      registeredAt: '2025-12-07T11:50:00.000Z',
      lastHeartbeat: '2025-12-07T11:55:00.000Z', // 5 minutes old
    };

    vi.mocked(kv.listRegistryEntries).mockResolvedValue([staleEntry]);
    vi.mocked(kv.getRegistryEntry).mockResolvedValue(staleEntry);
    vi.mocked(kv.putRegistryEntry).mockResolvedValue();

    const result = await runGarbageCollection({ staleThresholdMs: 180000 }); // 3 minutes

    expect(result.markedOffline).toBe(1);
    expect(kv.putRegistryEntry).toHaveBeenCalledWith(staleEntry.guid, {
      ...staleEntry,
      status: 'offline',
    });
  });

  it('should delete entries older than TTL', async () => {
    const now = new Date('2025-12-07T12:00:00.000Z');
    vi.setSystemTime(now);

    const oldEntry: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'OldAgent',
      hostname: 'host1',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'offline',
      currentTaskCount: 0,
      registeredAt: '2025-12-05T12:00:00.000Z', // 2 days old
      lastHeartbeat: '2025-12-05T12:00:00.000Z',
    };

    vi.mocked(kv.listRegistryEntries).mockResolvedValue([oldEntry]);
    vi.mocked(kv.deleteRegistryEntry).mockResolvedValue(true);

    const result = await runGarbageCollection({ ttlMs: 24 * 60 * 60 * 1000 }); // 24 hours

    expect(result.deleted).toBe(1);
    expect(kv.deleteRegistryEntry).toHaveBeenCalledWith(oldEntry.guid);
  });

  it('should not mark offline entries as offline again', async () => {
    const now = new Date('2025-12-07T12:00:00.000Z');
    vi.setSystemTime(now);

    const offlineEntry: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'OfflineAgent',
      hostname: 'host1',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'offline',
      currentTaskCount: 0,
      registeredAt: '2025-12-07T11:50:00.000Z',
      lastHeartbeat: '2025-12-07T11:55:00.000Z', // Stale but already offline
    };

    vi.mocked(kv.listRegistryEntries).mockResolvedValue([offlineEntry]);

    const result = await runGarbageCollection();

    expect(result.markedOffline).toBe(0);
    expect(kv.putRegistryEntry).not.toHaveBeenCalled();
  });

  it('should work in dry-run mode without making changes', async () => {
    const now = new Date('2025-12-07T12:00:00.000Z');
    vi.setSystemTime(now);

    const staleEntry: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'StaleAgent',
      hostname: 'host1',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'online',
      currentTaskCount: 0,
      registeredAt: '2025-12-07T11:50:00.000Z',
      lastHeartbeat: '2025-12-07T11:55:00.000Z', // Stale
    };

    const oldEntry: RegistryEntry = {
      guid: '223e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'OldAgent',
      hostname: 'host2',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'offline',
      currentTaskCount: 0,
      registeredAt: '2025-12-05T12:00:00.000Z', // Old
      lastHeartbeat: '2025-12-05T12:00:00.000Z',
    };

    vi.mocked(kv.listRegistryEntries).mockResolvedValue([staleEntry, oldEntry]);

    const result = await runGarbageCollection({ dryRun: true });

    expect(result.scanned).toBe(2);
    expect(result.markedOffline).toBe(1);
    expect(result.deleted).toBe(1);
    expect(kv.putRegistryEntry).not.toHaveBeenCalled();
    expect(kv.deleteRegistryEntry).not.toHaveBeenCalled();
  });

  it('should collect errors for failed operations', async () => {
    const now = new Date('2025-12-07T12:00:00.000Z');
    vi.setSystemTime(now);

    const entry1: RegistryEntry = {
      guid: '123e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'Agent1',
      hostname: 'host1',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'online',
      currentTaskCount: 0,
      registeredAt: '2025-12-07T11:50:00.000Z',
      lastHeartbeat: '2025-12-07T11:55:00.000Z', // Stale
    };

    const entry2: RegistryEntry = {
      guid: '223e4567-e89b-42d3-a456-426614174000',
      agentType: 'developer',
      handle: 'Agent2',
      hostname: 'host2',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript'],
      scope: 'project',
      visibility: 'project-only',
      status: 'online',
      currentTaskCount: 0,
      registeredAt: '2025-12-07T11:50:00.000Z',
      lastHeartbeat: '2025-12-07T11:55:00.000Z', // Stale
    };

    vi.mocked(kv.listRegistryEntries).mockResolvedValue([entry1, entry2]);
    vi.mocked(kv.getRegistryEntry).mockResolvedValue(entry1);

    // First call succeeds, second fails
    vi.mocked(kv.putRegistryEntry)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('KV store error'));

    const result = await runGarbageCollection();

    expect(result.scanned).toBe(2);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Failed to process entry');
  });

  it('should handle listRegistryEntries failure', async () => {
    vi.mocked(kv.listRegistryEntries).mockRejectedValue(new Error('Failed to list entries'));

    const result = await runGarbageCollection();

    expect(result.scanned).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Garbage collection failed');
  });
});

describe('startGarbageCollector and stopGarbageCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stopGarbageCollector(); // Ensure clean state
  });

  afterEach(() => {
    stopGarbageCollector();
    vi.useRealTimers();
  });

  it('should run GC immediately on start', async () => {
    vi.mocked(kv.listRegistryEntries).mockResolvedValue([]);

    const cleanup = startGarbageCollector(60000);

    // Wait for initial GC to complete
    await vi.waitFor(() => {
      expect(kv.listRegistryEntries).toHaveBeenCalled();
    });

    cleanup();
  });

  it('should run GC on interval', async () => {
    vi.mocked(kv.listRegistryEntries).mockResolvedValue([]);

    const cleanup = startGarbageCollector(5000); // 5 seconds

    // Wait for initial run
    await vi.waitFor(() => {
      expect(kv.listRegistryEntries).toHaveBeenCalledTimes(1);
    });

    // Advance time and check for next run
    vi.advanceTimersByTime(5000);
    await vi.waitFor(() => {
      expect(kv.listRegistryEntries).toHaveBeenCalledTimes(2);
    });

    // Advance time again
    vi.advanceTimersByTime(5000);
    await vi.waitFor(() => {
      expect(kv.listRegistryEntries).toHaveBeenCalledTimes(3);
    });

    cleanup();
  });

  it('should stop GC when cleanup function is called', async () => {
    vi.mocked(kv.listRegistryEntries).mockResolvedValue([]);

    const cleanup = startGarbageCollector(5000);

    // Wait for initial run
    await vi.waitFor(() => {
      expect(kv.listRegistryEntries).toHaveBeenCalled();
    });
    const initialCallCount = vi.mocked(kv.listRegistryEntries).mock.calls.length;

    // Stop the collector
    cleanup();

    // Advance time - GC should not run
    vi.advanceTimersByTime(10000);

    // Verify no additional calls were made
    expect(kv.listRegistryEntries).toHaveBeenCalledTimes(initialCallCount);
  });

  it('should stop GC when stopGarbageCollector is called', async () => {
    vi.mocked(kv.listRegistryEntries).mockResolvedValue([]);

    startGarbageCollector(5000);

    // Wait for initial run
    await vi.waitFor(() => {
      expect(kv.listRegistryEntries).toHaveBeenCalled();
    });
    const initialCallCount = vi.mocked(kv.listRegistryEntries).mock.calls.length;

    // Stop the collector
    stopGarbageCollector();

    // Advance time - GC should not run
    vi.advanceTimersByTime(10000);

    // Verify no additional calls were made
    expect(kv.listRegistryEntries).toHaveBeenCalledTimes(initialCallCount);
  });

  it('should handle GC errors gracefully and continue running', async () => {
    // First call fails, subsequent calls succeed
    vi.mocked(kv.listRegistryEntries)
      .mockRejectedValueOnce(new Error('First error'))
      .mockResolvedValue([]);

    const cleanup = startGarbageCollector(5000);

    // Wait for initial run (fails)
    await vi.waitFor(() => {
      expect(kv.listRegistryEntries).toHaveBeenCalledTimes(1);
    });

    // Should still schedule next run
    vi.advanceTimersByTime(5000);
    await vi.waitFor(() => {
      expect(kv.listRegistryEntries).toHaveBeenCalledTimes(2);
    });

    cleanup();
  });

  it('should stop previous instance when starting new collector', async () => {
    vi.mocked(kv.listRegistryEntries).mockResolvedValue([]);

    startGarbageCollector(5000);

    // Wait for initial run
    await vi.waitFor(() => {
      expect(kv.listRegistryEntries).toHaveBeenCalled();
    });
    const callCountAfterFirst = vi.mocked(kv.listRegistryEntries).mock.calls.length;

    // Start another collector (should stop first one)
    const cleanup2 = startGarbageCollector(3000);

    // Wait for initial run of second collector
    await vi.waitFor(() => {
      expect(kv.listRegistryEntries).toHaveBeenCalledTimes(callCountAfterFirst + 1);
    });

    // Advance by second interval
    vi.advanceTimersByTime(3000);
    await vi.waitFor(() => {
      expect(kv.listRegistryEntries).toHaveBeenCalledTimes(callCountAfterFirst + 2);
    });

    cleanup2();
  });

  it('should use default interval if not specified', async () => {
    vi.mocked(kv.listRegistryEntries).mockResolvedValue([]);

    const cleanup = startGarbageCollector(); // Default 5 minutes (300000ms)

    // Wait for initial run
    await vi.waitFor(() => {
      expect(kv.listRegistryEntries).toHaveBeenCalledTimes(1);
    });

    // Advance by default interval
    vi.advanceTimersByTime(300000);
    await vi.waitFor(() => {
      expect(kv.listRegistryEntries).toHaveBeenCalledTimes(2);
    });

    cleanup();
  });

  it('should handle stopping when not running', () => {
    // Should not throw
    expect(() => stopGarbageCollector()).not.toThrow();
  });
});
