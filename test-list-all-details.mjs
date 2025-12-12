import { connect } from 'nats';

const nc = await connect({ servers: 'nats://localhost:4222' });
const js = nc.jetstream();

const kv = await js.views.kv('agent-registry');

console.log('All agents in bucket:\n');
const keys = await kv.keys();
let count = 0;
for await (const key of keys) {
  count++;
  const entry = await kv.get(key);
  if (entry?.value) {
    const data = JSON.parse(new TextDecoder().decode(entry.value));
    console.log(`${count}. ${data.handle} (${data.guid})`);
    console.log('   projectId:', data.projectId);
    console.log('   visibility:', data.visibility);
    console.log('   status:', data.status);
    console.log('   capabilities:', JSON.stringify(data.capabilities));
    console.log();
  }
}

await nc.close();
