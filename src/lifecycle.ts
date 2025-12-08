/**
 * Registry lifecycle management for agent registry
 * Handles stale detection, offline marking, and garbage collection
 */

import type { RegistryEntry } from './types.js';
import { getRegistryEntry, putRegistryEntry, deleteRegistryEntry, listRegistryEntries } from './kv.js';
import { createLogger } from './logger.js';

const logger = createLogger('lifecycle');

/** Default threshold for staleness: 3 minutes (3x default heartbeat interval) */
const DEFAULT_STALE_THRESHOLD_MS = 3 * 60000;

/** Default TTL: 24 hours */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Default GC interval: 5 minutes */
const DEFAULT_GC_INTERVAL_MS = 5 * 60000;

/**
 * Options for garbage collection
 */
export interface GCOptions {
  /** Threshold in milliseconds for considering an entry stale (default: 180000 / 3 min) */
  staleThresholdMs?: number;
  /** Time-to-live in milliseconds for registry entries (default: 86400000 / 24 hours) */
  ttlMs?: number;
  /** If true, simulate GC without making changes (default: false) */
  dryRun?: boolean;
}

/**
 * Result of garbage collection run
 */
export interface GCResult {
  /** Total number of entries scanned */
  scanned: number;
  /** Number of entries marked as offline */
  markedOffline: number;
  /** Number of entries deleted */
  deleted: number;
  /** List of errors encountered during GC */
  errors: string[];
}

/** Global garbage collector state */
let gcIntervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Check if a registry entry is stale based on its lastHeartbeat
 */
export function isStale(entry: RegistryEntry, staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS): boolean {
  const now = Date.now();
  const lastHeartbeat = new Date(entry.lastHeartbeat).getTime();
  const age = now - lastHeartbeat;

  return age > staleThresholdMs;
}

/**
 * Mark a registry entry as offline
 */
export async function markAsOffline(guid: string): Promise<void> {
  try {
    const entry = await getRegistryEntry(guid);

    if (!entry) {
      logger.warn('Cannot mark as offline - entry not found', { guid });
      return;
    }

    // Only update if not already offline
    if (entry.status === 'offline') {
      logger.debug('Entry already offline', { guid, handle: entry.handle });
      return;
    }

    // Update status
    const updatedEntry: RegistryEntry = {
      ...entry,
      status: 'offline',
    };

    await putRegistryEntry(guid, updatedEntry);
    logger.info('Marked entry as offline', {
      guid,
      handle: entry.handle,
      previousStatus: entry.status,
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to mark entry as offline', {
      guid,
      error: error.message,
    });
    throw new Error(`Failed to mark entry ${guid} as offline: ${error.message}`);
  }
}

/**
 * Run garbage collection on the registry
 * - Marks stale entries as offline
 * - Deletes entries older than TTL
 */
export async function runGarbageCollection(options: GCOptions = {}): Promise<GCResult> {
  const {
    staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS,
    ttlMs = DEFAULT_TTL_MS,
    dryRun = false,
  } = options;

  const result: GCResult = {
    scanned: 0,
    markedOffline: 0,
    deleted: 0,
    errors: [],
  };

  const mode = dryRun ? 'DRY-RUN' : 'ACTIVE';
  logger.info(`Starting garbage collection [${mode}]`, {
    staleThresholdMs,
    ttlMs,
  });

  try {
    const entries = await listRegistryEntries();
    result.scanned = entries.length;

    const now = Date.now();

    for (const entry of entries) {
      try {
        const registeredAt = new Date(entry.registeredAt).getTime();
        const entryAge = now - registeredAt;

        // Check if entry should be deleted (older than TTL)
        if (entryAge > ttlMs) {
          if (!dryRun) {
            await deleteRegistryEntry(entry.guid);
          }
          result.deleted++;
          logger.info(`${dryRun ? '[DRY-RUN] Would delete' : 'Deleted'} old entry`, {
            guid: entry.guid,
            handle: entry.handle,
            registeredAt: entry.registeredAt,
            ageMs: entryAge,
          });
          continue;
        }

        // Check if entry is stale and needs to be marked offline
        if (isStale(entry, staleThresholdMs) && entry.status !== 'offline') {
          if (!dryRun) {
            await markAsOffline(entry.guid);
          }
          result.markedOffline++;
          logger.info(`${dryRun ? '[DRY-RUN] Would mark offline' : 'Marked offline'} stale entry`, {
            guid: entry.guid,
            handle: entry.handle,
            lastHeartbeat: entry.lastHeartbeat,
            previousStatus: entry.status,
          });
        }
      } catch (err) {
        const error = err as Error;
        const errorMsg = `Failed to process entry ${entry.guid}: ${error.message}`;
        result.errors.push(errorMsg);
        logger.error('Error processing entry during GC', {
          guid: entry.guid,
          handle: entry.handle,
          error: error.message,
        });
      }
    }

    logger.info(`Garbage collection complete [${mode}]`, {
      scanned: result.scanned,
      markedOffline: result.markedOffline,
      deleted: result.deleted,
      errors: result.errors.length,
    });
  } catch (err) {
    const error = err as Error;
    const errorMsg = `Garbage collection failed: ${error.message}`;
    result.errors.push(errorMsg);
    logger.error('Garbage collection failed', { error: error.message });
  }

  return result;
}

/**
 * Start the garbage collector to run periodically
 * Returns a cleanup function to stop the collector
 */
export function startGarbageCollector(intervalMs: number = DEFAULT_GC_INTERVAL_MS): () => void {
  if (gcIntervalHandle !== null) {
    logger.warn('Garbage collector already running, stopping previous instance');
    stopGarbageCollector();
  }

  logger.info('Starting garbage collector', { intervalMs });

  // Run immediately on start
  runGarbageCollection().catch((err) => {
    logger.error('Initial garbage collection failed', { error: (err as Error).message });
  });

  // Set up recurring GC
  gcIntervalHandle = setInterval(() => {
    runGarbageCollection().catch((err) => {
      logger.error('Scheduled garbage collection failed', { error: (err as Error).message });
    });
  }, intervalMs);

  // Return cleanup function
  return () => {
    stopGarbageCollector();
  };
}

/**
 * Stop the running garbage collector
 */
export function stopGarbageCollector(): void {
  if (gcIntervalHandle !== null) {
    clearInterval(gcIntervalHandle);
    gcIntervalHandle = null;
    logger.info('Stopped garbage collector');
  } else {
    logger.debug('Garbage collector not running, nothing to stop');
  }
}
