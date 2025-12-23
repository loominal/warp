/**
 * GUID Format Consistency Tests
 *
 * This test suite ensures that all components of Warp use consistent GUID formats.
 *
 * Issue identified: Agent registration generates 32-char hex GUIDs while some tools
 * expect UUID v4 format with hyphens.
 *
 * Expected format: UUID v4 (e.g., "550e8400-e29b-41d4-a716-446655440000")
 * Current format (registry): 32-char hex (e.g., "5e77acfc77c69a8c6e2561f7b98b03b0")
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectToNats, disconnect } from '../nats.js';
import type { NatsConnection } from 'nats';
import {
  handleRegisterAgent,
  handleDiscoverAgents,
  handleSendDirectMessage,
  handleGetAgentInfo,
} from './registry.js';
import type { SessionState, ResolvedConfig } from '../types.js';
import { loadConfig } from '../config.js';

let config: ResolvedConfig;
let sessionState: SessionState;

// UUID v4 regex pattern
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 32-char hex pattern (current format)
const HEX_32_PATTERN = /^[0-9a-f]{32}$/i;

beforeAll(async () => {
  await connectToNats('nats://localhost:4222');
  config = await loadConfig();
});

afterAll(async () => {
  await disconnect();
});

beforeEach(() => {
  // Reset session state for each test
  sessionState = {
    handle: 'guid-test-agent',
    agentGuid: undefined,
  };
});

describe('GUID Format Consistency', () => {
  describe('Agent Registration', () => {
    it('should generate GUIDs in UUID v4 format', async () => {
      const result = await handleRegisterAgent(
        {
          agentType: 'tester',
          capabilities: ['typescript'],
          scope: 'team',
        },
        sessionState,
        config
      );

      expect(result.isError).toBeFalsy();
      expect(sessionState.agentGuid).toBeDefined();

      // Extract GUID from response text
      const guidMatch = sessionState.agentGuid;

      if (guidMatch) {
        console.log('Generated GUID:', guidMatch);

        // Check if it's UUID v4 format
        const isUuidV4 = UUID_V4_PATTERN.test(guidMatch);
        const isHex32 = HEX_32_PATTERN.test(guidMatch);

        console.log('Is UUID v4:', isUuidV4);
        console.log('Is 32-char hex:', isHex32);

        // FAIL if it's hex32 but not UUID v4
        if (isHex32 && !isUuidV4) {
          throw new Error(
            `GUID format inconsistency: Generated hex format (${guidMatch}) instead of UUID v4. ` +
              'This will cause compatibility issues with tools that expect UUID v4 format.'
          );
        }

        // PASS if it's UUID v4
        expect(isUuidV4).toBe(true);
      }
    });

    it('should generate consistent GUID format across multiple registrations', async () => {
      const guids: string[] = [];

      // Register 3 agents
      for (let i = 0; i < 3; i++) {
        const state: SessionState = {
          handle: `test-agent-${i}`,
          agentGuid: undefined,
        };

        await handleRegisterAgent(
          {
            agentType: 'tester',
            capabilities: ['typescript'],
            scope: 'team',
          },
          state,
          config
        );

        if (state.agentGuid) {
          guids.push(state.agentGuid);
        }
      }

      expect(guids.length).toBe(3);

      // Check all GUIDs use the same format
      const allUuidV4 = guids.every((guid) => UUID_V4_PATTERN.test(guid));
      const allHex32 = guids.every((guid) => HEX_32_PATTERN.test(guid));

      console.log('GUIDs generated:', guids);
      console.log('All UUID v4:', allUuidV4);
      console.log('All hex32:', allHex32);

      // All should be the same format
      expect(allUuidV4 || allHex32).toBe(true);

      // Prefer UUID v4
      if (allHex32 && !allUuidV4) {
        throw new Error(
          'All GUIDs are in hex32 format but should be UUID v4 for consistency with tool validation'
        );
      }

      expect(allUuidV4).toBe(true);
    });
  });

  describe('Agent Discovery', () => {
    it('should return GUIDs in consistent format', async () => {
      // Register an agent
      const registerState: SessionState = {
        handle: 'discovery-test-agent',
        agentGuid: undefined,
      };

      await handleRegisterAgent(
        {
          agentType: 'developer',
          capabilities: ['typescript'],
          scope: 'team',
        },
        registerState,
        config
      );

      // Discover agents (reuse same agent for discovery)
      const result = await handleDiscoverAgents({}, registerState, config);

      if (result.isError) {
        console.log('Discovery error:', result.content[0]?.text);
      }
      expect(result.isError).toBeFalsy();
      const responseText = result.content[0]?.text || '';

      // Extract GUIDs from response
      const guidMatches = responseText.match(/GUID: ([0-9a-f-]+)/gi) || [];
      const guids = guidMatches.map((match) =>
        match.replace(/GUID: /i, '').trim()
      );

      console.log('Discovered GUIDs:', guids);

      if (guids.length > 0) {
        // Check all discovered GUIDs
        for (const guid of guids) {
          const isUuidV4 = UUID_V4_PATTERN.test(guid);
          const isHex32 = HEX_32_PATTERN.test(guid);

          console.log(`GUID ${guid}: UUID v4=${isUuidV4}, Hex32=${isHex32}`);

          if (isHex32 && !isUuidV4) {
            throw new Error(
              `discover_agents returned hex32 GUID (${guid}) but should return UUID v4`
            );
          }

          expect(isUuidV4).toBe(true);
        }
      }
    });
  });

  describe('Direct Messaging GUID Validation', () => {
    it('should accept GUIDs generated by register_agent', async () => {
      // Register sender
      const senderState: SessionState = {
        handle: 'sender-agent',
        agentGuid: undefined,
      };

      await handleRegisterAgent(
        {
          agentType: 'sender',
          capabilities: ['typescript'],
          scope: 'team',
        },
        senderState,
        config
      );

      // Register recipient
      const recipientState: SessionState = {
        handle: 'recipient-agent',
        agentGuid: undefined,
      };

      await handleRegisterAgent(
        {
          agentType: 'recipient',
          capabilities: ['typescript'],
          scope: 'team',
        },
        recipientState,
        config
      );

      const recipientGuid = recipientState.agentGuid!;

      console.log('Attempting to send DM to GUID:', recipientGuid);
      console.log('Is UUID v4:', UUID_V4_PATTERN.test(recipientGuid));
      console.log('Is hex32:', HEX_32_PATTERN.test(recipientGuid));

      // Attempt to send direct message using the generated GUID
      const result = await handleSendDirectMessage(
        {
          recipientGuid,
          message: 'Test message',
          messageType: 'text',
        },
        senderState,
        config
      );

      // This should succeed if GUID formats are consistent
      if (result.isError) {
        const errorMessage = result.content[0]?.text || '';
        console.log('Error:', errorMessage);

        if (errorMessage.includes('Invalid recipientGuid format')) {
          throw new Error(
            `GUID format validation failed: register_agent generated "${recipientGuid}" ` +
              `but send_direct_message rejected it. This indicates GUID format inconsistency.`
          );
        }
      }

      expect(result.isError).toBeFalsy();
    });

    it('should reject malformed GUIDs', async () => {
      const senderState: SessionState = {
        handle: 'sender',
        agentGuid: '550e8400-e29b-41d4-a716-446655440000',
      };

      const malformedGuids = [
        'not-a-guid',
        '12345',
        'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
        '550e8400e29b41d4a716446655440000', // UUID without hyphens (if we expect hyphens)
        '', // Empty
      ];

      for (const badGuid of malformedGuids) {
        const result = await handleSendDirectMessage(
          {
            recipientGuid: badGuid,
            message: 'Test',
            messageType: 'text',
          },
          senderState,
          config
        );

        // Should fail validation
        expect(result.isError).toBe(true);
        const errorMessage = result.content[0]?.text || '';
        expect(errorMessage).toContain('Invalid recipientGuid');
      }
    });
  });

  describe('get_agent_info GUID Validation', () => {
    it('should accept GUIDs from register_agent', async () => {
      // Register an agent
      const registerState: SessionState = {
        handle: 'info-test-agent',
        agentGuid: undefined,
      };

      await handleRegisterAgent(
        {
          agentType: 'tester',
          capabilities: ['typescript'],
          scope: 'team',
        },
        registerState,
        config
      );

      const agentGuid = registerState.agentGuid!;

      // Try to get info using the generated GUID (reuse same agent)
      const result = await handleGetAgentInfo(
        { guid: agentGuid },
        registerState,
        config
      );

      if (result.isError) {
        const errorMessage = result.content[0]?.text || '';
        console.log('get_agent_info error:', errorMessage);

        if (errorMessage.includes('Invalid GUID format')) {
          throw new Error(
            `get_agent_info rejected GUID "${agentGuid}" generated by register_agent. ` +
              'GUID format inconsistency detected.'
          );
        }
      }

      expect(result.isError).toBeFalsy();
    });
  });

  describe('Cross-Tool GUID Compatibility', () => {
    it('should allow full workflow: register → discover → get_info → send_dm', async () => {
      // Step 1: Register agent A
      const agentAState: SessionState = {
        handle: 'workflow-agent-a',
        agentGuid: undefined,
      };

      await handleRegisterAgent(
        {
          agentType: 'developer',
          capabilities: ['typescript'],
          scope: 'team',
        },
        agentAState,
        config
      );

      const guidA = agentAState.agentGuid!;
      console.log('Step 1 - Registered agent A with GUID:', guidA);

      // Step 2: Register agent B (will discover and message A)
      const agentBState: SessionState = {
        handle: 'workflow-agent-b',
        agentGuid: undefined,
      };

      await handleRegisterAgent(
        {
          agentType: 'reviewer',
          capabilities: ['code-review'],
          scope: 'team',
        },
        agentBState,
        config
      );

      console.log('Step 2 - Registered agent B');

      // Step 3: Agent B discovers agents
      const discoverResult = await handleDiscoverAgents(
        { agentType: 'developer' },
        agentBState,
        config
      );

      expect(discoverResult.isError).toBeFalsy();
      const discoverText = discoverResult.content[0]?.text || '';

      // Extract GUID from discovery results
      const guidMatch = discoverText.match(
        /GUID: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})/i
      );
      const discoveredGuid = guidMatch ? guidMatch[1] : null;

      console.log('Step 3 - Discovered GUID:', discoveredGuid);

      expect(discoveredGuid).toBe(guidA);

      // Step 4: Get detailed info about discovered agent
      const infoResult = await handleGetAgentInfo(
        { guid: discoveredGuid! },
        agentBState,
        config
      );

      if (infoResult.isError) {
        const errorMessage = infoResult.content[0]?.text || '';
        throw new Error(
          `Step 4 failed: get_agent_info rejected GUID from discover_agents. ` +
            `Error: ${errorMessage}`
        );
      }

      expect(infoResult.isError).toBeFalsy();
      console.log('Step 4 - Retrieved agent info successfully');

      // Step 5: Send direct message to discovered agent
      const dmResult = await handleSendDirectMessage(
        {
          recipientGuid: discoveredGuid!,
          message: 'Hello from agent B',
          messageType: 'text',
        },
        agentBState,
        config
      );

      if (dmResult.isError) {
        const errorMessage = dmResult.content[0]?.text || '';
        throw new Error(
          `Step 5 failed: send_direct_message rejected GUID from discover_agents. ` +
            `Error: ${errorMessage}`
        );
      }

      expect(dmResult.isError).toBeFalsy();
      console.log(
        'Step 5 - Sent direct message successfully using discovered GUID'
      );

      // Full workflow succeeded
      console.log('✓ Full workflow completed: register → discover → get_info → send_dm');
    });
  });

  describe('GUID Format Standardization', () => {
    it('should document expected GUID format', () => {
      // This test documents the expected format for future reference

      const expectedFormat = 'UUID v4';
      const exampleValid = '550e8400-e29b-41d4-a716-446655440000';
      const exampleInvalid = '5e77acfc77c69a8c6e2561f7b98b03b0'; // 32-char hex

      console.log('=== GUID Format Specification ===');
      console.log('Expected format:', expectedFormat);
      console.log('Valid example:', exampleValid);
      console.log('Invalid example:', exampleInvalid);
      console.log('Pattern:', UUID_V4_PATTERN);
      console.log('');
      console.log('All tools must:');
      console.log('1. Generate GUIDs in UUID v4 format (with hyphens)');
      console.log('2. Validate GUIDs using the same pattern');
      console.log('3. Accept GUIDs generated by any other tool');
      console.log('================================');

      // Verify example formats
      expect(UUID_V4_PATTERN.test(exampleValid)).toBe(true);
      expect(UUID_V4_PATTERN.test(exampleInvalid)).toBe(false);
    });

    it('should identify current format used by registry', async () => {
      const state: SessionState = {
        handle: 'format-test',
        agentGuid: undefined,
      };

      await handleRegisterAgent(
        {
          agentType: 'tester',
          capabilities: ['test'],
          scope: 'team',
        },
        state,
        config
      );

      const guid = state.agentGuid!;

      const isUuidV4 = UUID_V4_PATTERN.test(guid);
      const isHex32 = HEX_32_PATTERN.test(guid);

      console.log('=== Current Registry GUID Format ===');
      console.log('Generated GUID:', guid);
      console.log('Is UUID v4:', isUuidV4);
      console.log('Is 32-char hex:', isHex32);

      if (isHex32 && !isUuidV4) {
        console.log('');
        console.log('⚠️  FORMAT MISMATCH DETECTED');
        console.log('Current: 32-character hex (no hyphens)');
        console.log('Expected: UUID v4 (with hyphens)');
        console.log('');
        console.log('Fix required in: src/registry.ts');
        console.log('Function: generateAgentGuid()');
        console.log('');
        console.log('Suggested fix:');
        console.log('  - Use crypto.randomUUID() for UUID v4 generation');
        console.log('  - Or convert hex to UUID v4 format with hyphens');
      }

      console.log('===================================');

      // Document the finding
      expect(isUuidV4 || isHex32).toBe(true);
    });
  });
});
