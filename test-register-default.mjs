import { connect } from 'nats';
import { randomUUID } from 'crypto';

const nc = await connect({ servers: 'nats://localhost:4222' });
const js = nc.jetstream();

// Get or create the agent-registry KV bucket
let kv;
try {
  kv = await js.views.kv('agent-registry');
} catch {
  kv = await js.views.kv('agent-registry', { history: 1, ttl: 0 });
}

// Create agent registration entry with 'default' projectId
const agentGuid = randomUUID();
const entry = {
  guid: agentGuid,
  handle: 'test-agent-beta',
  hostname: 'test-host',
  projectId: 'default',  // Changed to match Weft's default projectId
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
await kv.put(agentGuid, JSON.stringify(entry));

console.log('Agent registered successfully');
console.log('Agent GUID:', agentGuid);
console.log('Agent Handle:', entry.handle);
console.log('Project ID:', entry.projectId);

// Close connection
await nc.close();
