/**
 * Agent Registry schema validation and helper functions
 */

import { createHash, randomUUID } from 'crypto';
import type { LoominalScope } from '@loominal/shared/types';
import { isValidScope, migrateLegacyVisibility } from '@loominal/shared/types';
import type { RegistryEntry } from './types.js';

/**
 * Validation result for registry entries
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Requester context for visibility filtering
 */
export interface Requester {
  projectId: string;
  username?: string;
  guid: string;
}

/**
 * UUID v4 validation pattern
 */
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * ISO 8601 timestamp validation pattern
 */
const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?([+-]\d{2}:\d{2})?$/;

/**
 * Validate a registry entry
 */
export function validateRegistryEntry(entry: unknown): ValidationResult {
  const errors: string[] = [];

  // Type check
  if (!entry || typeof entry !== 'object') {
    return { valid: false, errors: ['Entry must be an object'] };
  }

  const e = entry as Record<string, unknown>;

  // Required fields - Identity
  if (typeof e.guid !== 'string' || !UUID_V4_PATTERN.test(e.guid)) {
    errors.push('guid must be a valid UUID v4');
  }

  if (typeof e.agentType !== 'string' || e.agentType.trim() === '') {
    errors.push('agentType must be a non-empty string');
  }

  if (typeof e.handle !== 'string' || e.handle.trim() === '') {
    errors.push('handle must be a non-empty string');
  }

  // Required fields - Location
  if (typeof e.hostname !== 'string' || e.hostname.trim() === '') {
    errors.push('hostname must be a non-empty string');
  }

  if (typeof e.projectId !== 'string' || e.projectId.length !== 16 || !/^[a-f0-9]+$/.test(e.projectId)) {
    errors.push('projectId must be a 16-character lowercase hex string');
  }

  if (typeof e.natsUrl !== 'string' || !e.natsUrl.startsWith('nats://')) {
    errors.push('natsUrl must be a valid NATS URL starting with nats://');
  }

  // Optional fields
  if (e.username !== undefined && (typeof e.username !== 'string' || e.username.trim() === '')) {
    errors.push('username, if provided, must be a non-empty string');
  }

  // Required fields - Capabilities
  if (!Array.isArray(e.capabilities)) {
    errors.push('capabilities must be an array');
  } else {
    if (!e.capabilities.every((cap) => typeof cap === 'string' && cap.trim() !== '')) {
      errors.push('capabilities must be an array of non-empty strings');
    }
  }

  // Required field - Scope (unified model)
  if (!isValidScope(e.scope)) {
    errors.push('scope must be one of: "private", "personal", "team", "public"');
  }

  // Optional legacy field - visibility (deprecated but tolerated during migration)
  if (e.visibility !== undefined) {
    if (
      e.visibility !== 'private' &&
      e.visibility !== 'project-only' &&
      e.visibility !== 'user-only' &&
      e.visibility !== 'public'
    ) {
      errors.push('visibility (deprecated) must be one of: "private", "project-only", "user-only", "public"');
    }
  }

  // Required fields - Status
  if (e.status !== 'online' && e.status !== 'busy' && e.status !== 'offline') {
    errors.push('status must be one of: "online", "busy", "offline"');
  }

  if (typeof e.currentTaskCount !== 'number' || e.currentTaskCount < 0 || !Number.isInteger(e.currentTaskCount)) {
    errors.push('currentTaskCount must be a non-negative integer');
  }

  // Required fields - Timestamps
  if (typeof e.registeredAt !== 'string' || !ISO_8601_PATTERN.test(e.registeredAt)) {
    errors.push('registeredAt must be a valid ISO 8601 timestamp');
  }

  if (typeof e.lastHeartbeat !== 'string' || !ISO_8601_PATTERN.test(e.lastHeartbeat)) {
    errors.push('lastHeartbeat must be a valid ISO 8601 timestamp');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate opaque projectId from project path (use same hash as namespace)
 */
export function generateProjectId(projectPath: string): string {
  const hash = createHash('sha256').update(projectPath).digest('hex');
  return hash.substring(0, 16);
}

/**
 * Check if agent should be visible to requester based on scope rules
 * - private: Only the agent itself can see (guid match)
 * - personal: Only agents with same username (across all projects)
 * - team: Only agents in same project (projectId match)
 * - public: All agents can see
 *
 * Also handles legacy visibility field for backward compatibility
 */
export function isVisibleTo(entry: RegistryEntry, requester: Requester): boolean {
  // Use scope if available (new unified model)
  const scope = entry.scope;

  switch (scope) {
    case 'private':
      // Only the agent itself
      return entry.guid === requester.guid;

    case 'personal':
      // Same username (user-only across projects)
      return (
        entry.username !== undefined &&
        requester.username !== undefined &&
        entry.username === requester.username
      );

    case 'team':
      // Same project
      return entry.projectId === requester.projectId;

    case 'public':
      // Everyone can see
      return true;

    default:
      // Unknown scope - default to private
      return false;
  }
}

/**
 * Filter sensitive fields based on visibility
 * Returns a partial entry with sensitive fields redacted for requesters who can see the entry
 */
export function redactEntry(
  entry: RegistryEntry,
  requester: Requester
): Partial<RegistryEntry> {
  // If not visible at all, return empty object
  if (!isVisibleTo(entry, requester)) {
    return {};
  }

  // If it's the agent itself, return everything
  if (entry.guid === requester.guid) {
    return entry;
  }

  // For others, redact sensitive fields based on visibility
  const redacted: Partial<RegistryEntry> = {
    guid: entry.guid,
    agentType: entry.agentType,
    handle: entry.handle,
    capabilities: entry.capabilities,
    scope: entry.scope,
    status: entry.status,
    currentTaskCount: entry.currentTaskCount,
    lastHeartbeat: entry.lastHeartbeat,
  };

  // Include projectId if in same project
  if (entry.projectId === requester.projectId) {
    redacted.projectId = entry.projectId;
  }

  // Include hostname only for public or same-project agents
  if (entry.scope === 'public' || entry.projectId === requester.projectId) {
    redacted.hostname = entry.hostname;
  }

  // Include username only for personal scope with matching users
  if (
    entry.scope === 'personal' &&
    entry.username !== undefined &&
    requester.username !== undefined &&
    entry.username === requester.username
  ) {
    redacted.username = entry.username;
  }

  // Include natsUrl only for same project
  if (entry.projectId === requester.projectId) {
    redacted.natsUrl = entry.natsUrl;
  }

  return redacted;
}

/**
 * Create a new registry entry with defaults
 */
export function createRegistryEntry(params: {
  agentType: string;
  handle: string;
  hostname: string;
  /** Project path - used to generate projectId if not explicitly provided */
  projectPath?: string;
  /** Explicit project ID - takes precedence over projectPath */
  projectId?: string;
  natsUrl: string;
  username?: string;
  capabilities?: string[];
  scope?: LoominalScope;
  /** @deprecated Use scope instead. Provided for backward compatibility */
  visibility?: 'private' | 'project-only' | 'user-only' | 'public';
}): RegistryEntry {
  const now = new Date().toISOString();

  // Use explicit projectId if provided, otherwise generate from projectPath
  let resolvedProjectId: string;
  if (params.projectId) {
    resolvedProjectId = params.projectId;
  } else if (params.projectPath) {
    resolvedProjectId = generateProjectId(params.projectPath);
  } else {
    throw new Error('Either projectId or projectPath must be provided');
  }

  // Determine scope - prefer scope param, fallback to migrating visibility, default to 'team'
  let resolvedScope: LoominalScope = 'team';
  if (params.scope) {
    resolvedScope = params.scope;
  } else if (params.visibility) {
    // Migrate legacy visibility to scope
    const migratedScope = migrateLegacyVisibility(params.visibility);
    if (migratedScope) {
      resolvedScope = migratedScope;
    }
  }

  const entry: RegistryEntry = {
    guid: randomUUID(),
    agentType: params.agentType,
    handle: params.handle,
    hostname: params.hostname,
    projectId: resolvedProjectId,
    natsUrl: params.natsUrl,
    capabilities: params.capabilities ?? [],
    scope: resolvedScope,
    status: 'online',
    currentTaskCount: 0,
    registeredAt: now,
    lastHeartbeat: now,
  };

  if (params.username) {
    entry.username = params.username;
  }

  return entry;
}
