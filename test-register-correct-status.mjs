import { connect } from 'nats';
import { randomUUID } from 'crypto';

const nc = await connect({ servers: 'nats://localhost:4222' });
const js = nc.jetstream();

const kv = await js.views.kv('agent-registry');

// Create agent with correct status value
const agentGuid = randomUUID();
const entry = {
  guid: agentGuid,
  handle: 'test-agent-delta',
  hostname: 'test-host',
  projectId: 'default',
  username: 'test-user',
  capabilities: ['typescript', 'python', 'general'],
  visibility: 'project-only',
  status: 'online',  // Changed from 'available' to 'online'
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

console.log('Agent registered with correct status');
console.log('Agent GUID:', agentGuid);
console.log('Agent Handle:', entry.handle);
console.log('Status:', entry.status);

await nc.close();
