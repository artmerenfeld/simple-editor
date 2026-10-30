// App state plus IndexedDB persistence, so work survives Safari reloading the tab.
// Collage and Batch are separate workspaces: each keeps its own settings and photos.

export const DEFAULTS = {
  paper: 'A4',
  orientation: 'portrait',
  layoutId: 'auto',
  gapMm: 4,
  marginMm: 8,
  radiusMm: 0,
  bg: '#ffffff',
};

export const MODES = {
  collage: { defaults: DEFAULTS, maxPhotos: 40, maxEdge: 2048, fit: 'fill', dpi: 300 },
  // Many photos, each small on the page: smaller copies and 250 DPI keep memory in check.
  batch: { defaults: { ...DEFAULTS, layoutId: 'g6' }, maxPhotos: 300, maxEdge: 1600, fit: 'fit', dpi: 250 },
};

export const state = { mode: 'collage', ...DEFAULTS, photos: [] };

// The workspace that is not showing.
const parked = {};

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

function takeWorkspace() {
  const ws = { photos: state.photos };
  for (const key of Object.keys(DEFAULTS)) ws[key] = state[key];
  return ws;
}

export function switchMode(mode) {
  if (mode === state.mode || !MODES[mode]) return;
  parked[state.mode] = takeWorkspace();
  Object.assign(state, parked[mode] || { ...MODES[mode].defaults, photos: [] }, { mode });
  delete parked[mode];
  changed();
}

/** Restore saved workspaces ({ mode, workspaces: { collage, batch } }). */
export function restore(mode, workspaces) {
  for (const [m, ws] of Object.entries(workspaces)) {
    if (m === mode) Object.assign(state, ws, { mode });
    else parked[m] = ws;
  }
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

function snapshotOf(ws) {
  const settings = {};
  for (const key of Object.keys(DEFAULTS)) settings[key] = ws[key];
  const photos = ws.photos.map(({ id, rotation, fit, zoom, panX, panY }) => ({ id, rotation, fit, zoom, panX, panY }));
  return { settings, photos };
}

function snapshot() {
  const workspaces = { [state.mode]: snapshotOf(takeWorkspace()) };
  for (const [m, ws] of Object.entries(parked)) workspaces[m] = snapshotOf(ws);
  return { mode: state.mode, workspaces };
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

/** Store a photo's blob. Resolves false if storage refused it (e.g. full). */
export function saveBlob(id, blob) {
  return run('blobs', 'readwrite', (s) => s.put(blob, id)).then(
    () => true,
    (err) => {
      console.warn('Photo save failed', err);
      return false;
    });
}

export function deleteBlobs(ids) {
  if (!ids.length) return Promise.resolve();
  return run('blobs', 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); })
    .catch((err) => console.warn('Photo delete failed', err));
}

/**
 * Saved workspaces with their photo blobs, in order:
 * { mode, workspaces: { [mode]: { settings, photos: [{ meta, blob }] } } }.
 * Drops anything that no longer matches up.
 */
export async function loadSaved() {
  try {
    let doc = await run('kv', 'readonly', (s) => s.get('doc'));
    if (doc && !doc.workspaces) doc = { mode: 'collage', workspaces: { collage: doc } }; // first version's format
    const docs = doc ? Object.values(doc.workspaces) : [];
    const wanted = new Set(docs.flatMap((ws) => ws.photos.map((p) => p.id)));
    // getAllKeys and getAll both return in key order, so they line up.
    const keys = await run('blobs', 'readonly', (s) => s.getAllKeys());
    const blobs = await run('blobs', 'readonly', (s) => s.getAll());
    const byId = new Map(keys.map((key, i) => [key, blobs[i]]));
    await deleteBlobs(keys.filter((key) => !wanted.has(key)));
    if (!doc) return null;

    const workspaces = {};
    for (const [m, ws] of Object.entries(doc.workspaces)) {
      if (!MODES[m]) continue;
      const photos = ws.photos.filter((meta) => byId.has(meta.id)).map((meta) => ({ meta, blob: byId.get(meta.id) }));
      workspaces[m] = { settings: ws.settings || {}, photos };
    }
    return { mode: MODES[doc.mode] ? doc.mode : 'collage', workspaces };
  } catch (err) {
    console.warn('Load failed', err);
    return null;
  }
}
