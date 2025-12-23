/**
 * Messaging tools: send_message, read_messages
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { LoominalScope } from '@loominal/shared/types';
import type { InternalChannel, SessionState } from '../types.js';
import { publishMessage, readMessages, getStreamInfo } from '../streams.js';
import {
  createMessagePayload,
  serializeMessage,
  parseMessage,
  formatMessages,
  validateMessageContent,
} from '../messages.js';
import { findChannel, getChannelNames } from '../config.js';
import { createLogger } from '../logger.js';
import { parsePaginationArgs, createPaginationMetadata } from '../pagination.js';

const logger = createLogger('tools:messaging');

/**
 * Create tool definitions for messaging (dynamically includes channel enum)
 */
export function createMessagingTools(channels: InternalChannel[]): Tool[] {
  const channelEnum = channels.map((ch) => ch.name);

  return [
    {
      name: 'warp_channels_send',
      description:
        'Send a message to a channel for team-wide broadcasts and coordination. ' +
        'Messages are broadcast to all subscribers and stored for history. ' +
        'Use this for status updates, announcements, sharing context, and team visibility. ' +
        '\n\n' +
        'When to use: Team announcements ("Phase 1 complete"), status updates ("Running tests, ETA 5min"), ' +
        'error reporting ("NATS timeout in scenario-05"), sharing context ("Template created at /docs/template.md"). ' +
        '\n\n' +
        'When NOT to use: For 1-to-1 coordination with a specific agent, use warp_messages_send_direct instead. ' +
        'For distributing work based on capabilities, use warp_work_broadcast. ' +
        'See docs/COMMUNICATION_DECISION_GUIDE.md for detailed comparison. ' +
        '\n\n' +
        'Prerequisites: You must set a handle first using warp_handle_set. ' +
        '\n\n' +
        'Examples:\n' +
        '- Status: { channel: "parallel-work", message: "Tests passing for shuttle-tool-1" }\n' +
        '- Announcement: { channel: "roadmap", message: "Starting Phase 2 implementation" }\n' +
        '- Error: { channel: "errors", message: "Connection timeout in test-05. Investigating." }',
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
      name: 'warp_channels_read',
      description:
        'Read recent messages from a channel to catch up on team communications. ' +
        'Messages remain in the channel and can be read multiple times - this tool does not acknowledge or remove messages. ' +
        'Use this to review team status, check for updates, or see what happened while you were offline. ' +
        '\n\n' +
        'When to use: Catching up on team announcements, reviewing status updates in #parallel-work, ' +
        'checking error reports in #errors, reading roadmap discussions. ' +
        '\n\n' +
        'When NOT to use: For reading personal direct messages sent to you, use warp_messages_read_direct instead. ' +
        '\n\n' +
        'Examples:\n' +
        '- Catch up: { channel: "roadmap" } - Read last 50 messages (default)\n' +
        '- Recent only: { channel: "parallel-work", limit: 10 } - Last 10 messages\n' +
        '- Full history: { channel: "errors", limit: 1000 } - Up to max 1000 messages',
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
            description: 'Maximum number of messages to retrieve per page (default: 50, max: 1000)',
            default: 50,
          },
          cursor: {
            type: 'string',
            description: 'Optional pagination cursor from previous response to fetch next page',
          },
        },
        required: ['channel'],
      },
    },
    {
      name: 'warp_channels_status',
      description:
        'Get status information for communication channels without reading messages. ' +
        'Returns message count, storage usage, and sequence range for each channel. ' +
        'Use this to monitor channel activity, check for new messages, or understand channel health. ' +
        '\n\n' +
        'When to use: Checking if new messages arrived since last read, ' +
        'monitoring channel activity levels, verifying messages were published, ' +
        'understanding channel storage usage. ' +
        '\n\n' +
        'When NOT to use: If you want to read actual message content, use warp_channels_read instead. ' +
        'This tool only provides metadata, not message contents. ' +
        '\n\n' +
        'Examples:\n' +
        '- All channels: {} - Get status for all channels\n' +
        '- Specific channel: { channel: "roadmap" } - Just roadmap channel status',
      inputSchema: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: 'Optional: specific channel name to check. If omitted, returns status for all channels',
            enum: channelEnum,
          },
        },
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
 * Handle read_messages tool (v0.4.0+ with pagination)
 */
export async function handleReadMessages(
  args: Record<string, unknown>,
  channels: InternalChannel[]
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const channelName = args['channel'] as string;

  // Parse pagination parameters (default: 50 per page, max: 1000)
  const { offset, limit } = parsePaginationArgs(args, 50, 1000);

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
    const { messages: rawMessages, total } = await readMessages(channel, limit, offset);

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

    // Create pagination metadata
    const pagination = createPaginationMetadata({
      count: parsedMessages.length,
      total,
      offset,
      limit,
    });

    // Build response with pagination info
    let responseText = `Messages from #${channelName}:\n\n${formatted}`;

    // Add pagination footer
    responseText += `\n\n---\nShowing ${pagination.count} of ${pagination.total} messages`;

    if (pagination.hasMore) {
      responseText += `\n\nTo see older messages, use: { channel: "${channelName}", cursor: "${pagination.nextCursor}" }`;
    }

    logger.debug('Messages read', {
      channel: channelName,
      count: pagination.count,
      total: pagination.total,
      offset,
      limit,
      hasMore: pagination.hasMore,
    });

    return {
      content: [
        {
          type: 'text',
          text: responseText,
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

/**
 * Handle channels_status tool
 */
export async function handleChannelsStatus(
  args: Record<string, unknown>,
  channels: InternalChannel[]
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const channelName = args['channel'] as string | undefined;

  try {
    // If specific channel requested, validate it
    if (channelName) {
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

      // Get status for single channel
      const info = await getStreamInfo(channel);
      const lines: string[] = [
        `Status for channel #${channelName}:`,
        '',
        '| Metric | Value |',
        '|--------|-------|',
      ];

      if (info) {
        lines.push(`| Messages | ${info.messages.toLocaleString()} |`);
        lines.push(`| Storage | ${(info.bytes / 1024).toFixed(2)} KB |`);
        lines.push(`| First Sequence | ${info.firstSeq} |`);
        lines.push(`| Last Sequence | ${info.lastSeq} |`);
      } else {
        lines.push('| Status | No messages yet (stream not initialized) |');
      }

      logger.debug('Channel status retrieved', { channel: channelName, info });

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    }

    // Get status for all channels
    const lines: string[] = ['Channel status for all channels:', ''];

    for (const channel of channels) {
      const info = await getStreamInfo(channel);
      lines.push(`### #${channel.name}`);
      lines.push('');
      lines.push('| Metric | Value |');
      lines.push('|--------|-------|');

      if (info) {
        lines.push(`| Messages | ${info.messages.toLocaleString()} |`);
        lines.push(`| Storage | ${(info.bytes / 1024).toFixed(2)} KB |`);
        lines.push(`| First Sequence | ${info.firstSeq} |`);
        lines.push(`| Last Sequence | ${info.lastSeq} |`);
      } else {
        lines.push('| Status | No messages yet (stream not initialized) |');
      }

      lines.push('');
    }

    logger.debug('All channels status retrieved', { channelCount: channels.length });

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to get channel status', { error: error.message, channel: channelName });
    return {
      content: [
        {
          type: 'text',
          text: `Error getting channel status: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}
