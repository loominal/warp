/**
 * Type definitions for the NATS MCP Server
 */

/**
 * Channel configuration as defined in .mcp-config.json
 */
export interface ChannelConfig {
  /** Channel identifier (lowercase alphanumeric and hyphens) */
  name: string;
  /** Human-readable channel purpose */
  description: string;
  /** Maximum number of messages to retain (default: 10000) */
  maxMessages?: number;
  /** Maximum storage in bytes (default: 10MB) */
  maxBytes?: number;
  /** Maximum message age (e.g., '24h', '7d', '30m') */
  maxAge?: string;
}

/**
 * Work queue configuration
 */
export interface WorkQueueConfig {
  /** Acknowledgment timeout in milliseconds (default: 300000 = 5 min) */
  ackTimeoutMs?: number;
  /** Maximum delivery attempts before dead letter (default: 3) */
  maxDeliveryAttempts?: number;
  /** Dead letter queue TTL in milliseconds (default: 604800000 = 7 days) */
  deadLetterTTLMs?: number;
}

/**
 * Project configuration from .mcp-config.json
 */
export interface ProjectConfig {
  /** Unique namespace for this project (auto-generated from path if not specified) */
  namespace?: string;
  /** List of communication channels for this project */
  channels?: ChannelConfig[];
  /** NATS server URL (can be overridden by NATS_URL env var) */
  natsUrl?: string;
  /** Logging configuration */
  logging?: {
    level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    format?: 'json' | 'text';
  };
  /** Work queue configuration */
  workQueue?: WorkQueueConfig;
}

/**
 * Resolved configuration with all defaults applied
 */
export interface ResolvedConfig {
  namespace: string;
  channels: Required<ChannelConfig>[];
  natsUrl: string;
  logging: {
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    format: 'json' | 'text';
  };
  workQueue: Required<WorkQueueConfig>;
  projectPath: string;
  /** Explicit project ID (from LOOMINAL_PROJECT_ID env var) or derived from projectPath */
  projectId: string;
}

/**
 * Default channel definitions
 */
export const DEFAULT_CHANNELS: ChannelConfig[] = [
  {
    name: 'roadmap',
    description: 'Discussion about project roadmap and planning',
  },
  {
    name: 'parallel-work',
    description: 'Coordination for parallel work among agents',
  },
  {
    name: 'errors',
    description: 'Error reporting and troubleshooting',
  },
];

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  maxMessages: 10000,
  maxBytes: 10485760, // 10MB
  maxAge: '24h',
  natsUrl: 'nats://localhost:4222',
  logging: {
    level: 'INFO' as const,
    format: 'json' as const,
  },
  workQueue: {
    ackTimeoutMs: 300000, // 5 minutes
    maxDeliveryAttempts: 3,
    deadLetterTTLMs: 604800000, // 7 days
  },
};

/**
 * Message payload format
 */
export interface MessagePayload {
  /** Sender's agent handle */
  handle: string;
  /** Message content */
  message: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Internal channel representation with NATS details
 */
export interface InternalChannel {
  name: string;
  description: string;
  streamName: string;
  subject: string;
  maxMessages: number;
  maxBytes: number;
  maxAgeNanos: number;
}

/**
 * Server session state
 */
export interface SessionState {
  handle: string | null;
  agentGuid: string | null;
  registeredEntry: RegistryEntry | null;
  /** Agent identity (root or sub-agent), initialized at startup */
  identity: AgentIdentity | null;
}

/**
 * Root agent identity for v0.2.0 unified identity management
 *
 * Root agents have stable identities derived from hostname + projectPath.
 * The agentId is deterministic, ensuring the same root agent always gets
 * the same ID across restarts.
 */
export interface RootIdentity {
  /** Deterministic ID: sha256(hostname + projectPath).substring(0, 32) */
  agentId: string;
  /** Machine hostname from os.hostname() */
  hostname: string;
  /** Resolved absolute project path */
  projectPath: string;
  /** ISO 8601 timestamp of when this identity was created */
  createdAt: string;
}

/**
 * Sub-agent identity for v0.2.0 unified identity management
 *
 * Sub-agents are spawned by root agents for specialized tasks.
 * Their IDs are derived from the parent's ID + subagent type, ensuring
 * consistent identification of sub-agent roles.
 */
export interface SubagentIdentity {
  /** Deterministic ID: sha256(rootAgentId + subagentType).substring(0, 32) */
  agentId: string;
  /** Root agent's ID (parent) */
  parentId: string;
  /** Sub-agent type identifier (e.g., "explore", "plan", "general-purpose") */
  subagentType: string;
  /** ISO 8601 timestamp of when this identity was created */
  createdAt: string;
}

/**
 * Unified agent identity type
 *
 * Discriminated union that represents either a root agent or a sub-agent.
 * Use the `isSubagent` field to determine which type it is.
 */
export type AgentIdentity =
  | (RootIdentity & { isSubagent: false })
  | (SubagentIdentity & { isSubagent: true });

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Error types for structured error handling
 */
export type ErrorCategory =
  | 'ValidationError'
  | 'ConnectionError'
  | 'NotFoundError'
  | 'ConfigurationError'
  | 'InternalError';

export interface StructuredError {
  category: ErrorCategory;
  message: string;
  details?: Record<string, unknown>;
  remediation?: string;
}

/**
 * Registry entry for agent discovery in distributed system
 */
export interface RegistryEntry {
  // Identity
  guid: string; // UUID v4, unique identifier
  agentType: string; // e.g., "project-manager", "developer", "reviewer"
  handle: string; // Display name (same as chat handle)

  // Location
  hostname: string; // Computer hostname
  projectId: string; // Opaque hash of project path (for privacy)
  natsUrl: string; // NATS server this agent connects to

  // Optional identity
  username?: string; // OS username (optional for privacy)

  // Capabilities
  capabilities: string[]; // e.g., ["typescript", "testing", "code-review"]

  // Scope and visibility
  scope: 'user' | 'project'; // user-level or project-level agent
  visibility: 'private' | 'project-only' | 'user-only' | 'public';

  // Status
  status: 'online' | 'busy' | 'offline';
  currentTaskCount: number;

  // Timestamps
  registeredAt: string; // ISO 8601
  lastHeartbeat: string; // ISO 8601
}

/**
 * Registry event for watching agent changes
 */
export type RegistryEvent = {
  type: 'put' | 'delete';
  guid: string;
  entry?: RegistryEntry;
};

/**
 * Inbox message for agent-to-agent communication
 */
export interface InboxMessage {
  /** Message ID from JetStream */
  id: string;
  /** Sender's agent GUID */
  senderGuid: string;
  /** Sender's display handle */
  senderHandle: string;
  /** Recipient's agent GUID */
  recipientGuid: string;
  /** Message type (e.g., "text", "work-offer", "work-claim") */
  messageType: string;
  /** Message content */
  content: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Work item for work queue distribution
 */
export interface WorkItem {
  /** UUID v4 */
  id: string;
  /** Application-defined task ID */
  taskId: string;
  /** Required capability */
  capability: string;
  /** Human-readable description */
  description: string;
  /** 1-10, higher = more urgent (default: 5) */
  priority?: number;
  /** ISO 8601 timestamp */
  deadline?: string;
  /** Application-specific data */
  contextData?: Record<string, unknown>;
  /** GUID of offering agent */
  offeredBy: string;
  /** ISO 8601 timestamp */
  offeredAt: string;
  /** Delivery attempt count */
  attempts: number;
}

/**
 * Dead Letter Queue item for failed work items
 */
export interface DLQItem {
  /** Original work item ID */
  id: string;
  /** Original work item */
  workItem: WorkItem;
  /** Why it was moved to DLQ */
  reason: string;
  /** Delivery attempts made */
  attempts: number;
  /** ISO 8601 timestamp */
  failedAt: string;
  /** Error messages from attempts */
  errors: string[];
}

/**
 * Message types for work handoff protocol
 */
export type WorkMessageType =
  | 'work-offer' // Offering work to an agent
  | 'work-claim' // Agent claims offered work
  | 'work-accept' // Offerer accepts the claim
  | 'work-reject' // Offerer rejects the claim
  | 'progress-update' // Worker reports progress
  | 'work-complete' // Worker reports completion
  | 'work-error'; // Worker reports error

/**
 * Payload for work-offer message
 */
export interface WorkOfferPayload {
  /** Unique work item identifier */
  workItemId: string;
  /** Application-defined task ID */
  taskId: string;
  /** Required capability for this work */
  capability: string;
  /** Human-readable description */
  description: string;
  /** Priority level 1-10 (optional) */
  priority?: number;
  /** ISO 8601 deadline (optional) */
  deadline?: string;
  /** Application-specific context data (optional) */
  contextData?: Record<string, unknown>;
}

/**
 * Payload for work-claim message
 */
export interface WorkClaimPayload {
  /** Work item being claimed */
  workItemId: string;
  /** Claimer's capabilities */
  claimerCapabilities: string[];
}

/**
 * Payload for work-accept message
 */
export interface WorkAcceptPayload {
  /** Work item being accepted */
  workItemId: string;
  /** Optional instructions for the worker */
  instructions?: string;
}

/**
 * Payload for work-reject message
 */
export interface WorkRejectPayload {
  /** Work item being rejected */
  workItemId: string;
  /** Reason for rejection */
  reason: string;
}

/**
 * Payload for progress-update message
 */
export interface ProgressUpdatePayload {
  /** Work item being updated */
  workItemId: string;
  /** Progress percentage 0-100 */
  progress: number;
  /** Optional progress message */
  message?: string;
}

/**
 * Payload for work-complete message
 */
export interface WorkCompletePayload {
  /** Work item being completed */
  workItemId: string;
  /** Optional result data */
  result?: Record<string, unknown>;
  /** Optional summary of completion */
  summary?: string;
}

/**
 * Payload for work-error message
 */
export interface WorkErrorPayload {
  /** Work item that encountered an error */
  workItemId: string;
  /** Error message */
  error: string;
  /** Whether the error is recoverable */
  recoverable: boolean;
}
