/**
 * Automated heartbeat system for keeping agent registry entries fresh
 */

import { getRegistryEntry, putRegistryEntry } from './kv.js';
import { createLogger } from './logger.js';

const logger = createLogger('heartbeat');

/**
 * Configuration options for heartbeat
 */
export interface HeartbeatOptions {
  /** Interval between heartbeats in milliseconds (default: 60000 = 60 seconds) */
  intervalMs?: number;
  /** Optional error callback */
  onError?: (error: Error) => void;
}

/** Default heartbeat interval: 60 seconds */
const DEFAULT_INTERVAL_MS = 60000;

/** Active heartbeat interval timer */
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

/** Current agent GUID being tracked */
let currentGuid: string | null = null;

/**
 * Send a single heartbeat for the given agent
 * Updates the lastHeartbeat timestamp in the KV store
 *
 * @param guid - Agent GUID to send heartbeat for
 * @returns true if successful, false otherwise
 */
export async function sendHeartbeat(guid: string): Promise<boolean> {
  // Get current entry
  const entry = await getRegistryEntry(guid);

  if (!entry) {
    logger.debug('Cannot send heartbeat: registry entry not found', { guid });
    return false;
  }

  // Update lastHeartbeat timestamp
  const updatedEntry = {
    ...entry,
    lastHeartbeat: new Date().toISOString(),
  };

  // Store back to KV
  await putRegistryEntry(guid, updatedEntry);

  logger.debug('Heartbeat sent', { guid, lastHeartbeat: updatedEntry.lastHeartbeat });
  return true;
}

/**
 * Start automated heartbeat for a registered agent
 * Sends an immediate heartbeat, then continues on the specified interval
 *
 * @param guid - Agent GUID to send heartbeats for
 * @param options - Heartbeat configuration options
 * @returns Cleanup function to stop the heartbeat
 */
export function startHeartbeat(guid: string, options?: HeartbeatOptions): () => void {
  // Stop any existing heartbeat first
  if (heartbeatInterval) {
    stopHeartbeat();
  }

  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const onError = options?.onError;

  currentGuid = guid;
  logger.info('Starting heartbeat', { guid, intervalMs });

  // Send immediate heartbeat
  sendHeartbeat(guid).catch((err) => {
    const error = err as Error;
    logger.warn('Initial heartbeat failed', { guid, error: error.message });
    if (onError) {
      onError(error);
    }
  });

  // Set up interval for subsequent heartbeats
  heartbeatInterval = setInterval(() => {
    sendHeartbeat(guid).catch((err) => {
      const error = err as Error;
      logger.warn('Heartbeat failed', { guid, error: error.message });
      if (onError) {
        onError(error);
      }
      // Note: we don't stop the heartbeat on error - continue trying
    });
  }, intervalMs);

  // Return cleanup function
  return () => {
    stopHeartbeat();
  };
}

/**
 * Stop the active heartbeat
 * Safe to call even if no heartbeat is running
 */
export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;

    if (currentGuid) {
      logger.info('Stopped heartbeat', { guid: currentGuid });
    }

    currentGuid = null;
  }
}

/**
 * Check if a heartbeat is currently running
 *
 * @returns true if heartbeat is active, false otherwise
 */
export function isHeartbeatRunning(): boolean {
  return heartbeatInterval !== null;
}
