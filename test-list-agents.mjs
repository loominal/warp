import { connect } from 'nats';

const nc = await connect({ servers: 'nats://localhost:4222' });
const js = nc.jetstream();

// Get the agent-registry KV bucket
const kv = await js.views.kv('agent-registry');

console.log('Listing all agents in KV bucket:');
const keys = await kv.keys();
for await (const key of keys) {
  const entry = await kv.get(key);
  if (entry?.value) {
    const data = JSON.parse(new TextDecoder().decode(entry.value));
    console.log(`  - ${data.handle} (${data.guid}) - projectId: ${data.projectId}`);
  }
}

await nc.close();
