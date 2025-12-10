/**
 * Configuration loading and validation
 * Supports: env vars > project config > user config > defaults
 */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import {
  type ProjectConfig,
  type ResolvedConfig,
  type ChannelConfig,
  type InternalChannel,
  DEFAULT_CHANNELS,
  DEFAULT_CONFIG,
} from './types.js';
import { createLogger } from './logger.js';

const logger = createLogger('config');

/** Valid channel name pattern */
const CHANNEL_NAME_PATTERN = /^[a-z0-9-]+$/;

/** Config file name */
const CONFIG_FILE_NAME = '.mcp-config.json';

/** User config directory */
const USER_CONFIG_DIR = '.nats-mcp';

/**
 * Parse duration string to nanoseconds
 * Supports: ns, us, ms, s, m, h, d
 */
export function parseDurationToNanos(duration: string): number {
  const match = duration.match(/^(\d+)(ns|us|ms|s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like '24h', '7d', '30m'`);
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;

  const multipliers: Record<string, number> = {
    ns: 1,
    us: 1000,
    ms: 1000000,
    s: 1000000000,
    m: 60 * 1000000000,
    h: 60 * 60 * 1000000000,
    d: 24 * 60 * 60 * 1000000000,
  };

  return value * multipliers[unit]!;
}

/**
 * Generate namespace from project path using SHA-256 hash
 */
export function generateNamespace(projectPath: string): string {
  const hash = createHash('sha256').update(projectPath).digest('hex');
  return hash.substring(0, 16);
}

/**
 * Validate channel name
 */
export function validateChannelName(name: string): void {
  if (!CHANNEL_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid channel name: "${name}". Must be lowercase alphanumeric with hyphens only (pattern: ^[a-z0-9-]+$)`
    );
  }
}

/**
 * Validate channel configuration
 */
export function validateChannelConfig(channel: ChannelConfig): void {
  validateChannelName(channel.name);

  if (!channel.description || channel.description.trim() === '') {
    throw new Error(`Channel "${channel.name}" must have a description`);
  }

  if (channel.maxMessages !== undefined && channel.maxMessages < 1) {
    throw new Error(`Channel "${channel.name}": maxMessages must be at least 1`);
  }

  if (channel.maxBytes !== undefined && channel.maxBytes < 1024) {
    throw new Error(`Channel "${channel.name}": maxBytes must be at least 1024`);
  }

  if (channel.maxAge !== undefined) {
    try {
      parseDurationToNanos(channel.maxAge);
    } catch {
      throw new Error(
        `Channel "${channel.name}": invalid maxAge format. Use format like '24h', '7d', '30m'`
      );
    }
  }
}

/**
 * Load JSON config file if it exists
 */
async function loadJsonConfig(filePath: string): Promise<ProjectConfig | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as ProjectConfig;
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to parse config file ${filePath}: ${error.message}`);
  }
}

/**
 * Search for config file in directory and parent directories
 */
async function findConfigFile(startPath: string, maxLevels: number = 5): Promise<string | null> {
  let currentPath = resolve(startPath);

  for (let i = 0; i < maxLevels; i++) {
    const configPath = join(currentPath, CONFIG_FILE_NAME);
    if (existsSync(configPath)) {
      return configPath;
    }

    const parentPath = resolve(currentPath, '..');
    if (parentPath === currentPath) {
      // Reached filesystem root
      break;
    }
    currentPath = parentPath;
  }

  return null;
}

/**
 * Convert channel config to internal representation
 */
export function toInternalChannel(
  channel: ChannelConfig,
  namespace: string
): InternalChannel {
  const maxAge = channel.maxAge ?? DEFAULT_CONFIG.maxAge;

  return {
    name: channel.name,
    description: channel.description,
    streamName: `${namespace}_${channel.name.toUpperCase().replace(/-/g, '_')}`,
    subject: `${namespace}.${channel.name}`,
    maxMessages: channel.maxMessages ?? DEFAULT_CONFIG.maxMessages,
    maxBytes: channel.maxBytes ?? DEFAULT_CONFIG.maxBytes,
    maxAgeNanos: parseDurationToNanos(maxAge),
  };
}

/**
 * Load and resolve configuration
 */
export async function loadConfig(): Promise<ResolvedConfig> {
  // Determine project path
  const projectPath = process.env['MCP_PROJECT_PATH'] ?? process.cwd();
  const resolvedProjectPath = resolve(projectPath);

  logger.debug('Loading configuration', { projectPath: resolvedProjectPath });

  // Load project config
  let projectConfig: ProjectConfig = {};
  const configFilePath = await findConfigFile(resolvedProjectPath);

  if (configFilePath) {
    logger.info('Found config file', { path: configFilePath });
    const loadedConfig = await loadJsonConfig(configFilePath);
    if (loadedConfig) {
      projectConfig = loadedConfig;
    }
  } else {
    logger.info('No config file found, using defaults');
  }

  // Load user config (lower precedence)
  const userConfigPath = join(homedir(), USER_CONFIG_DIR, 'config.json');
  const userConfig = await loadJsonConfig(userConfigPath);

  // Merge configs: env vars > project config > user config > defaults

  // NATS URL
  const natsUrl =
    process.env['NATS_URL'] ??
    projectConfig.natsUrl ??
    userConfig?.natsUrl ??
    DEFAULT_CONFIG.natsUrl;

  // Namespace
  const namespace =
    projectConfig.namespace ?? userConfig?.namespace ?? generateNamespace(resolvedProjectPath);

  // Validate namespace
  if (!CHANNEL_NAME_PATTERN.test(namespace)) {
    throw new Error(
      `Invalid namespace: "${namespace}". Must be lowercase alphanumeric with hyphens only`
    );
  }

  // Channels
  const channelConfigs = projectConfig.channels ?? userConfig?.channels ?? DEFAULT_CHANNELS;

  // Validate channels
  const seenNames = new Set<string>();
  for (const channel of channelConfigs) {
    validateChannelConfig(channel);

    if (seenNames.has(channel.name)) {
      throw new Error(`Duplicate channel name: "${channel.name}"`);
    }
    seenNames.add(channel.name);
  }

  // Apply defaults to channels
  const channels = channelConfigs.map((ch) => ({
    name: ch.name,
    description: ch.description,
    maxMessages: ch.maxMessages ?? DEFAULT_CONFIG.maxMessages,
    maxBytes: ch.maxBytes ?? DEFAULT_CONFIG.maxBytes,
    maxAge: ch.maxAge ?? DEFAULT_CONFIG.maxAge,
  }));

  // Logging
  const logLevel = (process.env['LOG_LEVEL']?.toUpperCase() ??
    projectConfig.logging?.level ??
    userConfig?.logging?.level ??
    DEFAULT_CONFIG.logging.level) as ResolvedConfig['logging']['level'];

  const logFormat = (process.env['LOG_FORMAT']?.toLowerCase() ??
    projectConfig.logging?.format ??
    userConfig?.logging?.format ??
    DEFAULT_CONFIG.logging.format) as ResolvedConfig['logging']['format'];

  // Work queue configuration
  const ackTimeoutMs =
    (process.env['WORKQUEUE_ACK_TIMEOUT']
      ? parseInt(process.env['WORKQUEUE_ACK_TIMEOUT'], 10)
      : undefined) ??
    projectConfig.workQueue?.ackTimeoutMs ??
    userConfig?.workQueue?.ackTimeoutMs ??
    DEFAULT_CONFIG.workQueue.ackTimeoutMs;

  const maxDeliveryAttempts =
    (process.env['WORKQUEUE_MAX_ATTEMPTS']
      ? parseInt(process.env['WORKQUEUE_MAX_ATTEMPTS'], 10)
      : undefined) ??
    projectConfig.workQueue?.maxDeliveryAttempts ??
    userConfig?.workQueue?.maxDeliveryAttempts ??
    DEFAULT_CONFIG.workQueue.maxDeliveryAttempts;

  const deadLetterTTLMs =
    (process.env['WORKQUEUE_DLQ_TTL']
      ? parseInt(process.env['WORKQUEUE_DLQ_TTL'], 10)
      : undefined) ??
    projectConfig.workQueue?.deadLetterTTLMs ??
    userConfig?.workQueue?.deadLetterTTLMs ??
    DEFAULT_CONFIG.workQueue.deadLetterTTLMs;

  // Project ID - can be explicitly set or derived from path
  const explicitProjectId = process.env['LOOM_PROJECT_ID'];
  const projectId = explicitProjectId ?? generateNamespace(resolvedProjectPath);

  // Validate project ID format (16-char hex)
  if (!/^[a-f0-9]{16}$/.test(projectId) && explicitProjectId) {
    // If explicitly set but wrong format, generate one instead
    logger.warn('Invalid LOOM_PROJECT_ID format, must be 16-char hex. Using generated ID.', {
      provided: explicitProjectId,
      generated: generateNamespace(resolvedProjectPath),
    });
  }

  const config: ResolvedConfig = {
    namespace,
    channels,
    natsUrl,
    logging: {
      level: logLevel,
      format: logFormat,
    },
    workQueue: {
      ackTimeoutMs,
      maxDeliveryAttempts,
      deadLetterTTLMs,
    },
    projectPath: resolvedProjectPath,
    projectId: /^[a-f0-9]{16}$/.test(projectId) ? projectId : generateNamespace(resolvedProjectPath),
  };

  logger.info('Configuration loaded', {
    namespace: config.namespace,
    channelCount: config.channels.length,
    natsUrl: config.natsUrl,
    projectId: config.projectId,
    projectIdSource: explicitProjectId ? 'LOOM_PROJECT_ID env var' : 'derived from path',
  });

  return config;
}

/**
 * Get internal channels from resolved config
 */
export function getInternalChannels(config: ResolvedConfig): InternalChannel[] {
  return config.channels.map((ch) => toInternalChannel(ch, config.namespace));
}

/**
 * Find channel by name
 */
export function findChannel(
  channels: InternalChannel[],
  name: string
): InternalChannel | undefined {
  return channels.find((ch) => ch.name === name);
}

/**
 * Get list of valid channel names
 */
export function getChannelNames(channels: InternalChannel[]): string[] {
  return channels.map((ch) => ch.name);
}
