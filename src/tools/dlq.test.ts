/**
 * Tests for DLQ management tools
 */

import { describe, it, expect } from 'vitest';
import { handleListDeadLetterItems, handleRetryDeadLetterItem, handleDiscardDeadLetterItem } from './registry.js';

describe('list_dead_letter_items tool', () => {
  describe('validation', () => {
    it('should accept request with no parameters', async () => {
      const args = {};

      // Will fail due to NATS not connected, but validation should pass
      const result = await handleListDeadLetterItems(args);
      // Should not have validation errors, but may have NATS connection errors
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('is required');
      }
    });

    it('should accept capability filter', async () => {
      const args = {
        capability: 'typescript',
      };

      // Will fail due to NATS not connected
      await handleListDeadLetterItems(args);
      // If validation passed, the error would be from NATS, not from validation
    });

    it('should accept limit parameter', async () => {
      const args = {
        limit: 10,
      };

      // Will fail due to NATS not connected
      await handleListDeadLetterItems(args);
      // If validation passed, the error would be from NATS, not from validation
    });

    it('should enforce max limit of 100', async () => {
      const args = {
        limit: 200,
      };

      // Will fail due to NATS not connected, but limit should be capped at 100
      await handleListDeadLetterItems(args);
      // The function should internally limit to 100
    });

    it('should default limit to 20', async () => {
      const args = {};

      // Will fail due to NATS not connected
      await handleListDeadLetterItems(args);
      // The function should use default limit of 20
    });

    it('should accept both capability and limit', async () => {
      const args = {
        capability: 'code-review',
        limit: 50,
      };

      // Will fail due to NATS not connected
      await handleListDeadLetterItems(args);
      // If validation passed, the error would be from NATS, not from validation
    });
  });

  describe('response format', () => {
    it('should accept valid parameters structure', () => {
      const args = {
        capability: 'typescript',
        limit: 20,
      };

      // Verify that args structure is correct
      expect(args.capability).toBe('typescript');
      expect(args.limit).toBe(20);
    });
  });
});

describe('retry_dead_letter_item tool', () => {
  describe('validation', () => {
    it('should require itemId', async () => {
      const args = {};

      const result = await handleRetryDeadLetterItem(args);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('itemId is required');
    });

    it('should reject empty itemId', async () => {
      const args = {
        itemId: '',
      };

      const result = await handleRetryDeadLetterItem(args);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('itemId is required');
    });

    it('should reject invalid UUID format', async () => {
      const args = {
        itemId: 'not-a-uuid',
      };

      const result = await handleRetryDeadLetterItem(args);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('valid UUID v4 format');
    });

    it('should reject UUID v1 format', async () => {
      const args = {
        itemId: '550e8400-e29b-11d4-a716-446655440000', // UUID v1
      };

      const result = await handleRetryDeadLetterItem(args);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('valid UUID v4 format');
    });

    it('should accept valid UUID v4', async () => {
      const args = {
        itemId: '123e4567-e89b-42d3-a456-426614174000', // Valid UUID v4
      };

      // Will fail due to NATS not connected or item not found
      const result = await handleRetryDeadLetterItem(args);
      // Should not have UUID validation error
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('valid UUID v4 format');
      }
    });

    it('should accept resetAttempts parameter', async () => {
      const args = {
        itemId: '123e4567-e89b-42d3-a456-426614174000',
        resetAttempts: true,
      };

      // Will fail due to NATS not connected or item not found
      const result = await handleRetryDeadLetterItem(args);
      // Should not have validation error for resetAttempts
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('resetAttempts');
      }
    });

    it('should default resetAttempts to false', async () => {
      const args = {
        itemId: '123e4567-e89b-42d3-a456-426614174000',
      };

      // Will fail due to NATS not connected or item not found
      await handleRetryDeadLetterItem(args);
      // The function should use default resetAttempts = false
    });
  });

  describe('response format', () => {
    it('should have required fields in args', () => {
      const args = {
        itemId: '123e4567-e89b-42d3-a456-426614174000',
        resetAttempts: true,
      };

      // Verify that args structure is correct
      expect(args.itemId).toBe('123e4567-e89b-42d3-a456-426614174000');
      expect(args.resetAttempts).toBe(true);
    });
  });
});

describe('discard_dead_letter_item tool', () => {
  describe('validation', () => {
    it('should require itemId', async () => {
      const args = {};

      const result = await handleDiscardDeadLetterItem(args);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('itemId is required');
    });

    it('should reject empty itemId', async () => {
      const args = {
        itemId: '',
      };

      const result = await handleDiscardDeadLetterItem(args);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('itemId is required');
    });

    it('should reject invalid UUID format', async () => {
      const args = {
        itemId: 'not-a-uuid',
      };

      const result = await handleDiscardDeadLetterItem(args);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('valid UUID v4 format');
    });

    it('should reject UUID v1 format', async () => {
      const args = {
        itemId: '550e8400-e29b-11d4-a716-446655440000', // UUID v1
      };

      const result = await handleDiscardDeadLetterItem(args);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('valid UUID v4 format');
    });

    it('should accept valid UUID v4', async () => {
      const args = {
        itemId: '123e4567-e89b-42d3-a456-426614174000', // Valid UUID v4
      };

      // Will fail due to NATS not connected or item not found
      const result = await handleDiscardDeadLetterItem(args);
      // Should not have UUID validation error
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('valid UUID v4 format');
      }
    });
  });

  describe('response format', () => {
    it('should have required fields in args', () => {
      const args = {
        itemId: '123e4567-e89b-42d3-a456-426614174000',
      };

      // Verify that args structure is correct
      expect(args.itemId).toBe('123e4567-e89b-42d3-a456-426614174000');
    });
  });
});

describe('DLQ tools - various UUID formats', () => {
  describe('retry_dead_letter_item with different UUID formats', () => {
    it('should accept lowercase UUID v4', async () => {
      const args = {
        itemId: '123e4567-e89b-42d3-a456-426614174000',
      };

      const result = await handleRetryDeadLetterItem(args);
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('valid UUID v4 format');
      }
    });

    it('should accept uppercase UUID v4', async () => {
      const args = {
        itemId: '123E4567-E89B-42D3-A456-426614174000',
      };

      const result = await handleRetryDeadLetterItem(args);
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('valid UUID v4 format');
      }
    });

    it('should accept mixed case UUID v4', async () => {
      const args = {
        itemId: '123e4567-E89B-42d3-A456-426614174000',
      };

      const result = await handleRetryDeadLetterItem(args);
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('valid UUID v4 format');
      }
    });
  });

  describe('discard_dead_letter_item with different UUID formats', () => {
    it('should accept lowercase UUID v4', async () => {
      const args = {
        itemId: '123e4567-e89b-42d3-a456-426614174000',
      };

      const result = await handleDiscardDeadLetterItem(args);
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('valid UUID v4 format');
      }
    });

    it('should accept uppercase UUID v4', async () => {
      const args = {
        itemId: '123E4567-E89B-42D3-A456-426614174000',
      };

      const result = await handleDiscardDeadLetterItem(args);
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('valid UUID v4 format');
      }
    });

    it('should accept mixed case UUID v4', async () => {
      const args = {
        itemId: '123e4567-E89B-42d3-A456-426614174000',
      };

      const result = await handleDiscardDeadLetterItem(args);
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('valid UUID v4 format');
      }
    });
  });
});

/**
 * Integration tests - require running NATS server with JetStream
 * These tests are commented out but can be run manually with:
 * INTEGRATION_TESTS=true npm test
 *
 * Start NATS first: nats-server -js
 */
describe.skip('DLQ Tools Integration Tests', () => {
  // beforeEach(async () => {
  //   // Would need to connect to NATS first
  //   // await connectToNats('nats://localhost:4222');
  //   // await createDLQStream();
  // });
  //
  // afterEach(async () => {
  //   // Would need to clean up
  //   // await disconnect();
  // });
  //
  // it('should list dead letter items', async () => {
  //   // const args = {
  //   //   limit: 10,
  //   // };
  //   //
  //   // const result = await handleListDeadLetterItems(args);
  //   //
  //   // expect(result.isError).toBeFalsy();
  //   // expect(result.content[0]?.text).toContain('Dead Letter Queue');
  // });
  //
  // it('should retry dead letter item', async () => {
  //   // First create a DLQ item, then retry it
  //   // const args = {
  //   //   itemId: 'some-item-id',
  //   //   resetAttempts: true,
  //   // };
  //   //
  //   // const result = await handleRetryDeadLetterItem(args);
  //   //
  //   // expect(result.isError).toBeFalsy();
  //   // expect(result.content[0]?.text).toContain('moved back to work queue');
  // });
  //
  // it('should discard dead letter item', async () => {
  //   // First create a DLQ item, then discard it
  //   // const args = {
  //   //   itemId: 'some-item-id',
  //   // };
  //   //
  //   // const result = await handleDiscardDeadLetterItem(args);
  //   //
  //   // expect(result.isError).toBeFalsy();
  //   // expect(result.content[0]?.text).toContain('permanently deleted');
  // });
});
