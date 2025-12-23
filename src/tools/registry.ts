/**
 * Registry tools: warp_registry_register
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { hostname } from 'os';
import { randomUUID } from 'crypto';
import type { LoominalScope } from '@loominal/shared/types';
import { migrateLegacyVisibility } from '@loominal/shared/types';
import type { SessionState, RegistryEntry, ResolvedConfig, InboxMessage, WorkItem } from '../types.js';
import { createLogger } from '../logger.js';
import { createRegistryEntry, isVisibleTo, redactEntry, type Requester } from '../registry.js';
import { initializeRegistry, putRegistryEntry, listRegistryEntries, getRegistryEntry } from '../kv.js';
import { validateHandle } from './handle.js';
import { startHeartbeat, stopHeartbeat } from '../heartbeat.js';
import { createInboxStream, subscribeToInbox, unsubscribeFromInbox, getInboxSubject, getInboxConsumerName } from '../inbox.js';
import { getJetStreamClient, getJetStreamManager } from '../nats.js';
import { createWorkQueueStream, publishWorkItem, getWorkQueueSubject, claimWorkItem, listWorkItems, type ListWorkItemsFilters } from '../workqueue.js';
import { listDeadLetterItems, retryDeadLetterItem, discardDeadLetterItem } from '../dlq.js';
import { parsePaginationArgs, createPaginationMetadata } from '../pagination.js';

const logger = createLogger('tools:registry');

/** Heartbeat cleanup function for the current session */
let heartbeatCleanup: (() => void) | null = null;

/** Inbox unsubscribe function for the current session */
let inboxUnsubscribe: (() => void) | null = null;

/**
 * Tool definitions for registry management
 */
export const registryTools: Tool[] = [
  {
    name: 'warp_registry_register',
    description:
      'Register this agent in the global registry for discovery and coordination. ' +
      'This enables cross-computer agent communication, work distribution, and direct messaging. ' +
      'Automatically starts heartbeat (60 sec interval) and creates your personal inbox. ' +
      '\n\n' +
      'When to use: At session start before using any communication or coordination features. ' +
      'Required before: warp_registry_discover, warp_messages_send_direct, warp_work_broadcast, warp_work_claim. ' +
      '\n\n' +
      'Important: Auto-generates handle from agentType if you haven\'t set one with warp_handle_set. ' +
      'Registration persists across sessions if you use same hostname + project (uses stable agent ID). ' +
      '\n\n' +
      'Examples:\n' +
      '- Basic: { agentType: "developer" } - Register with no capabilities\n' +
      '- With capabilities: { agentType: "developer", capabilities: ["typescript", "testing"] }\n' +
      '- Team scoped: { agentType: "reviewer", capabilities: ["code-review"], scope: "team" } (default)\n' +
      '- Personal scoped: { agentType: "assistant", scope: "personal" } - Follows you across projects',
    inputSchema: {
      type: 'object',
      properties: {
        agentType: {
          type: 'string',
          description: 'Type of agent (e.g., "developer", "reviewer", "tester", "project-manager")',
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of capabilities this agent has (e.g., ["typescript", "testing"])',
        },
        scope: {
          type: 'string',
          enum: ['private', 'personal', 'team', 'public'],
          description:
            'Who can discover this agent: "private" (only self), "personal" (same user across projects), ' +
            '"team" (same project), "public" (everyone). Default: "team"',
        },
        visibility: {
          type: 'string',
          enum: ['private', 'project-only', 'user-only', 'public'],
          description:
            '[DEPRECATED] Use scope instead. Maps: private→private, user-only→personal, project-only→team, public→public',
        },
      },
      required: ['agentType'],
    },
  },
  {
    name: 'warp_registry_discover',
    description:
      'Discover other agents in the registry by type, capability, status, or other criteria (v0.4.0+ with pagination). ' +
      'Results are filtered by visibility rules (you can only see agents visible to you based on scope). ' +
      'Returns online agents by default (use includeOffline: true to see all). ' +
      '\n\n' +
      'When to use: Finding agents before sending direct messages, locating agents with specific capabilities, ' +
      'checking who\'s online, finding agents in specific project, discovering available workers. ' +
      '\n\n' +
      'Prerequisites: You must be registered (warp_registry_register) to discover other agents. ' +
      '\n\n' +
      'Examples:\n' +
      '- By capability: { capability: "typescript" } - Find online TypeScript developers\n' +
      '- By type: { agentType: "reviewer" } - Find all online reviewers\n' +
      '- By type + capability: { agentType: "developer", capability: "testing" } - Developers who can test\n' +
      '- Include offline: { capability: "documentation", includeOffline: true } - All doc writers\n' +
      '- By status: { status: "busy" } - See who\'s currently busy\n' +
      '- Paginate: { capability: "typescript", limit: 10, cursor: "..." } - Page through results',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of agents to return (default: 20, max: 100)',
          minimum: 1,
          maximum: 100,
        },
        cursor: {
          type: 'string',
          description: 'Optional pagination cursor from previous response to fetch next page',
        },
        agentType: {
          type: 'string',
          description: 'Filter by agent type (e.g., "developer", "reviewer")',
        },
        capability: {
          type: 'string',
          description: 'Filter by capability - agent must have this capability (e.g., "typescript", "testing")',
        },
        hostname: {
          type: 'string',
          description: 'Filter by hostname',
        },
        projectId: {
          type: 'string',
          description: 'Filter by project ID (16-character hex string)',
        },
        status: {
          type: 'string',
          enum: ['online', 'busy', 'offline'],
          description: 'Filter by agent status',
        },
        scope: {
          type: 'string',
          enum: ['private', 'personal', 'team', 'public'],
          description: 'Filter by scope',
        },
        includeOffline: {
          type: 'boolean',
          description: 'Include offline agents in results (default: false)',
        },
      },
    },
  },
  {
    name: 'warp_registry_get_info',
    description:
      'Retrieve detailed information about a specific agent by GUID. ' +
      'Returns full agent details including status, capabilities, last heartbeat, and metadata. ' +
      'Results are filtered by visibility rules (you can only view agents visible to you based on scope). ' +
      '\n\n' +
      'When to use: Getting full details about an agent from warp_registry_discover results, ' +
      'checking last seen time for specific agent, verifying agent capabilities before coordination, ' +
      'inspecting agent metadata (hostname, project, username). ' +
      '\n\n' +
      'Prerequisites: You must be registered (warp_registry_register) and have a valid agent GUID (from warp_registry_discover). ' +
      '\n\n' +
      'Examples:\n' +
      '- Get info: { guid: "550e8400-e29b-41d4-a716-446655440000" } - Full details for specific agent',
    inputSchema: {
      type: 'object',
      properties: {
        guid: {
          type: 'string',
          description: 'GUID of the agent to look up (UUID v4 format)',
        },
      },
      required: ['guid'],
    },
  },
  {
    name: 'warp_registry_update_presence',
    description:
      'Update your agent presence information in the registry. ' +
      'You can update status, current task count, and capabilities. ' +
      'Setting status to "offline" will stop the automated heartbeat. ' +
      '\n\n' +
      'Prerequisites: You must warp_registry_register first before updating presence. ' +
      '\n\n' +
      'When to use: Update status to "busy" when working on tasks, set currentTaskCount to reflect your workload, or add/remove capabilities as your role changes. ' +
      '\n\n' +
      'Note: At least one field (status, currentTaskCount, or capabilities) must be provided.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['online', 'busy', 'offline'],
          description: 'Update agent status',
        },
        currentTaskCount: {
          type: 'number',
          description: 'Update current task count',
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Update capabilities list',
        },
      },
    },
  },
  {
    name: 'warp_registry_deregister',
    description:
      'Deregister this agent from the global registry. ' +
      'Stops heartbeat, unsubscribes from inbox, and marks the agent as offline. ' +
      'The agent entry is preserved in the registry for historical purposes. ' +
      '\n\n' +
      'Prerequisites: You must be registered first before deregistering. ' +
      '\n\n' +
      'When to use: Use this when shutting down your agent or when you want to stop participating in multi-agent coordination. Your agent will no longer appear in warp_registry_discover results (for online agents) and will stop receiving heartbeat updates. ' +
      '\n\n' +
      'When NOT to use: If you just want to appear offline temporarily, use warp_registry_update_presence with status "offline" instead. Deregistering is more permanent.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'warp_messages_send_direct',
    description:
      'Send a direct message to another agent via their personal inbox for 1-to-1 coordination. ' +
      'Messages are delivered reliably and queued if the recipient is offline. ' +
      'Use this for direct coordination, status requests, handoffs, and targeted help requests. ' +
      '\n\n' +
      'When to use: Asking specific agent for status ("What\'s the status of your work?"), ' +
      'coordinating handoff ("I\'ve completed X, ready for you to start Y"), ' +
      'requesting help from known expert ("Can you help debug this NATS issue?"), ' +
      'following up on claimed work. ' +
      '\n\n' +
      'When NOT to use: For team broadcasts or announcements, use send_message with a channel. ' +
      'For distributing work to anyone with a capability, use warp_work_broadcast. ' +
      'See docs/COMMUNICATION_DECISION_GUIDE.md for detailed comparison. ' +
      '\n\n' +
      'Prerequisites: You must be registered (warp_registry_register) and know the recipient\'s GUID (get from warp_registry_discover). ' +
      '\n\n' +
      'Examples:\n' +
      '- Status request: { recipientGuid: "550e8400-...", message: "What\'s your progress on tool-1?" }\n' +
      '- Handoff: { recipientGuid: "...", message: "Scaffold done. Results in /tmp/results.json" }\n' +
      '- Help request: { recipientGuid: "...", message: "Stuck on NATS config. Can you help?", messageType: "help-request" }',
    inputSchema: {
      type: 'object',
      properties: {
        recipientGuid: {
          type: 'string',
          description: 'GUID of the recipient agent (UUID v4 format)',
        },
        message: {
          type: 'string',
          description: 'Message content to send',
        },
        messageType: {
          type: 'string',
          description: 'Type of message (e.g., "text", "work-offer", "work-claim"). Default: "text"',
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata to include with the message',
          additionalProperties: true,
        },
      },
      required: ['recipientGuid', 'message'],
    },
  },
  {
    name: 'warp_messages_read_direct',
    description:
      'Read direct messages from your personal inbox sent via warp_messages_send_direct (v0.4.0+ with pagination). ' +
      'Messages are retrieved from your inbox and can be filtered by type or sender. ' +
      'Retrieved messages are acknowledged and will not be returned in subsequent reads (consume once). ' +
      '\n\n' +
      'When to use: Checking for messages sent directly to you, reading work coordination messages, ' +
      'checking for help requests, reviewing handoff notifications. ' +
      '\n\n' +
      'When NOT to use: For reading team channel messages, use read_messages instead. ' +
      '\n\n' +
      'Prerequisites: You must be registered (warp_registry_register) to have an inbox. ' +
      '\n\n' +
      'Examples:\n' +
      '- Read all: {} - Get up to 10 most recent messages (default)\n' +
      '- Filter by type: { messageType: "help-request", limit: 20 } - Get help requests\n' +
      '- Filter by sender: { senderGuid: "550e8400-...", limit: 5 } - Messages from specific agent\n' +
      '- Continue reading: { cursor: "..." } - Fetch next batch when hasMore is true',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of messages to return (default: 10, max: 100)',
          minimum: 1,
          maximum: 100,
        },
        cursor: {
          type: 'string',
          description: 'Optional pagination cursor to continue reading inbox (returned when hasMore is true)',
        },
        messageType: {
          type: 'string',
          description: 'Filter by message type (e.g., "text", "work-offer", "work-claim")',
        },
        senderGuid: {
          type: 'string',
          description: 'Filter by sender GUID (UUID v4 format)',
        },
      },
    },
  },
  {
    name: 'warp_work_broadcast',
    description:
      'Broadcast a work offer to the capability-based work queue for task distribution. ' +
      'Work items are published to a capability-specific queue and distributed to available agents (first to claim wins). ' +
      'Use this for parallel task distribution, load balancing, and opportunistic work when you don\'t care WHO does it, just that they HAVE the required capability. ' +
      '\n\n' +
      'When to use: Distributing parallel implementation tasks ("implement tool-1", "implement tool-2"), ' +
      'load balancing test execution ("run test scenarios 1-10"), ' +
      'offering opportunistic work ("review README.md"), ' +
      'delegating to subagents in multi-agent coordination. ' +
      '\n\n' +
      'When NOT to use: For team announcements or status updates, use send_message with a channel. ' +
      'For coordinating with a specific known agent, use warp_messages_send_direct. ' +
      'See docs/COMMUNICATION_DECISION_GUIDE.md for detailed comparison. ' +
      '\n\n' +
      'Prerequisites: You must be registered (warp_registry_register) before broadcasting work. ' +
      '\n\n' +
      'Important: Once claimed, work is permanently removed from queue (not reassigned on failure). ' +
      'Failed items after max delivery attempts go to dead letter queue (see warp_dlq_list). ' +
      '\n\n' +
      'Examples:\n' +
      '- Parallel tasks: { taskId: "impl-tool-1", description: "Implement assess_task_complexity", requiredCapability: "typescript", priority: 8 }\n' +
      '- Load balancing: { taskId: "test-batch-1", description: "Run integration tests 1-10", requiredCapability: "testing" }\n' +
      '- With deadline: { taskId: "docs", description: "Review API docs", requiredCapability: "documentation", deadline: "2025-12-20T23:59:59Z" }',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Application-defined task identifier (e.g., "task-123", "bug-456")',
        },
        description: {
          type: 'string',
          description: 'Human-readable description of the task',
        },
        requiredCapability: {
          type: 'string',
          description: 'Required capability for this task (e.g., "typescript", "code-review", "testing")',
        },
        priority: {
          type: 'number',
          description: 'Priority level from 1-10, where 10 is highest (default: 5)',
          minimum: 1,
          maximum: 10,
        },
        deadline: {
          type: 'string',
          description: 'Optional ISO 8601 deadline for task completion (e.g., "2024-12-31T23:59:59Z")',
        },
        contextData: {
          type: 'object',
          description: 'Optional application-specific context data for the task',
          additionalProperties: true,
        },
        scope: {
          type: 'string',
          enum: ['private', 'personal', 'team', 'public'],
          description: 'Scope of work item: determines which agents can claim it (default: "team")',
        },
      },
      required: ['taskId', 'description', 'requiredCapability'],
    },
  },
  {
    name: 'warp_work_claim',
    description:
      'Claim work from a capability-based work queue created by warp_work_broadcast. ' +
      'Fetches the next available work item for the specified capability (first to claim wins). ' +
      'Once claimed, the work item is permanently removed from queue and you are responsible for completing it. ' +
      '\n\n' +
      'When to use: Looking for available work matching your capabilities, ' +
      'claiming distributed implementation tasks, picking up test execution work, ' +
      'participating in multi-agent swarm coordination. ' +
      '\n\n' +
      'When NOT to use: For broadcasting work to other agents, use warp_work_broadcast instead. This tool is for consuming work, not offering it. ' +
      '\n\n' +
      'Prerequisites: You must warp_registry_register with the required capability. Use warp_registry_update_presence to add capabilities if needed. ' +
      '\n\n' +
      'IMPORTANT: Work is NOT reassigned on failure (permanently removed when claimed). ' +
      'Failed work may eventually appear in dead letter queue (see warp_dlq_list, warp_dlq_retry). ' +
      '\n\n' +
      'Examples:\n' +
      '- Claim work: { capability: "typescript" } - Wait up to 5 sec (default) for TypeScript work\n' +
      '- Quick check: { capability: "testing", timeout: 1000 } - Wait 1 sec for testing work\n' +
      '- Longer wait: { capability: "documentation", timeout: 30000 } - Wait 30 sec (max)',
    inputSchema: {
      type: 'object',
      properties: {
        capability: {
          type: 'string',
          description: 'The capability to claim work for (e.g., "typescript", "code-review", "testing")',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time in milliseconds to wait for work (default: 5000, max: 30000)',
          minimum: 100,
          maximum: 30000,
        },
      },
      required: ['capability'],
    },
  },
  {
    name: 'warp_work_list',
    description:
      'List available work items from a capability-based work queue WITHOUT claiming them (non-destructive preview). ' +
      'Preview work items to make informed decisions before claiming. Unlike warp_work_claim, this does not remove items from the queue. ' +
      'Supports filtering by priority and deadline. Returns truncation metadata when results are limited. ' +
      '\n\n' +
      'When to use: Previewing available work before committing, ' +
      'checking work priority to decide what to claim next, ' +
      'monitoring work queue health, ' +
      'verifying work was broadcast successfully. ' +
      '\n\n' +
      'When NOT to use: If you want to claim and start work immediately, use warp_work_claim instead (which removes the item). ' +
      'For getting just the count of pending items without details, this is still useful but getPendingWorkCount would be more efficient if we exposed it. ' +
      '\n\n' +
      'Prerequisites: None required - any agent can preview work queues. ' +
      '\n\n' +
      'Examples:\n' +
      '- Preview all: { capability: "typescript" } - Show up to 20 items (default)\n' +
      '- High priority: { capability: "testing", minPriority: 8 } - Only priority 8-10\n' +
      '- Urgent: { capability: "code-review", deadlineBefore: "2025-12-23T23:59:59Z" } - Deadline before date\n' +
      '- More results: { capability: "documentation", limit: 50 } - Show up to 50 items',
    inputSchema: {
      type: 'object',
      properties: {
        capability: {
          type: 'string',
          description: 'The capability to list work for (e.g., "typescript", "code-review", "testing")',
        },
        minPriority: {
          type: 'number',
          description: 'Filter by minimum priority (1-10). Only show items with priority >= this value',
          minimum: 1,
          maximum: 10,
        },
        maxPriority: {
          type: 'number',
          description: 'Filter by maximum priority (1-10). Only show items with priority <= this value',
          minimum: 1,
          maximum: 10,
        },
        deadlineBefore: {
          type: 'string',
          description: 'Filter by deadline before this ISO 8601 timestamp (e.g., "2025-12-31T23:59:59Z")',
        },
        deadlineAfter: {
          type: 'string',
          description: 'Filter by deadline after this ISO 8601 timestamp (e.g., "2025-01-01T00:00:00Z")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of items to return (default: 20, max: 100)',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['capability'],
    },
  },
  {
    name: 'warp_work_queue_status',
    description:
      'Get status and health metrics for work queues. ' +
      'Shows pending work count per capability queue without claiming items. ' +
      'Use this to monitor queue backlogs, identify stuck queues, or check if work was successfully broadcast. ' +
      '\n\n' +
      'When to use: Monitoring queue health across all capabilities, ' +
      'checking if warp_work_broadcast succeeded, ' +
      'identifying capability queues with backlog, ' +
      'understanding system load distribution. ' +
      '\n\n' +
      'When NOT to use: If you want to see actual work item details, use warp_work_list instead. ' +
      'This tool only shows counts, not work item contents. ' +
      '\n\n' +
      'Prerequisites: None required - any agent can check queue status. ' +
      '\n\n' +
      'Examples:\n' +
      '- Specific queue: { capability: "typescript" } - Check TypeScript queue depth\n' +
      '- All queues: {} - Get status for all capability queues (shows only non-empty)',
    inputSchema: {
      type: 'object',
      properties: {
        capability: {
          type: 'string',
          description: 'Optional: specific capability to check. If omitted, returns status for all queues with pending work',
        },
      },
    },
  },
  {
    name: 'warp_dlq_list',
    description:
      'List items in the dead letter queue (DLQ) - work that failed after maximum delivery attempts (v0.4.0+ with pagination). ' +
      'Use this to inspect failed work, identify patterns, and decide whether to retry or discard. ' +
      'Results include failure reason, attempt count, errors, and original work item details. ' +
      '\n\n' +
      'When to use: Inspecting failed work items, debugging why tasks are failing, ' +
      'identifying work to retry after fixing issues, monitoring queue health. ' +
      '\n\n' +
      'Examples:\n' +
      '- All failures: {} - List all DLQ items (default limit 20)\n' +
      '- By capability: { capability: "typescript" } - Only TypeScript task failures\n' +
      '- More results: { limit: 100 } - Get up to max 100 items\n' +
      '- Specific cap + limit: { capability: "testing", limit: 50 } - Testing failures only\n' +
      '- Paginate: { limit: 20, cursor: "..." } - Page through results',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of items to return (default: 20, max: 100)',
          minimum: 1,
          maximum: 100,
        },
        cursor: {
          type: 'string',
          description: 'Optional pagination cursor from previous response to fetch next page',
        },
        capability: {
          type: 'string',
          description: 'Filter by capability (e.g., "typescript", "code-review")',
        },
      },
    },
  },
  {
    name: 'warp_dlq_retry',
    description:
      'Retry a dead letter queue item by moving it back to the work queue for another attempt. ' +
      'Use this after fixing the issue that caused the work to fail. ' +
      'Optionally reset attempt counter to give it a completely fresh start (recommended after fixing root cause). ' +
      '\n\n' +
      'When to use: After fixing bugs that caused work failures, when transient issues have been resolved, ' +
      'when you want to give failed work another chance with updated infrastructure. ' +
      '\n\n' +
      'Examples:\n' +
      '- Retry: { itemId: "550e8400-e29b-41d4-a716-446655440000" } - Retry with existing attempt count\n' +
      '- Fresh start: { itemId: "550e8400-...", resetAttempts: true } - Reset to 0 attempts (use after bug fix)',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: {
          type: 'string',
          description: 'DLQ item ID (UUID format) to retry',
        },
        resetAttempts: {
          type: 'boolean',
          description: 'Reset the attempt counter to 0 (default: false)',
        },
      },
      required: ['itemId'],
    },
  },
  {
    name: 'warp_dlq_discard',
    description:
      'Permanently delete a dead letter queue item - cannot be undone. ' +
      'Use this when work is no longer needed, unfixable, or obsolete. ' +
      'This removes the item completely from the DLQ (cannot be recovered). ' +
      '\n\n' +
      'When to use: Removing obsolete work that\'s no longer relevant, ' +
      'discarding work that cannot be fixed, cleaning up DLQ after failed experiments. ' +
      '\n\n' +
      'When NOT to use: If work might be retryable after fixes, use warp_dlq_retry instead. ' +
      '\n\n' +
      'Examples:\n' +
      '- Discard: { itemId: "550e8400-e29b-41d4-a716-446655440000" } - Permanently delete this DLQ item',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: {
          type: 'string',
          description: 'DLQ item ID (UUID format) to discard',
        },
      },
      required: ['itemId'],
    },
  },
];

/**
 * Generate a handle from agent type if no handle is set
 */
function generateHandle(agentType: string): string {
  // Convert to lowercase and replace spaces/underscores with hyphens
  const base = agentType.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
  return base || 'agent';
}

/**
 * Check if an agent with the same handle exists and is offline
 * Returns the existing GUID if we should reuse it, null otherwise
 */
async function findReusableAgent(
  handle: string,
  projectId: string,
  hostnameStr: string
): Promise<string | null> {
  try {
    const entries = await listRegistryEntries((entry) => {
      return (
        entry.handle === handle &&
        entry.projectId === projectId &&
        entry.hostname === hostnameStr &&
        entry.status === 'offline'
      );
    });

    if (entries.length > 0) {
      // Reuse the first matching offline agent
      logger.info('Found offline agent with same handle, reusing GUID', {
        guid: entries[0]!.guid,
        handle,
      });
      return entries[0]!.guid;
    }

    return null;
  } catch (err) {
    const error = err as Error;
    logger.warn('Failed to check for reusable agent', { error: error.message });
    return null;
  }
}

/**
 * Handle warp_registry_register tool
 */
export async function handleRegisterAgent(
  args: Record<string, unknown>,
  state: SessionState,
  config: ResolvedConfig
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const agentType = args['agentType'] as string;
  const capabilities = (args['capabilities'] as string[] | undefined) ?? [];

  // Handle scope parameter (new unified model) - default to 'team'
  let scope: LoominalScope = 'team';
  if (args['scope']) {
    scope = args['scope'] as LoominalScope;
  } else if (args['visibility']) {
    // Migrate legacy visibility parameter
    const legacyVisibility = args['visibility'] as 'private' | 'project-only' | 'user-only' | 'public';
    const migratedScope = migrateLegacyVisibility(legacyVisibility);
    if (migratedScope) {
      scope = migratedScope;
      logger.warn('Using deprecated visibility parameter, migrating to scope', {
        visibility: legacyVisibility,
        scope: migratedScope,
      });
    }
  }

  // Validate agent type
  if (!agentType || agentType.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: agentType cannot be empty' }],
      isError: true,
    };
  }

  // Auto-set handle if not already set
  let handle = state.handle;
  if (!handle) {
    handle = generateHandle(agentType);
    const validationError = validateHandle(handle);
    if (validationError) {
      return {
        content: [{ type: 'text', text: `Error: Generated handle is invalid: ${validationError}` }],
        isError: true,
      };
    }
    state.handle = handle;
    logger.info('Auto-generated handle from agentType', { handle, agentType });
  }

  // Auto-detect environment details
  const hostnameStr = hostname();
  const username = process.env['USER'] || process.env['USERNAME'];
  const natsUrl = config.natsUrl;
  const projectId = config.projectId;

  // Initialize registry if not already done
  try {
    await initializeRegistry();
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to initialize registry', { error: error.message });
    return {
      content: [{ type: 'text', text: `Error: Failed to initialize registry: ${error.message}` }],
      isError: true,
    };
  }

  // Use identity-derived agent ID if available, otherwise check for reusable GUID
  let guid: string;
  if (state.identity) {
    // Use stable identity-derived agent ID
    guid = state.identity.agentId;
    logger.info('Using identity-derived agent ID', {
      agentId: guid,
      isSubagent: state.identity.isSubagent,
    });
  } else {
    // Fallback to reusable GUID logic (for backward compatibility)
    const reusableGuid = await findReusableAgent(handle, projectId, hostnameStr);
    if (reusableGuid) {
      guid = reusableGuid;
      logger.info('Reusing existing offline agent GUID', { guid });
    } else {
      // Generate new random GUID as last resort
      guid = randomUUID();
      logger.warn('No identity available, generated random GUID', { guid });
    }
  }

  // Build entry params, conditionally including username
  const entryParams = {
    agentType,
    handle,
    hostname: hostnameStr,
    projectId,
    natsUrl,
    capabilities,
    scope,
    ...(username ? { username } : {}),
  };

  // Create entry with the determined GUID
  let entry = createRegistryEntry(entryParams);
  entry = { ...entry, guid };

  // Publish to KV store
  try {
    await putRegistryEntry(entry.guid, entry);
    logger.info('Agent registered', { guid: entry.guid, handle, agentType });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to publish registry entry', { error: error.message });
    return {
      content: [
        { type: 'text', text: `Error: Failed to publish to registry: ${error.message}` },
      ],
      isError: true,
    };
  }

  // Update session state
  state.agentGuid = entry.guid;
  state.registeredEntry = entry;

  // Start automated heartbeat
  // Stop any existing heartbeat first
  if (heartbeatCleanup) {
    heartbeatCleanup();
  }

  heartbeatCleanup = startHeartbeat(entry.guid, {
    intervalMs: 60000, // 60 seconds
    onError: (error) => {
      logger.warn('Heartbeat error', { guid: entry.guid, error: error.message });
    },
  });

  logger.info('Heartbeat started for agent', { guid: entry.guid });

  // Create inbox stream and subscribe
  try {
    // Stop any existing inbox subscription first
    if (inboxUnsubscribe) {
      await inboxUnsubscribe();
      inboxUnsubscribe = null;
    }

    // Create inbox stream
    await createInboxStream(entry.guid);
    logger.info('Inbox stream created for agent', { guid: entry.guid });

    // Subscribe to inbox (for now, just log received messages)
    inboxUnsubscribe = await subscribeToInbox(entry.guid, (message: InboxMessage) => {
      logger.info('Received inbox message', {
        id: message.id,
        senderGuid: message.senderGuid,
        senderHandle: message.senderHandle,
        messageType: message.messageType,
        content: message.content.substring(0, 100), // Log first 100 chars
      });
    });

    logger.info('Subscribed to inbox for agent', { guid: entry.guid });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to setup inbox', { guid: entry.guid, error: error.message });
    // Don't fail registration if inbox setup fails
  }

  // Build response message
  const identityNote = state.identity
    ? state.identity.isSubagent
      ? `Note: Using stable sub-agent ID (type: ${state.identity.subagentType})`
      : 'Note: Using stable root agent ID (derived from hostname + project path)'
    : 'Note: Using fallback GUID (identity system not initialized)';

  const summary = [
    'Agent registered successfully!',
    '',
    `GUID: ${entry.guid}`,
    `Handle: ${entry.handle}`,
    `Agent Type: ${entry.agentType}`,
    `Hostname: ${entry.hostname}`,
    `Project ID: ${entry.projectId}`,
    `Scope: ${entry.scope}`,
    `Capabilities: ${entry.capabilities.length > 0 ? entry.capabilities.join(', ') : 'none'}`,
    '',
    identityNote,
    '',
    'Heartbeat: Automatic heartbeat started (60 second interval)',
    `Inbox: Personal inbox created at subject global.agent.${entry.guid}`,
  ].join('\n');

  return {
    content: [{ type: 'text', text: summary }],
  };
}

/**
 * Stop the heartbeat (cleanup function)
 * Call this when shutting down the server
 */
export function cleanupHeartbeat(): void {
  if (heartbeatCleanup) {
    heartbeatCleanup();
    heartbeatCleanup = null;
  }
}

/**
 * Handle warp_registry_get_info tool
 */
export async function handleGetAgentInfo(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const guid = args['guid'] as string;

  // Validate GUID format
  const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!guid || !UUID_V4_PATTERN.test(guid)) {
    return {
      content: [{ type: 'text', text: 'Error: Invalid GUID format. Must be a valid UUID v4.' }],
      isError: true,
    };
  }

  // Require caller to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to view agent information. Use warp_registry_register first.',
        },
      ],
      isError: true,
    };
  }

  // Get requester context
  const requester: Requester = {
    guid: state.agentGuid,
    projectId: state.registeredEntry.projectId,
    ...(state.registeredEntry.username ? { username: state.registeredEntry.username } : {}),
  };

  // Retrieve the agent entry
  let entry: RegistryEntry | null;
  try {
    entry = await getRegistryEntry(guid);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to retrieve agent entry', { guid, error: error.message });
    return {
      content: [{ type: 'text', text: `Error: Failed to retrieve agent: ${error.message}` }],
      isError: true,
    };
  }

  // Check if entry exists
  if (!entry) {
    return {
      content: [{ type: 'text', text: 'Error: Agent not found or not visible to you.' }],
      isError: true,
    };
  }

  // Check visibility
  if (!isVisibleTo(entry, requester)) {
    return {
      content: [{ type: 'text', text: 'Error: Agent not found or not visible to you.' }],
      isError: true,
    };
  }

  // Redact sensitive fields
  const redactedEntry = redactEntry(entry, requester);

  // Build markdown response
  const lines = [`## Agent: ${entry.handle}`, '', '| Field | Value |', '|-------|-------|'];

  // Add fields that are present in redacted entry
  if (redactedEntry.guid) {
    lines.push(`| GUID | ${redactedEntry.guid} |`);
  }
  if (redactedEntry.agentType) {
    lines.push(`| Type | ${redactedEntry.agentType} |`);
  }
  if (redactedEntry.status) {
    lines.push(`| Status | ${redactedEntry.status} |`);
  }
  if (redactedEntry.hostname) {
    lines.push(`| Hostname | ${redactedEntry.hostname} |`);
  }
  if (redactedEntry.capabilities && redactedEntry.capabilities.length > 0) {
    lines.push(`| Capabilities | ${redactedEntry.capabilities.join(', ')} |`);
  } else if (redactedEntry.capabilities) {
    lines.push(`| Capabilities | none |`);
  }
  if (redactedEntry.scope) {
    lines.push(`| Scope | ${redactedEntry.scope} |`);
  }
  if (redactedEntry.lastHeartbeat) {
    lines.push(`| Last Heartbeat | ${redactedEntry.lastHeartbeat} |`);
  }
  if (redactedEntry.registeredAt) {
    lines.push(`| Registered At | ${redactedEntry.registeredAt} |`);
  }
  if (redactedEntry.currentTaskCount !== undefined) {
    lines.push(`| Current Tasks | ${redactedEntry.currentTaskCount} |`);
  }
  if (redactedEntry.projectId) {
    lines.push(`| Project ID | ${redactedEntry.projectId} |`);
  }
  if (redactedEntry.natsUrl) {
    lines.push(`| NATS URL | ${redactedEntry.natsUrl} |`);
  }
  if (redactedEntry.username) {
    lines.push(`| Username | ${redactedEntry.username} |`);
  }

  const summary = lines.join('\n');

  logger.debug('Retrieved agent info', { guid, handle: entry.handle });

  return {
    content: [{ type: 'text', text: summary }],
  };
}

/**
 * Handle warp_registry_update_presence tool
 */
export async function handleUpdatePresence(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Require caller to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to update presence. Use warp_registry_register first.',
        },
      ],
      isError: true,
    };
  }

  const status = args['status'] as 'online' | 'busy' | 'offline' | undefined;
  const currentTaskCount = args['currentTaskCount'] as number | undefined;
  const capabilities = args['capabilities'] as string[] | undefined;

  // Validate at least one field is provided
  if (status === undefined && currentTaskCount === undefined && capabilities === undefined) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: At least one field (status, currentTaskCount, or capabilities) must be provided',
        },
      ],
      isError: true,
    };
  }

  const guid = state.agentGuid;

  // Get current entry from KV store
  let currentEntry: RegistryEntry | null;
  try {
    currentEntry = await getRegistryEntry(guid);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to retrieve current registry entry', { guid, error: error.message });
    return {
      content: [
        { type: 'text', text: `Error: Failed to retrieve current entry: ${error.message}` },
      ],
      isError: true,
    };
  }

  if (!currentEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: Registry entry not found. You may need to re-register.',
        },
      ],
      isError: true,
    };
  }

  // Track changes for response
  const changes: string[] = [];

  // Update only provided fields
  const updatedEntry: RegistryEntry = {
    ...currentEntry,
    lastHeartbeat: new Date().toISOString(), // Always update lastHeartbeat
  };

  if (status !== undefined) {
    changes.push(`- Status: ${currentEntry.status} → ${status}`);
    updatedEntry.status = status;
  }

  if (currentTaskCount !== undefined) {
    changes.push(`- Current Tasks: ${currentEntry.currentTaskCount} → ${currentTaskCount}`);
    updatedEntry.currentTaskCount = currentTaskCount;
  }

  if (capabilities !== undefined) {
    const oldCaps = currentEntry.capabilities.join(', ') || 'none';
    const newCaps = capabilities.join(', ') || 'none';
    changes.push(`- Capabilities: [${oldCaps}] → [${newCaps}]`);
    updatedEntry.capabilities = capabilities;
  }

  changes.push(`- Last Heartbeat: ${updatedEntry.lastHeartbeat}`);

  // Put updated entry back to KV store
  try {
    await putRegistryEntry(guid, updatedEntry);
    logger.info('Updated presence', { guid, changes: changes.length });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to update registry entry', { guid, error: error.message });
    return {
      content: [{ type: 'text', text: `Error: Failed to update presence: ${error.message}` }],
      isError: true,
    };
  }

  // Update session state to match
  state.registeredEntry = updatedEntry;

  // If status is set to offline, stop the heartbeat
  if (status === 'offline') {
    if (heartbeatCleanup) {
      heartbeatCleanup();
      heartbeatCleanup = null;
      logger.info('Stopped heartbeat due to offline status', { guid });
    }
    stopHeartbeat();
  }

  // Build response message
  const summary = ['Presence updated:', '', ...changes].join('\n');

  return {
    content: [{ type: 'text', text: summary }],
  };
}

/**
 * Handle warp_registry_discover tool (v0.4.0+ with pagination)
 */
export async function handleDiscoverAgents(
  args: Record<string, unknown>,
  state: SessionState,
  _config: ResolvedConfig
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Require the caller to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must register first using warp_registry_register before discovering other agents',
        },
      ],
      isError: true,
    };
  }

  // Parse pagination parameters (default: 20 per page, max: 100)
  const { offset, limit } = parsePaginationArgs(args, 20, 100);

  const agentType = args['agentType'] as string | undefined;
  const capability = args['capability'] as string | undefined;
  const hostnameFilter = args['hostname'] as string | undefined;
  const projectId = args['projectId'] as string | undefined;
  const status = args['status'] as 'online' | 'busy' | 'offline' | undefined;
  const scopeFilter = args['scope'] as LoominalScope | undefined;
  const includeOffline = (args['includeOffline'] as boolean | undefined) ?? false;

  // Initialize registry if not already done
  try {
    await initializeRegistry();
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to initialize registry', { error: error.message });
    return {
      content: [{ type: 'text', text: `Error: Failed to initialize registry: ${error.message}` }],
      isError: true,
    };
  }

  // Get requester context
  const requester: Requester = {
    projectId: state.registeredEntry.projectId,
    guid: state.registeredEntry.guid,
    ...(state.registeredEntry.username ? { username: state.registeredEntry.username } : {}),
  };

  // List all entries
  let entries: RegistryEntry[];
  try {
    entries = await listRegistryEntries();
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to list registry entries', { error: error.message });
    return {
      content: [
        { type: 'text', text: `Error: Failed to list registry entries: ${error.message}` },
      ],
      isError: true,
    };
  }

  // Apply filters
  let filteredEntries = entries;

  // Filter by agentType
  if (agentType) {
    filteredEntries = filteredEntries.filter((entry) => entry.agentType === agentType);
  }

  // Filter by capability
  if (capability) {
    filteredEntries = filteredEntries.filter((entry) =>
      entry.capabilities.includes(capability)
    );
  }

  // Filter by hostname
  if (hostnameFilter) {
    filteredEntries = filteredEntries.filter((entry) => entry.hostname === hostnameFilter);
  }

  // Filter by projectId
  if (projectId) {
    filteredEntries = filteredEntries.filter((entry) => entry.projectId === projectId);
  }

  // Filter by status
  if (status) {
    filteredEntries = filteredEntries.filter((entry) => entry.status === status);
  }

  // Filter by scope
  if (scopeFilter) {
    filteredEntries = filteredEntries.filter((entry) => entry.scope === scopeFilter);
  }

  // Exclude offline agents by default
  if (!includeOffline) {
    filteredEntries = filteredEntries.filter((entry) => entry.status !== 'offline');
  }

  // Apply visibility filtering and redaction
  const visibleEntries = filteredEntries
    .filter((entry) => isVisibleTo(entry, requester))
    .map((entry) => redactEntry(entry, requester));

  // Sort by lastHeartbeat descending (most recent first)
  visibleEntries.sort((a, b) => {
    const aTime = a.lastHeartbeat ? new Date(a.lastHeartbeat).getTime() : 0;
    const bTime = b.lastHeartbeat ? new Date(b.lastHeartbeat).getTime() : 0;
    return bTime - aTime;
  });

  const total = visibleEntries.length;

  // Apply pagination
  const paginatedEntries = visibleEntries.slice(offset, offset + limit);

  // Build response
  if (paginatedEntries.length === 0 && offset === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No agents found matching the specified criteria.',
        },
      ],
    };
  }

  if (paginatedEntries.length === 0 && offset > 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No more agents available. Total: ${total}`,
        },
      ],
    };
  }

  // Create pagination metadata
  const pagination = createPaginationMetadata({
    count: paginatedEntries.length,
    total,
    offset,
    limit,
  });

  // Format response as markdown
  const lines = [
    `Found ${paginatedEntries.length} of ${total} agent${total === 1 ? '' : 's'}:`,
    '',
  ];

  for (const entry of paginatedEntries) {
    lines.push(`**${entry.handle}** (${entry.agentType})`);
    lines.push(`- GUID: ${entry.guid}`);
    lines.push(`- Status: ${entry.status}`);
    if (entry.capabilities && entry.capabilities.length > 0) {
      lines.push(`- Capabilities: [${entry.capabilities.join(', ')}]`);
    }
    if (entry.lastHeartbeat) {
      lines.push(`- Last seen: ${entry.lastHeartbeat}`);
    }
    if (entry.hostname) {
      lines.push(`- Hostname: ${entry.hostname}`);
    }
    if (entry.projectId) {
      lines.push(`- Project ID: ${entry.projectId}`);
    }
    if (entry.currentTaskCount !== undefined) {
      lines.push(`- Current tasks: ${entry.currentTaskCount}`);
    }
    lines.push('');
  }

  // Add pagination footer
  lines.push('---');
  lines.push(`Showing ${pagination.count} of ${pagination.total} agents`);

  if (pagination.hasMore) {
    lines.push(`\nTo see more agents, use: { cursor: "${pagination.nextCursor}" }`);
  }

  logger.debug('Agents discovered', {
    count: pagination.count,
    total: pagination.total,
    offset,
    limit,
    hasMore: pagination.hasMore,
  });

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
  };
}

/**
 * Handle warp_registry_deregister tool
 */
export async function handleDeregisterAgent(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Require caller to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to deregister. Use warp_registry_register first.',
        },
      ],
      isError: true,
    };
  }

  const guid = state.agentGuid;
  const handle = state.registeredEntry.handle;

  // Stop heartbeat
  logger.info('Stopping heartbeat for agent', { guid });
  if (heartbeatCleanup) {
    heartbeatCleanup();
    heartbeatCleanup = null;
  }
  stopHeartbeat();

  // Unsubscribe from inbox
  logger.info('Unsubscribing from inbox for agent', { guid });
  try {
    if (inboxUnsubscribe) {
      await inboxUnsubscribe();
      inboxUnsubscribe = null;
    }
    await unsubscribeFromInbox();
  } catch (err) {
    const error = err as Error;
    logger.warn('Error unsubscribing from inbox', { guid, error: error.message });
    // Continue with deregistration even if unsubscribe fails
  }

  // Get current entry from KV store
  let entry: RegistryEntry | null;
  try {
    entry = await getRegistryEntry(guid);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to retrieve agent entry for deregistration', { guid, error: error.message });
    return {
      content: [{ type: 'text', text: `Error: Failed to retrieve agent entry: ${error.message}` }],
      isError: true,
    };
  }

  if (!entry) {
    return {
      content: [{ type: 'text', text: 'Error: Agent entry not found in registry.' }],
      isError: true,
    };
  }

  // Update entry to offline status
  const updatedEntry: RegistryEntry = {
    ...entry,
    status: 'offline',
  };

  // Store updated entry back to KV
  try {
    await putRegistryEntry(guid, updatedEntry);
    logger.info('Agent deregistered', { guid, handle });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to update registry entry to offline', { guid, error: error.message });
    return {
      content: [
        { type: 'text', text: `Error: Failed to update registry entry: ${error.message}` },
      ],
      isError: true,
    };
  }

  // Clear session state
  state.agentGuid = null;
  state.registeredEntry = null;

  // Build response message
  const summary = [
    'Agent deregistered successfully.',
    '',
    `- GUID: ${guid}`,
    `- Handle: ${handle}`,
    `- Status: offline`,
    `- Heartbeat: stopped`,
    `- Inbox: unsubscribed`,
  ].join('\n');

  return {
    content: [{ type: 'text', text: summary }],
  };
}

/**
 * Handle warp_messages_send_direct tool
 */
export async function handleSendDirectMessage(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const recipientGuid = args['recipientGuid'] as string;
  const message = args['message'] as string;
  const messageType = (args['messageType'] as string | undefined) ?? 'text';
  const metadata = (args['metadata'] as Record<string, unknown> | undefined) ?? undefined;

  // Validate UUID format
  const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!recipientGuid || !UUID_V4_PATTERN.test(recipientGuid)) {
    return {
      content: [{ type: 'text', text: 'Error: Invalid recipientGuid format. Must be a valid UUID v4.' }],
      isError: true,
    };
  }

  // Require sender to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to send messages. Use warp_registry_register first.',
        },
      ],
      isError: true,
    };
  }

  // Look up recipient in registry
  let recipientEntry: RegistryEntry | null;
  try {
    recipientEntry = await getRegistryEntry(recipientGuid);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to retrieve recipient entry', { recipientGuid, error: error.message });
    return {
      content: [{ type: 'text', text: `Error: Failed to retrieve recipient: ${error.message}` }],
      isError: true,
    };
  }

  // Check if recipient exists
  if (!recipientEntry) {
    return {
      content: [{ type: 'text', text: 'Error: Recipient not found in registry.' }],
      isError: true,
    };
  }

  // Warn if recipient is offline or busy (but don't error)
  const recipientStatus = recipientEntry.status;
  const isRecipientOffline = recipientStatus === 'offline';
  const isRecipientBusy = recipientStatus === 'busy';

  // Construct inbox message payload
  const inboxMessage: InboxMessage = {
    id: randomUUID(),
    senderGuid: state.agentGuid,
    senderHandle: state.registeredEntry.handle,
    recipientGuid: recipientGuid,
    messageType: messageType,
    content: message,
    ...(metadata ? { metadata } : {}),
    timestamp: new Date().toISOString(),
  };

  // Get recipient's inbox subject
  const inboxSubject = getInboxSubject(recipientGuid);

  // Publish message to JetStream
  try {
    const js = getJetStreamClient();
    await js.publish(inboxSubject, JSON.stringify(inboxMessage));

    logger.info('Direct message sent', {
      messageId: inboxMessage.id,
      senderGuid: state.agentGuid,
      recipientGuid: recipientGuid,
      messageType: messageType,
      recipientStatus: recipientStatus,
    });

    // Build response with warning if needed
    let summary: string;
    if (isRecipientOffline) {
      summary = [
        'Message sent (recipient may be offline)',
        '',
        `- Message ID: ${inboxMessage.id}`,
        `- To: ${recipientEntry.handle} (${recipientGuid})`,
        `- Type: ${messageType}`,
        `- Recipient Status: offline`,
        `- Note: Message queued for delivery`,
      ].join('\n');
    } else if (isRecipientBusy) {
      summary = [
        'Message sent (recipient is busy)',
        '',
        `- Message ID: ${inboxMessage.id}`,
        `- To: ${recipientEntry.handle} (${recipientGuid})`,
        `- Type: ${messageType}`,
        `- Recipient Status: busy`,
        `- Note: Message delivered to inbox`,
      ].join('\n');
    } else {
      summary = [
        'Message sent successfully!',
        '',
        `- Message ID: ${inboxMessage.id}`,
        `- To: ${recipientEntry.handle} (${recipientGuid})`,
        `- Type: ${messageType}`,
        `- Status: delivered`,
      ].join('\n');
    }

    return {
      content: [{ type: 'text', text: summary }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to send direct message', {
      recipientGuid,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: Failed to send message: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle warp_messages_read_direct tool (v0.4.0+ with pagination)
 */
export async function handleReadDirectMessages(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Parse pagination parameters (default: 10 per page, max: 100)
  const { limit } = parsePaginationArgs(args, 10, 100);
  const messageType = args['messageType'] as string | undefined;
  const senderGuid = args['senderGuid'] as string | undefined;

  // Validate senderGuid format if provided
  const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (senderGuid && !UUID_V4_PATTERN.test(senderGuid)) {
    return {
      content: [{ type: 'text', text: 'Error: Invalid senderGuid format. Must be a valid UUID v4.' }],
      isError: true,
    };
  }

  // Require reader to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to read messages. Use warp_registry_register first.',
        },
      ],
      isError: true,
    };
  }

  const readerGuid = state.agentGuid;
  const streamName = `INBOX_${readerGuid.replace(/-/g, '_')}`;

  try {
    const jsm = getJetStreamManager();
    const js = getJetStreamClient();

    const consumerName = getInboxConsumerName(state.agentGuid);

    // Check if inbox stream exists
    try {
      await jsm.streams.info(streamName);
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: 'No direct messages in your inbox.',
          },
        ],
      };
    }

    // Get the durable consumer for this inbox
    const consumer = await js.consumers.get(streamName, consumerName);

    // Fetch messages - fetch limit + 1 to detect if there are more
    const messages: InboxMessage[] = [];
    const messagesToAck: Array<{ ack: () => void }> = [];
    let hasMore = false;

    try {
      // Fetch extra to handle filtering and detect pagination
      const fetchLimit = (limit + 1) * 2; // Account for filtering
      const iter = await consumer.fetch({ max_messages: fetchLimit });

      for await (const msg of iter) {
        try {
          // Parse message payload
          const payload = JSON.parse(msg.data.toString()) as InboxMessage;

          // Apply filters
          let matches = true;

          if (messageType && payload.messageType !== messageType) {
            matches = false;
          }

          if (senderGuid && payload.senderGuid !== senderGuid) {
            matches = false;
          }

          if (matches) {
            messages.push(payload);
            messagesToAck.push(msg);

            // If we've got more than limit, we know there are more messages
            if (messages.length > limit) {
              hasMore = true;
              break;
            }
          } else {
            // Acknowledge filtered messages so they don't appear again
            msg.ack();
          }
        } catch (parseErr) {
          const error = parseErr as Error;
          logger.error('Error parsing inbox message', { error: error.message });
          // Acknowledge bad messages so they don't get stuck
          msg.ack();
        }
      }
    } catch (err) {
      const error = err as Error;
      // Handle "no messages" case gracefully
      if (error.message?.includes('no messages') || error.message?.includes('timeout')) {
        return {
          content: [
            {
              type: 'text',
              text: 'No direct messages in your inbox.',
            },
          ],
        };
      }
      throw err;
    }

    // If no messages found
    if (messages.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No direct messages in your inbox.',
          },
        ],
      };
    }

    // If we have more than limit, keep only limit messages
    const messagesToReturn = messages.slice(0, limit);
    const messagesToAckFinal = messagesToAck.slice(0, limit);

    // Acknowledge all matched messages that we're returning
    for (const msg of messagesToAckFinal) {
      msg.ack();
    }

    // Sort messages by timestamp (chronological order)
    messagesToReturn.sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime();
      const bTime = new Date(b.timestamp).getTime();
      return aTime - bTime;
    });

    // Create pagination metadata
    const pagination = createPaginationMetadata({
      count: messagesToReturn.length,
      offset: 0, // Inbox is consume-once, no meaningful offset
      limit,
    });

    // Override hasMore based on actual fetch results
    pagination.hasMore = hasMore;
    // Provide a simple continuation cursor if there are more messages
    if (hasMore) {
      pagination.nextCursor = 'continue';
    } else {
      pagination.nextCursor = null;
    }

    // Build markdown response
    const lines = [
      `## Direct Messages (${messagesToReturn.length} message${messagesToReturn.length === 1 ? '' : 's'})`,
      '',
    ];

    for (const message of messagesToReturn) {
      lines.push('---');
      lines.push(`**From:** ${message.senderHandle} (${message.senderGuid})`);
      lines.push(`**Type:** ${message.messageType}`);
      lines.push(`**Time:** ${message.timestamp}`);
      lines.push('');
      lines.push(message.content);
      lines.push('');
    }

    // Add pagination footer
    if (pagination.hasMore) {
      lines.push('---');
      lines.push(`\n**More messages available.** To continue reading, use: { cursor: "${pagination.nextCursor}" }`);
    }

    logger.info('Read direct messages', {
      guid: readerGuid,
      count: messagesToReturn.length,
      hasMore: pagination.hasMore,
      messageType,
      senderGuid,
    });

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to read direct messages', {
      guid: readerGuid,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: Failed to read messages: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle warp_work_broadcast tool
 */
export async function handleBroadcastWorkOffer(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const taskId = args['taskId'] as string;
  const description = args['description'] as string;
  const requiredCapability = args['requiredCapability'] as string;
  const priority = (args['priority'] as number | undefined) ?? 5;
  const deadline = args['deadline'] as string | undefined;
  const contextData = args['contextData'] as Record<string, unknown> | undefined;
  const scope: LoominalScope = (args['scope'] as LoominalScope | undefined) ?? 'team';

  // Validate required fields
  if (!taskId || taskId.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: taskId is required and cannot be empty' }],
      isError: true,
    };
  }

  if (!description || description.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: description is required and cannot be empty' }],
      isError: true,
    };
  }

  if (!requiredCapability || requiredCapability.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: requiredCapability is required and cannot be empty' }],
      isError: true,
    };
  }

  // Validate priority range
  if (priority < 1 || priority > 10) {
    return {
      content: [{ type: 'text', text: 'Error: priority must be between 1 and 10' }],
      isError: true,
    };
  }

  // Require sender to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to broadcast work offers. Use warp_registry_register first.',
        },
      ],
      isError: true,
    };
  }

  // Create work item
  const workItem: WorkItem = {
    id: randomUUID(),
    taskId: taskId,
    capability: requiredCapability,
    description: description,
    priority: priority,
    offeredBy: state.agentGuid,
    offeredAt: new Date().toISOString(),
    attempts: 0,
    scope: scope,
  };

  // Add optional fields
  if (deadline) {
    workItem.deadline = deadline;
  }

  if (contextData) {
    workItem.contextData = contextData;
  }

  // Create work queue stream if it doesn't exist
  try {
    await createWorkQueueStream(requiredCapability);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to create work queue stream', {
      capability: requiredCapability,
      error: error.message,
    });
    return {
      content: [
        { type: 'text', text: `Error: Failed to create work queue: ${error.message}` },
      ],
      isError: true,
    };
  }

  // Publish work item to queue
  try {
    const workItemId = await publishWorkItem(workItem);
    const queueSubject = getWorkQueueSubject(requiredCapability);

    logger.info('Work offer broadcast successfully', {
      workItemId,
      taskId,
      capability: requiredCapability,
      priority,
      offeredBy: state.agentGuid,
    });

    // Build response message
    const summary = [
      'Work offer published successfully!',
      '',
      `- Work Item ID: ${workItemId}`,
      `- Task ID: ${taskId}`,
      `- Capability: ${requiredCapability}`,
      `- Priority: ${priority}`,
      `- Published to: ${queueSubject}`,
      `- Offered by: ${state.registeredEntry.handle} (${state.agentGuid})`,
    ];

    if (deadline) {
      summary.push(`- Deadline: ${deadline}`);
    }

    if (contextData) {
      summary.push(`- Context Data: ${JSON.stringify(contextData)}`);
    }

    return {
      content: [{ type: 'text', text: summary.join('\n') }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to publish work offer', {
      taskId,
      capability: requiredCapability,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: Failed to publish work offer: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle warp_dlq_list tool (v0.4.0+ with pagination)
 */
export async function handleListDeadLetterItems(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Parse pagination parameters (default: 20 per page, max: 100)
  const { offset, limit } = parsePaginationArgs(args, 20, 100);
  const capability = args['capability'] as string | undefined;

  try {
    // List DLQ items - fetch more than needed to determine hasMore
    const fetchLimit = offset + limit + 1;
    const allItems = await listDeadLetterItems(
      capability !== undefined ? { capability, limit: fetchLimit } : { limit: fetchLimit }
    );

    const total = allItems.length;

    // Apply pagination
    const paginatedItems = allItems.slice(offset, offset + limit);

    // If no items found on first page
    if (paginatedItems.length === 0 && offset === 0) {
      return {
        content: [
          {
            type: 'text',
            text: capability
              ? `No dead letter items found for capability: ${capability}`
              : 'No dead letter items found',
          },
        ],
      };
    }

    // If no items on subsequent pages
    if (paginatedItems.length === 0 && offset > 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No more dead letter items available. Total: ${total}`,
          },
        ],
      };
    }

    // Create pagination metadata
    const pagination = createPaginationMetadata({
      count: paginatedItems.length,
      total: Math.min(total, fetchLimit), // Cap total at fetchLimit since we don't know if there are more
      offset,
      limit,
    });

    // Build markdown response
    const lines = [
      `## Dead Letter Queue (${paginatedItems.length} of ${total} item${total === 1 ? '' : 's'})`,
      '',
    ];

    for (const item of paginatedItems) {
      lines.push('---');
      lines.push(`**ID:** ${item.id}`);
      lines.push(`**Task:** ${item.workItem.taskId}`);
      lines.push(`**Capability:** ${item.workItem.capability}`);
      lines.push(`**Reason:** ${item.reason}`);
      lines.push(`**Attempts:** ${item.attempts}`);
      lines.push(`**Failed At:** ${item.failedAt}`);

      if (item.errors && item.errors.length > 0) {
        lines.push('**Errors:**');
        for (const error of item.errors) {
          lines.push(`- ${error}`);
        }
      }
      lines.push('');
    }

    // Add pagination footer
    lines.push('---');
    lines.push(`Showing ${pagination.count} of ${pagination.total} dead letter items`);

    if (pagination.hasMore) {
      lines.push(`\nTo see more items, use: { cursor: "${pagination.nextCursor}" }`);
    }

    logger.info('Listed dead letter items', {
      count: pagination.count,
      total: pagination.total,
      offset,
      limit,
      capability,
      hasMore: pagination.hasMore,
    });

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to list dead letter items', {
      capability,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: Failed to list DLQ items: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle warp_dlq_retry tool
 */
export async function handleRetryDeadLetterItem(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const itemId = args['itemId'] as string;
  const resetAttempts = (args['resetAttempts'] as boolean | undefined) ?? false;

  // Validate itemId
  if (!itemId || itemId.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: itemId is required and cannot be empty' }],
      isError: true,
    };
  }

  // Validate UUID format
  const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_V4_PATTERN.test(itemId)) {
    return {
      content: [{ type: 'text', text: 'Error: itemId must be a valid UUID v4 format' }],
      isError: true,
    };
  }

  try {
    // Retry the DLQ item
    await retryDeadLetterItem(itemId, resetAttempts);

    logger.info('Retried DLQ item', { itemId, resetAttempts });

    // Build response message
    const summary = [
      'Dead letter item moved back to work queue successfully!',
      '',
      `- Item ID: ${itemId}`,
      `- Attempts reset: ${resetAttempts ? 'yes' : 'no'}`,
      '',
      'The item has been republished to the work queue and can now be claimed by workers.',
    ].join('\n');

    return {
      content: [{ type: 'text', text: summary }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to retry DLQ item', {
      itemId,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle warp_dlq_discard tool
 */
export async function handleDiscardDeadLetterItem(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const itemId = args['itemId'] as string;

  // Validate itemId
  if (!itemId || itemId.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: itemId is required and cannot be empty' }],
      isError: true,
    };
  }

  // Validate UUID format
  const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_V4_PATTERN.test(itemId)) {
    return {
      content: [{ type: 'text', text: 'Error: itemId must be a valid UUID v4 format' }],
      isError: true,
    };
  }

  try {
    // Discard the DLQ item
    await discardDeadLetterItem(itemId);

    logger.info('Discarded DLQ item', { itemId });

    // Build response message
    const summary = [
      'Dead letter item permanently deleted.',
      '',
      `- Item ID: ${itemId}`,
      '',
      'This action cannot be undone. The work item has been permanently removed from the dead letter queue.',
    ].join('\n');

    return {
      content: [{ type: 'text', text: summary }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to discard DLQ item', {
      itemId,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle warp_work_claim tool
 */
export async function handleClaimWork(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const capability = args['capability'] as string;
  const timeout = Math.min((args['timeout'] as number | undefined) ?? 5000, 30000);

  // Validate required fields
  if (!capability || capability.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: capability is required and cannot be empty' }],
      isError: true,
    };
  }

  // Require agent to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to claim work. Use warp_registry_register first.',
        },
      ],
      isError: true,
    };
  }

  // Check if agent has the required capability
  const agentCapabilities = state.registeredEntry.capabilities || [];
  if (!agentCapabilities.includes(capability)) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: You do not have the "${capability}" capability registered. ` +
            `Your capabilities: [${agentCapabilities.join(', ')}]. ` +
            `Use warp_registry_update_presence to add capabilities, or register with the required capability.`,
        },
      ],
      isError: true,
    };
  }

  try {
    // Try to claim work from the queue
    const workItem = await claimWorkItem(capability, timeout);

    if (!workItem) {
      return {
        content: [
          {
            type: 'text',
            text: `No work available for capability "${capability}". The queue is empty or timed out waiting for work.`,
          },
        ],
      };
    }

    logger.info('Work claimed successfully', {
      workItemId: workItem.id,
      taskId: workItem.taskId,
      capability: workItem.capability,
      claimedBy: state.agentGuid,
    });

    // Build response message with full work item details
    const summary = [
      'Work item claimed successfully!',
      '',
      '## Work Item Details',
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Work Item ID | ${workItem.id} |`,
      `| Task ID | ${workItem.taskId} |`,
      `| Capability | ${workItem.capability} |`,
      `| Priority | ${workItem.priority ?? 5} |`,
      `| Description | ${workItem.description} |`,
      `| Offered By | ${workItem.offeredBy} |`,
      `| Offered At | ${workItem.offeredAt} |`,
      `| Attempts | ${workItem.attempts} |`,
    ];

    if (workItem.deadline) {
      summary.push(`| Deadline | ${workItem.deadline} |`);
    }

    if (workItem.contextData) {
      summary.push('', '## Context Data', '', '```json', JSON.stringify(workItem.contextData, null, 2), '```');
    }

    summary.push(
      '',
      '---',
      '',
      'You are now responsible for completing this work item. ' +
      'If you cannot complete it, the work will not be automatically reassigned (it has been removed from the queue).'
    );

    return {
      content: [{ type: 'text', text: summary.join('\n') }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to claim work', {
      capability,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: Failed to claim work: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle warp_work_list tool
 */
export async function handleListWork(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const capability = args['capability'] as string;
  const minPriority = args['minPriority'] as number | undefined;
  const maxPriority = args['maxPriority'] as number | undefined;
  const deadlineBefore = args['deadlineBefore'] as string | undefined;
  const deadlineAfter = args['deadlineAfter'] as string | undefined;
  const limit = Math.min(Math.max((args['limit'] as number | undefined) ?? 20, 1), 100);

  // Validate required fields
  if (!capability || capability.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: capability is required and cannot be empty' }],
      isError: true,
    };
  }

  // Validate priority ranges
  if (minPriority !== undefined && (minPriority < 1 || minPriority > 10)) {
    return {
      content: [{ type: 'text', text: 'Error: minPriority must be between 1 and 10' }],
      isError: true,
    };
  }

  if (maxPriority !== undefined && (maxPriority < 1 || maxPriority > 10)) {
    return {
      content: [{ type: 'text', text: 'Error: maxPriority must be between 1 and 10' }],
      isError: true,
    };
  }

  if (minPriority !== undefined && maxPriority !== undefined && minPriority > maxPriority) {
    return {
      content: [{ type: 'text', text: 'Error: minPriority cannot be greater than maxPriority' }],
      isError: true,
    };
  }

  try {
    // Build filters object (only include defined properties for exactOptionalPropertyTypes)
    const filters: ListWorkItemsFilters = { capability };
    if (minPriority !== undefined) filters.minPriority = minPriority;
    if (maxPriority !== undefined) filters.maxPriority = maxPriority;
    if (deadlineBefore !== undefined) filters.deadlineBefore = deadlineBefore;
    if (deadlineAfter !== undefined) filters.deadlineAfter = deadlineAfter;

    // List work items from queue
    const { items, total } = await listWorkItems(filters, limit);

    if (items.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No work items found for capability "${capability}". The queue is empty or all items were filtered out.`,
          },
        ],
      };
    }

    logger.info('Work items listed', {
      capability,
      showing: items.length,
      total,
      filtersApplied: {
        minPriority,
        maxPriority,
        deadlineBefore,
        deadlineAfter,
      },
    });

    // Build response with work item list
    const lines: string[] = [
      `Work items available for capability "${capability}":`,
      '',
      `Showing ${items.length} of ${total} total items`,
      '',
    ];

    // Add each work item
    items.forEach((item, index) => {
      lines.push(`### ${index + 1}. ${item.taskId}`);
      lines.push('');
      lines.push('| Field | Value |');
      lines.push('|-------|-------|');
      lines.push(`| Work Item ID | ${item.id} |`);
      lines.push(`| Description | ${item.description} |`);
      lines.push(`| Priority | ${item.priority ?? 5} |`);
      lines.push(`| Offered By | ${item.offeredBy} |`);
      lines.push(`| Offered At | ${item.offeredAt} |`);
      lines.push(`| Attempts | ${item.attempts} |`);

      if (item.deadline) {
        lines.push(`| Deadline | ${item.deadline} |`);
      }

      if (item.scope) {
        lines.push(`| Scope | ${item.scope} |`);
      }

      if (item.contextData && Object.keys(item.contextData).length > 0) {
        lines.push('');
        lines.push('**Context Data:**');
        lines.push('```json');
        lines.push(JSON.stringify(item.contextData, null, 2));
        lines.push('```');
      }

      lines.push('');
    });

    // Add truncation message if results were limited
    const showing = items.length;
    const truncated = showing < total;

    if (truncated) {
      const suggestions: string[] = [];
      if (!minPriority && !maxPriority) {
        suggestions.push('Filter by priority (minPriority/maxPriority)');
      }
      if (!deadlineBefore && !deadlineAfter) {
        suggestions.push('Filter by deadline (deadlineBefore/deadlineAfter)');
      }
      if (limit < 100) {
        suggestions.push(`Increase limit (current: ${limit}, max: 100)`);
      }

      const suggestion = suggestions.length > 0
        ? suggestions.join(', ')
        : 'Try more specific filters to narrow results';

      lines.push('---');
      lines.push(`**Note:** Results truncated. ${suggestion}`);
    }

    lines.push('');
    lines.push('Use `warp_work_claim` with this capability to claim the next available item from the queue.');

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to list work items', {
      capability,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: Failed to list work items: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle warp_work_queue_status tool
 */
export async function handleWorkQueueStatus(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const capability = args['capability'] as string | undefined;

  try {
    const jsm = getJetStreamManager();

    // If specific capability requested, check that queue
    if (capability) {
      const streamName = `WORKQUEUE_${capability.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;

      try {
        const streamInfo = await jsm.streams.info(streamName);
        const lines: string[] = [
          `Work queue status for capability "${capability}":`,
          '',
          '| Metric | Value |',
          '|--------|-------|',
          `| Pending Work Items | ${streamInfo.state.messages.toLocaleString()} |`,
          `| Storage Used | ${(streamInfo.state.bytes / 1024).toFixed(2)} KB |`,
          `| First Sequence | ${streamInfo.state.first_seq} |`,
          `| Last Sequence | ${streamInfo.state.last_seq} |`,
        ];

        logger.debug('Work queue status retrieved', {
          capability,
          pendingItems: streamInfo.state.messages,
        });

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      } catch (err) {
        const error = err as Error;
        if (error.message?.includes('not found')) {
          return {
            content: [
              {
                type: 'text',
                text: `Work queue for capability "${capability}" does not exist yet. No work has been broadcast for this capability.`,
              },
            ],
          };
        }
        throw err;
      }
    }

    // List all work queues
    const allStreams = await jsm.streams.list().next();
    const workQueues: Array<{ capability: string; count: number; bytes: number }> = [];

    for (const stream of allStreams) {
      // Filter for work queue streams only
      if (stream.config.name.startsWith('WORKQUEUE_')) {
        const capability = stream.config.name
          .substring('WORKQUEUE_'.length)
          .toLowerCase()
          .replace(/_/g, '-');

        workQueues.push({
          capability,
          count: stream.state.messages,
          bytes: stream.state.bytes,
        });
      }
    }

    // Sort by pending count descending
    workQueues.sort((a, b) => b.count - a.count);

    // Filter to only non-empty queues
    const nonEmptyQueues = workQueues.filter((q) => q.count > 0);

    if (nonEmptyQueues.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No work queues have pending items. All queues are empty or no work has been broadcast yet.',
          },
        ],
      };
    }

    const lines: string[] = [
      'Work queue status across all capabilities:',
      '',
      `Found ${nonEmptyQueues.length} queue(s) with pending work:`,
      '',
      '| Capability | Pending Items | Storage |',
      '|------------|---------------|---------|',
    ];

    for (const queue of nonEmptyQueues) {
      lines.push(
        `| ${queue.capability} | ${queue.count.toLocaleString()} | ${(queue.bytes / 1024).toFixed(2)} KB |`
      );
    }

    const totalPending = nonEmptyQueues.reduce((sum, q) => sum + q.count, 0);
    lines.push('');
    lines.push(`**Total pending work items:** ${totalPending.toLocaleString()}`);

    logger.debug('All work queues status retrieved', {
      queueCount: nonEmptyQueues.length,
      totalPending,
    });

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to get work queue status', {
      capability,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: Failed to get work queue status: ${error.message}` }],
      isError: true,
    };
  }
}
