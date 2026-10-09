import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ERROR_KINDS,
  VEHICLE_DATA_ENDPOINTS,
  createTeslemetryClient,
} from '../src/teslemetry/client.js';
import { SseParser, createTeslemetryStream } from '../src/teslemetry/stream.js';

const TOKEN = 'secret-token-value';

function jsonResponse(status, body, headers = {}) {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function recordingFetch(answer) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: new URL(url), init });
    return answer(new URL(url), init);
  };
  return { fetchImpl, requests };
}

test('requests carry the bearer token and unwrap the Fleet API envelope', async () => {
  const { fetchImpl, requests } = recordingFetch(() =>
    jsonResponse(200, { response: [{ vin: 'X' }], count: 1 }),
  );
  const client = createTeslemetryClient({ token: TOKEN, fetchImpl });
  assert.deepEqual(await client.products(), [{ vin: 'X' }]);
  assert.equal(requests[0].url.href, 'https://api.teslemetry.com/api/1/products');
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${TOKEN}`);
});

test('vehicle_data never asks for the location', async () => {
  const { fetchImpl, requests } = recordingFetch(() => jsonResponse(200, { response: {} }));
  await createTeslemetryClient({ token: TOKEN, fetchImpl }).vehicleData('VIN1');
  const endpoints = requests[0].url.searchParams.get('endpoints').split(';');
  assert.deepEqual(endpoints, VEHICLE_DATA_ENDPOINTS);
  assert.ok(!endpoints.includes('location_data') && !endpoints.includes('drive_state'));
});

test('errors are classified, and never contain the token', async () => {
  const cases = [
    [401, { error: 'invalid_token' }, ERROR_KINDS.AUTH],
    [402, { error: 'insufficient_credits' }, ERROR_KINDS.CREDITS],
    [402, { error: 'subscription_required' }, ERROR_KINDS.SUBSCRIPTION],
    [403, { error: 'invalid_scope' }, ERROR_KINDS.FORBIDDEN],
    [408, { error: 'vehicle unavailable' }, ERROR_KINDS.OFFLINE],
    [429, {}, ERROR_KINDS.RATE_LIMITED],
    [503, undefined, ERROR_KINDS.SERVER],
  ];
  for (const [status, body, kind] of cases) {
    const { fetchImpl } = recordingFetch(() => jsonResponse(status, body));
    const client = createTeslemetryClient({ token: TOKEN, fetchImpl });
    await assert.rejects(client.vehicleData('VIN1'), (err) => {
      assert.equal(err.kind, kind, `HTTP ${status}`);
      assert.ok(!err.message.includes(TOKEN));
      return true;
    });
  }
  const network = createTeslemetryClient({
    token: TOKEN,
    fetchImpl: async () => {
      throw new TypeError(`fetch failed for Bearer ${TOKEN}`);
    },
  });
  await assert.rejects(network.products(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.NETWORK);
    assert.ok(!err.message.includes(TOKEN));
    return true;
  });
});

test('a command refused by the car fails, "already set" does not', async () => {
  let answer = { response: { result: false, reason: 'is_charging' } };
  const { fetchImpl, requests } = recordingFetch(() => jsonResponse(200, answer));
  const client = createTeslemetryClient({ token: TOKEN, fetchImpl });
  await assert.rejects(client.vehicleCommand('VIN1', 'charge_start'), {
    kind: ERROR_KINDS.COMMAND,
  });
  answer = { response: { result: false, reason: 'already_set' } };
  await client.vehicleCommand('VIN1', 'set_charge_limit', { percent: 80 });
  const last = requests.at(-1);
  assert.equal(last.init.method, 'POST');
  assert.equal(last.url.pathname, '/api/1/vehicles/VIN1/command/set_charge_limit');
  assert.deepEqual(JSON.parse(last.init.body), { percent: 80 });
});

test('no token: no request at all', async () => {
  let called = false;
  const client = createTeslemetryClient({
    token: '',
    fetchImpl: async () => {
      called = true;
    },
  });
  await assert.rejects(client.products(), { kind: ERROR_KINDS.AUTH });
  assert.equal(called, false);
});

test('the SSE parser reads the captured stream', () => {
  const raw = readFileSync(new URL('./fixtures/teslemetry/stream.sse', import.meta.url), 'utf8');
  const events = [];
  const parser = new SseParser((data) => events.push(JSON.parse(data)));
  // Feed it in awkward chunks, as the network does.
  for (let i = 0; i < raw.length; i += 37) parser.push(raw.slice(i, i + 37));
  assert.equal(events.length, 9);
  assert.equal(events[0].state, 'online');
  assert.equal(events[1].data.DetailedChargeState, 'DetailedChargeStateCharging');
  assert.equal(events.at(-1).credits.balance, 498);
});

test('the SSE parser joins multi-line data and handles CRLF', () => {
  const events = [];
  const parser = new SseParser((data) => events.push(data));
  parser.push('event: x\r\ndata: {"a":\r\ndata: 1}\r\n\r\n: keep-alive\r\n\r\n');
  assert.deepEqual(events, ['{"a":\n1}']);
});

function sseResponse(lines) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

test('the stream delivers events, reconnects when the server closes, filters topics', async () => {
  const events = [];
  const connections = [];
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    connections.push(new URL(url));
    return sseResponse([`data: {"vin":"V","data":{"BatteryLevel":${calls}}}\n\n`]);
  };
  const sleeps = [];
  const stream = createTeslemetryStream({
    token: TOKEN,
    fetchImpl,
    onEvent: (event) => events.push(event),
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length >= 3) stream.stop();
    },
  });
  stream.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await stream.stop();
  assert.ok(events.length >= 2, 'reconnected after the server closed the stream');
  assert.equal(events[0].data.BatteryLevel, 1);
  assert.equal(connections[0].pathname, '/sse');
  assert.ok(connections[0].searchParams.get('topics').split(',').includes('live_status'));
});

test('the stream stops for good on a refused token', async () => {
  let calls = 0;
  const changes = [];
  const stream = createTeslemetryStream({
    token: TOKEN,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(401, { error: 'invalid_token' });
    },
    onEvent: () => {},
    onConnectionChange: (value, reason) => changes.push([value, reason]),
    sleep: async () => {},
  });
  stream.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  assert.equal(stream.running, false);
  await stream.stop();
});

test('the stream backs off exponentially on errors', async () => {
  const sleeps = [];
  const stream = createTeslemetryStream({
    token: TOKEN,
    fetchImpl: async () => jsonResponse(503),
    onEvent: () => {},
    maxBackoffMs: 8000,
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length >= 6) stream.stop();
    },
  });
  stream.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await stream.stop();
  assert.deepEqual(sleeps.slice(0, 6), [1000, 2000, 4000, 8000, 8000, 8000]);
});

test('a topic filter the server refuses falls back to every topic', async () => {
  const urls = [];
  const stream = createTeslemetryStream({
    token: TOKEN,
    fetchImpl: async (url) => {
      urls.push(new URL(url));
      return urls.length === 1 ? jsonResponse(400, { error: 'invalid topics' }) : sseResponse([]);
    },
    onEvent: () => {},
    sleep: async () => {
      // Not awaited: stop() waits for this very loop.
      stream.stop();
    },
  });
  stream.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await stream.stop();
  assert.ok(urls[0].searchParams.has('topics'));
  assert.equal(urls[1].searchParams.has('topics'), false);
});
