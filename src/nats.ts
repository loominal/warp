/**
 * NATS connection management with retry and graceful shutdown
 */

import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  type JetStreamManager,
} from 'nats';
import { createLogger } from './logger.js';

const logger = createLogger('nats-connection');

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

  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    if (state.isShuttingDown) {
      state.isConnecting = false;
      throw new Error('Server is shutting down');
    }

    try {
      logger.info('Connecting to NATS', { url: natsUrl, attempt: attempt + 1 });

      state.connection = await connect({
        servers: [natsUrl],
        reconnect: true,
        maxReconnectAttempts: -1, // Unlimited reconnects
        reconnectTimeWait: 1000,
        timeout: 10000,
      });

      // Set up connection event handlers
      setupConnectionHandlers(state.connection);

      // Initialize JetStream
      state.jetStreamClient = state.connection.jetstream();
      state.jetStreamManager = await state.connection.jetstreamManager();

      logger.info('Connected to NATS with JetStream', { url: natsUrl });
      state.isConnecting = false;
      return;
    } catch (err) {
      const error = err as Error;
      logger.warn('Failed to connect to NATS', {
        error: error.message,
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
  throw new Error(
    `Failed to connect to NATS after ${RETRY_CONFIG.maxRetries} attempts. ` +
      `Make sure NATS server with JetStream is running at ${natsUrl}. ` +
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
