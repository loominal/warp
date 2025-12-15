/**
 * Tests for JetStream stream operations module
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  ensureStream,
  ensureAllStreams,
  publishMessage,
  readMessages,
  getStreamInfo,
} from './streams.js';
import type { InternalChannel } from './types.js';

// Mock the nats module
vi.mock('./nats.js', () => ({
  getJetStreamManager: vi.fn(),
  getJetStreamClient: vi.fn(),
}));

// Mock the logger module
vi.mock('./logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Import mocked modules
import { getJetStreamManager, getJetStreamClient } from './nats.js';

// Mock type interfaces
interface MockJetStreamManager {
  streams: {
    info: Mock;
    add: Mock;
    update: Mock;
    get: Mock;
  };
}

interface MockJetStreamClient {
  publish: Mock;
}

interface MockStream {
  getMessage: Mock;
}

describe('ensureStream', () => {
  let mockJsm: MockJetStreamManager;
  let mockChannel: InternalChannel;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannel = {
      name: 'test-channel',
      description: 'Test channel',
      streamName: 'TEST_STREAM',
      subject: 'test.subject',
      maxMessages: 10000,
      maxBytes: 10485760,
      maxAgeNanos: 86400000000000,
    };

    mockJsm = {
      streams: {
        info: vi.fn(),
        add: vi.fn(),
        update: vi.fn(),
      },
    };

    vi.mocked(getJetStreamManager).mockReturnValue(mockJsm);
  });

  it('should create a new stream when it does not exist', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));
    mockJsm.streams.add.mockResolvedValue({});

    await ensureStream(mockChannel);

    expect(mockJsm.streams.info).toHaveBeenCalledWith('TEST_STREAM');
    expect(mockJsm.streams.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'TEST_STREAM',
        subjects: ['test.subject'],
        max_msgs: 10000,
        max_bytes: 10485760,
        max_age: 86400000000000,
        num_replicas: 1,
      })
    );
  });

  it('should not create a stream when it already exists', async () => {
    mockJsm.streams.info.mockResolvedValue({
      config: { name: 'TEST_STREAM' },
      state: { messages: 0 },
    });

    await ensureStream(mockChannel);

    expect(mockJsm.streams.info).toHaveBeenCalledWith('TEST_STREAM');
    expect(mockJsm.streams.add).not.toHaveBeenCalled();
  });

  it('should handle "already in use" error gracefully', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));
    mockJsm.streams.add.mockRejectedValue(new Error('stream name already in use'));

    await expect(ensureStream(mockChannel)).resolves.not.toThrow();

    expect(mockJsm.streams.add).toHaveBeenCalled();
  });

  it('should throw error for other stream creation failures', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));
    mockJsm.streams.add.mockRejectedValue(new Error('permission denied'));

    await expect(ensureStream(mockChannel)).rejects.toThrow(
      'Failed to create stream TEST_STREAM: permission denied'
    );
  });

  it('should use correct stream configuration', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));
    mockJsm.streams.add.mockResolvedValue({});

    await ensureStream(mockChannel);

    const addCall = mockJsm.streams.add.mock.calls[0][0];
    expect(addCall.name).toBe('TEST_STREAM');
    expect(addCall.subjects).toEqual(['test.subject']);
    expect(addCall.max_msgs).toBe(10000);
    expect(addCall.max_bytes).toBe(10485760);
    expect(addCall.max_age).toBe(86400000000000);
    expect(addCall.num_replicas).toBe(1);
  });
});

describe('ensureAllStreams', () => {
  let mockJsm: MockJetStreamManager;
  let mockChannels: InternalChannel[];

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannels = [
      {
        name: 'channel1',
        description: 'Channel 1',
        streamName: 'STREAM1',
        subject: 'test.channel1',
        maxMessages: 5000,
        maxBytes: 5242880,
        maxAgeNanos: 3600000000000,
      },
      {
        name: 'channel2',
        description: 'Channel 2',
        streamName: 'STREAM2',
        subject: 'test.channel2',
        maxMessages: 10000,
        maxBytes: 10485760,
        maxAgeNanos: 7200000000000,
      },
    ];

    mockJsm = {
      streams: {
        info: vi.fn(),
        add: vi.fn(),
      },
    };

    vi.mocked(getJetStreamManager).mockReturnValue(mockJsm);
  });

  it('should create all streams', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));
    mockJsm.streams.add.mockResolvedValue({});

    await ensureAllStreams(mockChannels);

    expect(mockJsm.streams.info).toHaveBeenCalledTimes(2);
    expect(mockJsm.streams.add).toHaveBeenCalledTimes(2);
    expect(mockJsm.streams.info).toHaveBeenCalledWith('STREAM1');
    expect(mockJsm.streams.info).toHaveBeenCalledWith('STREAM2');
  });

  it('should handle empty channel list', async () => {
    await ensureAllStreams([]);

    expect(mockJsm.streams.info).not.toHaveBeenCalled();
    expect(mockJsm.streams.add).not.toHaveBeenCalled();
  });

  it('should process streams sequentially', async () => {
    const callOrder: string[] = [];
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));
    mockJsm.streams.add.mockImplementation(async (config: { name: string }) => {
      callOrder.push(config.name);
      return {};
    });

    await ensureAllStreams(mockChannels);

    expect(callOrder).toEqual(['STREAM1', 'STREAM2']);
  });
});


describe('publishMessage', () => {
  let mockJs: MockJetStreamClient;
  let mockChannel: InternalChannel;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannel = {
      name: 'test-channel',
      description: 'Test channel',
      streamName: 'TEST_STREAM',
      subject: 'test.subject',
      maxMessages: 10000,
      maxBytes: 10485760,
      maxAgeNanos: 86400000000000,
    };

    mockJs = {
      publish: vi.fn(),
    };

    vi.mocked(getJetStreamClient).mockReturnValue(mockJs);
  });

  it('should publish message to correct subject', async () => {
    mockJs.publish.mockResolvedValue({ seq: 1, stream: 'TEST_STREAM' });

    await publishMessage(mockChannel, 'test payload');

    expect(mockJs.publish).toHaveBeenCalledWith('test.subject', expect.any(Buffer));
    const buffer = mockJs.publish.mock.calls[0][1];
    expect(buffer.toString()).toBe('test payload');
  });

  it('should handle successful publish with acknowledgment', async () => {
    mockJs.publish.mockResolvedValue({ seq: 42, stream: 'TEST_STREAM' });

    await expect(publishMessage(mockChannel, 'test message')).resolves.not.toThrow();

    expect(mockJs.publish).toHaveBeenCalled();
  });

  it('should throw error when publish fails', async () => {
    mockJs.publish.mockRejectedValue(new Error('stream unavailable'));

    await expect(publishMessage(mockChannel, 'test message')).rejects.toThrow(
      'Failed to publish message to test-channel: stream unavailable'
    );
  });

  it('should convert string payload to Buffer', async () => {
    mockJs.publish.mockResolvedValue({ seq: 1, stream: 'TEST_STREAM' });

    await publishMessage(mockChannel, 'Hello, World!');

    const buffer = mockJs.publish.mock.calls[0][1];
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString()).toBe('Hello, World!');
  });

  it('should publish to correct channel subject', async () => {
    const channel: InternalChannel = {
      ...mockChannel,
      subject: 'custom.subject.path',
    };

    mockJs.publish.mockResolvedValue({ seq: 1, stream: 'TEST_STREAM' });

    await publishMessage(channel, 'test');

    expect(mockJs.publish).toHaveBeenCalledWith('custom.subject.path', expect.any(Buffer));
  });
});

describe('readMessages', () => {
  let mockJsm: MockJetStreamManager;
  let mockStream: MockStream;
  let mockChannel: InternalChannel;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannel = {
      name: 'test-channel',
      description: 'Test channel',
      streamName: 'TEST_STREAM',
      subject: 'test.subject',
      maxMessages: 10000,
      maxBytes: 10485760,
      maxAgeNanos: 86400000000000,
    };

    mockStream = {
      getMessage: vi.fn(),
    };

    mockJsm = {
      streams: {
        info: vi.fn(),
        get: vi.fn().mockResolvedValue(mockStream),
      },
    };

    vi.mocked(getJetStreamManager).mockReturnValue(mockJsm);
  });

  it('should read messages from stream using direct access', async () => {
    mockJsm.streams.info.mockResolvedValue({
      state: { first_seq: 1, last_seq: 2, messages: 2 },
    });

    mockStream.getMessage
      .mockResolvedValueOnce({ data: new TextEncoder().encode('message 1') })
      .mockResolvedValueOnce({ data: new TextEncoder().encode('message 2') });

    const result = await readMessages(mockChannel, 10);

    expect(result).toHaveLength(2);
    expect(result[0].data).toBe('message 1');
    expect(result[1].data).toBe('message 2');
  });

  it('should return newest messages when limit is less than total', async () => {
    // Stream has messages 1-100, we want last 5 (96-100)
    mockJsm.streams.info.mockResolvedValue({
      state: { first_seq: 1, last_seq: 100, messages: 100 },
    });

    mockStream.getMessage
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 96') })
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 97') })
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 98') })
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 99') })
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 100') });

    const result = await readMessages(mockChannel, 5);

    expect(result).toHaveLength(5);
    expect(result[0].data).toBe('msg 96');
    expect(result[4].data).toBe('msg 100');
    // Should start from seq 96 (100 - 5 + 1)
    expect(mockStream.getMessage).toHaveBeenCalledWith({ seq: 96 });
  });

  it('should return empty array when stream has no messages', async () => {
    mockJsm.streams.info.mockResolvedValue({
      state: { first_seq: 0, last_seq: 0, messages: 0 },
    });

    const result = await readMessages(mockChannel, 10);

    expect(result).toEqual([]);
    expect(mockStream.getMessage).not.toHaveBeenCalled();
  });

  it('should return empty array when stream does not exist', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));

    const result = await readMessages(mockChannel, 10);

    expect(result).toEqual([]);
  });

  it('should throw error for other failures', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('permission denied'));

    await expect(readMessages(mockChannel, 10)).rejects.toThrow(
      'Failed to read messages from test-channel: permission denied'
    );
  });

  it('should skip gaps in sequence numbers (deleted messages)', async () => {
    mockJsm.streams.info.mockResolvedValue({
      state: { first_seq: 1, last_seq: 5, messages: 3 },
    });

    mockStream.getMessage
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 1') })
      .mockRejectedValueOnce(new Error('no message found')) // seq 2 deleted
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 3') })
      .mockRejectedValueOnce(new Error('no message found')) // seq 4 deleted
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 5') });

    const result = await readMessages(mockChannel, 10);

    expect(result).toHaveLength(3);
    expect(result[0].data).toBe('msg 1');
    expect(result[1].data).toBe('msg 3');
    expect(result[2].data).toBe('msg 5');
  });

  it('should handle first_seq > 1 (old messages expired)', async () => {
    // Messages 1-50 expired, only 51-100 remain
    mockJsm.streams.info.mockResolvedValue({
      state: { first_seq: 51, last_seq: 100, messages: 50 },
    });

    mockStream.getMessage
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 96') })
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 97') })
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 98') })
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 99') })
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 100') });

    const result = await readMessages(mockChannel, 5);

    expect(result).toHaveLength(5);
    // Should start from seq 96, not try to read below first_seq
    expect(mockStream.getMessage).toHaveBeenCalledWith({ seq: 96 });
  });

  it('should respect first_seq when limit exceeds available messages', async () => {
    // Only 3 messages available (seq 98-100), but limit is 10
    mockJsm.streams.info.mockResolvedValue({
      state: { first_seq: 98, last_seq: 100, messages: 3 },
    });

    mockStream.getMessage
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 98') })
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 99') })
      .mockResolvedValueOnce({ data: new TextEncoder().encode('msg 100') });

    const result = await readMessages(mockChannel, 10);

    expect(result).toHaveLength(3);
    // Should start from first_seq (98), not go negative
    expect(mockStream.getMessage).toHaveBeenCalledWith({ seq: 98 });
  });
});

describe('getStreamInfo', () => {
  let mockJsm: MockJetStreamManager;
  let mockChannel: InternalChannel;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannel = {
      name: 'test-channel',
      description: 'Test channel',
      streamName: 'TEST_STREAM',
      subject: 'test.subject',
      maxMessages: 10000,
      maxBytes: 10485760,
      maxAgeNanos: 86400000000000,
    };

    mockJsm = {
      streams: {
        info: vi.fn(),
      },
    };

    vi.mocked(getJetStreamManager).mockReturnValue(mockJsm);
  });

  it('should return stream info when stream exists', async () => {
    mockJsm.streams.info.mockResolvedValue({
      state: {
        messages: 42,
        bytes: 1024,
        first_seq: 1,
        last_seq: 42,
      },
    });

    const result = await getStreamInfo(mockChannel);

    expect(result).toEqual({
      messages: 42,
      bytes: 1024,
      firstSeq: 1,
      lastSeq: 42,
    });
  });

  it('should return null when stream does not exist', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));

    const result = await getStreamInfo(mockChannel);

    expect(result).toBeNull();
  });

  it('should handle empty stream', async () => {
    mockJsm.streams.info.mockResolvedValue({
      state: {
        messages: 0,
        bytes: 0,
        first_seq: 0,
        last_seq: 0,
      },
    });

    const result = await getStreamInfo(mockChannel);

    expect(result).toEqual({
      messages: 0,
      bytes: 0,
      firstSeq: 0,
      lastSeq: 0,
    });
  });

  it('should handle stream with many messages', async () => {
    mockJsm.streams.info.mockResolvedValue({
      state: {
        messages: 1000000,
        bytes: 524288000,
        first_seq: 1,
        last_seq: 1000000,
      },
    });

    const result = await getStreamInfo(mockChannel);

    expect(result).toEqual({
      messages: 1000000,
      bytes: 524288000,
      firstSeq: 1,
      lastSeq: 1000000,
    });
  });

  it('should call streams.info with correct stream name', async () => {
    const channel: InternalChannel = {
      ...mockChannel,
      streamName: 'CUSTOM_STREAM_NAME',
    };

    mockJsm.streams.info.mockResolvedValue({
      state: {
        messages: 10,
        bytes: 100,
        first_seq: 1,
        last_seq: 10,
      },
    });

    await getStreamInfo(channel);

    expect(mockJsm.streams.info).toHaveBeenCalledWith('CUSTOM_STREAM_NAME');
  });

  it('should return null for any stream error', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('connection timeout'));

    const result = await getStreamInfo(mockChannel);

    expect(result).toBeNull();
  });
});
