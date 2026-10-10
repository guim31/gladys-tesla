// -----------------------------------------------------------------------------
// Small JSON persistence under /data, the container's only writable volume.
//
// What survives a restart: the energy index accumulators (without them the
// cumulative indexes would restart from zero, which Gladys reads as a meter
// reset), and the last known value of the states that fire scene triggers (so
// a restart neither misses nor repeats a "charge complete"). Writes are
// debounced and atomic (temporary file + rename).
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_DATA_DIR = process.env.DATA_DIR || '/data';

export function createStore({ dir = DEFAULT_DATA_DIR, debounceMs = 5000, logger } = {}) {
  const file = join(dir, 'tesla-state.json');
  let data = { version: 1, vehicles: {}, sites: {} };
  let timer = null;
  let writing = Promise.resolve();

  async function load() {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed && parsed.version === 1) {
        data = { version: 1, vehicles: {}, sites: {}, ...parsed };
      }
    } catch (err) {
      if (err.code !== 'ENOENT') logger?.warn(`Ignoring unreadable ${file}: ${err.message}`);
    }
    return data;
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    const snapshot = JSON.stringify(data);
    writing = writing.then(async () => {
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(`${file}.tmp`, snapshot);
        await rename(`${file}.tmp`, file);
      } catch (err) {
        logger?.warn(`Could not save ${file}: ${err.message}`);
      }
    });
    return writing;
  }

  return {
    load,
    flush,
    get data() {
      return data;
    },
    /** Ask for a write soon; several changes in a row make one write. */
    touch() {
      if (!timer) {
        timer = setTimeout(flush, debounceMs);
        timer.unref?.();
      }
    },
  };
}
