import { connect } from 'nats';

const nc = await connect({ servers: 'nats://localhost:4222' });
const js = nc.jetstream();
const kv = await js.views.kv('agent-registry');

const keys = await kv.keys();
const keyList = [];
for await (const key of keys) {
  keyList.push(key);
}

console.log('Total keys in agent-registry:', keyList.length);
console.log('Keys:', keyList.slice(0, 10));

await nc.close();
