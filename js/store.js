// App state plus IndexedDB persistence, so work survives Safari reloading the tab.

export const DEFAULTS = {
  paper: 'A4',
  orientation: 'portrait',
  layoutId: 'auto',
  gapMm: 4,
  marginMm: 8,
  radiusMm: 0,
  bg: '#ffffff',
};

export const MAX_PHOTOS = 40;

export const state = { ...DEFAULTS, photos: [] };

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
}

/** Call after mutating state: redraws listeners and schedules a save. */
export function changed() {
  listeners.forEach((fn) => fn());
  schedulePersist();
}

export function set(patch) {
  Object.assign(state, patch);
  changed();
}

// --- IndexedDB -------------------------------------------------------------

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('photo-grid', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
        req.result.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function snapshot() {
  const settings = {};
  for (const key of Object.keys(DEFAULTS)) settings[key] = state[key];
  const photos = state.photos.map(({ id, rotation, fit, zoom, panX, panY }) => ({ id, rotation, fit, zoom, panX, panY }));
  return { settings, photos };
}

let saveTimer = 0;

function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 300);
}

export function persistNow() {
  clearTimeout(saveTimer);
  return run('kv', 'readwrite', (s) => s.put(snapshot(), 'doc')).catch((err) => console.warn('Save failed', err));
}

export function saveBlob(id, blob) {
  return run('blobs', 'readwrite', (s) => s.put(blob, id)).catch((err) => console.warn('Photo save failed', err));
}

export function deleteBlob(id) {
  return run('blobs', 'readwrite', (s) => s.delete(id)).catch((err) => console.warn('Photo delete failed', err));
}

export async function clearSaved() {
  try {
    await run('blobs', 'readwrite', (s) => s.clear());
    await run('kv', 'readwrite', (s) => s.clear());
  } catch (err) {
    console.warn('Clear failed', err);
  }
}

/** Saved settings and photo blobs, in order. Drops anything that no longer matches up. */
export async function loadSaved() {
  try {
    const doc = await run('kv', 'readonly', (s) => s.get('doc'));
    const keys = await run('blobs', 'readonly', (s) => s.getAllKeys());
    const wanted = new Set(doc ? doc.photos.map((p) => p.id) : []);
    for (const key of keys) if (!wanted.has(key)) await deleteBlob(key);
    if (!doc) return null;
    const photos = [];
    for (const meta of doc.photos) {
      const blob = await run('blobs', 'readonly', (s) => s.get(meta.id));
      if (blob) photos.push({ meta, blob });
    }
    return { settings: doc.settings || {}, photos };
  } catch (err) {
    console.warn('Load failed', err);
    return null;
  }
}
