/**
 * Tests for messages module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMessagePayload,
  serializeMessage,
  parseMessage,
  formatMessage,
  formatMessages,
  validateMessageContent,
} from './messages.js';

describe('createMessagePayload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:00:00.000Z'));
  });

  it('should create a message payload', () => {
    const payload = createMessagePayload('test-agent', 'Hello world');

    expect(payload.handle).toBe('test-agent');
    expect(payload.message).toBe('Hello world');
    expect(payload.timestamp).toBe('2025-01-15T10:00:00.000Z');
  });
});

describe('serializeMessage', () => {
  it('should serialize to JSON', () => {
    const payload = {
      handle: 'agent',
      message: 'test',
      timestamp: '2025-01-15T10:00:00.000Z',
    };

    const json = serializeMessage(payload);
    const parsed = JSON.parse(json);

    expect(parsed.handle).toBe('agent');
    expect(parsed.message).toBe('test');
    expect(parsed.timestamp).toBe('2025-01-15T10:00:00.000Z');
  });
});

describe('parseMessage', () => {
  it('should parse valid JSON', () => {
    const json = JSON.stringify({
      handle: 'agent',
      message: 'test',
      timestamp: '2025-01-15T10:00:00.000Z',
    });

    const payload = parseMessage(json);

    expect(payload).not.toBeNull();
    expect(payload?.handle).toBe('agent');
    expect(payload?.message).toBe('test');
  });

  it('should return null for invalid JSON', () => {
    expect(parseMessage('not json')).toBeNull();
  });

  it('should return null for missing fields', () => {
    expect(parseMessage(JSON.stringify({ handle: 'agent' }))).toBeNull();
    expect(parseMessage(JSON.stringify({ message: 'test' }))).toBeNull();
  });

  it('should return null for wrong field types', () => {
    expect(parseMessage(JSON.stringify({ handle: 123, message: 'test', timestamp: 'x' }))).toBeNull();
  });
});

describe('formatMessage', () => {
  it('should format message for display', () => {
    const formatted = formatMessage({
      handle: 'project-manager',
      message: 'Hello team!',
      timestamp: '2025-01-15T10:00:00.000Z',
    });

    expect(formatted).toBe('[2025-01-15T10:00:00.000Z] **project-manager**: Hello team!');
  });
});

describe('formatMessages', () => {
  it('should format multiple messages', () => {
    const messages = [
      { handle: 'agent1', message: 'First', timestamp: '2025-01-15T10:00:00.000Z' },
      { handle: 'agent2', message: 'Second', timestamp: '2025-01-15T10:01:00.000Z' },
    ];

    const formatted = formatMessages(messages);
    const lines = formatted.split('\n');

    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('agent1');
    expect(lines[1]).toContain('agent2');
  });

  it('should return empty string for no messages', () => {
    expect(formatMessages([])).toBe('');
  });
});

describe('validateMessageContent', () => {
  it('should accept valid content', () => {
    expect(validateMessageContent('Hello world')).toBeNull();
    expect(validateMessageContent('With unicode: 你好 🎉')).toBeNull();
  });

  it('should reject empty content', () => {
    expect(validateMessageContent('')).toBe('Message content cannot be empty');
    expect(validateMessageContent('   ')).toBe('Message content cannot be empty');
  });

  it('should reject oversized content', () => {
    const large = 'x'.repeat(1024 * 1024 + 1);
    expect(validateMessageContent(large)).toBe('Message content exceeds 1MB limit');
  });
});
