/**
 * Storage helpers shared by the local backend and settings persistence.
 *
 * `localStorage` can throw on access (site data blocked, sandboxed iframes) or
 * on write (quota). Callers pick the storage once via safeLocalStorage() and
 * still guard every read/write, because a storage that worked at start-up can
 * fail later.
 */

/** In-memory Storage with the DOM interface. Used as the fallback and in tests. */
export function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(String(key));
    },
    setItem(key: string, value: string) {
      map.set(String(key), String(value));
    },
  };
  return storage;
}

const PROBE_KEY = 'dyad:probe';

/**
 * window.localStorage when it can be read and written, otherwise a memory
 * store so the app keeps working (without persistence) instead of crashing.
 */
export function safeLocalStorage(): Storage {
  try {
    const storage = globalThis.localStorage;
    if (storage) {
      storage.setItem(PROBE_KEY, '1');
      storage.removeItem(PROBE_KEY);
      return storage;
    }
  } catch {
    // Access denied or quota exhausted: fall through to memory.
  }
  return createMemoryStorage();
}
