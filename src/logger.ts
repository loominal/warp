/**
 * Structured logging module
 * Logs to stderr in JSON or text format
 */

import type { Logger } from './types.js';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type LogFormat = 'json' | 'text';

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let currentLevel: LogLevel = 'INFO';
let currentFormat: LogFormat = 'json';

/**
 * Configure the logger
 */
export function configureLogger(level: LogLevel, format: LogFormat): void {
  currentLevel = level;
  currentFormat = format;
}

/**
 * Get current log level from environment or default
 */
export function getLogLevelFromEnv(): LogLevel {
  const envLevel = process.env['LOG_LEVEL']?.toUpperCase();
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel as LogLevel;
  }
  return 'INFO';
}

/**
 * Get current log format from environment or default
 */
export function getLogFormatFromEnv(): LogFormat {
  const envFormat = process.env['LOG_FORMAT']?.toLowerCase();
  if (envFormat === 'text' || envFormat === 'json') {
    return envFormat;
  }
  return 'json';
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(
  level: LogLevel,
  component: string,
  message: string,
  data?: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString();

  if (currentFormat === 'json') {
    return JSON.stringify({
      timestamp,
      level,
      component,
      message,
      ...data,
    });
  }

  // Text format
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `[${timestamp}] ${level} [${component}] ${message}${dataStr}`;
}

function log(
  level: LogLevel,
  component: string,
  message: string,
  data?: Record<string, unknown>
): void {
  if (shouldLog(level)) {
    console.error(formatMessage(level, component, message, data));
  }
}

/**
 * Create a logger instance for a specific component
 */
export function createLogger(component: string): Logger {
  return {
    debug: (message: string, data?: Record<string, unknown>) =>
      log('DEBUG', component, message, data),
    info: (message: string, data?: Record<string, unknown>) =>
      log('INFO', component, message, data),
    warn: (message: string, data?: Record<string, unknown>) =>
      log('WARN', component, message, data),
    error: (message: string, data?: Record<string, unknown>) =>
      log('ERROR', component, message, data),
  };
}

// Initialize from environment
configureLogger(getLogLevelFromEnv(), getLogFormatFromEnv());
