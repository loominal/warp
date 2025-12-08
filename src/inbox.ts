/**
 * Personal inbox subjects for agent-to-agent messaging
 */

import type { StreamConfig, ConsumerMessages } from 'nats';
import { RetentionPolicy, StorageType } from 'nats';
import { getJetStreamManager, getJetStreamClient } from './nats.js';
import type { InboxMessage } from './types.js';
import { createLogger } from './logger.js';

const logger = createLogger('inbox');

/** Subject pattern for agent inboxes */
const INBOX_SUBJECT_PREFIX = 'global.agent';

/** Subscription state */
interface SubscriptionState {
  guid: string | null;
  consumer: ConsumerMessages | null;
  isActive: boolean;
}

const subscriptionState: SubscriptionState = {
  guid: null,
  consumer: null,
  isActive: false,
};

/**
 * Get inbox subject for an agent
 * Returns: "global.agent.{guid}"
 */
export function getInboxSubject(guid: string): string {
  return `${INBOX_SUBJECT_PREFIX}.${guid}`;
}

/**
 * Create inbox stream for an agent (called on registration)
 * Stream name: INBOX_{guid} (replace hyphens with underscores)
 * Subject: global.agent.{guid}
 * Retention: Limits (max 1000 messages, max 7 days)
 * Storage: File
 */
export async function createInboxStream(guid: string): Promise<void> {
  const jsm = getJetStreamManager();
  const streamName = `INBOX_${guid.replace(/-/g, '_')}`;
  const subject = getInboxSubject(guid);

  const streamConfig: Partial<StreamConfig> = {
    name: streamName,
    subjects: [subject],
    retention: RetentionPolicy.Limits,
    max_msgs: 1000,
    max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
    storage: StorageType.File,
    num_replicas: 1,
  };

  try {
    // Try to get existing stream
    const existingStream = await jsm.streams.info(streamName).catch(() => null);

    if (existingStream) {
      logger.debug('Inbox stream already exists', { stream: streamName, guid });
      return;
    }

    // Create new stream
    await jsm.streams.add(streamConfig);
    logger.info('Created inbox stream', { stream: streamName, subject, guid });
  } catch (err) {
    const error = err as Error;
    // Handle "already in use" error (race condition)
    if (error.message?.includes('already in use')) {
      logger.debug('Inbox stream already exists (concurrent creation)', {
        stream: streamName,
        guid,
      });
      return;
    }
    throw new Error(`Failed to create inbox stream for ${guid}: ${error.message}`);
  }
}

/**
 * Subscribe to personal inbox (called on registration)
 * Returns unsubscribe function
 */
export async function subscribeToInbox(
  guid: string,
  callback: (message: InboxMessage) => void
): Promise<() => void> {
  // Unsubscribe from any existing subscription
  if (subscriptionState.isActive) {
    logger.warn('Already subscribed to inbox, unsubscribing first', {
      currentGuid: subscriptionState.guid,
      newGuid: guid,
    });
    await unsubscribeFromInbox();
  }

  const js = getJetStreamClient();
  const streamName = `INBOX_${guid.replace(/-/g, '_')}`;
  const subject = getInboxSubject(guid);

  try {
    // Create ordered consumer for real-time message delivery
    const consumer = await js.consumers.get(streamName);
    const messages = await consumer.consume();

    subscriptionState.guid = guid;
    subscriptionState.consumer = messages;
    subscriptionState.isActive = true;

    logger.info('Subscribed to inbox', { guid, subject });

    // Process messages in background
    (async () => {
      try {
        for await (const msg of messages) {
          try {
            // Parse message payload
            const payload = JSON.parse(msg.data.toString()) as InboxMessage;

            // Acknowledge message
            msg.ack();

            logger.debug('Received inbox message', {
              id: payload.id,
              senderGuid: payload.senderGuid,
              recipientGuid: payload.recipientGuid,
              messageType: payload.messageType,
            });

            // Call callback
            callback(payload);
          } catch (parseErr) {
            const error = parseErr as Error;
            logger.error('Error processing inbox message', { error: error.message });
            // Ack anyway to avoid redelivery of bad messages
            msg.ack();
          }
        }
      } catch (err) {
        const error = err as Error;
        if (subscriptionState.isActive) {
          logger.error('Error in inbox subscription loop', { error: error.message });
        }
      }
    })().catch((err) => {
      logger.error('Inbox subscription loop failed', { error: (err as Error).message });
    });

    // Return unsubscribe function
    return async () => {
      await unsubscribeFromInbox();
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to subscribe to inbox', { guid, error: error.message });
    throw new Error(`Failed to subscribe to inbox for ${guid}: ${error.message}`);
  }
}

/**
 * Unsubscribe from inbox (called on deregistration)
 */
export async function unsubscribeFromInbox(): Promise<void> {
  if (!subscriptionState.isActive) {
    logger.debug('Not subscribed to inbox, nothing to unsubscribe');
    return;
  }

  const guid = subscriptionState.guid;

  try {
    if (subscriptionState.consumer) {
      await subscriptionState.consumer.close();
    }

    subscriptionState.guid = null;
    subscriptionState.consumer = null;
    subscriptionState.isActive = false;

    logger.info('Unsubscribed from inbox', { guid });
  } catch (err) {
    const error = err as Error;
    logger.error('Error unsubscribing from inbox', { guid, error: error.message });
    // Reset state anyway
    subscriptionState.guid = null;
    subscriptionState.consumer = null;
    subscriptionState.isActive = false;
    throw new Error(`Failed to unsubscribe from inbox: ${error.message}`);
  }
}

/**
 * Check if subscribed to inbox
 */
export function isSubscribedToInbox(): boolean {
  return subscriptionState.isActive;
}

/**
 * Get current subscription GUID (for testing)
 */
export function getCurrentSubscriptionGuid(): string | null {
  return subscriptionState.guid;
}

/**
 * Reset subscription state (for testing)
 */
export function resetInboxState(): void {
  subscriptionState.guid = null;
  subscriptionState.consumer = null;
  subscriptionState.isActive = false;
}
