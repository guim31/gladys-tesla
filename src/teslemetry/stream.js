// -----------------------------------------------------------------------------
// Teslemetry real-time stream (Server-Sent Events).
//
// One long-lived `GET https://api.teslemetry.com/sse` carries, for the whole
// account:
//   - `data`: Fleet Telemetry field deltas pushed by the cars themselves
//     (`{ vin, data: { BatteryLevel: 80.5, ... }, createdAt }`). A sleeping car
//     pushes nothing and is never woken by the stream;
//   - `state`: `{ vin, state: 'online' | 'asleep' | 'offline' }`;
//   - `live_status`, `site_info`, `energy_totals`: Powerwall/solar documents,
//     polled server-side by Teslemetry (`{ site_id, live_status: {...} }`);
//   - `credits`: the account credit balance after each billed call.
// Streaming is included in the Teslemetry subscription: no credit is spent.
// Wire format and topic names come from the `teslemetry-stream` Python library
// (Apache 2.0) used by Home Assistant.
// -----------------------------------------------------------------------------

import { TESLEMETRY_API_URL } from './client.js';

export const STREAM_TOPICS = [
  'state',
  'data',
  'connectivity',
  'live_status',
  'site_info',
  'energy_totals',
  'credits',
];

/**
 * Incremental SSE parser: feed it text chunks, it calls `onMessage(data)` with
 * the payload of every complete event (data lines joined, comments skipped).
 */
export class SseParser {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.buffer = '';
    this.dataLines = [];
  }

  push(chunk) {
    this.buffer += chunk;
    let newline = this.buffer.search(/\r\n|\n|\r/);
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline);
      const width = this.buffer.startsWith('\r\n', newline) ? 2 : 1;
      this.buffer = this.buffer.slice(newline + width);
      this.line(line);
      newline = this.buffer.search(/\r\n|\n|\r/);
    }
  }

  line(line) {
    if (line === '') {
      this.dispatch();
      return;
    }
    if (line.startsWith(':')) return; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') {
      this.dataLines.push(value);
      // Teslemetry sends one JSON document per `data:` line; dispatch as soon
      // as it parses instead of waiting for the blank line some proxies drop.
      if (this.dataLines.length === 1 && isCompleteJson(value)) this.dispatch();
    }
  }

  dispatch() {
    if (this.dataLines.length === 0) return;
    const data = this.dataLines.join('\n');
    this.dataLines = [];
    this.onMessage(data);
  }
}

function isCompleteJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep the SSE connection open for life: reconnect with an exponential
 * backoff (1 s → 5 min), and treat 60 s of silence as a dead connection.
 * An authentication refusal stops the loop: retrying a revoked token can
 * never succeed and would only hammer the service.
 */
export function createTeslemetryStream({
  token,
  baseUrl = TESLEMETRY_API_URL,
  topics = STREAM_TOPICS,
  fetchImpl = globalThis.fetch,
  onEvent,
  onConnectionChange = () => {},
  logger,
  idleTimeoutMs = 60000,
  maxBackoffMs = 300000,
  sleep = (ms, signal) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    }),
}) {
  let running = false;
  let controller = null;
  let connected = false;
  let useTopics = true;
  let attempt = 0;
  let loop = null;
  let stopSignal = new AbortController();

  function setConnected(value, reason) {
    if (connected === value) return;
    connected = value;
    onConnectionChange(value, reason);
  }

  function handleMessage(text) {
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      logger?.debug('Ignoring a stream message that is not JSON');
      return;
    }
    if (event && typeof event === 'object') {
      try {
        onEvent(event);
      } catch (err) {
        logger?.error('Stream event handler failed', err);
      }
    }
  }

  async function connectOnce(signal) {
    const url = new URL('/sse', baseUrl);
    if (useTopics && topics?.length) url.searchParams.set('topics', topics.join(','));
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      return { status: response.status };
    }
    attempt = 0;
    setConnected(true);
    const parser = new SseParser(handleMessage);
    const decoder = new TextDecoder();
    let idleTimer = null;
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller?.abort(new Error('idle')), idleTimeoutMs);
    };
    armIdle();
    try {
      for await (const chunk of response.body) {
        armIdle();
        parser.push(decoder.decode(chunk, { stream: true }));
      }
    } finally {
      clearTimeout(idleTimer);
    }
    return { status: response.status, ended: true };
  }

  async function run() {
    while (running) {
      controller = new AbortController();
      let outcome;
      try {
        outcome = await connectOnce(controller.signal);
      } catch (err) {
        outcome = { error: err };
      }
      if (!running) break;
      setConnected(false, outcome.status && outcome.status >= 400 ? outcome.status : 'network');
      if (outcome.status === 401 || outcome.status === 403) {
        logger?.error(`Teslemetry stream refused (${outcome.status}): check the access token`);
        running = false;
        break;
      }
      if (outcome.status === 400 && useTopics) {
        // An older server rejecting a topic name: fall back to "everything".
        logger?.warn('Teslemetry stream refused the topic filter, retrying without it');
        useTopics = false;
        continue;
      }
      if (outcome.ended) {
        logger?.info('Teslemetry stream closed by the server, reconnecting');
      } else if (outcome.error) {
        logger?.warn(`Teslemetry stream interrupted (${outcome.error.name}), reconnecting`);
      } else {
        logger?.warn(`Teslemetry stream answered ${outcome.status}, reconnecting`);
      }
      const delay = Math.min(1000 * 2 ** attempt, maxBackoffMs);
      attempt += 1;
      await sleep(delay, stopSignal.signal);
    }
  }

  return {
    start() {
      if (running || !token) return;
      running = true;
      stopSignal = new AbortController();
      loop = run();
    },
    async stop() {
      running = false;
      stopSignal.abort();
      controller?.abort(new Error('stopped'));
      await loop?.catch(() => {});
      loop = null;
      setConnected(false, 'stopped');
    },
    get connected() {
      return connected;
    },
    get running() {
      return running;
    },
  };
}
