/**
 * Message format and serialization
 */

import type { MessagePayload } from './types.js';
import { createLogger } from './logger.js';

const logger = createLogger('messages');

/**
 * Create a message payload
 */
export function createMessagePayload(handle: string, message: string): MessagePayload {
  return {
    handle,
    message,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Serialize a message payload to JSON
 */
export function serializeMessage(payload: MessagePayload): string {
  return JSON.stringify(payload);
}

/**
 * Parse a message payload from JSON
 * Returns null if parsing fails
 */
export function parseMessage(data: string): MessagePayload | null {
  try {
    const parsed = JSON.parse(data) as unknown;

    // Validate structure
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('handle' in parsed) ||
      !('message' in parsed) ||
      !('timestamp' in parsed)
    ) {
      logger.warn('Invalid message structure', { data });
      return null;
    }

    const payload = parsed as Record<string, unknown>;

    if (
      typeof payload['handle'] !== 'string' ||
      typeof payload['message'] !== 'string' ||
      typeof payload['timestamp'] !== 'string'
    ) {
      logger.warn('Invalid message field types', { data });
      return null;
    }

    return {
      handle: payload['handle'],
      message: payload['message'],
      timestamp: payload['timestamp'],
    };
  } catch (err) {
    logger.warn('Failed to parse message JSON', { error: (err as Error).message });
    return null;
  }
}

/**
 * Format a message for display
 */
export function formatMessage(payload: MessagePayload): string {
  return `[${payload.timestamp}] **${payload.handle}**: ${payload.message}`;
}

/**
 * Format multiple messages for display
 */
export function formatMessages(payloads: MessagePayload[]): string {
  if (payloads.length === 0) {
    return '';
  }
  return payloads.map(formatMessage).join('\n');
}

/**
 * Validate message content
 * Returns error message if invalid, null if valid
 */
export function validateMessageContent(message: string): string | null {
  if (!message || message.trim() === '') {
    return 'Message content cannot be empty';
  }

  // Check for reasonable size (< 1MB recommended)
  const byteLength = Buffer.byteLength(message, 'utf-8');
  if (byteLength > 1024 * 1024) {
    return 'Message content exceeds 1MB limit';
  }

  return null;
}
