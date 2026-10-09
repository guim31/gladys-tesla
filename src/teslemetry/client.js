// -----------------------------------------------------------------------------
// Teslemetry REST client.
//
// Teslemetry (https://teslemetry.com) relays the official Tesla Fleet API: same
// paths, same response shapes, but one bearer token instead of a registered
// Tesla developer application, and Teslemetry signs the vehicle commands. The
// response formats below are those of the Fleet API documentation and of the
// `tesla-fleet-api` Python library (Apache 2.0), which Home Assistant uses.
//
// Cost rules this client is written around (Teslemetry pricing, 2026):
//   - the streaming (Fleet Telemetry) data is included in the subscription;
//   - a `vehicle_data` read is served from Teslemetry's cache for free while
//     the cache is younger than ~20 minutes (or the car is asleep); a read
//     against an older cache while the car is online costs up to 2 credits;
//   - a command costs 1 credit, and a command to a sleeping car first wakes it
//     (20 credits). Nothing here ever calls `wake_up` on its own.
// The token never reaches a log line or an error message.
// -----------------------------------------------------------------------------

export const TESLEMETRY_API_URL = 'https://api.teslemetry.com';

// What a vehicle_data read asks for. `drive_state` and `location_data` are
// deliberately absent: this version never reads the position of the car.
export const VEHICLE_DATA_ENDPOINTS = [
  'charge_state',
  'climate_state',
  'vehicle_state',
  'gui_settings',
  'vehicle_config',
];

// Error kinds the rest of the code branches on.
export const ERROR_KINDS = {
  AUTH: 'auth', // 401: token missing, revoked or mistyped
  SUBSCRIPTION: 'subscription', // 402: no Teslemetry subscription for this product
  CREDITS: 'credits', // 402: out of command credits
  FORBIDDEN: 'forbidden', // 403: missing scope, unsupported vehicle
  NOT_FOUND: 'not_found', // 404
  OFFLINE: 'offline', // 408: the car is asleep or out of coverage
  RATE_LIMITED: 'rate_limited', // 429
  SERVER: 'server', // 5xx
  NETWORK: 'network', // DNS, TLS, timeout
  COMMAND: 'command', // the car answered result: false
  INVALID: 'invalid', // 400 and anything else
};

export class TeslemetryError extends Error {
  constructor(message, { kind, status = null, code = null, retryAfter = null } = {}) {
    super(message);
    this.name = 'TeslemetryError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

// Command answers that mean "nothing to do": the state already is the one
// asked (Home Assistant treats them the same way).
const HARMLESS_COMMAND_REASONS = new Set(['already_set', 'not_charging', 'requested', 'complete']);

function classify(status, code) {
  if (status === 401) return ERROR_KINDS.AUTH;
  if (status === 402) {
    return code === 'insufficient_credits' ? ERROR_KINDS.CREDITS : ERROR_KINDS.SUBSCRIPTION;
  }
  if (status === 403) return ERROR_KINDS.FORBIDDEN;
  if (status === 404) return ERROR_KINDS.NOT_FOUND;
  if (status === 408) return ERROR_KINDS.OFFLINE;
  if (status === 429) return ERROR_KINDS.RATE_LIMITED;
  if (status >= 500) return ERROR_KINDS.SERVER;
  return ERROR_KINDS.INVALID;
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorCode(body) {
  if (!body || typeof body !== 'object') return null;
  return typeof body.error === 'string' ? body.error : null;
}

/**
 * Build a Teslemetry client.
 * @param {object} options
 * @param {string} options.token Teslemetry access token
 * @param {string} [options.baseUrl]
 * @param {typeof fetch} [options.fetchImpl] injected by the tests
 * @param {number} [options.timeoutMs]
 */
export function createTeslemetryClient({
  token,
  baseUrl = TESLEMETRY_API_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
} = {}) {
  async function request(method, path, { query, body } = {}) {
    if (!token) {
      throw new TeslemetryError('No Teslemetry access token configured', {
        kind: ERROR_KINDS.AUTH,
      });
    }
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Never echo the request (its headers carry the token): the path is enough.
      throw new TeslemetryError(`Teslemetry unreachable (${method} ${url.pathname}): ${err.name}`, {
        kind: ERROR_KINDS.NETWORK,
      });
    }
    const payload = await readBody(response);
    if (!response.ok) {
      const code = errorCode(payload);
      const retryAfter = Number(response.headers?.get?.('retry-after')) || null;
      throw new TeslemetryError(
        `Teslemetry answered ${response.status}${code ? ` (${code})` : ''} on ${method} ${url.pathname}`,
        { kind: classify(response.status, code), status: response.status, code, retryAfter },
      );
    }
    return payload;
  }

  // Unwrap `{ response: ... }`, the Fleet API envelope.
  async function get(path, query) {
    const payload = await request('GET', path, { query });
    return payload?.response ?? payload;
  }

  async function command(path, body) {
    const payload = await request('POST', path, { body: body ?? {} });
    const response = payload?.response;
    if (response && typeof response === 'object' && 'result' in response) {
      if (response.result !== true && !HARMLESS_COMMAND_REASONS.has(response.reason)) {
        throw new TeslemetryError(
          `Command refused by the vehicle${response.reason ? `: ${response.reason}` : ''}`,
          { kind: ERROR_KINDS.COMMAND, code: response.reason || null },
        );
      }
    }
    return response ?? payload;
  }

  return {
    /** Account metadata: scopes, region (used by the connection test). */
    metadata: () => request('GET', '/api/metadata'),
    /** Vehicles and energy sites of the account. Never wakes a car. */
    products: () => get('/api/1/products'),
    /**
     * Vehicle data: the Teslemetry cache (free) unless it is stale and the car
     * online. A sleeping car is answered from the cache, never woken.
     */
    vehicleData: (vin) =>
      get(`/api/1/vehicles/${encodeURIComponent(vin)}/vehicle_data`, {
        endpoints: VEHICLE_DATA_ENDPOINTS.join(';'),
      }),
    vehicleCommand: (vin, name, body) =>
      command(`/api/1/vehicles/${encodeURIComponent(vin)}/command/${name}`, body),
    /** Fields the vehicle currently streams (Fleet Telemetry configuration). */
    streamingConfig: (vin) => request('GET', `/api/config/${encodeURIComponent(vin)}`),
    /** Add fields to the streaming configuration (merged, never replaced). */
    addStreamingFields: (vin, fields) =>
      request('PATCH', `/api/config/${encodeURIComponent(vin)}`, { body: { fields } }),
    siteLiveStatus: (siteId) =>
      get(`/api/1/energy_sites/${encodeURIComponent(siteId)}/live_status`),
    siteInfo: (siteId) => get(`/api/1/energy_sites/${encodeURIComponent(siteId)}/site_info`),
    siteCommand: (siteId, name, body) =>
      command(`/api/1/energy_sites/${encodeURIComponent(siteId)}/${name}`, body),
  };
}
