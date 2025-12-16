/**
 * Tests for heartbeat system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  sendHeartbeat,
  startHeartbeat,
  stopHeartbeat,
  isHeartbeatRunning,
} from './heartbeat.js';
import { getRegistryEntry, putRegistryEntry } from './kv.js';
import type { RegistryEntry } from './types.js';

// Mock the KV module
vi.mock('./kv.js', () => ({
  getRegistryEntry: vi.fn(),
  putRegistryEntry: vi.fn(),
}));

const mockGetRegistryEntry = vi.mocked(getRegistryEntry);
const mockPutRegistryEntry = vi.mocked(putRegistryEntry);

describe('heartbeat', () => {
  // Use fake timers for deterministic tests
  beforeEach(() => {
    vi.useFakeTimers();
    stopHeartbeat(); // Ensure clean state
  });

  afterEach(() => {
    stopHeartbeat();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const createMockEntry = (guid: string, lastHeartbeat?: string): RegistryEntry => ({
    guid,
    agentType: 'test-agent',
    handle: 'test-handle',
    hostname: 'test-host',
    projectId: 'test-project',
    natsUrl: 'nats://localhost:4222',
    capabilities: [],
    scope: 'team',
    status: 'online',
    currentTaskCount: 0,
    registeredAt: '2025-01-01T00:00:00.000Z',
    lastHeartbeat: lastHeartbeat || '2025-01-01T00:00:00.000Z',
  });

  describe('sendHeartbeat', () => {
    it('should update lastHeartbeat timestamp', async () => {
      const guid = 'test-guid-123';
      const mockEntry = createMockEntry(guid, '2025-01-01T00:00:00.000Z');

      mockGetRegistryEntry.mockResolvedValue(mockEntry);
      mockPutRegistryEntry.mockResolvedValue();

      const startTime = new Date('2025-01-02T12:00:00.000Z');
      vi.setSystemTime(startTime);

      const result = await sendHeartbeat(guid);

      expect(result).toBe(true);
      expect(mockGetRegistryEntry).toHaveBeenCalledWith(guid);
      expect(mockPutRegistryEntry).toHaveBeenCalledWith(guid, {
        ...mockEntry,
        lastHeartbeat: '2025-01-02T12:00:00.000Z',
      });
    });

    it('should return false if entry not found', async () => {
      const guid = 'nonexistent-guid';
      mockGetRegistryEntry.mockResolvedValue(null);

      const result = await sendHeartbeat(guid);

      expect(result).toBe(false);
      expect(mockPutRegistryEntry).not.toHaveBeenCalled();
    });

    it('should throw on KV get error', async () => {
      const guid = 'test-guid';
      mockGetRegistryEntry.mockRejectedValue(new Error('KV connection failed'));

      await expect(sendHeartbeat(guid)).rejects.toThrow('KV connection failed');
      expect(mockPutRegistryEntry).not.toHaveBeenCalled();
    });

    it('should throw on KV put error', async () => {
      const guid = 'test-guid';
      const mockEntry = createMockEntry(guid);

      mockGetRegistryEntry.mockResolvedValue(mockEntry);
      mockPutRegistryEntry.mockRejectedValue(new Error('KV put failed'));

      await expect(sendHeartbeat(guid)).rejects.toThrow('KV put failed');
    });
  });

  describe('startHeartbeat', () => {
    it('should send immediate heartbeat', async () => {
      const guid = 'test-guid';
      const mockEntry = createMockEntry(guid);

      mockGetRegistryEntry.mockResolvedValue(mockEntry);
      mockPutRegistryEntry.mockResolvedValue();

      const cleanup = startHeartbeat(guid);

      // Wait for immediate heartbeat promise
      await vi.runOnlyPendingTimersAsync();

      expect(mockGetRegistryEntry).toHaveBeenCalledWith(guid);
      expect(mockPutRegistryEntry).toHaveBeenCalled();

      cleanup();
    });

    it('should send heartbeats on interval', async () => {
      const guid = 'test-guid';
      const mockEntry = createMockEntry(guid);

      mockGetRegistryEntry.mockResolvedValue(mockEntry);
      mockPutRegistryEntry.mockResolvedValue();

      const intervalMs = 5000; // 5 seconds
      const cleanup = startHeartbeat(guid, { intervalMs });

      // Clear initial heartbeat
      await vi.runOnlyPendingTimersAsync();
      vi.clearAllMocks();

      // Advance time by interval
      await vi.advanceTimersByTimeAsync(intervalMs);
      expect(mockPutRegistryEntry).toHaveBeenCalledTimes(1);

      // Advance time by another interval
      await vi.advanceTimersByTimeAsync(intervalMs);
      expect(mockPutRegistryEntry).toHaveBeenCalledTimes(2);

      cleanup();
    });

    it('should use default interval when not specified', async () => {
      const guid = 'test-guid';
      const mockEntry = createMockEntry(guid);

      mockGetRegistryEntry.mockResolvedValue(mockEntry);
      mockPutRegistryEntry.mockResolvedValue();

      const cleanup = startHeartbeat(guid);

      // Clear initial heartbeat
      await vi.runOnlyPendingTimersAsync();
      vi.clearAllMocks();

      // Default interval is 60000ms (60 seconds)
      await vi.advanceTimersByTimeAsync(60000);
      expect(mockPutRegistryEntry).toHaveBeenCalledTimes(1);

      cleanup();
    });

    it('should call onError callback on failure', async () => {
      const guid = 'test-guid';
      const onError = vi.fn();
      const testError = new Error('Heartbeat failed');

      mockGetRegistryEntry.mockRejectedValue(testError);

      const cleanup = startHeartbeat(guid, { onError });

      // Wait for immediate heartbeat to fail
      await vi.runOnlyPendingTimersAsync();

      expect(onError).toHaveBeenCalledWith(testError);

      cleanup();
    });

    it('should continue heartbeating after error', async () => {
      const guid = 'test-guid';
      const mockEntry = createMockEntry(guid);
      const onError = vi.fn();

      // First call fails, second succeeds
      mockGetRegistryEntry
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValue(mockEntry);
      mockPutRegistryEntry.mockResolvedValue();

      const intervalMs = 1000;
      const cleanup = startHeartbeat(guid, { intervalMs, onError });

      // Initial heartbeat fails
      await vi.runOnlyPendingTimersAsync();
      expect(onError).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Next heartbeat should succeed
      await vi.advanceTimersByTimeAsync(intervalMs);
      expect(mockPutRegistryEntry).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();

      cleanup();
    });

    it('should stop previous heartbeat when starting new one', async () => {
      const guid1 = 'guid-1';
      const guid2 = 'guid-2';
      const mockEntry1 = createMockEntry(guid1);
      const mockEntry2 = createMockEntry(guid2);

      mockGetRegistryEntry.mockImplementation(async (g) => {
        if (g === guid1) return mockEntry1;
        if (g === guid2) return mockEntry2;
        return null;
      });
      mockPutRegistryEntry.mockResolvedValue();

      // Start first heartbeat
      startHeartbeat(guid1, { intervalMs: 1000 });

      await vi.runOnlyPendingTimersAsync();
      expect(isHeartbeatRunning()).toBe(true);

      // Start second heartbeat (should stop first)
      const cleanup2 = startHeartbeat(guid2, { intervalMs: 1000 });

      await vi.runOnlyPendingTimersAsync();
      vi.clearAllMocks();

      // Advance time - should only heartbeat for guid2
      await vi.advanceTimersByTimeAsync(1000);

      const putCalls = mockPutRegistryEntry.mock.calls;
      expect(putCalls.length).toBe(1);
      expect(putCalls[0]![0]).toBe(guid2);

      cleanup2();
    });

    it('should return cleanup function that stops heartbeat', async () => {
      const guid = 'test-guid';
      const mockEntry = createMockEntry(guid);

      mockGetRegistryEntry.mockResolvedValue(mockEntry);
      mockPutRegistryEntry.mockResolvedValue();

      const cleanup = startHeartbeat(guid, { intervalMs: 1000 });

      await vi.runOnlyPendingTimersAsync();
      expect(isHeartbeatRunning()).toBe(true);

      cleanup();
      expect(isHeartbeatRunning()).toBe(false);
    });
  });

  describe('stopHeartbeat', () => {
    it('should clear the interval', async () => {
      const guid = 'test-guid';
      const mockEntry = createMockEntry(guid);

      mockGetRegistryEntry.mockResolvedValue(mockEntry);
      mockPutRegistryEntry.mockResolvedValue();

      startHeartbeat(guid, { intervalMs: 1000 });

      await vi.runOnlyPendingTimersAsync();
      expect(isHeartbeatRunning()).toBe(true);

      stopHeartbeat();
      expect(isHeartbeatRunning()).toBe(false);

      vi.clearAllMocks();

      // Advancing time should not trigger heartbeat
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockPutRegistryEntry).not.toHaveBeenCalled();
    });

    it('should be safe to call when not running', () => {
      expect(isHeartbeatRunning()).toBe(false);
      expect(() => stopHeartbeat()).not.toThrow();
      expect(isHeartbeatRunning()).toBe(false);
    });

    it('should be safe to call multiple times', () => {
      const guid = 'test-guid';
      const mockEntry = createMockEntry(guid);

      mockGetRegistryEntry.mockResolvedValue(mockEntry);
      mockPutRegistryEntry.mockResolvedValue();

      startHeartbeat(guid);
      expect(isHeartbeatRunning()).toBe(true);

      stopHeartbeat();
      expect(isHeartbeatRunning()).toBe(false);

      stopHeartbeat();
      expect(isHeartbeatRunning()).toBe(false);
    });
  });

  describe('isHeartbeatRunning', () => {
    it('should return false initially', () => {
      expect(isHeartbeatRunning()).toBe(false);
    });

    it('should return true when heartbeat is active', async () => {
      const guid = 'test-guid';
      const mockEntry = createMockEntry(guid);

      mockGetRegistryEntry.mockResolvedValue(mockEntry);
      mockPutRegistryEntry.mockResolvedValue();

      const cleanup = startHeartbeat(guid);

      await vi.runOnlyPendingTimersAsync();
      expect(isHeartbeatRunning()).toBe(true);

      cleanup();
    });

    it('should return false after stopping', async () => {
      const guid = 'test-guid';
      const mockEntry = createMockEntry(guid);

      mockGetRegistryEntry.mockResolvedValue(mockEntry);
      mockPutRegistryEntry.mockResolvedValue();

      startHeartbeat(guid);

      await vi.runOnlyPendingTimersAsync();
      expect(isHeartbeatRunning()).toBe(true);

      stopHeartbeat();
      expect(isHeartbeatRunning()).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('should maintain heartbeat with realistic timestamps', async () => {
      const guid = 'test-guid';
      const mockEntry = createMockEntry(guid);

      mockGetRegistryEntry.mockResolvedValue(mockEntry);
      mockPutRegistryEntry.mockResolvedValue();

      const cleanup = startHeartbeat(guid, { intervalMs: 1000 });

      // Wait for initial heartbeat
      await vi.runOnlyPendingTimersAsync();

      // Verify initial heartbeat was sent
      expect(mockPutRegistryEntry).toHaveBeenCalled();

      vi.clearAllMocks();

      // Advance time by interval
      await vi.advanceTimersByTimeAsync(1000);

      // Should have sent another heartbeat
      expect(mockPutRegistryEntry).toHaveBeenCalledTimes(1);

      // Advance again
      await vi.advanceTimersByTimeAsync(1000);

      // Should have sent yet another heartbeat
      expect(mockPutRegistryEntry).toHaveBeenCalledTimes(2);

      cleanup();
    });

    it('should handle rapid start/stop cycles', async () => {
      const guid = 'test-guid';
      const mockEntry = createMockEntry(guid);

      mockGetRegistryEntry.mockResolvedValue(mockEntry);
      mockPutRegistryEntry.mockResolvedValue();

      for (let i = 0; i < 5; i++) {
        const cleanup = startHeartbeat(guid, { intervalMs: 100 });
        await vi.runOnlyPendingTimersAsync();
        expect(isHeartbeatRunning()).toBe(true);
        cleanup();
        expect(isHeartbeatRunning()).toBe(false);
      }
    });
  });
});
