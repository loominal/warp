/**
 * Cursor-based pagination utilities for stateless pagination
 *
 * Uses base64-encoded JSON to store pagination state in an opaque cursor.
 * Supports offset-based pagination with optional filter consistency checking.
 */

import { createHash } from 'crypto';
import type { PaginationCursor, PaginationState, PaginationMetadata } from './types.js';
import { createLogger } from './logger.js';

const logger = createLogger('pagination');

/**
 * Encode pagination state into an opaque cursor
 * @param state - Pagination state to encode
 * @returns Base64-encoded cursor string
 */
export function encodeCursor(state: PaginationState): PaginationCursor {
  const json = JSON.stringify(state);
  const cursor = Buffer.from(json, 'utf-8').toString('base64url');

  logger.debug('Cursor encoded', { offset: state.offset, limit: state.limit });

  return cursor;
}

/**
 * Decode pagination cursor into state
 * @param cursor - Base64-encoded cursor string
 * @returns Decoded pagination state
 * @throws Error if cursor is invalid
 */
export function decodeCursor(cursor: PaginationCursor): PaginationState {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const state = JSON.parse(json) as PaginationState;

    // Validate decoded state
    if (typeof state.offset !== 'number' || state.offset < 0) {
      throw new Error('Invalid offset in cursor');
    }

    if (typeof state.limit !== 'number' || state.limit < 1 || state.limit > 1000) {
      throw new Error('Invalid limit in cursor');
    }

    logger.debug('Cursor decoded', { offset: state.offset, limit: state.limit });

    return state;
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to decode cursor', { error: error.message });
    throw new Error(`Invalid pagination cursor: ${error.message}`);
  }
}

/**
 * Validate pagination cursor
 * @param cursor - Cursor to validate
 * @param filterHash - Optional expected filter hash for consistency
 * @returns Validation result
 */
export function validateCursor(
  cursor: PaginationCursor,
  filterHash?: string
): { valid: boolean; error?: string } {
  try {
    const state = decodeCursor(cursor);

    // Check filter consistency if provided
    if (filterHash && state.filterHash && state.filterHash !== filterHash) {
      return {
        valid: false,
        error: 'Cursor filter mismatch - filters changed between requests. Start a new query.',
      };
    }

    return { valid: true };
  } catch (err) {
    const error = err as Error;
    return { valid: false, error: error.message };
  }
}

/**
 * Create filter hash for consistency checking
 * Hashes the filter parameters to detect changes between paginated requests
 * @param filters - Filter object to hash
 * @returns SHA-256 hash of filters (first 16 chars)
 */
export function createFilterHash(filters: Record<string, unknown>): string {
  // Sort keys for deterministic hashing
  const sortedKeys = Object.keys(filters).sort();
  const normalized = sortedKeys.reduce((acc, key) => {
    acc[key] = filters[key];
    return acc;
  }, {} as Record<string, unknown>);

  const json = JSON.stringify(normalized);
  const hash = createHash('sha256').update(json).digest('hex');

  return hash.substring(0, 16);
}

/**
 * Create pagination metadata for a result set
 * @param options - Pagination options
 * @returns Pagination metadata
 */
export function createPaginationMetadata(options: {
  /** Items returned in this page */
  count: number;
  /** Total items available (if known) */
  total?: number;
  /** Current offset */
  offset: number;
  /** Page size */
  limit: number;
  /** Optional filter hash */
  filterHash?: string;
}): PaginationMetadata {
  const { count, total, offset, limit, filterHash } = options;

  // Determine if there are more pages
  const hasMore = total !== undefined
    ? offset + count < total
    : count === limit; // If we got a full page, assume more exist

  // Create next cursor if more pages available
  const nextState: PaginationState = { offset: offset + count, limit };
  if (filterHash) nextState.filterHash = filterHash;
  const nextCursor = hasMore ? encodeCursor(nextState) : null;

  // Create previous cursor if not on first page
  const prevState: PaginationState = { offset: Math.max(0, offset - limit), limit };
  if (filterHash) prevState.filterHash = filterHash;
  const prevCursor = offset > 0 ? encodeCursor(prevState) : null;

  // Build metadata conditionally for exactOptionalPropertyTypes
  const metadata: PaginationMetadata = {
    count,
    nextCursor,
    prevCursor, // Always include (null on first page)
    hasMore,
  };

  if (total !== undefined) metadata.total = total;

  return metadata;
}

/**
 * Parse pagination parameters from tool arguments
 * @param args - Tool arguments that may contain cursor or limit
 * @param defaultLimit - Default page size (default: 20)
 * @param maxLimit - Maximum allowed page size (default: 100)
 * @returns Pagination state
 */
export function parsePaginationArgs(
  args: Record<string, unknown>,
  defaultLimit: number = 20,
  maxLimit: number = 100
): PaginationState {
  const cursor = args['cursor'] as PaginationCursor | undefined;
  const limit = Math.min(
    Math.max((args['limit'] as number | undefined) ?? defaultLimit, 1),
    maxLimit
  );

  // If cursor provided, decode it
  if (cursor) {
    const state = decodeCursor(cursor);
    // Use limit from cursor, but allow override if explicitly provided
    return {
      ...state,
      limit: args['limit'] !== undefined ? limit : state.limit,
    };
  }

  // No cursor - start from beginning
  return {
    offset: 0,
    limit,
  };
}
