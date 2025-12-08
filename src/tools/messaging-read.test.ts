/**
 * Tests for read_direct_messages tool
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleReadDirectMessages } from './registry.js';
import type { SessionState, InboxMessage } from '../types.js';
import * as nats from '../nats.js';

// Mock dependencies
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

describe('read_direct_messages tool', () => {
  let sessionState: SessionState;
  const readerGuid = '11111111-1111-4111-8111-111111111111';
  const senderGuid1 = '22222222-2222-4222-8222-222222222222';
  const senderGuid2 = '33333333-3333-4333-8333-333333333333';
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockStreamsInfo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Setup registered session state
    sessionState = {
      handle: 'reader',
      agentGuid: readerGuid,
      registeredEntry: {
        guid: readerGuid,
        agentType: 'developer',
        handle: 'reader',
        hostname: 'reader-host',
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

    // Mock JetStream manager
    mockStreamsInfo = vi.fn().mockResolvedValue({});
    vi.mocked(nats.getJetStreamManager).mockReturnValue({
      streams: {
        info: mockStreamsInfo,
      },
    } as unknown as ReturnType<typeof nats.getJetStreamManager>);

    // Mock JetStream consumer
    mockFetch = vi.fn();
    vi.mocked(nats.getJetStreamClient).mockReturnValue({
      consumers: {
        get: vi.fn().mockResolvedValue({
          fetch: mockFetch,
        }),
      },
    } as unknown as ReturnType<typeof nats.getJetStreamClient>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Validation', () => {
    it('should require user to be registered', async () => {
      const unregisteredState: SessionState = {
        handle: null,
        agentGuid: null,
        registeredEntry: null,
      };

      const args = {};

      const result = await handleReadDirectMessages(args, unregisteredState);

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('You must be registered');
    });

    it('should validate senderGuid format', async () => {
      const args = {
        senderGuid: 'invalid-guid',
      };

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('Invalid senderGuid format');
    });

    it('should accept valid senderGuid', async () => {
      // Mock empty stream
      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          // No messages
        },
      });

      const args = {
        senderGuid: senderGuid1,
      };

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
    });
  });

  describe('Empty Inbox', () => {
    it('should handle non-existent inbox stream', async () => {
      mockStreamsInfo.mockRejectedValue(new Error('stream not found'));

      const args = {};

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toBe('No direct messages in your inbox.');
    });

    it('should handle inbox with no messages', async () => {
      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          // No messages
        },
      });

      const args = {};

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toBe('No direct messages in your inbox.');
    });

    it('should handle timeout error', async () => {
      mockFetch.mockRejectedValue(new Error('timeout'));

      const args = {};

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toBe('No direct messages in your inbox.');
    });

    it('should handle no messages error', async () => {
      mockFetch.mockRejectedValue(new Error('no messages'));

      const args = {};

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toBe('No direct messages in your inbox.');
    });
  });

  describe('Message Retrieval', () => {
    it('should retrieve messages successfully', async () => {
      const message1: InboxMessage = {
        id: 'msg-1',
        senderGuid: senderGuid1,
        senderHandle: 'sender1',
        recipientGuid: readerGuid,
        messageType: 'text',
        content: 'Hello, reader!',
        timestamp: '2025-01-15T10:00:00Z',
      };

      const message2: InboxMessage = {
        id: 'msg-2',
        senderGuid: senderGuid2,
        senderHandle: 'sender2',
        recipientGuid: readerGuid,
        messageType: 'text',
        content: 'Another message',
        timestamp: '2025-01-15T10:05:00Z',
      };

      const mockAck = vi.fn();

      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield {
            data: Buffer.from(JSON.stringify(message1)),
            ack: mockAck,
          };
          yield {
            data: Buffer.from(JSON.stringify(message2)),
            ack: mockAck,
          };
        },
      });

      const args = {};

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('## Direct Messages (2 messages)');
      expect(result.content[0]?.text).toContain('sender1');
      expect(result.content[0]?.text).toContain('sender2');
      expect(result.content[0]?.text).toContain('Hello, reader!');
      expect(result.content[0]?.text).toContain('Another message');

      // Verify messages were acknowledged
      expect(mockAck).toHaveBeenCalledTimes(2);
    });

    it('should respect limit parameter', async () => {
      const messages = [];
      const mockAck = vi.fn();

      for (let i = 0; i < 20; i++) {
        messages.push({
          id: `msg-${i}`,
          senderGuid: senderGuid1,
          senderHandle: 'sender1',
          recipientGuid: readerGuid,
          messageType: 'text',
          content: `Message ${i}`,
          timestamp: `2025-01-15T10:${i.toString().padStart(2, '0')}:00Z`,
        });
      }

      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          for (const msg of messages) {
            yield {
              data: Buffer.from(JSON.stringify(msg)),
              ack: mockAck,
            };
          }
        },
      });

      const args = {
        limit: 5,
      };

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('## Direct Messages (5 messages)');

      // Should only acknowledge 5 messages
      expect(mockAck).toHaveBeenCalledTimes(5);
    });

    it('should enforce max limit of 100', async () => {
      const messages = [];
      const mockAck = vi.fn();

      for (let i = 0; i < 150; i++) {
        messages.push({
          id: `msg-${i}`,
          senderGuid: senderGuid1,
          senderHandle: 'sender1',
          recipientGuid: readerGuid,
          messageType: 'text',
          content: `Message ${i}`,
          timestamp: `2025-01-15T10:00:00.${i.toString().padStart(3, '0')}Z`,
        });
      }

      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          for (const msg of messages) {
            yield {
              data: Buffer.from(JSON.stringify(msg)),
              ack: mockAck,
            };
          }
        },
      });

      const args = {
        limit: 200, // Request more than max
      };

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('## Direct Messages (100 messages)');

      // Should only acknowledge 100 messages
      expect(mockAck).toHaveBeenCalledTimes(100);
    });

    it('should use default limit of 10', async () => {
      const messages = [];
      const mockAck = vi.fn();

      for (let i = 0; i < 20; i++) {
        messages.push({
          id: `msg-${i}`,
          senderGuid: senderGuid1,
          senderHandle: 'sender1',
          recipientGuid: readerGuid,
          messageType: 'text',
          content: `Message ${i}`,
          timestamp: `2025-01-15T10:${i.toString().padStart(2, '0')}:00Z`,
        });
      }

      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          for (const msg of messages) {
            yield {
              data: Buffer.from(JSON.stringify(msg)),
              ack: mockAck,
            };
          }
        },
      });

      const args = {}; // No limit specified

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('## Direct Messages (10 messages)');

      // Should only acknowledge 10 messages
      expect(mockAck).toHaveBeenCalledTimes(10);
    });
  });

  describe('Message Filtering', () => {
    it('should filter by messageType', async () => {
      const message1: InboxMessage = {
        id: 'msg-1',
        senderGuid: senderGuid1,
        senderHandle: 'sender1',
        recipientGuid: readerGuid,
        messageType: 'text',
        content: 'Text message',
        timestamp: '2025-01-15T10:00:00Z',
      };

      const message2: InboxMessage = {
        id: 'msg-2',
        senderGuid: senderGuid2,
        senderHandle: 'sender2',
        recipientGuid: readerGuid,
        messageType: 'work-offer',
        content: 'Work offer message',
        timestamp: '2025-01-15T10:05:00Z',
      };

      const mockAck = vi.fn();

      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield {
            data: Buffer.from(JSON.stringify(message1)),
            ack: mockAck,
          };
          yield {
            data: Buffer.from(JSON.stringify(message2)),
            ack: mockAck,
          };
        },
      });

      const args = {
        messageType: 'work-offer',
      };

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('## Direct Messages (1 message)');
      expect(result.content[0]?.text).toContain('Work offer message');
      expect(result.content[0]?.text).not.toContain('Text message');

      // All messages should be acknowledged (filtered ones too)
      expect(mockAck).toHaveBeenCalledTimes(2);
    });

    it('should filter by senderGuid', async () => {
      const message1: InboxMessage = {
        id: 'msg-1',
        senderGuid: senderGuid1,
        senderHandle: 'sender1',
        recipientGuid: readerGuid,
        messageType: 'text',
        content: 'Message from sender 1',
        timestamp: '2025-01-15T10:00:00Z',
      };

      const message2: InboxMessage = {
        id: 'msg-2',
        senderGuid: senderGuid2,
        senderHandle: 'sender2',
        recipientGuid: readerGuid,
        messageType: 'text',
        content: 'Message from sender 2',
        timestamp: '2025-01-15T10:05:00Z',
      };

      const mockAck = vi.fn();

      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield {
            data: Buffer.from(JSON.stringify(message1)),
            ack: mockAck,
          };
          yield {
            data: Buffer.from(JSON.stringify(message2)),
            ack: mockAck,
          };
        },
      });

      const args = {
        senderGuid: senderGuid1,
      };

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('## Direct Messages (1 message)');
      expect(result.content[0]?.text).toContain('sender1');
      expect(result.content[0]?.text).toContain('Message from sender 1');
      expect(result.content[0]?.text).not.toContain('sender2');

      // All messages should be acknowledged
      expect(mockAck).toHaveBeenCalledTimes(2);
    });

    it('should filter by both messageType and senderGuid', async () => {
      const messages: InboxMessage[] = [
        {
          id: 'msg-1',
          senderGuid: senderGuid1,
          senderHandle: 'sender1',
          recipientGuid: readerGuid,
          messageType: 'text',
          content: 'Text from sender1',
          timestamp: '2025-01-15T10:00:00Z',
        },
        {
          id: 'msg-2',
          senderGuid: senderGuid1,
          senderHandle: 'sender1',
          recipientGuid: readerGuid,
          messageType: 'work-offer',
          content: 'Work offer from sender1',
          timestamp: '2025-01-15T10:05:00Z',
        },
        {
          id: 'msg-3',
          senderGuid: senderGuid2,
          senderHandle: 'sender2',
          recipientGuid: readerGuid,
          messageType: 'work-offer',
          content: 'Work offer from sender2',
          timestamp: '2025-01-15T10:10:00Z',
        },
      ];

      const mockAck = vi.fn();

      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          for (const msg of messages) {
            yield {
              data: Buffer.from(JSON.stringify(msg)),
              ack: mockAck,
            };
          }
        },
      });

      const args = {
        messageType: 'work-offer',
        senderGuid: senderGuid1,
      };

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('## Direct Messages (1 message)');
      expect(result.content[0]?.text).toContain('Work offer from sender1');
      expect(result.content[0]?.text).not.toContain('Text from sender1');
      expect(result.content[0]?.text).not.toContain('sender2');

      // All messages should be acknowledged
      expect(mockAck).toHaveBeenCalledTimes(3);
    });

    it('should return empty when no messages match filters', async () => {
      const message1: InboxMessage = {
        id: 'msg-1',
        senderGuid: senderGuid1,
        senderHandle: 'sender1',
        recipientGuid: readerGuid,
        messageType: 'text',
        content: 'Text message',
        timestamp: '2025-01-15T10:00:00Z',
      };

      const mockAck = vi.fn();

      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield {
            data: Buffer.from(JSON.stringify(message1)),
            ack: mockAck,
          };
        },
      });

      const args = {
        messageType: 'work-offer', // No work-offer messages
      };

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toBe('No direct messages in your inbox.');

      // Filtered message should still be acknowledged
      expect(mockAck).toHaveBeenCalledTimes(1);
    });
  });

  describe('Chronological Ordering', () => {
    it('should sort messages by timestamp in chronological order', async () => {
      const message1: InboxMessage = {
        id: 'msg-1',
        senderGuid: senderGuid1,
        senderHandle: 'sender1',
        recipientGuid: readerGuid,
        messageType: 'text',
        content: 'Third message',
        timestamp: '2025-01-15T10:30:00Z',
      };

      const message2: InboxMessage = {
        id: 'msg-2',
        senderGuid: senderGuid2,
        senderHandle: 'sender2',
        recipientGuid: readerGuid,
        messageType: 'text',
        content: 'First message',
        timestamp: '2025-01-15T10:00:00Z',
      };

      const message3: InboxMessage = {
        id: 'msg-3',
        senderGuid: senderGuid1,
        senderHandle: 'sender1',
        recipientGuid: readerGuid,
        messageType: 'text',
        content: 'Second message',
        timestamp: '2025-01-15T10:15:00Z',
      };

      const mockAck = vi.fn();

      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          // Messages arrive out of order
          yield {
            data: Buffer.from(JSON.stringify(message1)),
            ack: mockAck,
          };
          yield {
            data: Buffer.from(JSON.stringify(message2)),
            ack: mockAck,
          };
          yield {
            data: Buffer.from(JSON.stringify(message3)),
            ack: mockAck,
          };
        },
      });

      const args = {};

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const text = result.content[0]?.text || '';

      // Find positions of each message
      const firstPos = text.indexOf('First message');
      const secondPos = text.indexOf('Second message');
      const thirdPos = text.indexOf('Third message');

      // Verify chronological order
      expect(firstPos).toBeLessThan(secondPos);
      expect(secondPos).toBeLessThan(thirdPos);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON messages', async () => {
      const validMessage: InboxMessage = {
        id: 'msg-1',
        senderGuid: senderGuid1,
        senderHandle: 'sender1',
        recipientGuid: readerGuid,
        messageType: 'text',
        content: 'Valid message',
        timestamp: '2025-01-15T10:00:00Z',
      };

      const mockAck = vi.fn();

      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          // Bad JSON message
          yield {
            data: Buffer.from('invalid json{{{'),
            ack: mockAck,
          };
          // Valid message
          yield {
            data: Buffer.from(JSON.stringify(validMessage)),
            ack: mockAck,
          };
        },
      });

      const args = {};

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('## Direct Messages (1 message)');
      expect(result.content[0]?.text).toContain('Valid message');

      // Both messages should be acknowledged
      expect(mockAck).toHaveBeenCalledTimes(2);
    });

    it('should handle unexpected errors', async () => {
      mockFetch.mockRejectedValue(new Error('Unexpected error'));

      const args = {};

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('Error: Failed to read messages');
    });
  });

  describe('Response Format', () => {
    it('should format single message correctly', async () => {
      const message: InboxMessage = {
        id: 'msg-1',
        senderGuid: senderGuid1,
        senderHandle: 'sender1',
        recipientGuid: readerGuid,
        messageType: 'text',
        content: 'Hello, reader!',
        timestamp: '2025-01-15T10:00:00Z',
      };

      const mockAck = vi.fn();

      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield {
            data: Buffer.from(JSON.stringify(message)),
            ack: mockAck,
          };
        },
      });

      const args = {};

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const text = result.content[0]?.text || '';

      // Verify format
      expect(text).toContain('## Direct Messages (1 message)');
      expect(text).toContain('---');
      expect(text).toContain(`**From:** sender1 (${senderGuid1})`);
      expect(text).toContain('**Type:** text');
      expect(text).toContain('**Time:** 2025-01-15T10:00:00Z');
      expect(text).toContain('Hello, reader!');
    });

    it('should format multiple messages correctly', async () => {
      const messages: InboxMessage[] = [
        {
          id: 'msg-1',
          senderGuid: senderGuid1,
          senderHandle: 'sender1',
          recipientGuid: readerGuid,
          messageType: 'text',
          content: 'First message',
          timestamp: '2025-01-15T10:00:00Z',
        },
        {
          id: 'msg-2',
          senderGuid: senderGuid2,
          senderHandle: 'sender2',
          recipientGuid: readerGuid,
          messageType: 'work-offer',
          content: 'Second message',
          timestamp: '2025-01-15T10:05:00Z',
        },
      ];

      const mockAck = vi.fn();

      mockFetch.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          for (const msg of messages) {
            yield {
              data: Buffer.from(JSON.stringify(msg)),
              ack: mockAck,
            };
          }
        },
      });

      const args = {};

      const result = await handleReadDirectMessages(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const text = result.content[0]?.text || '';

      // Verify format
      expect(text).toContain('## Direct Messages (2 messages)');
      expect((text.match(/---/g) || []).length).toBe(2); // Two separators

      // Verify both messages are present
      expect(text).toContain('sender1');
      expect(text).toContain('sender2');
      expect(text).toContain('First message');
      expect(text).toContain('Second message');
    });
  });
});
