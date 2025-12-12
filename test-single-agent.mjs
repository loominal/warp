import { connect } from 'nats';

const nc = await connect({ servers: 'nats://localhost:4222' });
const js = nc.jetstream();
const kv = await js.views.kv('agent-registry');

// First, delete ALL keys to start fresh
console.log('Deleting all existing keys...');
const keys = await kv.keys();
for await (const key of keys) {
  await kv.delete(key);
}
console.log('All keys deleted');

// Now register a single agent with correct properties
const agentGuid = '00000000-test-single-agent-guid';
const entry = {
  guid: agentGuid,
  handle: 'test-single-agent',
  hostname: 'test-host',
  projectId: 'default',
  username: 'test-user',
  capabilities: ['general', 'typescript'],
  visibility: 'project-only',
  status: 'online',
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

await kv.put(agentGuid, JSON.stringify(entry));
console.log('Registered single test agent:', entry.handle);
console.log('GUID:', agentGuid);
console.log('Capabilities:', entry.capabilities);

await nc.close();
