/**
 * Messaging tools: send_message, read_messages
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { LoominalScope } from '@loominal/shared/types';
import type { InternalChannel, SessionState } from '../types.js';
import { publishMessage, readMessages } from '../streams.js';
import {
  createMessagePayload,
  serializeMessage,
  parseMessage,
  formatMessages,
  validateMessageContent,
} from '../messages.js';
import { findChannel, getChannelNames } from '../config.js';
import { createLogger } from '../logger.js';

const logger = createLogger('tools:messaging');

/**
 * Create tool definitions for messaging (dynamically includes channel enum)
 */
export function createMessagingTools(channels: InternalChannel[]): Tool[] {
  const channelEnum = channels.map((ch) => ch.name);

  return [
    {
      name: 'send_message',
      description:
        'Send a message to a channel. You must set a handle first using set_handle.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: 'Channel name to send the message to',
            enum: channelEnum,
          },
          message: {
            type: 'string',
            description: 'The message content to send',
          },
          scope: {
            type: 'string',
            enum: ['private', 'personal', 'team', 'public'],
            description: 'Scope of message (default: "team"). Channels are typically team-scoped.',
          },
        },
        required: ['channel', 'message'],
      },
    },
    {
      name: 'read_messages',
      description: 'Read recent messages from a channel',
      inputSchema: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: 'Channel name to read messages from',
            enum: channelEnum,
          },
          limit: {
            type: 'number',
            description: 'Maximum number of messages to retrieve (default: 50, max: 1000)',
            default: 50,
          },
        },
        required: ['channel'],
      },
    },
  ];
}

/**
 * Handle send_message tool
 */
export async function handleSendMessage(
  args: Record<string, unknown>,
  state: SessionState,
  channels: InternalChannel[]
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Check handle is set
  if (!state.handle) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must set a handle first using set_handle tool.',
        },
      ],
      isError: true,
    };
  }

  const channelName = args['channel'] as string;
  const message = args['message'] as string;
  const scope: LoominalScope = (args['scope'] as LoominalScope | undefined) ?? 'team';

  // Validate channel
  const channel = findChannel(channels, channelName);
  if (!channel) {
    const validChannels = getChannelNames(channels);
    return {
      content: [
        {
          type: 'text',
          text:
            `Error: Invalid channel "${channelName}". ` +
            `Valid channels: ${validChannels.join(', ')}`,
        },
      ],
      isError: true,
    };
  }

  // Validate message content
  const contentError = validateMessageContent(message);
  if (contentError) {
    return {
      content: [{ type: 'text', text: `Error: ${contentError}` }],
      isError: true,
    };
  }

  // Create and publish message
  try {
    const payload = createMessagePayload(state.handle, message, scope);
    const serialized = serializeMessage(payload);
    await publishMessage(channel, serialized);

    logger.info('Message sent', {
      channel: channelName,
      handle: state.handle,
      messageLength: message.length,
    });

    return {
      content: [
        {
          type: 'text',
          text: `Message sent to #${channelName} by ${state.handle}`,
        },
      ],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to send message', { error: error.message, channel: channelName });
    return {
      content: [
        {
          type: 'text',
          text: `Error sending message: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handle read_messages tool
 */
export async function handleReadMessages(
  args: Record<string, unknown>,
  channels: InternalChannel[]
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const channelName = args['channel'] as string;
  const limit = Math.min(Math.max((args['limit'] as number) || 50, 1), 1000);

  // Validate channel
  const channel = findChannel(channels, channelName);
  if (!channel) {
    const validChannels = getChannelNames(channels);
    return {
      content: [
        {
          type: 'text',
          text:
            `Error: Invalid channel "${channelName}". ` +
            `Valid channels: ${validChannels.join(', ')}`,
        },
      ],
      isError: true,
    };
  }

  try {
    const rawMessages = await readMessages(channel, limit);

    if (rawMessages.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No messages in #${channelName} yet.`,
          },
        ],
      };
    }

    // Parse and format messages
    const parsedMessages = rawMessages
      .map((msg) => parseMessage(msg.data))
      .filter((msg): msg is NonNullable<typeof msg> => msg !== null);

    if (parsedMessages.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No valid messages in #${channelName}.`,
          },
        ],
      };
    }

    const formatted = formatMessages(parsedMessages);

    logger.debug('Messages read', { channel: channelName, count: parsedMessages.length });

    return {
      content: [
        {
          type: 'text',
          text: `Messages from #${channelName}:\n\n${formatted}`,
        },
      ],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to read messages', { error: error.message, channel: channelName });
    return {
      content: [
        {
          type: 'text',
          text: `Error reading messages: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}
