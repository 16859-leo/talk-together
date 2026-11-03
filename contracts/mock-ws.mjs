import { readFileSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';

const name = process.argv[2] ?? 'host-stream';
if (!/^[a-z0-9_-]+$/.test(name)) throw new Error('Invalid scenario name');
const scenario = JSON.parse(readFileSync(new URL(`./examples/ws/${name}.json`, import.meta.url)));
const dates = new Set(['capturedAt', 'occurredAt', 'createdAt', 'updatedAt', 'joinedAt', 'startedAt', 'finishedAt', 'expiresAt', 'publishedAt', 'closedAt', 'recoveryExpiresAt', 'hostRecoveryExpiresAt']);
function rebase(value, offset, key = '') {
  if (typeof value === 'string' && dates.has(key)) return new Date(Date.parse(value) + offset).toISOString();
  if (Array.isArray(value)) return value.map(item => rebase(item, offset));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rebase(v, offset, k)]));
  return value;
}
const server = new WebSocketServer({ host: '127.0.0.1', port: 4011, path: '/api/v1/rooms/room_demo/events' });
server.on('connection', socket => {
  const offset = Date.now() - Date.parse(scenario.baseTime);
  const timers = scenario.frames.map(frame => setTimeout(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(rebase(frame.message, offset)));
  }, frame.atMs));
  if (scenario.close) timers.push(setTimeout(() => socket.close(scenario.close.code, scenario.close.reason), scenario.frames.at(-1).atMs + 20));
  socket.on('close', () => timers.forEach(clearTimeout));
  socket.on('error', error => console.error(error.message));
});
console.log(`WS fixture ${name}: ws://127.0.0.1:4011/api/v1/rooms/room_demo/events`);
process.on('SIGINT', () => { for (const client of server.clients) client.terminate(); server.close(); });
