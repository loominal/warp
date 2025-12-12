import { connect } from 'nats';

const nc = await connect({ servers: 'nats://localhost:4222' });
const js = nc.jetstream();

const kv = await js.views.kv('agent-registry');

const keys = await kv.keys();
const keyList = [];
for await (const key of keys) {
  keyList.push(key);
}

console.log('Total keys:', keyList.length);
console.log('\nChecking each key:');

for (const key of keyList) {
  try {
    const entry = await kv.get(key);
    if (entry && entry.value) {
      const data = JSON.parse(new TextDecoder().decode(entry.value));
      console.log(`✓ ${key}: ${data.handle}`);
    } else {
      console.log(`✗ ${key}: NO VALUE`);
    }
  } catch (err) {
    console.log(`✗ ${key}: ERROR -`, err.message);
  }
}

await nc.close();
