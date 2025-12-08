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
    name: 'list_channels',
    description: 'List all available chat channels and their descriptions',
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
