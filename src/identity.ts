/**
 * Identity management utilities for Loominal v0.2.0 unified identity system
 *
 * This module provides stable, deterministic agent ID derivation for both root agents
 * and sub-agents. Root agent IDs are derived from hostname + project path, ensuring
 * consistent identification across restarts. Sub-agent IDs are derived from parent ID +
 * type, enabling predictable hierarchical agent structures.
 *
 * @module identity
 */

import { createHash } from 'crypto';
import { hostname } from 'os';
import type { KV, NatsConnection } from 'nats';
import type { RootIdentity, SubagentIdentity, AgentIdentity } from './types.js';
import { createLogger } from './logger.js';

const logger = createLogger('identity');

/**
 * Derive a stable root agent ID from hostname and project path
 *
 * Root agent IDs are deterministic, ensuring that the same agent running on the
 * same machine with the same project always gets the same ID across restarts.
 * This enables consistent identity management and state recovery.
 *
 * The ID is computed as: `sha256(hostname + projectPath).substring(0, 32)`
 *
 * @param projectPath - Absolute path to the project directory
 * @returns 32-character hex string uniquely identifying this root agent
 *
 * @example
 * ```typescript
 * const rootId = deriveRootAgentId('/var/home/mike/source/my-project');
 * // Returns: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
 * ```
 */
export function deriveRootAgentId(projectPath: string): string {
  const host = hostname();
  const hash = createHash('sha256')
    .update(host + projectPath)
    .digest('hex');
  return hash.substring(0, 32);
}

/**
 * Derive a sub-agent ID from parent agent ID and sub-agent type
 *
 * Sub-agents are spawned by root agents for specialized tasks (e.g., "explore",
 * "plan", "test"). Their IDs are derived deterministically from the parent's ID
 * and the sub-agent type, enabling consistent identification of sub-agent roles
 * within an agent hierarchy.
 *
 * The ID is computed as: `sha256(parentAgentId + subagentType).substring(0, 32)`
 *
 * @param parentAgentId - The root or parent agent's ID (32-character hex string)
 * @param subagentType - The type of sub-agent (e.g., "explore", "plan", "test")
 * @returns 32-character hex string uniquely identifying this sub-agent
 *
 * @example
 * ```typescript
 * const parentId = deriveRootAgentId('/var/home/mike/source/my-project');
 * const subagentId = deriveSubagentId(parentId, 'explore');
 * // Returns: "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3"
 * ```
 */
export function deriveSubagentId(
  parentAgentId: string,
  subagentType: string
): string {
  const hash = createHash('sha256')
    .update(parentAgentId + subagentType)
    .digest('hex');
  return hash.substring(0, 32);
}

/**
 * Check if running as a sub-agent by looking for LOOMINAL_SUBAGENT_TYPE env var
 *
 * Sub-agents are identified by the presence of the `LOOMINAL_SUBAGENT_TYPE`
 * environment variable, which is set by the parent agent when spawning a sub-agent.
 * Root agents do not have this environment variable.
 *
 * @returns `true` if running as a sub-agent, `false` if running as a root agent
 *
 * @example
 * ```typescript
 * if (isSubagent()) {
 *   console.log('Running as sub-agent');
 * } else {
 *   console.log('Running as root agent');
 * }
 * ```
 */
export function isSubagent(): boolean {
  return !!process.env.LOOMINAL_SUBAGENT_TYPE;
}

/**
 * Get the sub-agent type from environment, or undefined if root agent
 *
 * When running as a sub-agent, this returns the value of the `LOOMINAL_SUBAGENT_TYPE`
 * environment variable (e.g., "explore", "plan", "test"). When running as a root agent,
 * this returns `undefined`.
 *
 * This is useful for conditional logic based on agent role and for deriving sub-agent IDs.
 *
 * @returns The sub-agent type string if running as a sub-agent, `undefined` otherwise
 *
 * @example
 * ```typescript
 * const subagentType = getSubagentType();
 * if (subagentType) {
 *   console.log(`Running as ${subagentType} sub-agent`);
 * } else {
 *   console.log('Running as root agent');
 * }
 * ```
 */
export function getSubagentType(): string | undefined {
  return process.env.LOOMINAL_SUBAGENT_TYPE;
}

/**
 * Get manually configured agent ID from environment, or undefined if not set
 *
 * The `LOOMINAL_AGENT_ID` environment variable allows manual override of the
 * automatically derived agent ID. This is useful for multi-machine scenarios
 * where the same logical agent should share memories across different computers.
 *
 * When set, this ID is used instead of deriving from hostname + projectPath.
 *
 * @returns The manual agent ID if set, `undefined` otherwise
 *
 * @example
 * ```typescript
 * const manualId = getManualAgentId();
 * if (manualId) {
 *   console.log(`Using manually configured agent ID: ${manualId}`);
 * } else {
 *   console.log('Agent ID will be derived automatically');
 * }
 * ```
 */
export function getManualAgentId(): string | undefined {
  return process.env.LOOMINAL_AGENT_ID;
}

/**
 * NATS KV bucket management for identity persistence
 *
 * The identity bucket stores agent identities persistently across restarts.
 * Bucket naming: loom-identity-{projectId}
 * Key patterns:
 *   - root: Root agent identity
 *   - subagent/{type}: Sub-agent identity by type
 */

/** Bucket name pattern: loom-identity-{projectId} */
const IDENTITY_BUCKET_PREFIX = 'loom-identity-';

/**
 * Get or create the identity KV bucket for a project
 *
 * The identity bucket stores stable agent identities that persist across restarts.
 * Unlike the registry (which has TTL), identity entries never expire.
 *
 * @param nc - NATS connection
 * @param projectId - Project identifier (opaque hash of project path)
 * @returns KV bucket instance
 * @throws Error if bucket creation fails
 */
export async function getOrCreateIdentityBucket(
  nc: NatsConnection,
  projectId: string
): Promise<KV> {
  const js = nc.jetstream();
  const bucketName = `${IDENTITY_BUCKET_PREFIX}${projectId}`;

  try {
    // Try to get existing bucket
    const bucket = await js.views.kv(bucketName);
    logger.debug('Using existing identity bucket', { bucket: bucketName });
    return bucket;
  } catch (err) {
    const error = err as Error;
    // Bucket doesn't exist, create it
    if (error.message?.includes('not found') || error.message?.includes('does not exist')) {
      logger.info('Creating new identity bucket', { bucket: bucketName });

      try {
        // Create bucket with no expiration (TTL=0)
        const bucket = await js.views.kv(bucketName, {
          history: 1, // Keep only latest version
          ttl: 0, // No expiration for identity data
        });
        logger.info('Created identity bucket', { bucket: bucketName });
        return bucket;
      } catch (createErr) {
        const createError = createErr as Error;
        // Handle race condition where bucket was created by another process
        if (createError.message?.includes('already in use') || createError.message?.includes('exists')) {
          const bucket = await js.views.kv(bucketName);
          logger.debug('Identity bucket created by concurrent process', { bucket: bucketName });
          return bucket;
        }
        throw createError;
      }
    }
    throw error;
  }
}

/**
 * Get root identity from the bucket
 *
 * @param bucket - Identity KV bucket
 * @returns RootIdentity if found, null otherwise
 */
export async function getRootIdentity(bucket: KV): Promise<RootIdentity | null> {
  try {
    const entry = await bucket.get('root');
    if (!entry || !entry.value) {
      logger.debug('Root identity not found');
      return null;
    }

    const identity = JSON.parse(new TextDecoder().decode(entry.value)) as RootIdentity;
    logger.debug('Retrieved root identity', {
      agentId: identity.agentId,
      hostname: identity.hostname,
    });
    return identity;
  } catch (err) {
    const error = err as Error;
    // Key not found is not an error, return null
    if (error.message?.includes('not found') || error.message?.includes('no message found')) {
      logger.debug('Root identity not found');
      return null;
    }
    logger.error('Failed to get root identity', { error: error.message });
    throw new Error(`Failed to get root identity: ${error.message}`);
  }
}

/**
 * Store root identity in the bucket
 *
 * @param bucket - Identity KV bucket
 * @param identity - Root identity to store
 */
export async function putRootIdentity(bucket: KV, identity: RootIdentity): Promise<void> {
  try {
    const payload = JSON.stringify(identity);
    await bucket.put('root', payload);
    logger.debug('Stored root identity', {
      agentId: identity.agentId,
      hostname: identity.hostname,
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to put root identity', { error: error.message });
    throw new Error(`Failed to put root identity: ${error.message}`);
  }
}

/**
 * Get sub-agent identity from the bucket
 *
 * @param bucket - Identity KV bucket
 * @param subagentType - Sub-agent type identifier (e.g., "explore", "plan")
 * @returns SubagentIdentity if found, null otherwise
 */
export async function getSubagentIdentity(
  bucket: KV,
  subagentType: string
): Promise<SubagentIdentity | null> {
  const key = `subagent/${subagentType}`;

  try {
    const entry = await bucket.get(key);
    if (!entry || !entry.value) {
      logger.debug('Sub-agent identity not found', { subagentType });
      return null;
    }

    const identity = JSON.parse(new TextDecoder().decode(entry.value)) as SubagentIdentity;
    logger.debug('Retrieved sub-agent identity', {
      agentId: identity.agentId,
      subagentType: identity.subagentType,
      parentId: identity.parentId,
    });
    return identity;
  } catch (err) {
    const error = err as Error;
    // Key not found is not an error, return null
    if (error.message?.includes('not found') || error.message?.includes('no message found')) {
      logger.debug('Sub-agent identity not found', { subagentType });
      return null;
    }
    logger.error('Failed to get sub-agent identity', { subagentType, error: error.message });
    throw new Error(`Failed to get sub-agent identity for ${subagentType}: ${error.message}`);
  }
}

/**
 * Store sub-agent identity in the bucket
 *
 * @param bucket - Identity KV bucket
 * @param identity - Sub-agent identity to store
 */
export async function putSubagentIdentity(bucket: KV, identity: SubagentIdentity): Promise<void> {
  const key = `subagent/${identity.subagentType}`;

  try {
    const payload = JSON.stringify(identity);
    await bucket.put(key, payload);
    logger.debug('Stored sub-agent identity', {
      agentId: identity.agentId,
      subagentType: identity.subagentType,
      parentId: identity.parentId,
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to put sub-agent identity', {
      subagentType: identity.subagentType,
      error: error.message,
    });
    throw new Error(`Failed to put sub-agent identity for ${identity.subagentType}: ${error.message}`);
  }
}

/**
 * Initialize root agent identity
 *
 * Priority order:
 * 1. If LOOMINAL_AGENT_ID is set, use that (for multi-machine scenarios)
 * 2. If existing identity matches hostname, reuse it
 * 3. Otherwise, derive new ID from hostname + projectPath
 *
 * @param bucket - Identity KV bucket
 * @param projectPath - Absolute project path for deriving root ID
 * @returns Root agent identity
 */
async function initializeRootIdentity(
  bucket: KV,
  projectPath: string
): Promise<AgentIdentity> {
  const host = hostname();
  const manualAgentId = getManualAgentId();

  // Priority 1: Manual override via LOOMINAL_AGENT_ID
  if (manualAgentId) {
    logger.info('Using manually configured agent ID', {
      agentId: manualAgentId,
      source: 'LOOMINAL_AGENT_ID',
    });

    const identity: RootIdentity = {
      agentId: manualAgentId,
      hostname: host,
      projectPath,
      createdAt: new Date().toISOString(),
    };

    // Store the manual identity (overwrites any existing)
    await putRootIdentity(bucket, identity);
    return { ...identity, isSubagent: false as const };
  }

  // Priority 2: Check for existing identity matching this hostname
  const existing = await getRootIdentity(bucket);
  if (existing && existing.hostname === host) {
    logger.info('Using existing root identity', { agentId: existing.agentId });
    return { ...existing, isSubagent: false as const };
  }

  // Priority 3: Derive new identity from hostname + projectPath
  const agentId = deriveRootAgentId(projectPath);
  const identity: RootIdentity = {
    agentId,
    hostname: host,
    projectPath,
    createdAt: new Date().toISOString(),
  };

  await putRootIdentity(bucket, identity);
  logger.info('Created new root identity', { agentId, hostname: host });

  return { ...identity, isSubagent: false as const };
}

/**
 * Initialize sub-agent identity
 *
 * Retrieves the parent root identity and derives a sub-agent ID from it.
 * Throws an error if the root identity is not found.
 *
 * @param bucket - Identity KV bucket
 * @param subagentType - Sub-agent type identifier
 * @returns Sub-agent identity
 * @throws Error if root identity not found
 */
async function initializeSubagentIdentity(
  bucket: KV,
  subagentType: string
): Promise<AgentIdentity> {
  // Get root identity first
  const root = await getRootIdentity(bucket);
  if (!root) {
    throw new Error('Cannot initialize sub-agent: root identity not found');
  }

  // Derive sub-agent ID
  const agentId = deriveSubagentId(root.agentId, subagentType);
  const identity: SubagentIdentity = {
    agentId,
    parentId: root.agentId,
    subagentType,
    createdAt: new Date().toISOString(),
  };

  await putSubagentIdentity(bucket, identity);
  logger.info('Created sub-agent identity', {
    agentId,
    subagentType,
    parentId: root.agentId,
  });

  return { ...identity, isSubagent: true as const };
}

/**
 * Initialize agent identity on startup
 *
 * For root agents (no LOOMINAL_SUBAGENT_TYPE):
 * - Check for existing root identity in NATS KV
 * - If exists and hostname matches, use it
 * - If not, derive new ID and store it
 *
 * For sub-agents (LOOMINAL_SUBAGENT_TYPE is set):
 * - Read root identity from NATS KV
 * - Derive sub-agent ID from root ID + type
 * - Store sub-agent identity
 *
 * @param nc - NATS connection
 * @param projectId - Project identifier
 * @param projectPath - Absolute project path (for deriving root ID)
 * @returns AgentIdentity (either root or sub-agent)
 * @throws Error if sub-agent initialization fails due to missing root identity
 */
export async function initializeIdentity(
  nc: NatsConnection,
  projectId: string,
  projectPath: string
): Promise<AgentIdentity> {
  const bucket = await getOrCreateIdentityBucket(nc, projectId);
  const subagentType = getSubagentType();

  if (subagentType) {
    // Sub-agent mode
    return initializeSubagentIdentity(bucket, subagentType);
  } else {
    // Root agent mode
    return initializeRootIdentity(bucket, projectPath);
  }
}
