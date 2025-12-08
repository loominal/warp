/**
 * Tests for work-messages module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateWorkMessage,
  createWorkOfferMessage,
  createWorkClaimMessage,
  createWorkAcceptMessage,
  createWorkRejectMessage,
  createProgressUpdateMessage,
  createWorkCompleteMessage,
  createWorkErrorMessage,
  parseWorkMessagePayload,
} from './work-messages.js';
import type {
  WorkOfferPayload,
  WorkClaimPayload,
  WorkAcceptPayload,
  WorkRejectPayload,
  ProgressUpdatePayload,
  WorkCompletePayload,
  WorkErrorPayload,
} from './types.js';

describe('validateWorkMessage', () => {
  describe('work-offer validation', () => {
    it('should accept valid work-offer payload', () => {
      const payload: WorkOfferPayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Fix bug in parser',
      };

      const result = validateWorkMessage('work-offer', payload);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept work-offer with optional fields', () => {
      const payload: WorkOfferPayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Fix bug in parser',
        priority: 8,
        deadline: '2025-12-31T23:59:59.000Z',
        contextData: { file: 'parser.ts', line: 42 },
      };

      const result = validateWorkMessage('work-offer', payload);
      expect(result.valid).toBe(true);
    });

    it('should reject work-offer with missing workItemId', () => {
      const payload = {
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Fix bug',
      };

      const result = validateWorkMessage('work-offer', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('workItemId');
    });

    it('should reject work-offer with invalid UUID', () => {
      const payload = {
        workItemId: 'invalid-uuid',
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Fix bug',
      };

      const result = validateWorkMessage('work-offer', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('UUID');
    });

    it('should reject work-offer with empty taskId', () => {
      const payload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        taskId: '',
        capability: 'typescript',
        description: 'Fix bug',
      };

      const result = validateWorkMessage('work-offer', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('taskId');
    });

    it('should reject work-offer with invalid priority', () => {
      const payload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Fix bug',
        priority: 11,
      };

      const result = validateWorkMessage('work-offer', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('priority');
    });

    it('should reject work-offer with invalid deadline', () => {
      const payload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Fix bug',
        deadline: 'not-a-date',
      };

      const result = validateWorkMessage('work-offer', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('deadline');
    });
  });

  describe('work-claim validation', () => {
    it('should accept valid work-claim payload', () => {
      const payload: WorkClaimPayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        claimerCapabilities: ['typescript', 'testing'],
      };

      const result = validateWorkMessage('work-claim', payload);
      expect(result.valid).toBe(true);
    });

    it('should reject work-claim with empty capabilities', () => {
      const payload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        claimerCapabilities: [],
      };

      const result = validateWorkMessage('work-claim', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('claimerCapabilities');
    });

    it('should reject work-claim with non-array capabilities', () => {
      const payload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        claimerCapabilities: 'typescript',
      };

      const result = validateWorkMessage('work-claim', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('claimerCapabilities');
    });
  });

  describe('work-accept validation', () => {
    it('should accept valid work-accept payload', () => {
      const payload: WorkAcceptPayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = validateWorkMessage('work-accept', payload);
      expect(result.valid).toBe(true);
    });

    it('should accept work-accept with instructions', () => {
      const payload: WorkAcceptPayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        instructions: 'Focus on edge cases',
      };

      const result = validateWorkMessage('work-accept', payload);
      expect(result.valid).toBe(true);
    });

    it('should reject work-accept with invalid workItemId', () => {
      const payload = {
        workItemId: 'not-a-uuid',
      };

      const result = validateWorkMessage('work-accept', payload);
      expect(result.valid).toBe(false);
    });
  });

  describe('work-reject validation', () => {
    it('should accept valid work-reject payload', () => {
      const payload: WorkRejectPayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        reason: 'Insufficient capabilities',
      };

      const result = validateWorkMessage('work-reject', payload);
      expect(result.valid).toBe(true);
    });

    it('should reject work-reject with empty reason', () => {
      const payload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        reason: '',
      };

      const result = validateWorkMessage('work-reject', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reason');
    });
  });

  describe('progress-update validation', () => {
    it('should accept valid progress-update payload', () => {
      const payload: ProgressUpdatePayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        progress: 50,
      };

      const result = validateWorkMessage('progress-update', payload);
      expect(result.valid).toBe(true);
    });

    it('should accept progress-update with message', () => {
      const payload: ProgressUpdatePayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        progress: 75,
        message: 'Almost done',
      };

      const result = validateWorkMessage('progress-update', payload);
      expect(result.valid).toBe(true);
    });

    it('should reject progress-update with invalid progress range', () => {
      const payload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        progress: 150,
      };

      const result = validateWorkMessage('progress-update', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('progress');
    });

    it('should reject progress-update with negative progress', () => {
      const payload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        progress: -10,
      };

      const result = validateWorkMessage('progress-update', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('progress');
    });
  });

  describe('work-complete validation', () => {
    it('should accept valid work-complete payload', () => {
      const payload: WorkCompletePayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = validateWorkMessage('work-complete', payload);
      expect(result.valid).toBe(true);
    });

    it('should accept work-complete with result and summary', () => {
      const payload: WorkCompletePayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        result: { testsAdded: 5, bugFixed: true },
        summary: 'Fixed parser bug and added comprehensive tests',
      };

      const result = validateWorkMessage('work-complete', payload);
      expect(result.valid).toBe(true);
    });

    it('should reject work-complete with non-object result', () => {
      const payload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        result: 'not-an-object',
      };

      const result = validateWorkMessage('work-complete', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('result');
    });
  });

  describe('work-error validation', () => {
    it('should accept valid work-error payload', () => {
      const payload: WorkErrorPayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        error: 'Failed to compile',
        recoverable: true,
      };

      const result = validateWorkMessage('work-error', payload);
      expect(result.valid).toBe(true);
    });

    it('should reject work-error with missing recoverable field', () => {
      const payload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        error: 'Failed to compile',
      };

      const result = validateWorkMessage('work-error', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('recoverable');
    });

    it('should reject work-error with empty error message', () => {
      const payload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        error: '',
        recoverable: true,
      };

      const result = validateWorkMessage('work-error', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('error');
    });
  });

  describe('unknown message type', () => {
    it('should reject unknown message type', () => {
      const payload = { workItemId: '550e8400-e29b-41d4-a716-446655440000' };

      const result = validateWorkMessage('unknown-type', payload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown work message type');
    });
  });
});

describe('message creation functions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-12-07T10:00:00.000Z'));
  });

  describe('createWorkOfferMessage', () => {
    it('should create a valid work-offer message', () => {
      const payload: WorkOfferPayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Fix bug',
      };

      const message = createWorkOfferMessage(
        'sender-guid',
        'sender-handle',
        'recipient-guid',
        payload
      );

      expect(message.senderGuid).toBe('sender-guid');
      expect(message.senderHandle).toBe('sender-handle');
      expect(message.recipientGuid).toBe('recipient-guid');
      expect(message.messageType).toBe('work-offer');
      expect(message.timestamp).toBe('2025-12-07T10:00:00.000Z');
      expect(message.id).toBeDefined();

      const parsedContent = JSON.parse(message.content);
      expect(parsedContent.workItemId).toBe(payload.workItemId);
      expect(parsedContent.taskId).toBe(payload.taskId);
      expect(parsedContent.capability).toBe(payload.capability);
      expect(parsedContent.description).toBe(payload.description);
    });
  });

  describe('createWorkClaimMessage', () => {
    it('should create a valid work-claim message', () => {
      const payload: WorkClaimPayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        claimerCapabilities: ['typescript', 'testing'],
      };

      const message = createWorkClaimMessage(
        'sender-guid',
        'sender-handle',
        'recipient-guid',
        payload
      );

      expect(message.messageType).toBe('work-claim');
      expect(message.senderGuid).toBe('sender-guid');

      const parsedContent = JSON.parse(message.content);
      expect(parsedContent.workItemId).toBe(payload.workItemId);
      expect(parsedContent.claimerCapabilities).toEqual(payload.claimerCapabilities);
    });
  });

  describe('createWorkAcceptMessage', () => {
    it('should create a valid work-accept message', () => {
      const payload: WorkAcceptPayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        instructions: 'Please focus on edge cases',
      };

      const message = createWorkAcceptMessage(
        'sender-guid',
        'sender-handle',
        'recipient-guid',
        payload
      );

      expect(message.messageType).toBe('work-accept');
      expect(message.senderGuid).toBe('sender-guid');

      const parsedContent = JSON.parse(message.content);
      expect(parsedContent.workItemId).toBe(payload.workItemId);
      expect(parsedContent.instructions).toBe(payload.instructions);
    });
  });

  describe('createWorkRejectMessage', () => {
    it('should create a valid work-reject message', () => {
      const payload: WorkRejectPayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        reason: 'Insufficient capabilities',
      };

      const message = createWorkRejectMessage(
        'sender-guid',
        'sender-handle',
        'recipient-guid',
        payload
      );

      expect(message.messageType).toBe('work-reject');

      const parsedContent = JSON.parse(message.content);
      expect(parsedContent.workItemId).toBe(payload.workItemId);
      expect(parsedContent.reason).toBe(payload.reason);
    });
  });

  describe('createProgressUpdateMessage', () => {
    it('should create a valid progress-update message', () => {
      const payload: ProgressUpdatePayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        progress: 50,
        message: 'Halfway done',
      };

      const message = createProgressUpdateMessage(
        'sender-guid',
        'sender-handle',
        'recipient-guid',
        payload
      );

      expect(message.messageType).toBe('progress-update');

      const parsedContent = JSON.parse(message.content);
      expect(parsedContent.workItemId).toBe(payload.workItemId);
      expect(parsedContent.progress).toBe(payload.progress);
      expect(parsedContent.message).toBe(payload.message);
    });
  });

  describe('createWorkCompleteMessage', () => {
    it('should create a valid work-complete message', () => {
      const payload: WorkCompletePayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        result: { testsAdded: 5 },
        summary: 'Bug fixed successfully',
      };

      const message = createWorkCompleteMessage(
        'sender-guid',
        'sender-handle',
        'recipient-guid',
        payload
      );

      expect(message.messageType).toBe('work-complete');

      const parsedContent = JSON.parse(message.content);
      expect(parsedContent.workItemId).toBe(payload.workItemId);
      expect(parsedContent.result).toEqual(payload.result);
      expect(parsedContent.summary).toBe(payload.summary);
    });
  });

  describe('createWorkErrorMessage', () => {
    it('should create a valid work-error message', () => {
      const payload: WorkErrorPayload = {
        workItemId: '550e8400-e29b-41d4-a716-446655440000',
        error: 'Compilation failed',
        recoverable: true,
      };

      const message = createWorkErrorMessage(
        'sender-guid',
        'sender-handle',
        'recipient-guid',
        payload
      );

      expect(message.messageType).toBe('work-error');

      const parsedContent = JSON.parse(message.content);
      expect(parsedContent.workItemId).toBe(payload.workItemId);
      expect(parsedContent.error).toBe(payload.error);
      expect(parsedContent.recoverable).toBe(payload.recoverable);
    });
  });
});

describe('parseWorkMessagePayload', () => {
  it('should parse valid work-offer payload', () => {
    const payload: WorkOfferPayload = {
      workItemId: '550e8400-e29b-41d4-a716-446655440000',
      taskId: 'task-123',
      capability: 'typescript',
      description: 'Fix bug',
    };

    const content = JSON.stringify(payload);
    const parsed = parseWorkMessagePayload<WorkOfferPayload>('work-offer', content);

    expect(parsed).not.toBeNull();
    expect(parsed?.workItemId).toBe(payload.workItemId);
    expect(parsed?.taskId).toBe(payload.taskId);
    expect(parsed?.capability).toBe(payload.capability);
    expect(parsed?.description).toBe(payload.description);
  });

  it('should return null for invalid JSON', () => {
    const parsed = parseWorkMessagePayload<WorkOfferPayload>('work-offer', 'not json');
    expect(parsed).toBeNull();
  });

  it('should return null for invalid payload', () => {
    const invalidPayload = {
      workItemId: 'invalid-uuid',
      taskId: 'task-123',
      capability: 'typescript',
      description: 'Fix bug',
    };

    const content = JSON.stringify(invalidPayload);
    const parsed = parseWorkMessagePayload<WorkOfferPayload>('work-offer', content);

    expect(parsed).toBeNull();
  });

  it('should parse work-claim payload', () => {
    const payload: WorkClaimPayload = {
      workItemId: '550e8400-e29b-41d4-a716-446655440000',
      claimerCapabilities: ['typescript'],
    };

    const content = JSON.stringify(payload);
    const parsed = parseWorkMessagePayload<WorkClaimPayload>('work-claim', content);

    expect(parsed).not.toBeNull();
    expect(parsed?.workItemId).toBe(payload.workItemId);
    expect(parsed?.claimerCapabilities).toEqual(payload.claimerCapabilities);
  });

  it('should parse progress-update payload', () => {
    const payload: ProgressUpdatePayload = {
      workItemId: '550e8400-e29b-41d4-a716-446655440000',
      progress: 75,
      message: 'Almost done',
    };

    const content = JSON.stringify(payload);
    const parsed = parseWorkMessagePayload<ProgressUpdatePayload>('progress-update', content);

    expect(parsed).not.toBeNull();
    expect(parsed?.workItemId).toBe(payload.workItemId);
    expect(parsed?.progress).toBe(payload.progress);
    expect(parsed?.message).toBe(payload.message);
  });
});
