/**
 * Tests for NATS URL parsing, authentication, and transport detection
 */

import { describe, it, expect } from 'vitest';
import { parseNatsUrl, detectTransport } from './nats.js';

describe('detectTransport', () => {
  it('should detect TCP for nats:// URLs', () => {
    expect(detectTransport('nats://localhost:4222')).toBe('tcp');
  });

  it('should detect TCP for tls:// URLs', () => {
    expect(detectTransport('tls://localhost:4222')).toBe('tcp');
  });

  it('should detect WebSocket for wss:// URLs', () => {
    expect(detectTransport('wss://nats.example.com')).toBe('websocket');
  });

  it('should detect WebSocket for ws:// URLs', () => {
    expect(detectTransport('ws://localhost:8080')).toBe('websocket');
  });

  it('should detect TCP for bare host:port', () => {
    expect(detectTransport('localhost:4222')).toBe('tcp');
  });

  it('should be case-insensitive', () => {
    expect(detectTransport('WSS://nats.example.com')).toBe('websocket');
    expect(detectTransport('NATS://localhost:4222')).toBe('tcp');
  });
});

describe('parseNatsUrl', () => {
  describe('TCP URLs without authentication', () => {
    it('should parse simple nats URL', () => {
      const result = parseNatsUrl('nats://localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        transport: 'tcp',
      });
    });

    it('should parse URL with hostname', () => {
      const result = parseNatsUrl('nats://nats.example.com:4222');
      expect(result).toEqual({
        server: 'nats://nats.example.com:4222',
        transport: 'tcp',
      });
    });

    it('should parse URL without port', () => {
      const result = parseNatsUrl('nats://localhost');
      expect(result).toEqual({
        server: 'nats://localhost',
        transport: 'tcp',
      });
    });

    it('should handle IP address', () => {
      const result = parseNatsUrl('nats://192.168.1.100:4222');
      expect(result).toEqual({
        server: 'nats://192.168.1.100:4222',
        transport: 'tcp',
      });
    });
  });

  describe('TCP URLs with authentication', () => {
    it('should parse URL with user and password', () => {
      const result = parseNatsUrl('nats://myuser:mypass@localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        user: 'myuser',
        pass: 'mypass',
        transport: 'tcp',
      });
    });

    it('should parse URL with user only', () => {
      const result = parseNatsUrl('nats://myuser@localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        user: 'myuser',
        transport: 'tcp',
      });
    });

    it('should handle URL-encoded credentials', () => {
      const result = parseNatsUrl('nats://user%40domain:p%40ss%2Fword@localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        user: 'user@domain',
        pass: 'p@ss/word',
        transport: 'tcp',
      });
    });

    it('should handle password with special characters', () => {
      const result = parseNatsUrl('nats://agent:FxZWmPIV6rzDC4i6xuk9AEJ9Kd5sMpFi58%2FOAtr7INQ%3D@nats.example.com:4222');
      expect(result).toEqual({
        server: 'nats://nats.example.com:4222',
        user: 'agent',
        pass: 'FxZWmPIV6rzDC4i6xuk9AEJ9Kd5sMpFi58/OAtr7INQ=',
        transport: 'tcp',
      });
    });

    it('should handle base64-like passwords without encoding', () => {
      const result = parseNatsUrl('nats://admin:sxbJZgRH5quUu7weyiX1cF2g30vtZwTuSePL9V70I@localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        user: 'admin',
        pass: 'sxbJZgRH5quUu7weyiX1cF2g30vtZwTuSePL9V70I',
        transport: 'tcp',
      });
    });

    it('should preserve credentials with plus signs', () => {
      const result = parseNatsUrl('nats://user:pass%2Bword@localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        user: 'user',
        pass: 'pass+word',
        transport: 'tcp',
      });
    });
  });

  describe('WebSocket URLs', () => {
    it('should parse simple wss URL', () => {
      const result = parseNatsUrl('wss://nats.example.com');
      expect(result).toEqual({
        server: 'wss://nats.example.com/',
        transport: 'websocket',
      });
    });

    it('should parse wss URL with path', () => {
      const result = parseNatsUrl('wss://nats.example.com/nats');
      expect(result).toEqual({
        server: 'wss://nats.example.com/nats',
        transport: 'websocket',
      });
    });

    it('should parse wss URL with port', () => {
      const result = parseNatsUrl('wss://nats.example.com:8443/nats');
      expect(result).toEqual({
        server: 'wss://nats.example.com:8443/nats',
        transport: 'websocket',
      });
    });

    it('should parse wss URL with default port (443 stripped)', () => {
      // Standard ports (443 for wss) are stripped by URL parser
      const result = parseNatsUrl('wss://nats.example.com:443/nats');
      expect(result).toEqual({
        server: 'wss://nats.example.com/nats',
        transport: 'websocket',
      });
    });

    it('should parse ws URL (insecure)', () => {
      const result = parseNatsUrl('ws://localhost:8080');
      expect(result).toEqual({
        server: 'ws://localhost:8080/',
        transport: 'websocket',
      });
    });

    it('should parse wss URL with authentication', () => {
      const result = parseNatsUrl('wss://agent:secret@nats.example.com/nats');
      expect(result).toEqual({
        server: 'wss://nats.example.com/nats',
        user: 'agent',
        pass: 'secret',
        transport: 'websocket',
      });
    });

    it('should parse wss URL with URL-encoded credentials', () => {
      const result = parseNatsUrl('wss://user:p%40ss%2Fword@nats.example.com/nats');
      expect(result).toEqual({
        server: 'wss://nats.example.com/nats',
        user: 'user',
        pass: 'p@ss/word',
        transport: 'websocket',
      });
    });

    it('should preserve query string in WebSocket URL', () => {
      const result = parseNatsUrl('wss://nats.example.com/nats?token=abc');
      expect(result).toEqual({
        server: 'wss://nats.example.com/nats?token=abc',
        transport: 'websocket',
      });
    });
  });

  describe('edge cases', () => {
    it('should handle bare hostname (treats as nats://)', () => {
      // Bare hostnames without scheme are treated as nats://
      const result = parseNatsUrl('localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        transport: 'tcp',
      });
    });

    it('should handle empty string', () => {
      const result = parseNatsUrl('');
      expect(result).toEqual({
        server: '',
        transport: 'tcp',
      });
    });

    it('should handle URL with empty password (no pass returned)', () => {
      const result = parseNatsUrl('nats://user:@localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        user: 'user',
        transport: 'tcp',
      });
    });

    it('should handle tls:// scheme', () => {
      const result = parseNatsUrl('tls://nats.example.com:4222');
      expect(result).toEqual({
        server: 'nats://nats.example.com:4222',
        transport: 'tcp',
      });
    });
  });
});
