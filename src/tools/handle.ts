/**
 * Handle management tools: set_handle, get_my_handle
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { SessionState } from '../types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('tools:handle');

/** Valid handle pattern: lowercase alphanumeric and hyphens */
const HANDLE_PATTERN = /^[a-z0-9-]+$/;

/**
 * Tool definitions for handle management
 */
export const handleTools: Tool[] = [
  {
    name: 'set_handle',
    description:
      'Set your agent handle/username for the chat. This identifies you in all messages. ' +
      'Handle must be lowercase alphanumeric with hyphens only (e.g., "project-manager", "tdd-engineer-1").',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Your agent handle/username (lowercase alphanumeric with hyphens)',
          pattern: '^[a-z0-9-]+$',
        },
      },
      required: ['handle'],
    },
  },
  {
    name: 'get_my_handle',
    description: 'Get your current agent handle',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Validate handle format
 */
export function validateHandle(handle: string): string | null {
  if (!handle || handle.trim() === '') {
    return 'Handle cannot be empty';
  }

  if (!HANDLE_PATTERN.test(handle)) {
    return (
      `Invalid handle: "${handle}". ` +
      'Must be lowercase alphanumeric with hyphens only (e.g., "project-manager", "tdd-engineer-1")'
    );
  }

  return null;
}

/**
 * Handle set_handle tool
 */
export function handleSetHandle(
  args: Record<string, unknown>,
  state: SessionState
): { content: Array<{ type: string; text: string }>; isError?: boolean } {
  const handle = args['handle'] as string;

  const validationError = validateHandle(handle);
  if (validationError) {
    return {
      content: [{ type: 'text', text: `Error: ${validationError}` }],
      isError: true,
    };
  }

  const previousHandle = state.handle;
  state.handle = handle;

  logger.info('Handle set', { handle, previousHandle });

  return {
    content: [
      {
        type: 'text',
        text: `Handle set to: ${handle}\nYou can now send messages to channels!`,
      },
    ],
  };
}

/**
 * Handle get_my_handle tool
 */
export function handleGetMyHandle(
  _args: Record<string, unknown>,
  state: SessionState
): { content: Array<{ type: string; text: string }> } {
  if (!state.handle) {
    return {
      content: [
        {
          type: 'text',
          text: 'No handle set. Use set_handle tool to choose your agent handle.',
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Your current handle: ${state.handle}`,
      },
    ],
  };
}
