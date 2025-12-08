/**
 * Tests for send_direct_message tool
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleSendDirectMessage } from './registry.js';
import type { SessionState, RegistryEntry } from '../types.js';
import * as kv from '../kv.js';
import * as nats from '../nats.js';

// Mock dependencies
vi.mock('../kv.js');
vi.mock('../nats.js');
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  configureLogger: vi.fn(),
}));

describe('send_direct_message tool', () => {
  let sessionState: SessionState;
  const senderGuid = '11111111-1111-4111-8111-111111111111';
  const recipientGuid = '22222222-2222-4222-8222-222222222222';
  let mockPublish: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Setup registered session state
    sessionState = {
      handle: 'sender',
      agentGuid: senderGuid,
      registeredEntry: {
        guid: senderGuid,
        agentType: 'developer',
        handle: 'sender',
        hostname: 'sender-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: ['typescript'],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      },
    };

    // Mock JetStream publish
    mockPublish = vi.fn().mockResolvedValue({ seq: 1 });
    vi.mocked(nats.getJetStreamClient).mockReturnValue({
      publish: mockPublish,
    } as unknown as ReturnType<typeof nats.getJetStreamClient>);

    // Setup default mocks
    vi.mocked(kv.getRegistryEntry).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful Message Send', () => {
    it('should send message to online recipient', async () => {
      const recipientEntry: RegistryEntry = {
        guid: recipientGuid,
        agentType: 'developer',
        handle: 'recipient',
        hostname: 'recipient-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: ['testing'],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 1,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(recipientEntry);

      const args = {
        recipientGuid: recipientGuid,
        message: 'Hello, recipient!',
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('Message sent successfully!');
      expect(result.content[0]?.text).toContain('To: recipient');
      expect(result.content[0]?.text).toContain('Type: text');
      expect(result.content[0]?.text).toContain('Status: delivered');

      // Verify publish was called
      expect(mockPublish).toHaveBeenCalledOnce();
      const publishArgs = mockPublish.mock.calls[0];
      expect(publishArgs[0]).toBe(`global.agent.${recipientGuid}`);

      // Verify message payload
      const payload = JSON.parse(publishArgs[1]);
      expect(payload.senderGuid).toBe(senderGuid);
      expect(payload.senderHandle).toBe('sender');
      expect(payload.recipientGuid).toBe(recipientGuid);
      expect(payload.messageType).toBe('text');
      expect(payload.content).toBe('Hello, recipient!');
      expect(payload.id).toBeDefined();
      expect(payload.timestamp).toBeDefined();
    });

    it('should send message with custom messageType', async () => {
      const recipientEntry: RegistryEntry = {
        guid: recipientGuid,
        agentType: 'developer',
        handle: 'recipient',
        hostname: 'recipient-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(recipientEntry);

      const args = {
        recipientGuid: recipientGuid,
        message: 'Work offer details',
        messageType: 'work-offer',
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Type: work-offer');

      // Verify message payload
      const publishArgs = mockPublish.mock.calls[0];
      const payload = JSON.parse(publishArgs[1]);
      expect(payload.messageType).toBe('work-offer');
    });

    it('should send message with metadata', async () => {
      const recipientEntry: RegistryEntry = {
        guid: recipientGuid,
        agentType: 'developer',
        handle: 'recipient',
        hostname: 'recipient-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(recipientEntry);

      const args = {
        recipientGuid: recipientGuid,
        message: 'Task details',
        messageType: 'work-offer',
        metadata: {
          taskId: 'task-123',
          priority: 'high',
          tags: ['urgent', 'backend'],
        },
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBeUndefined();

      // Verify metadata is included
      const publishArgs = mockPublish.mock.calls[0];
      const payload = JSON.parse(publishArgs[1]);
      expect(payload.metadata).toEqual({
        taskId: 'task-123',
        priority: 'high',
        tags: ['urgent', 'backend'],
      });
    });
  });

  describe('Offline/Busy Recipients', () => {
    it('should warn when recipient is offline', async () => {
      const recipientEntry: RegistryEntry = {
        guid: recipientGuid,
        agentType: 'developer',
        handle: 'offline-recipient',
        hostname: 'recipient-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'offline',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T09:30:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(recipientEntry);

      const args = {
        recipientGuid: recipientGuid,
        message: 'Hello, are you there?',
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Message sent (recipient may be offline)');
      expect(result.content[0]?.text).toContain('Recipient Status: offline');
      expect(result.content[0]?.text).toContain('Message queued for delivery');

      // Should still publish the message
      expect(mockPublish).toHaveBeenCalledOnce();
    });

    it('should warn when recipient is busy', async () => {
      const recipientEntry: RegistryEntry = {
        guid: recipientGuid,
        agentType: 'developer',
        handle: 'busy-recipient',
        hostname: 'recipient-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'busy',
        currentTaskCount: 5,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(recipientEntry);

      const args = {
        recipientGuid: recipientGuid,
        message: 'Can you help with this?',
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Message sent (recipient is busy)');
      expect(result.content[0]?.text).toContain('Recipient Status: busy');
      expect(result.content[0]?.text).toContain('Message delivered to inbox');

      // Should still publish the message
      expect(mockPublish).toHaveBeenCalledOnce();
    });
  });

  describe('Validation', () => {
    it('should reject invalid GUID format', async () => {
      const args = {
        recipientGuid: 'invalid-guid',
        message: 'Test message',
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid recipientGuid format');
      expect(result.content[0]?.text).toContain('Must be a valid UUID v4');
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it('should reject empty GUID', async () => {
      const args = {
        recipientGuid: '',
        message: 'Test message',
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid recipientGuid format');
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it('should reject UUID v1 format', async () => {
      const args = {
        recipientGuid: '12345678-1234-1234-1234-123456789012', // v1, not v4
        message: 'Test message',
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid recipientGuid format');
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it('should accept valid UUID v4', async () => {
      const recipientEntry: RegistryEntry = {
        guid: recipientGuid,
        agentType: 'developer',
        handle: 'recipient',
        hostname: 'recipient-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(recipientEntry);

      const args = {
        recipientGuid: recipientGuid,
        message: 'Test message',
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(kv.getRegistryEntry).toHaveBeenCalledWith(recipientGuid);
      expect(mockPublish).toHaveBeenCalledOnce();
    });
  });

  describe('Registration Requirement', () => {
    it('should require sender to be registered', async () => {
      const unregisteredState: SessionState = {
        handle: null,
        agentGuid: null,
        registeredEntry: null,
      };

      const args = {
        recipientGuid: recipientGuid,
        message: 'Test message',
      };

      const result = await handleSendDirectMessage(args, unregisteredState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('You must be registered to send messages');
      expect(result.content[0]?.text).toContain('Use register_agent first');
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it('should require both agentGuid and registeredEntry', async () => {
      const partialState: SessionState = {
        handle: 'test',
        agentGuid: senderGuid,
        registeredEntry: null,
      };

      const args = {
        recipientGuid: recipientGuid,
        message: 'Test message',
      };

      const result = await handleSendDirectMessage(args, partialState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('You must be registered');
      expect(mockPublish).not.toHaveBeenCalled();
    });
  });

  describe('Recipient Not Found', () => {
    it('should return error when recipient does not exist', async () => {
      vi.mocked(kv.getRegistryEntry).mockResolvedValue(null);

      const args = {
        recipientGuid: recipientGuid,
        message: 'Test message',
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Recipient not found in registry');
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it('should handle retrieval errors', async () => {
      vi.mocked(kv.getRegistryEntry).mockRejectedValue(new Error('Connection failed'));

      const args = {
        recipientGuid: recipientGuid,
        message: 'Test message',
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to retrieve recipient');
      expect(result.content[0]?.text).toContain('Connection failed');
      expect(mockPublish).not.toHaveBeenCalled();
    });
  });

  describe('JetStream Delivery', () => {
    it('should publish to correct inbox subject', async () => {
      const recipientEntry: RegistryEntry = {
        guid: recipientGuid,
        agentType: 'developer',
        handle: 'recipient',
        hostname: 'recipient-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(recipientEntry);

      const args = {
        recipientGuid: recipientGuid,
        message: 'Test message',
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(mockPublish).toHaveBeenCalledOnce();

      const publishArgs = mockPublish.mock.calls[0];
      expect(publishArgs[0]).toBe(`global.agent.${recipientGuid}`);
    });

    it('should handle publish errors', async () => {
      const recipientEntry: RegistryEntry = {
        guid: recipientGuid,
        agentType: 'developer',
        handle: 'recipient',
        hostname: 'recipient-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(recipientEntry);
      mockPublish.mockRejectedValue(new Error('Publish failed'));

      const args = {
        recipientGuid: recipientGuid,
        message: 'Test message',
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to send message');
      expect(result.content[0]?.text).toContain('Publish failed');
    });
  });

  describe('Message Payload Structure', () => {
    it('should include all required fields', async () => {
      const recipientEntry: RegistryEntry = {
        guid: recipientGuid,
        agentType: 'developer',
        handle: 'recipient',
        hostname: 'recipient-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(recipientEntry);

      const args = {
        recipientGuid: recipientGuid,
        message: 'Test message',
      };

      await handleSendDirectMessage(args, sessionState);

      const publishArgs = mockPublish.mock.calls[0];
      const payload = JSON.parse(publishArgs[1]);

      // Check all required fields
      expect(payload.id).toBeDefined();
      expect(payload.senderGuid).toBe(senderGuid);
      expect(payload.senderHandle).toBe('sender');
      expect(payload.recipientGuid).toBe(recipientGuid);
      expect(payload.messageType).toBe('text');
      expect(payload.content).toBe('Test message');
      expect(payload.timestamp).toBeDefined();

      // Verify timestamp is ISO 8601
      expect(() => new Date(payload.timestamp)).not.toThrow();

      // Verify ID is UUID v4
      expect(payload.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should include metadata when provided', async () => {
      const recipientEntry: RegistryEntry = {
        guid: recipientGuid,
        agentType: 'developer',
        handle: 'recipient',
        hostname: 'recipient-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(recipientEntry);

      const metadata = { key1: 'value1', key2: 42 };
      const args = {
        recipientGuid: recipientGuid,
        message: 'Test message',
        metadata: metadata,
      };

      await handleSendDirectMessage(args, sessionState);

      const publishArgs = mockPublish.mock.calls[0];
      const payload = JSON.parse(publishArgs[1]);

      expect(payload.metadata).toEqual(metadata);
    });

    it('should not include metadata when not provided', async () => {
      const recipientEntry: RegistryEntry = {
        guid: recipientGuid,
        agentType: 'developer',
        handle: 'recipient',
        hostname: 'recipient-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(recipientEntry);

      const args = {
        recipientGuid: recipientGuid,
        message: 'Test message',
      };

      await handleSendDirectMessage(args, sessionState);

      const publishArgs = mockPublish.mock.calls[0];
      const payload = JSON.parse(publishArgs[1]);

      expect(payload.metadata).toBeUndefined();
    });
  });

  describe('Message ID Return', () => {
    it('should return unique message ID', async () => {
      const recipientEntry: RegistryEntry = {
        guid: recipientGuid,
        agentType: 'developer',
        handle: 'recipient',
        hostname: 'recipient-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(recipientEntry);

      const args = {
        recipientGuid: recipientGuid,
        message: 'Test message',
      };

      const result = await handleSendDirectMessage(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toMatch(/Message ID: [0-9a-f-]{36}/i);
    });

    it('should generate different message IDs for different messages', async () => {
      const recipientEntry: RegistryEntry = {
        guid: recipientGuid,
        agentType: 'developer',
        handle: 'recipient',
        hostname: 'recipient-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(recipientEntry);

      const args1 = {
        recipientGuid: recipientGuid,
        message: 'Test message 1',
      };

      const args2 = {
        recipientGuid: recipientGuid,
        message: 'Test message 2',
      };

      await handleSendDirectMessage(args1, sessionState);
      await handleSendDirectMessage(args2, sessionState);

      const payload1 = JSON.parse(mockPublish.mock.calls[0][1]);
      const payload2 = JSON.parse(mockPublish.mock.calls[1][1]);

      expect(payload1.id).not.toBe(payload2.id);
    });
  });
});
