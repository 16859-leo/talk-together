import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import openapiTS from 'openapi-typescript';

const load = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const base = 'https://contracts.talk-together.test/';
const models = load('models.schema.json');
const events = load('events.schema.json');
const api = load('openapi.json');
const examples = load('examples/http.json');
assert.equal(api.info.version, load('package.json').version);
assert.equal(examples.client_config.response.value.data.contractVersion, api.info.version);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(models, base + 'models.schema.json');
ajv.addSchema(events, base + 'events.schema.json');
for (const name of Object.keys(models.$defs)) ajv.getSchema(base + 'models.schema.json#/$defs/' + name);
const model = name => ajv.getSchema(base + 'models.schema.json#/$defs/' + name);
const serverMessage = ajv.getSchema(base + 'events.schema.json');
const valid = (validator, value, label) => assert(validator(value), `${label}: ${ajv.errorsText(validator.errors, { separator: '\n' })}`);
const operations = new Map();
for (const [path, methods] of Object.entries(api.paths)) for (const [method, operation] of Object.entries(methods)) {
  assert(!operations.has(operation.operationId), 'Duplicate operationId');
  operations.set(operation.operationId, { path, method, operation });
}
for (const [name, example] of Object.entries(examples)) {
  valid(model(example.responseSchema), example.response.value, name);
  if (!example.operationId) continue;
  const { method, operation } = operations.get(example.operationId);
  assert.equal(example.request.method.toLowerCase(), method, name);
  const response = operation.responses[example.status];
  assert(response?.content?.['application/json']?.examples?.[name], `${name} is missing from OpenAPI`);
  if (operation.requestBody) {
    const requestType = operation.requestBody.content['application/json'].schema.$ref.split('/').at(-1);
    valid(model(requestType), example.request.body, `${name} request`);
  }
  if (operation.parameters.some(p => p.$ref?.endsWith('/MembershipId'))) assert(example.request.headers['X-Membership-Id'], name);
}
for (const { operation } of operations.values()) for (const [status, response] of Object.entries(operation.responses)) {
  for (const reference of Object.values(response.content?.['application/json']?.examples ?? {})) {
    const name = reference.$ref.split('#/')[1].split('/')[0];
    const fixture = examples[name];
    assert(fixture, `Unresolved response example: ${reference.$ref}`);
    assert.equal(fixture.status, Number(status));
    if (Number(status) >= 400) assert(operation['x-error-codes'][status].includes(fixture.response.value.code));
  }
}
function checkScenario(scenario) {
  assert.equal(scenario.frames[0].atMs, 0);
  const first = scenario.frames[0].message;
  valid(serverMessage, first, 'initial snapshot');
  assert.equal(first.type, 'room.snapshot');
  const joined = first.data.self.joinedSequence;
  assert.deepEqual(first.data.self, scenario.viewer);
  assert(first.data.members.some(member => member.id === scenario.viewer.memberId && member.membership.id === scenario.viewer.membershipId));
  assert.equal(first.data.members.find(member => member.id === scenario.viewer.memberId).role, scenario.viewer.role);
  assert.deepEqual(first.data.members.filter(member => member.role === 'host').map(member => member.id), [first.data.room.hostMemberId]);
  assert.equal(first.data.room.occupiedSlots, first.data.members.length);
  assert.equal(first.data.room.id, first.roomId);
  const captured = Date.parse(first.capturedAt);
  const pastDates = new Set(['createdAt', 'updatedAt', 'joinedAt', 'startedAt', 'finishedAt', 'publishedAt']);
  const checkDates = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (pastDates.has(key) && item !== null) assert(Date.parse(item) <= captured, 'Snapshot contains future state');
      if (typeof item === 'object') checkDates(item);
    }
  };
  checkDates(first.data);
  let cursor = first.cursor;
  let lastAt = -1;
  let closed = false;
  let active = null;
  const replies = new Map();
  const terminal = new Map();
  const invocations = new Map();
  const seen = new Map();
  const note = invocation => {
    invocations.set(invocation.id, invocation.status);
    if (invocation.status === 'running') { assert(active === null || active === invocation.id, 'AI must run serially'); active = invocation.id; }
    if (['completed', 'failed', 'cancelled'].includes(invocation.status)) {
      assert(!terminal.has(invocation.id) || terminal.get(invocation.id) === invocation.status, 'Conflicting terminal states');
      terminal.set(invocation.id, invocation.status);
      if (active === invocation.id) active = null;
    }
  };
  for (const message of first.data.messages) {
    if (message.kind === 'member') assert(message.createdSequence >= joined, 'Pre-join message leaked');
    else { assert(message.startedSequence >= joined, 'Pre-join AI reply leaked'); replies.set(message.id, structuredClone(message)); }
  }
  first.data.invocations.forEach(note);
  for (const frame of scenario.frames) {
    valid(serverMessage, frame.message, scenario.description);
    assert(frame.atMs >= lastAt, 'Scenario time goes backwards'); lastAt = frame.atMs;
    const event = frame.message;
    assert.equal(event.roomId, first.roomId);
    assert(!closed, 'Business event emitted after room closed');
    if (event.type === 'room.snapshot') continue;
    if (event.sequence <= cursor) {
      assert.deepEqual(seen.get(event.sequence), event, 'Duplicate sequence has different content');
      continue;
    }
    cursor = event.sequence; seen.set(cursor, event);
    const data = event.data;
    if (event.type === 'message.created') { assert.equal(data.message.createdSequence, cursor); assert(cursor >= joined); }
    if (event.type === 'ai.invocation.updated') note(data.invocation);
    if (event.type === 'ai.reply.started') {
      assert.equal(data.reply.startedSequence, cursor);
      assert(cursor >= joined);
      assert(!replies.has(data.reply.id));
      assert.equal(data.reply.invocationId, data.invocation.id);
      assert.equal(data.invocation.replyId, data.reply.id);
      note(data.invocation); replies.set(data.reply.id, structuredClone(data.reply));
    }
    if (event.type === 'ai.reply.delta') {
      const reply = replies.get(data.replyId);
      assert(reply && reply.status === 'streaming', 'Delta has no visible streaming reply');
      assert.equal(reply.invocationId, data.invocationId); reply.text += data.textDelta;
    }
    if (['ai.reply.completed', 'ai.reply.failed', 'ai.reply.cancelled'].includes(event.type)) {
      const reply = replies.get(data.reply.id);
      assert(reply && reply.status === 'streaming', 'Reply terminated twice or was never visible');
      assert.equal(data.invocation.replyId, data.reply.id);
      assert.equal(data.invocation.id, data.reply.invocationId);
      note(data.invocation); replies.set(data.reply.id, structuredClone(data.reply));
    }
    if (event.type === 'room.closed') {
      assert.equal(data.roomId, event.roomId);
      assert.equal(active, null, 'Room closed before cancelling active AI');
      assert(![...invocations.values()].some(status => ['queued', 'running'].includes(status)), 'Room closed before terminating accepted calls');
      closed = true;
    }
    for (const id of scenario.forbiddenReplyIds ?? []) assert(!JSON.stringify(event).includes(`"${id}"`), 'Hidden reply leaked');
    for (const id of scenario.forbiddenMessageIds ?? []) assert(!JSON.stringify(event).includes(`"${id}"`), 'Hidden message leaked');
  }
  for (const [id, expected] of Object.entries(scenario.expectedReplies)) {
    assert.equal(replies.get(id)?.text, expected.text, id);
    assert.equal(replies.get(id)?.status, expected.status, id);
  }
}
const files = readdirSync(new URL('examples/ws/', import.meta.url)).filter(name => name.endsWith('.json'));
for (const file of files) checkScenario(load('examples/ws/' + file));
const observedTypes = new Set(files.flatMap(file => load('examples/ws/' + file).frames.map(frame => frame.message.type)));
for (const shape of Object.values(events.$defs)) if (shape.properties?.type?.const) assert(observedTypes.has(shape.properties.type.const), 'Event has no scenario: ' + shape.properties.type.const);
assert(!model('SendMessageRequest')({ text: 'missing id' }));
assert(!model('ProfileInput')({ nickname: '小林', interestTags: [] }));
assert(!model('ProfilePatch')({ bio: null }));
const leaked = structuredClone(load('examples/ws/join-midstream.json'));
leaked.frames[0].message.data.messages.push(load('examples/ws/guest-reconnect.json').frames[0].message.data.messages[1]);
assert.throws(() => checkScenario(leaked), /Pre-join AI reply leaked/);
await openapiTS(new URL('./openapi.json', import.meta.url));
console.log(`${operations.size} operations, ${Object.keys(models.$defs).length} models, ${Object.keys(examples).length} HTTP examples and ${files.length} WS scenarios checked.`);
