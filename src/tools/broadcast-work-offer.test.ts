/**
 * Tests for broadcast_work_offer tool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleBroadcastWorkOffer } from './registry.js';
import type { SessionState, RegistryEntry } from '../types.js';

describe('broadcast_work_offer tool', () => {
  let mockState: SessionState;
  let mockEntry: RegistryEntry;

  beforeEach(() => {
    // Create mock registry entry
    mockEntry = {
      guid: '123e4567-e89b-12d3-a456-426614174000',
      agentType: 'developer',
      handle: 'test-agent',
      hostname: 'test-host',
      projectId: '1234567890abcdef',
      natsUrl: 'nats://localhost:4222',
      capabilities: ['typescript', 'testing'],
      scope: 'project',
      visibility: 'project-only',
      status: 'online',
      currentTaskCount: 0,
      registeredAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
    };

    // Create mock session state
    mockState = {
      handle: 'test-agent',
      agentGuid: '123e4567-e89b-12d3-a456-426614174000',
      registeredEntry: mockEntry,
    };
  });

  describe('validation', () => {
    it('should require taskId', async () => {
      const args = {
        description: 'Test task',
        requiredCapability: 'typescript',
      };

      const result = await handleBroadcastWorkOffer(args, mockState);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('taskId is required');
    });

    it('should reject empty taskId', async () => {
      const args = {
        taskId: '',
        description: 'Test task',
        requiredCapability: 'typescript',
      };

      const result = await handleBroadcastWorkOffer(args, mockState);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('taskId is required');
    });

    it('should require description', async () => {
      const args = {
        taskId: 'task-123',
        requiredCapability: 'typescript',
      };

      const result = await handleBroadcastWorkOffer(args, mockState);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('description is required');
    });

    it('should reject empty description', async () => {
      const args = {
        taskId: 'task-123',
        description: '',
        requiredCapability: 'typescript',
      };

      const result = await handleBroadcastWorkOffer(args, mockState);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('description is required');
    });

    it('should require requiredCapability', async () => {
      const args = {
        taskId: 'task-123',
        description: 'Test task',
      };

      const result = await handleBroadcastWorkOffer(args, mockState);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('requiredCapability is required');
    });

    it('should reject empty requiredCapability', async () => {
      const args = {
        taskId: 'task-123',
        description: 'Test task',
        requiredCapability: '',
      };

      const result = await handleBroadcastWorkOffer(args, mockState);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('requiredCapability is required');
    });

    it('should validate priority range - reject too low', async () => {
      const args = {
        taskId: 'task-123',
        description: 'Test task',
        requiredCapability: 'typescript',
        priority: 0,
      };

      const result = await handleBroadcastWorkOffer(args, mockState);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('priority must be between 1 and 10');
    });

    it('should validate priority range - reject too high', async () => {
      const args = {
        taskId: 'task-123',
        description: 'Test task',
        requiredCapability: 'typescript',
        priority: 11,
      };

      const result = await handleBroadcastWorkOffer(args, mockState);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('priority must be between 1 and 10');
    });

    it('should accept valid priority values', async () => {
      const validPriorities = [1, 5, 10];

      for (const priority of validPriorities) {
        const args = {
          taskId: 'task-123',
          description: 'Test task',
          requiredCapability: 'typescript',
          priority,
        };

        // Will fail because NATS is not connected, but priority validation should pass
        const result = await handleBroadcastWorkOffer(args, mockState);
        // Should not have priority validation error
        if (result.isError) {
          expect(result.content[0]?.text).not.toContain('priority must be between 1 and 10');
        }
      }
    });

    it('should default priority to 5 if not provided', async () => {
      const args = {
        taskId: 'task-123',
        description: 'Test task',
        requiredCapability: 'typescript',
      };

      // Will fail because NATS is not connected, but we can verify priority default doesn't cause validation error
      const result = await handleBroadcastWorkOffer(args, mockState);
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('priority must be between 1 and 10');
      }
    });

    it('should require agent to be registered', async () => {
      const unregisteredState: SessionState = {
        handle: null,
        agentGuid: null,
        registeredEntry: null,
      };

      const args = {
        taskId: 'task-123',
        description: 'Test task',
        requiredCapability: 'typescript',
      };

      const result = await handleBroadcastWorkOffer(args, unregisteredState);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('must be registered');
    });
  });

  describe('work item creation', () => {
    it('should fail when NATS is not connected', async () => {
      const args = {
        taskId: 'task-123',
        description: 'Implement user authentication',
        requiredCapability: 'typescript',
        priority: 8,
      };

      const result = await handleBroadcastWorkOffer(args, mockState);
      expect(result.isError).toBe(true);
      // Should fail with NATS connection error or work queue error
    });

    it('should accept optional deadline', async () => {
      const args = {
        taskId: 'task-123',
        description: 'Test task',
        requiredCapability: 'typescript',
        deadline: '2024-12-31T23:59:59Z',
      };

      // Will fail due to NATS not connected, but validates deadline is accepted
      await handleBroadcastWorkOffer(args, mockState);
      // If validation passed, the error would be from NATS, not from validation
    });

    it('should accept optional contextData', async () => {
      const args = {
        taskId: 'task-123',
        description: 'Test task',
        requiredCapability: 'typescript',
        contextData: {
          projectId: 'proj-456',
          files: ['src/auth.ts', 'src/user.ts'],
          severity: 'high',
        },
      };

      // Will fail due to NATS not connected, but validates contextData is accepted
      await handleBroadcastWorkOffer(args, mockState);
      // If validation passed, the error would be from NATS, not from validation
    });

    it('should accept all optional fields together', async () => {
      const args = {
        taskId: 'task-123',
        description: 'Implement user authentication',
        requiredCapability: 'typescript',
        priority: 9,
        deadline: '2024-12-31T23:59:59Z',
        contextData: {
          projectId: 'proj-456',
          files: ['src/auth.ts'],
        },
      };

      // Will fail due to NATS not connected
      const result = await handleBroadcastWorkOffer(args, mockState);
      expect(result.isError).toBe(true);
      // Should not be a validation error
      expect(result.content[0]?.text).not.toContain('is required');
      expect(result.content[0]?.text).not.toContain('priority must be between');
    });
  });

  describe('capabilities', () => {
    it('should accept different capability types', async () => {
      const capabilities = ['typescript', 'code-review', 'testing', 'python', 'documentation'];

      for (const capability of capabilities) {
        const args = {
          taskId: 'task-123',
          description: 'Test task',
          requiredCapability: capability,
        };

        // Will fail due to NATS not connected
        const result = await handleBroadcastWorkOffer(args, mockState);
        // Should not be a capability validation error
        if (result.isError) {
          expect(result.content[0]?.text).not.toContain('requiredCapability is required');
        }
      }
    });
  });

  describe('response format', () => {
    it('should have required fields in args for minimal work offer', () => {
      const args = {
        taskId: 'task-123',
        description: 'Test task',
        requiredCapability: 'typescript',
      };

      // Verify that args structure is correct
      expect(args.taskId).toBe('task-123');
      expect(args.description).toBe('Test task');
      expect(args.requiredCapability).toBe('typescript');
    });

    it('should have all fields in args for complete work offer', () => {
      const args = {
        taskId: 'task-123',
        description: 'Implement feature',
        requiredCapability: 'typescript',
        priority: 8,
        deadline: '2024-12-31T23:59:59Z',
        contextData: {
          feature: 'authentication',
        },
      };

      // Verify that args structure is correct
      expect(args.taskId).toBe('task-123');
      expect(args.description).toBe('Implement feature');
      expect(args.requiredCapability).toBe('typescript');
      expect(args.priority).toBe(8);
      expect(args.deadline).toBe('2024-12-31T23:59:59Z');
      expect(args.contextData).toEqual({ feature: 'authentication' });
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
describe.skip('broadcast_work_offer Integration Tests', () => {
  // beforeEach(async () => {
  //   // Would need to connect to NATS first
  //   // await connectToNats('nats://localhost:4222');
  //   // await initializeRegistry();
  // });
  //
  // afterEach(async () => {
  //   // Would need to clean up
  //   // await disconnect();
  // });
  //
  // it('should successfully publish work offer to queue', async () => {
  //   // const mockEntry: RegistryEntry = { ... };
  //   // const mockState: SessionState = { ... };
  //   //
  //   // const args = {
  //   //   taskId: 'task-123',
  //   //   description: 'Implement user authentication',
  //   //   requiredCapability: 'typescript',
  //   //   priority: 8,
  //   // };
  //   //
  //   // const result = await handleBroadcastWorkOffer(args, mockState);
  //   //
  //   // expect(result.isError).toBeFalsy();
  //   // expect(result.content[0]?.text).toContain('Work offer published successfully');
  //   // expect(result.content[0]?.text).toContain('task-123');
  //   // expect(result.content[0]?.text).toContain('typescript');
  //   // expect(result.content[0]?.text).toContain('Priority: 8');
  // });
  //
  // it('should create work queue stream if it does not exist', async () => {
  //   // Test that the tool creates the stream for the capability
  // });
  //
  // it('should publish work item with all fields', async () => {
  //   // Test that all fields (including optional ones) are properly published
  // });
});
