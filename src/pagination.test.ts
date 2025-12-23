/**
 * Tests for pagination utilities
 */

import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  validateCursor,
  createFilterHash,
  createPaginationMetadata,
  parsePaginationArgs,
} from './pagination.js';

describe('encodeCursor', () => {
  it('should encode pagination state to base64url', () => {
    const state = { offset: 0, limit: 20 };
    const cursor = encodeCursor(state);

    expect(typeof cursor).toBe('string');
    expect(cursor.length).toBeGreaterThan(0);
    // Should be URL-safe base64
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should encode state with filter hash', () => {
    const state = { offset: 10, limit: 50, filterHash: 'abc123' };
    const cursor = encodeCursor(state);

    expect(cursor).toBeDefined();
    const decoded = decodeCursor(cursor);
    expect(decoded.filterHash).toBe('abc123');
  });

  it('should produce different cursors for different states', () => {
    const cursor1 = encodeCursor({ offset: 0, limit: 20 });
    const cursor2 = encodeCursor({ offset: 20, limit: 20 });

    expect(cursor1).not.toBe(cursor2);
  });
});

describe('decodeCursor', () => {
  it('should decode valid cursor back to state', () => {
    const original = { offset: 10, limit: 25 };
    const cursor = encodeCursor(original);
    const decoded = decodeCursor(cursor);

    expect(decoded.offset).toBe(10);
    expect(decoded.limit).toBe(25);
  });

  it('should decode cursor with filter hash', () => {
    const original = { offset: 0, limit: 20, filterHash: 'xyz789' };
    const cursor = encodeCursor(original);
    const decoded = decodeCursor(cursor);

    expect(decoded.offset).toBe(0);
    expect(decoded.limit).toBe(20);
    expect(decoded.filterHash).toBe('xyz789');
  });

  it('should throw error for invalid cursor', () => {
    expect(() => decodeCursor('invalid-cursor')).toThrow('Invalid pagination cursor');
  });

  it('should throw error for non-base64 cursor', () => {
    expect(() => decodeCursor('not base64!')).toThrow('Invalid pagination cursor');
  });

  it('should throw error for cursor with invalid offset', () => {
    const invalidState = JSON.stringify({ offset: -1, limit: 20 });
    const cursor = Buffer.from(invalidState).toString('base64url');

    expect(() => decodeCursor(cursor)).toThrow('Invalid offset');
  });

  it('should throw error for cursor with invalid limit', () => {
    const invalidState = JSON.stringify({ offset: 0, limit: 0 });
    const cursor = Buffer.from(invalidState).toString('base64url');

    expect(() => decodeCursor(cursor)).toThrow('Invalid limit');
  });

  it('should throw error for cursor with limit > 1000', () => {
    const invalidState = JSON.stringify({ offset: 0, limit: 1001 });
    const cursor = Buffer.from(invalidState).toString('base64url');

    expect(() => decodeCursor(cursor)).toThrow('Invalid limit');
  });
});

describe('validateCursor', () => {
  it('should validate correct cursor', () => {
    const cursor = encodeCursor({ offset: 0, limit: 20 });
    const result = validateCursor(cursor);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject invalid cursor', () => {
    const result = validateCursor('invalid-cursor');

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should validate cursor with matching filter hash', () => {
    const filterHash = 'abc123';
    const cursor = encodeCursor({ offset: 0, limit: 20, filterHash });
    const result = validateCursor(cursor, filterHash);

    expect(result.valid).toBe(true);
  });

  it('should reject cursor with mismatched filter hash', () => {
    const cursor = encodeCursor({ offset: 0, limit: 20, filterHash: 'abc123' });
    const result = validateCursor(cursor, 'xyz789');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('filter mismatch');
  });

  it('should allow cursor without filter hash when hash expected', () => {
    const cursor = encodeCursor({ offset: 0, limit: 20 });
    const result = validateCursor(cursor, 'abc123');

    // Should be valid - cursor has no hash, so no mismatch
    expect(result.valid).toBe(true);
  });
});

describe('createFilterHash', () => {
  it('should create consistent hash for same filters', () => {
    const filters = { capability: 'typescript', priority: 8 };
    const hash1 = createFilterHash(filters);
    const hash2 = createFilterHash(filters);

    expect(hash1).toBe(hash2);
  });

  it('should create different hash for different filters', () => {
    const filters1 = { capability: 'typescript' };
    const filters2 = { capability: 'testing' };
    const hash1 = createFilterHash(filters1);
    const hash2 = createFilterHash(filters2);

    expect(hash1).not.toBe(hash2);
  });

  it('should be order-independent (sorts keys)', () => {
    const filters1 = { a: 1, b: 2, c: 3 };
    const filters2 = { c: 3, a: 1, b: 2 };
    const hash1 = createFilterHash(filters1);
    const hash2 = createFilterHash(filters2);

    expect(hash1).toBe(hash2);
  });

  it('should return 16-character hex string', () => {
    const hash = createFilterHash({ test: 'value' });

    expect(hash.length).toBe(16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('should handle empty filters', () => {
    const hash = createFilterHash({});

    expect(hash.length).toBe(16);
  });
});

describe('createPaginationMetadata', () => {
  it('should create metadata for first page with more results', () => {
    const metadata = createPaginationMetadata({
      count: 20,
      total: 100,
      offset: 0,
      limit: 20,
    });

    expect(metadata.count).toBe(20);
    expect(metadata.total).toBe(100);
    expect(metadata.hasMore).toBe(true);
    expect(metadata.nextCursor).toBeDefined();
    expect(metadata.prevCursor).toBeNull();
  });

  it('should create metadata for middle page', () => {
    const metadata = createPaginationMetadata({
      count: 20,
      total: 100,
      offset: 40,
      limit: 20,
    });

    expect(metadata.count).toBe(20);
    expect(metadata.hasMore).toBe(true);
    expect(metadata.nextCursor).toBeDefined();
    expect(metadata.prevCursor).toBeDefined();
  });

  it('should create metadata for last page', () => {
    const metadata = createPaginationMetadata({
      count: 10,
      total: 50,
      offset: 40,
      limit: 20,
    });

    expect(metadata.count).toBe(10);
    expect(metadata.hasMore).toBe(false);
    expect(metadata.nextCursor).toBeNull();
    expect(metadata.prevCursor).toBeDefined();
  });

  it('should handle unknown total with full page (assumes more)', () => {
    const metadata = createPaginationMetadata({
      count: 20,
      offset: 0,
      limit: 20,
    });

    expect(metadata.total).toBeUndefined();
    expect(metadata.hasMore).toBe(true); // Got full page, assume more
    expect(metadata.nextCursor).toBeDefined();
  });

  it('should handle unknown total with partial page (no more)', () => {
    const metadata = createPaginationMetadata({
      count: 15,
      offset: 0,
      limit: 20,
    });

    expect(metadata.total).toBeUndefined();
    expect(metadata.hasMore).toBe(false); // Partial page, no more
    expect(metadata.nextCursor).toBeNull();
  });

  it('should include filter hash in cursors', () => {
    const filterHash = 'abc123';
    const metadata = createPaginationMetadata({
      count: 20,
      total: 100,
      offset: 0,
      limit: 20,
      filterHash,
    });

    expect(metadata.nextCursor).toBeDefined();

    if (metadata.nextCursor) {
      const decoded = decodeCursor(metadata.nextCursor);
      expect(decoded.filterHash).toBe(filterHash);
    }
  });

  it('should calculate correct next offset', () => {
    const metadata = createPaginationMetadata({
      count: 20,
      total: 100,
      offset: 10,
      limit: 20,
    });

    if (metadata.nextCursor) {
      const decoded = decodeCursor(metadata.nextCursor);
      expect(decoded.offset).toBe(30); // 10 + 20
    }
  });

  it('should calculate correct prev offset', () => {
    const metadata = createPaginationMetadata({
      count: 20,
      total: 100,
      offset: 40,
      limit: 20,
    });

    if (metadata.prevCursor) {
      const decoded = decodeCursor(metadata.prevCursor);
      expect(decoded.offset).toBe(20); // 40 - 20
    }
  });

  it('should not allow negative prev offset', () => {
    const metadata = createPaginationMetadata({
      count: 15,
      total: 100,
      offset: 10,
      limit: 20,
    });

    if (metadata.prevCursor) {
      const decoded = decodeCursor(metadata.prevCursor);
      expect(decoded.offset).toBe(0); // Max(0, 10 - 20)
    }
  });
});

describe('parsePaginationArgs', () => {
  it('should parse args with no cursor (first page)', () => {
    const state = parsePaginationArgs({});

    expect(state.offset).toBe(0);
    expect(state.limit).toBe(20); // Default
  });

  it('should parse args with custom limit', () => {
    const state = parsePaginationArgs({ limit: 50 });

    expect(state.offset).toBe(0);
    expect(state.limit).toBe(50);
  });

  it('should enforce max limit', () => {
    const state = parsePaginationArgs({ limit: 500 }, 20, 100);

    expect(state.limit).toBe(100); // Clamped to max
  });

  it('should enforce min limit', () => {
    const state = parsePaginationArgs({ limit: 0 }, 20, 100);

    expect(state.limit).toBe(1); // Clamped to min
  });

  it('should parse args with cursor', () => {
    const cursor = encodeCursor({ offset: 40, limit: 25 });
    const state = parsePaginationArgs({ cursor });

    expect(state.offset).toBe(40);
    expect(state.limit).toBe(25);
  });

  it('should allow limit override when cursor provided', () => {
    const cursor = encodeCursor({ offset: 40, limit: 25 });
    const state = parsePaginationArgs({ cursor, limit: 50 });

    expect(state.offset).toBe(40);
    expect(state.limit).toBe(50); // Overridden
  });

  it('should preserve filter hash from cursor', () => {
    const cursor = encodeCursor({ offset: 20, limit: 20, filterHash: 'abc123' });
    const state = parsePaginationArgs({ cursor });

    expect(state.filterHash).toBe('abc123');
  });

  it('should use custom defaults', () => {
    const state = parsePaginationArgs({}, 50, 200);

    expect(state.limit).toBe(50);
  });
});
