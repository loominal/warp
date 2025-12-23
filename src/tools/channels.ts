/**
 * Channel management tools: list_channels
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { InternalChannel } from '../types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('tools:channels');

/**
 * Tool definitions for channel management
 */
export const channelTools: Tool[] = [
  {
    name: 'warp_channels_list',
    description:
      'List all available chat channels and their descriptions. ' +
      'Shows default channels (roadmap, parallel-work, errors) and any custom channels from .loominal-config.json. ' +
      'Use this to discover which channels are available before sending messages. ' +
      '\n\n' +
      'When to use: Discovering available channels at session start, ' +
      'checking channel names before using warp_channels_send, seeing custom project channels. ' +
      '\n\n' +
      'Examples:\n' +
      '- List all: {} - No parameters needed, returns all available channels',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Handle list_channels tool
 */
export function handleListChannels(
  _args: Record<string, unknown>,
  channels: InternalChannel[]
): { content: Array<{ type: string; text: string }> } {
  logger.debug('Listing channels', { count: channels.length });

  const channelList = channels
    .map((ch) => `- **${ch.name}**: ${ch.description}`)
    .join('\n');

  return {
    content: [
      {
        type: 'text',
        text: `Available channels:\n${channelList}`,
      },
    ],
  };
}

/**
 * Generate enum values for channel names (used in tool schemas)
 */
export function getChannelEnum(channels: InternalChannel[]): string[] {
  return channels.map((ch) => ch.name);
}
