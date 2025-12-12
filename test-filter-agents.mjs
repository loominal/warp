import { connect } from 'nats';

const nc = await connect({ servers: 'nats://localhost:4222' });
const js = nc.jetstream();

const kv = await js.views.kv('agent-registry');

const keys = await kv.keys();
const keyList = [];
for await (const key of keys) {
  keyList.push(key);
}

console.log('Agents with projectId="default" and capability="general":\n');

for (const key of keyList) {
  try {
    const entry = await kv.get(key);
    if (entry && entry.value) {
      const data = JSON.parse(new TextDecoder().decode(entry.value));
      const hasGeneral = data.capabilities && data.capabilities.includes('general');
      const isDefault = data.projectId === 'default';
      
      if (hasGeneral && isDefault) {
        console.log(`MATCH: ${data.handle} (${key})`);
        console.log(`  projectId: ${data.projectId}`);
        console.log(`  visibility: ${data.visibility}`);
        console.log(`  status: ${data.status}`);
        console.log(`  capabilities:`, data.capabilities);
        console.log();
      }
    }
  } catch (err) {
    // skip
  }
}

await nc.close();
