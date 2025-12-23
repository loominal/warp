#!/usr/bin/env node

/**
 * Loom Warp - Main entry point
 *
 * A generalized MCP server for agent-to-agent communication via NATS JetStream.
 * Supports configurable channels, project namespace isolation, and message persistence.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig, getInternalChannels } from './config.js';
import { connectToNats, setupShutdownHandlers, isConnected, getConnection } from './nats.js';
import { ensureAllStreams } from './streams.js';
import {
  handleTools,
  handleSetHandle,
  handleGetMyHandle,
  channelTools,
  handleListChannels,
  createMessagingTools,
  handleSendMessage,
  handleReadMessages,
  handleChannelsStatus,
  registryTools,
  handleRegisterAgent,
  handleGetAgentInfo,
  handleDiscoverAgents,
  handleUpdatePresence,
  handleDeregisterAgent,
  handleSendDirectMessage,
  handleReadDirectMessages,
  handleBroadcastWorkOffer,
  handleClaimWork,
  handleListWork,
  handleWorkQueueStatus,
  handleListDeadLetterItems,
  handleRetryDeadLetterItem,
  handleDiscardDeadLetterItem,
} from './tools/index.js';
import type { SessionState, InternalChannel, ResolvedConfig } from './types.js';
import { createLogger, configureLogger } from './logger.js';
import { initializeIdentity } from './identity.js';

const logger = createLogger('server');

/** Server state */
let config: ResolvedConfig;
let channels: InternalChannel[];
let allTools: Tool[];

/** Session state (per MCP connection) */
const sessionState: SessionState = {
  handle: null,
  agentGuid: null,
  registeredEntry: null,
  identity: null,
};

/**
 * Initialize the server
 */
async function initialize(): Promise<void> {
  // Load configuration
  config = await loadConfig();

  // Configure logger based on config
  configureLogger(config.logging.level, config.logging.format);

  logger.info('Loom Warp initializing', {
    namespace: config.namespace,
    projectPath: config.projectPath,
  });

  // Get internal channel representations
  channels = getInternalChannels(config);

  // Build tool list (messaging tools need channel enum)
  const messagingTools = createMessagingTools(channels);
  allTools = [...handleTools, ...channelTools, ...messagingTools, ...registryTools];

  logger.debug('Tools registered', { count: allTools.length });
}

/**
 * Ensure NATS connection and streams are ready
 */
async function ensureNatsReady(): Promise<void> {
  if (!isConnected()) {
    await connectToNats(config.natsUrl);
    await ensureAllStreams(channels);

    // Initialize identity after NATS connection is established
    if (!sessionState.identity) {
      const nc = getConnection();
      sessionState.identity = await initializeIdentity(nc, config.projectId, config.projectPath);
      logger.info('Agent identity initialized', {
        agentId: sessionState.identity.agentId,
        isSubagent: sessionState.identity.isSubagent,
      });
    }
  }
}

/**
 * Handle tool calls
 */
async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Ensure NATS is connected (lazy initialization)
  await ensureNatsReady();

  switch (name) {
    case 'warp_handle_set':
      return handleSetHandle(args, sessionState);

    case 'warp_handle_get':
      return handleGetMyHandle(args, sessionState);

    case 'warp_channels_list':
      return handleListChannels(args, channels);

    case 'warp_channels_send':
      return handleSendMessage(args, sessionState, channels);

    case 'warp_channels_read':
      return handleReadMessages(args, channels);

    case 'warp_channels_status':
      return handleChannelsStatus(args, channels);

    case 'warp_registry_register':
      return handleRegisterAgent(args, sessionState, config);

    case 'warp_registry_get_info':
      return handleGetAgentInfo(args, sessionState);

    case 'warp_registry_discover':
      return handleDiscoverAgents(args, sessionState, config);

    case 'warp_registry_update_presence':
      return handleUpdatePresence(args, sessionState);

    case 'warp_registry_deregister':
      return handleDeregisterAgent(args, sessionState);

    case 'warp_messages_send_direct':
      return handleSendDirectMessage(args, sessionState);

    case 'warp_messages_read_direct':
      return handleReadDirectMessages(args, sessionState);

    case 'warp_work_broadcast':
      return handleBroadcastWorkOffer(args, sessionState);

    case 'warp_work_claim':
      return handleClaimWork(args, sessionState);

    case 'warp_work_list':
      return handleListWork(args);

    case 'warp_work_queue_status':
      return handleWorkQueueStatus(args);

    case 'warp_dlq_list':
      return handleListDeadLetterItems(args);

    case 'warp_dlq_retry':
      return handleRetryDeadLetterItem(args);

    case 'warp_dlq_discard':
      return handleDiscardDeadLetterItem(args);

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}

/**
 * Create and run the MCP server
 */
async function runServer(): Promise<void> {
  // Initialize configuration and channels
  await initialize();

  // Set up graceful shutdown
  setupShutdownHandlers();

  // Connect to NATS and initialize identity immediately on startup
  // This ensures identity is available for other MCP servers (like Pattern) that depend on it
  await ensureNatsReady();

  // Create MCP server
  const server = new Server(
    {
      name: 'loom-warp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      return await handleToolCall(name, args as Record<string, unknown>);
    } catch (error) {
      const err = error as Error;
      logger.error('Tool call failed', { tool: name, error: err.message });
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('NATS MCP Server running on stdio', {
    namespace: config.namespace,
    channels: channels.map((ch) => ch.name),
  });
}

// Run the server
runServer().catch((error) => {
  logger.error('Server failed to start', { error: (error as Error).message });
  process.exit(1);
});
