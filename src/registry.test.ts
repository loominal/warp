/**
 * Tests for registry module
 */

import { describe, it, expect } from 'vitest';
import {
  validateRegistryEntry,
  generateProjectId,
  isVisibleTo,
  redactEntry,
  createRegistryEntry,
  type Requester,
} from './registry.js';
import type { RegistryEntry } from './types.js';

describe('validateRegistryEntry', () => {
  const validEntry: RegistryEntry = {
    guid: '123e4567-e89b-42d3-a456-426614174000',
    agentType: 'developer',
    handle: 'TestAgent',
    hostname: 'test-host',
    projectId: '1234567890abcdef',
    natsUrl: 'nats://localhost:4222',
    capabilities: ['typescript', 'testing'],
    scope: 'team',
    status: 'online',
    currentTaskCount: 0,
    registeredAt: '2025-12-07T12:00:00.000Z',
    lastHeartbeat: '2025-12-07T12:00:00.000Z',
  };

  it('should accept valid registry entry', () => {
    const result = validateRegistryEntry(validEntry);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should accept valid entry with optional username', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      username: 'testuser',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should reject non-object input', () => {
    const result = validateRegistryEntry(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Entry must be an object');
  });

  it('should reject invalid UUID', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      guid: 'not-a-uuid',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('guid must be a valid UUID v4');
  });

  it('should reject non-v4 UUID', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      guid: '123e4567-e89b-12d3-a456-426614174000', // version 1, not 4
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('guid must be a valid UUID v4');
  });

  it('should reject empty agentType', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      agentType: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('agentType must be a non-empty string');
  });

  it('should reject empty handle', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      handle: '   ',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('handle must be a non-empty string');
  });

  it('should reject empty hostname', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      hostname: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('hostname must be a non-empty string');
  });

  it('should reject invalid projectId format', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      projectId: 'tooshort',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('projectId must be a 16-character lowercase hex string');
  });

  it('should reject projectId with uppercase', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      projectId: '1234567890ABCDEF',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('projectId must be a 16-character lowercase hex string');
  });

  it('should reject invalid natsUrl', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      natsUrl: 'http://localhost:4222',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('natsUrl must be a valid NATS URL starting with nats://');
  });

  it('should reject empty username when provided', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      username: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('username, if provided, must be a non-empty string');
  });

  it('should reject non-array capabilities', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      capabilities: 'not-an-array',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('capabilities must be an array');
  });

  it('should reject capabilities with empty strings', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      capabilities: ['typescript', '', 'testing'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('capabilities must be an array of non-empty strings');
  });

  it('should reject invalid scope', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      scope: 'invalid',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('scope must be one of: "private", "personal", "team", "public"');
  });

  it('should accept entry without legacy visibility field', () => {
    const result = validateRegistryEntry({
      ...validEntry,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should reject invalid status', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      status: 'away',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('status must be one of: "online", "busy", "offline"');
  });

  it('should reject negative currentTaskCount', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      currentTaskCount: -1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('currentTaskCount must be a non-negative integer');
  });

  it('should reject non-integer currentTaskCount', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      currentTaskCount: 1.5,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('currentTaskCount must be a non-negative integer');
  });

  it('should reject invalid registeredAt timestamp', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      registeredAt: 'not-a-timestamp',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('registeredAt must be a valid ISO 8601 timestamp');
  });

  it('should reject invalid lastHeartbeat timestamp', () => {
    const result = validateRegistryEntry({
      ...validEntry,
      lastHeartbeat: '12/07/2025',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('lastHeartbeat must be a valid ISO 8601 timestamp');
  });

  it('should collect multiple validation errors', () => {
    const result = validateRegistryEntry({
      guid: 'invalid',
      agentType: '',
      handle: '',
      hostname: '',
      projectId: 'bad',
      natsUrl: 'http://bad',
      capabilities: 'not-array',
      scope: 'bad',
      status: 'bad',
      currentTaskCount: -1,
      registeredAt: 'bad',
      lastHeartbeat: 'bad',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(5);
  });
});

describe('generateProjectId', () => {
  it('should generate consistent projectId for same path', () => {
    const id1 = generateProjectId('/home/user/project');
    const id2 = generateProjectId('/home/user/project');
    expect(id1).toBe(id2);
  });

  it('should generate different projectIds for different paths', () => {
    const id1 = generateProjectId('/home/user/project1');
    const id2 = generateProjectId('/home/user/project2');
    expect(id1).not.toBe(id2);
  });

  it('should generate 16 character projectId', () => {
    const id = generateProjectId('/any/path');
    expect(id.length).toBe(16);
  });

  it('should generate lowercase hex projectId', () => {
    const id = generateProjectId('/any/path');
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });

  it('should be deterministic across multiple calls', () => {
    const path = '/test/project/path';
    const ids = Array.from({ length: 10 }, () => generateProjectId(path));
    expect(new Set(ids).size).toBe(1); // All should be identical
  });
});

describe('isVisibleTo', () => {
  const baseEntry: RegistryEntry = {
    guid: '123e4567-e89b-42d3-a456-426614174000',
    agentType: 'developer',
    handle: 'TestAgent',
    hostname: 'test-host',
    projectId: '1234567890abcdef',
    natsUrl: 'nats://localhost:4222',
    username: 'testuser',
    capabilities: ['typescript'],
    scope: 'team',
    status: 'online',
    currentTaskCount: 0,
    registeredAt: '2025-12-07T12:00:00.000Z',
    lastHeartbeat: '2025-12-07T12:00:00.000Z',
  };

  const sameProjectRequester: Requester = {
    guid: '223e4567-e89b-42d3-a456-426614174000',
    projectId: '1234567890abcdef',
    username: 'otheruser',
  };

  const differentProjectRequester: Requester = {
    guid: '323e4567-e89b-42d3-a456-426614174000',
    projectId: 'fedcba0987654321',
    username: 'anotheruser',
  };

  const sameUserRequester: Requester = {
    guid: '423e4567-e89b-42d3-a456-426614174000',
    projectId: 'fedcba0987654321',
    username: 'testuser',
  };

  describe('private scope', () => {
    const entry = { ...baseEntry, scope: 'private' as const };

    it('should be visible to self only', () => {
      expect(isVisibleTo(entry, { ...sameProjectRequester, guid: entry.guid })).toBe(true);
    });

    it('should not be visible to others in same project', () => {
      expect(isVisibleTo(entry, sameProjectRequester)).toBe(false);
    });

    it('should not be visible to different project', () => {
      expect(isVisibleTo(entry, differentProjectRequester)).toBe(false);
    });
  });

  describe('team scope', () => {
    const entry = { ...baseEntry, scope: 'team' as const };

    it('should be visible to agents in same project', () => {
      expect(isVisibleTo(entry, sameProjectRequester)).toBe(true);
    });

    it('should not be visible to different project', () => {
      expect(isVisibleTo(entry, differentProjectRequester)).toBe(false);
    });

    it('should be visible to self', () => {
      expect(isVisibleTo(entry, { ...sameProjectRequester, guid: entry.guid })).toBe(true);
    });
  });

  describe('personal scope', () => {
    const entry = { ...baseEntry, scope: 'personal' as const };

    it('should be visible to agents with same username', () => {
      expect(isVisibleTo(entry, sameUserRequester)).toBe(true);
    });

    it('should not be visible to different username', () => {
      expect(isVisibleTo(entry, sameProjectRequester)).toBe(false);
    });

    it('should not be visible if entry username is undefined', () => {
      const entryWithoutUsername = { ...entry, username: undefined };
      expect(isVisibleTo(entryWithoutUsername, sameUserRequester)).toBe(false);
    });

    it('should not be visible if requester username is undefined', () => {
      expect(isVisibleTo(entry, { ...sameUserRequester, username: undefined })).toBe(false);
    });
  });

  describe('public scope', () => {
    const entry = { ...baseEntry, scope: 'public' as const };

    it('should be visible to everyone', () => {
      expect(isVisibleTo(entry, sameProjectRequester)).toBe(true);
      expect(isVisibleTo(entry, differentProjectRequester)).toBe(true);
      expect(isVisibleTo(entry, sameUserRequester)).toBe(true);
    });
  });
});

describe('redactEntry', () => {
  const baseEntry: RegistryEntry = {
    guid: '123e4567-e89b-42d3-a456-426614174000',
    agentType: 'developer',
    handle: 'TestAgent',
    hostname: 'test-host',
    projectId: '1234567890abcdef',
    natsUrl: 'nats://localhost:4222',
    username: 'testuser',
    capabilities: ['typescript', 'testing'],
    scope: 'team',
    status: 'online',
    currentTaskCount: 2,
    registeredAt: '2025-12-07T12:00:00.000Z',
    lastHeartbeat: '2025-12-07T12:05:00.000Z',
  };

  const sameProjectRequester: Requester = {
    guid: '223e4567-e89b-42d3-a456-426614174000',
    projectId: '1234567890abcdef',
    username: 'otheruser',
  };

  const differentProjectRequester: Requester = {
    guid: '323e4567-e89b-42d3-a456-426614174000',
    projectId: 'fedcba0987654321',
    username: 'anotheruser',
  };

  it('should return empty object if not visible', () => {
    const privateEntry = { ...baseEntry, scope: 'private' as const };
    const redacted = redactEntry(privateEntry, sameProjectRequester);
    expect(redacted).toEqual({});
  });

  it('should return full entry for self', () => {
    const selfRequester: Requester = {
      guid: baseEntry.guid,
      projectId: baseEntry.projectId,
      username: baseEntry.username,
    };
    const redacted = redactEntry(baseEntry, selfRequester);
    expect(redacted).toEqual(baseEntry);
  });

  it('should redact sensitive fields for same-project agents', () => {
    const redacted = redactEntry(baseEntry, sameProjectRequester);
    expect(redacted).toHaveProperty('guid');
    expect(redacted).toHaveProperty('agentType');
    expect(redacted).toHaveProperty('handle');
    expect(redacted).toHaveProperty('hostname');
    expect(redacted).toHaveProperty('projectId');
    expect(redacted).toHaveProperty('natsUrl');
    expect(redacted).toHaveProperty('capabilities');
    expect(redacted).toHaveProperty('scope');
    expect(redacted).toHaveProperty('status');
    expect(redacted).toHaveProperty('currentTaskCount');
    expect(redacted).toHaveProperty('lastHeartbeat');
    expect(redacted).not.toHaveProperty('username');
    expect(redacted).not.toHaveProperty('registeredAt');
  });

  it('should not include projectId/natsUrl for different project', () => {
    const publicEntry = { ...baseEntry, scope: 'public' as const };
    const redacted = redactEntry(publicEntry, differentProjectRequester);
    expect(redacted).toHaveProperty('guid');
    expect(redacted).toHaveProperty('hostname'); // public shows hostname
    expect(redacted).not.toHaveProperty('projectId');
    expect(redacted).not.toHaveProperty('natsUrl');
  });

  it('should include username for personal scope with same user', () => {
    const personalEntry = { ...baseEntry, scope: 'personal' as const };
    const sameUserRequester: Requester = {
      guid: '423e4567-e89b-42d3-a456-426614174000',
      projectId: 'fedcba0987654321',
      username: 'testuser',
    };
    const redacted = redactEntry(personalEntry, sameUserRequester);
    expect(redacted).toHaveProperty('username', 'testuser');
  });

  it('should include hostname for public agents', () => {
    const publicEntry = { ...baseEntry, scope: 'public' as const };
    const redacted = redactEntry(publicEntry, differentProjectRequester);
    expect(redacted).toHaveProperty('hostname', 'test-host');
  });
});

describe('createRegistryEntry', () => {
  it('should create a valid registry entry with required fields', () => {
    const entry = createRegistryEntry({
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectPath: '/home/user/project',
      natsUrl: 'nats://localhost:4222',
    });

    const validation = validateRegistryEntry(entry);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it('should generate a UUID v4 for guid', () => {
    const entry = createRegistryEntry({
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectPath: '/home/user/project',
      natsUrl: 'nats://localhost:4222',
    });

    expect(entry.guid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('should generate unique guids for each call', () => {
    const entry1 = createRegistryEntry({
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectPath: '/home/user/project',
      natsUrl: 'nats://localhost:4222',
    });

    const entry2 = createRegistryEntry({
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectPath: '/home/user/project',
      natsUrl: 'nats://localhost:4222',
    });

    expect(entry1.guid).not.toBe(entry2.guid);
  });

  it('should generate consistent projectId from projectPath', () => {
    const entry1 = createRegistryEntry({
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectPath: '/home/user/project',
      natsUrl: 'nats://localhost:4222',
    });

    const entry2 = createRegistryEntry({
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectPath: '/home/user/project',
      natsUrl: 'nats://localhost:4222',
    });

    expect(entry1.projectId).toBe(entry2.projectId);
  });

  it('should use default values for optional fields', () => {
    const entry = createRegistryEntry({
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectPath: '/home/user/project',
      natsUrl: 'nats://localhost:4222',
    });

    expect(entry.capabilities).toEqual([]);
    expect(entry.scope).toBe('team');
    expect(entry.status).toBe('online');
    expect(entry.currentTaskCount).toBe(0);
    expect(entry.username).toBeUndefined();
  });

  it('should use provided optional values', () => {
    const entry = createRegistryEntry({
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectPath: '/home/user/project',
      natsUrl: 'nats://localhost:4222',
      username: 'testuser',
      capabilities: ['typescript', 'testing'],
      scope: 'personal',
    });

    expect(entry.username).toBe('testuser');
    expect(entry.capabilities).toEqual(['typescript', 'testing']);
    expect(entry.scope).toBe('personal');
  });

  it('should set registeredAt and lastHeartbeat to same ISO timestamp', () => {
    const entry = createRegistryEntry({
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectPath: '/home/user/project',
      natsUrl: 'nats://localhost:4222',
    });

    expect(entry.registeredAt).toBe(entry.lastHeartbeat);
    expect(new Date(entry.registeredAt).getTime()).toBeGreaterThan(0);
  });

  it('should create timestamps close to current time', () => {
    const before = Date.now();
    const entry = createRegistryEntry({
      agentType: 'developer',
      handle: 'TestAgent',
      hostname: 'test-host',
      projectPath: '/home/user/project',
      natsUrl: 'nats://localhost:4222',
    });
    const after = Date.now();

    const timestamp = new Date(entry.registeredAt).getTime();
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});
