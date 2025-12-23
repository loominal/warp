/**
 * JetStream stream and consumer management
 */

import { type StreamConfig, RetentionPolicy, StorageType } from 'nats';
import { getJetStreamManager, getJetStreamClient } from './nats.js';
import type { InternalChannel } from './types.js';
import { createLogger } from './logger.js';

const logger = createLogger('streams');

/**
 * Create or update a JetStream stream for a channel
 * Idempotent - reuses existing streams
 */
export async function ensureStream(channel: InternalChannel): Promise<void> {
  const jsm = getJetStreamManager();

  const streamConfig: Partial<StreamConfig> = {
    name: channel.streamName,
    subjects: [channel.subject],
    retention: RetentionPolicy.Limits,
    max_msgs: channel.maxMessages,
    max_bytes: channel.maxBytes,
    max_age: channel.maxAgeNanos,
    storage: StorageType.File,
    num_replicas: 1,
  };

  try {
    // Try to get existing stream
    const existingStream = await jsm.streams.info(channel.streamName).catch(() => null);

    if (existingStream) {
      logger.debug('Stream already exists', { stream: channel.streamName });
      // Optionally update stream config if needed
      // await jsm.streams.update(channel.streamName, streamConfig);
      return;
    }

    // Create new stream
    await jsm.streams.add(streamConfig);
    logger.info('Created stream', {
      stream: channel.streamName,
      subject: channel.subject,
      maxMessages: channel.maxMessages,
    });
  } catch (err) {
    const error = err as Error;
    // Handle "already in use" error (race condition)
    if (error.message?.includes('already in use')) {
      logger.debug('Stream already exists (concurrent creation)', { stream: channel.streamName });
      return;
    }
    throw new Error(`Failed to create stream ${channel.streamName}: ${error.message}`);
  }
}

/**
 * Create streams for all channels
 */
export async function ensureAllStreams(channels: InternalChannel[]): Promise<void> {
  logger.info('Ensuring streams for all channels', { count: channels.length });

  for (const channel of channels) {
    await ensureStream(channel);
  }

  logger.info('All streams ready');
}


/**
 * Publish a message to a channel's stream
 */
export async function publishMessage(channel: InternalChannel, payload: string): Promise<void> {
  const js = getJetStreamClient();

  try {
    const ack = await js.publish(channel.subject, Buffer.from(payload));
    logger.debug('Message published', {
      subject: channel.subject,
      seq: ack.seq,
      stream: ack.stream,
    });
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to publish message to ${channel.name}: ${error.message}`);
  }
}

/**
 * Read messages from a channel's stream with pagination support (v0.4.0+)
 * Uses direct stream access for true pub-sub semantics - all agents can read the same messages
 * @param channel - Channel to read from
 * @param limit - Maximum number of messages to read
 * @param offset - Number of messages to skip from the end (0 = newest messages)
 * @returns Object with messages array and total count for pagination metadata
 */
export async function readMessages(
  channel: InternalChannel,
  limit: number,
  offset: number = 0
): Promise<{ messages: { data: string }[]; total: number }> {
  const jsm = getJetStreamManager();
  const messages: { data: string }[] = [];

  try {
    // Get stream info to find message range
    const streamInfo = await jsm.streams.info(channel.streamName);
    const { first_seq, last_seq, messages: msgCount } = streamInfo.state;

    if (msgCount === 0) {
      return { messages, total: 0 };
    }

    // Calculate sequence range for pagination
    // Offset from end: last_seq - offset is the newest message we want
    // Then go back limit-1 more to get limit messages
    const endSeq = Math.max(first_seq, last_seq - offset);
    const startSeq = Math.max(first_seq, endSeq - limit + 1);

    logger.debug('Reading messages from stream', {
      stream: channel.streamName,
      firstSeq: first_seq,
      lastSeq: last_seq,
      startSeq,
      endSeq,
      limit,
      offset,
    });

    // Read messages directly from stream by sequence number
    const stream = await jsm.streams.get(channel.streamName);
    for (let seq = startSeq; seq <= endSeq; seq++) {
      try {
        const msg = await stream.getMessage({ seq });
        messages.push({ data: new TextDecoder().decode(msg.data) });
      } catch (err) {
        // Message may have been deleted by retention policy - skip gaps
        const error = err as Error;
        if (!error.message?.includes('no message found')) {
          logger.warn('Error reading message', { seq, error: error.message });
        }
      }
    }

    logger.debug('Messages read from stream', {
      stream: channel.streamName,
      count: messages.length,
      total: msgCount,
      offset,
    });

    return { messages, total: msgCount };
  } catch (err) {
    const error = err as Error;
    // Stream doesn't exist yet - not an error
    if (error.message?.includes('stream not found')) {
      return { messages, total: 0 };
    }
    throw new Error(`Failed to read messages from ${channel.name}: ${error.message}`);
  }
}

/**
 * Get stream info for a channel
 */
export async function getStreamInfo(channel: InternalChannel): Promise<{
  messages: number;
  bytes: number;
  firstSeq: number;
  lastSeq: number;
} | null> {
  const jsm = getJetStreamManager();

  try {
    const info = await jsm.streams.info(channel.streamName);
    return {
      messages: info.state.messages,
      bytes: info.state.bytes,
      firstSeq: info.state.first_seq,
      lastSeq: info.state.last_seq,
    };
  } catch {
    return null;
  }
}
