/**
 * NATS connection management with retry and graceful shutdown
 * Supports both TCP (nats://) and WebSocket (wss://) transports
 */

import {
  connect as connectTcp,
  type NatsConnection,
  type JetStreamClient,
  type JetStreamManager,
  type ConnectionOptions,
} from 'nats';
import { createLogger } from './logger.js';

const logger = createLogger('nats-connection');

/**
 * Transport type for NATS connection
 */
export type NatsTransport = 'tcp' | 'websocket';

/**
 * Parsed NATS URL components
 */
export interface ParsedNatsUrl {
  /** Server URL without credentials (e.g., "nats://host:4222" or "wss://host") */
  server: string;
  /** Username if present in URL */
  user?: string;
  /** Password if present in URL */
  pass?: string;
  /** Transport type detected from URL scheme */
  transport: NatsTransport;
}

/**
 * Detect transport type from URL scheme
 */
export function detectTransport(url: string): NatsTransport {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.startsWith('wss://') || lowerUrl.startsWith('ws://')) {
    return 'websocket';
  }
  return 'tcp';
}

/**
 * Parse a NATS URL that may contain credentials
 *
 * Supports formats:
 * - nats://host:port (TCP, no auth)
 * - nats://user:pass@host:port (TCP with auth)
 * - tls://host:port (TCP with TLS)
 * - wss://host/path (WebSocket secure)
 * - wss://user:pass@host/path (WebSocket with auth)
 * - ws://host:port (WebSocket insecure)
 *
 * @param url - NATS URL to parse
 * @returns Parsed components with server URL, credentials, and transport type
 */
export function parseNatsUrl(url: string): ParsedNatsUrl {
  const transport = detectTransport(url);

  try {
    // Normalize URL for parsing
    let normalizedUrl: string;
    if (url.startsWith('nats://')) {
      normalizedUrl = url.replace(/^nats:\/\//, 'http://');
    } else if (url.startsWith('tls://')) {
      normalizedUrl = url.replace(/^tls:\/\//, 'https://');
    } else if (url.startsWith('wss://')) {
      normalizedUrl = url.replace(/^wss:\/\//, 'https://');
    } else if (url.startsWith('ws://')) {
      normalizedUrl = url.replace(/^ws:\/\//, 'http://');
    } else {
      // Assume nats:// for bare host:port
      normalizedUrl = `http://${url}`;
    }

    const parsed = new URL(normalizedUrl);

    // Reconstruct the server URL without credentials
    let server: string;
    if (transport === 'websocket') {
      // For WebSocket, preserve the path
      const protocol = url.toLowerCase().startsWith('ws://') ? 'ws' : 'wss';
      server = `${protocol}://${parsed.host}${parsed.pathname}${parsed.search}`;
    } else {
      // For TCP, use nats:// scheme
      server = `nats://${parsed.host}`;
    }

    const result: ParsedNatsUrl = { server, transport };

    // Extract credentials if present
    if (parsed.username) {
      result.user = decodeURIComponent(parsed.username);
    }
    if (parsed.password) {
      result.pass = decodeURIComponent(parsed.password);
    }

    return result;
  } catch {
    // If URL parsing fails, return as-is
    return { server: url, transport };
  }
}

/**
 * Initialize WebSocket shim for Node.js
 * Must be called before using nats.ws
 */
async function initWebSocketShim(): Promise<void> {
  // Dynamic import to avoid loading ws when using TCP
  const ws = await import('ws');
  (globalThis as unknown as { WebSocket: typeof ws.default }).WebSocket = ws.default;
}

/**
 * Connect using WebSocket transport
 */
async function connectWebSocket(opts: ConnectionOptions): Promise<NatsConnection> {
  await initWebSocketShim();
  // Dynamic import nats.ws after shim is in place
  const { connect: connectWs } = await import('nats.ws');
  return connectWs(opts);
}

/** Connection state */
interface ConnectionState {
  connection: NatsConnection | null;
  jetStreamClient: JetStreamClient | null;
  jetStreamManager: JetStreamManager | null;
  isConnecting: boolean;
  isShuttingDown: boolean;
}

const state: ConnectionState = {
  connection: null,
  jetStreamClient: null,
  jetStreamManager: null,
  isConnecting: false,
  isShuttingDown: false,
};

/** Retry configuration */
const RETRY_CONFIG = {
  maxRetries: 10,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

/**
 * Calculate retry delay with exponential backoff
 */
function getRetryDelay(attempt: number): number {
  const delay = RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
  return Math.min(delay, RETRY_CONFIG.maxDelayMs);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Connect to NATS server with retry logic
 *
 * Supports both TCP and WebSocket transports:
 * - TCP: nats://host:port, tls://host:port
 * - WebSocket: wss://host/path, ws://host:port
 *
 * Transport is auto-detected from URL scheme.
 *
 * Supports optional authentication via:
 * 1. Credentials in URL: nats://user:pass@host:port
 * 2. Environment variables: NATS_USER and NATS_PASS
 *
 * Authentication is optional - if no credentials are provided,
 * connects without authentication (suitable for local development).
 */
export async function connectToNats(natsUrl: string): Promise<void> {
  if (state.connection) {
    logger.debug('Already connected to NATS');
    return;
  }

  if (state.isConnecting) {
    logger.debug('Connection already in progress');
    // Wait for connection to complete
    while (state.isConnecting) {
      await sleep(100);
    }
    if (state.connection) {
      return;
    }
    throw new Error('Connection failed');
  }

  state.isConnecting = true;

  // Parse URL and extract credentials if present
  const parsed = parseNatsUrl(natsUrl);

  // Resolve credentials: URL takes precedence, then env vars
  const user = parsed.user ?? process.env['NATS_USER'];
  const pass = parsed.pass ?? process.env['NATS_PASS'];

  // Build connection options
  const connectOpts: ConnectionOptions = {
    servers: [parsed.server],
    reconnect: true,
    maxReconnectAttempts: -1, // Unlimited reconnects
    reconnectTimeWait: 1000,
    timeout: 10000,
  };

  // Add credentials only if provided (auth is optional)
  if (user) {
    connectOpts.user = user;
    if (pass) {
      connectOpts.pass = pass;
    }
  }

  const hasAuth = !!user;

  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    if (state.isShuttingDown) {
      state.isConnecting = false;
      throw new Error('Server is shutting down');
    }

    try {
      logger.info('Connecting to NATS', {
        url: parsed.server,
        transport: parsed.transport,
        attempt: attempt + 1,
        authenticated: hasAuth,
      });

      // Use appropriate transport based on URL scheme
      if (parsed.transport === 'websocket') {
        state.connection = await connectWebSocket(connectOpts);
      } else {
        state.connection = await connectTcp(connectOpts);
      }

      // Set up connection event handlers
      setupConnectionHandlers(state.connection);

      // Initialize JetStream
      state.jetStreamClient = state.connection.jetstream();
      state.jetStreamManager = await state.connection.jetstreamManager();

      logger.info('Connected to NATS with JetStream', {
        url: parsed.server,
        transport: parsed.transport,
        authenticated: hasAuth,
      });
      state.isConnecting = false;
      return;
    } catch (err) {
      const error = err as Error;
      logger.warn('Failed to connect to NATS', {
        error: error.message,
        transport: parsed.transport,
        attempt: attempt + 1,
        maxRetries: RETRY_CONFIG.maxRetries,
      });

      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        const delay = getRetryDelay(attempt);
        logger.info(`Retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }

  state.isConnecting = false;
  const authHint = hasAuth
    ? ' Check that credentials are correct.'
    : '';
  const transportHint = parsed.transport === 'websocket'
    ? ' For WebSocket, ensure NATS has websocket listener enabled.'
    : '';
  throw new Error(
    `Failed to connect to NATS after ${RETRY_CONFIG.maxRetries} attempts. ` +
      `Make sure NATS server with JetStream is running at ${parsed.server}.${authHint}${transportHint} ` +
      'Start NATS with: nats-server -js'
  );
}

/**
 * Set up connection event handlers
 */
function setupConnectionHandlers(nc: NatsConnection): void {
  (async () => {
    for await (const status of nc.status()) {
      switch (status.type) {
        case 'disconnect':
          logger.warn('Disconnected from NATS', { data: status.data });
          break;
        case 'reconnect':
          logger.info('Reconnected to NATS', { data: status.data });
          break;
        case 'reconnecting':
          logger.info('Reconnecting to NATS');
          break;
        case 'error':
          logger.error('NATS connection error', { data: status.data });
          break;
        case 'update':
          logger.debug('NATS connection update', { data: status.data });
          break;
      }
    }
  })().catch((err) => {
    logger.error('Error in connection status handler', { error: (err as Error).message });
  });
}

/**
 * Get the NATS connection (throws if not connected)
 */
export function getConnection(): NatsConnection {
  if (!state.connection) {
    throw new Error('Not connected to NATS. Call connectToNats() first.');
  }
  return state.connection;
}

/**
 * Get the JetStream client (throws if not connected)
 */
export function getJetStreamClient(): JetStreamClient {
  if (!state.jetStreamClient) {
    throw new Error('JetStream client not initialized. Call connectToNats() first.');
  }
  return state.jetStreamClient;
}

/**
 * Get the JetStream manager (throws if not connected)
 */
export function getJetStreamManager(): JetStreamManager {
  if (!state.jetStreamManager) {
    throw new Error('JetStream manager not initialized. Call connectToNats() first.');
  }
  return state.jetStreamManager;
}

/**
 * Check if connected to NATS
 */
export function isConnected(): boolean {
  return state.connection !== null && !state.connection.isClosed();
}

/**
 * Gracefully disconnect from NATS
 */
export async function disconnect(): Promise<void> {
  state.isShuttingDown = true;

  if (state.connection) {
    logger.info('Disconnecting from NATS');
    try {
      // Drain ensures all pending messages are processed
      await state.connection.drain();
      logger.info('NATS connection drained and closed');
    } catch (err) {
      logger.error('Error draining NATS connection', { error: (err as Error).message });
      // Force close if drain fails
      await state.connection.close();
    }

    state.connection = null;
    state.jetStreamClient = null;
    state.jetStreamManager = null;
  }
}

/**
 * Set up graceful shutdown handlers
 */
export function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    await disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
