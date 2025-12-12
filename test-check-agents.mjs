import { connect } from 'nats';

const nc = await connect({ servers: 'nats://localhost:4222' });
const js = nc.jetstream();

const kv = await js.views.kv('agent-registry');

console.log('Checking agents with general capability and default projectId:\n');
const keys = await kv.keys();
for await (const key of keys) {
  const entry = await kv.get(key);
  if (entry?.value) {
    const data = JSON.parse(new TextDecoder().decode(entry.value));
    if (data.capabilities.includes('general') && data.projectId === 'default') {
      console.log('MATCH:', data.handle, '(' + data.guid + ')');
      console.log('  projectId:', data.projectId);
      console.log('  visibility:', data.visibility);
      console.log('  status:', data.status);
      console.log('  capabilities:', data.capabilities);
      console.log();
    }
  }
}

await nc.close();
