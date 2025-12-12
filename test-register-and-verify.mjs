import { connect } from 'nats';
import { randomUUID } from 'crypto';

const nc = await connect({ servers: 'nats://localhost:4222' });
const js = nc.jetstream();

// Get the agent-registry KV bucket
const kv = await js.views.kv('agent-registry');

// Create agent registration entry with 'default' projectId
const agentGuid = randomUUID();
const entry = {
  guid: agentGuid,
  handle: 'test-agent-gamma',
  hostname: 'test-host',
  projectId: 'default',
  username: 'test-user',
  capabilities: ['typescript', 'python', 'general'],
  visibility: 'project-only',
  status: 'available',
  currentTaskCount: 0,
  maxConcurrentTasks: 3,
  spindownAfterIdleMs: 300000,
  lastHeartbeat: new Date().toISOString(),
  lastActivity: new Date().toISOString(),
  registeredAt: new Date().toISOString(),
  metadata: {
    agentType: 'claude-code',
    boundaries: ['default']
  }
};

// Store in KV
const putResult = await kv.put(agentGuid, JSON.stringify(entry));
console.log('Put result revision:', putResult);

// Immediately read it back
const getResult = await kv.get(agentGuid);
if (getResult?.value) {
  const retrieved = JSON.parse(new TextDecoder().decode(getResult.value));
  console.log('Retrieved agent:', retrieved.handle, '-', retrieved.projectId);
} else {
  console.log('ERROR: Agent not found after putting!');
}

// List all keys
console.log('\nAll keys in bucket:');
const keys = await kv.keys();
for await (const key of keys) {
  console.log('  -', key);
}

await nc.close();
