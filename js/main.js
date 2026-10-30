import { LAYOUTS, PAPER, pageSize, resolveLayout, cellRects } from './layouts.js';
import { pageModel, drawPage, placement } from './render.js';
import { downscale, photoFromBlob, releasePhoto } from './images.js';
import {
  state, MODES, subscribe, changed, set, switchMode, restore,
  saveBlob, deleteBlobs, loadSaved, persistNow,
} from './store.js';
import {
  renderPages, preparePrint, clearPrint, buildPdf, shareFiles, Cancelled, DIRECT_PRINT_MAX_PAGES,
} from './output.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// UI-only state (not saved).
const ui = { selectedId: null, swapping: false, page: 0 };

const canvas = $('preview');
const ctx = canvas.getContext('2d');
let model = pageModel(state);
let frame = 0;

// --- Drawing ------------------------------------------------------------------

function requestDraw() {
  if (!frame) frame = requestAnimationFrame(draw);
}

function draw() {
  frame = 0;
  model = pageModel(state);
  ui.page = clamp(ui.page, 0, model.pageCount - 1);
  if (ui.selectedId && !selectedPhoto()) {
    ui.selectedId = null;
    ui.swapping = false;
  }

  const stage = $('stage');
  const cs = getComputedStyle(stage);
  const availW = Math.max(50, stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  const availH = Math.max(50, stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
  const scale = Math.min(availW / model.page.w, availH / model.page.h);
  const cssW = Math.floor(model.page.w * scale);
  const cssH = Math.floor(model.page.h * scale);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const pxW = Math.round(cssW * dpr);
  const pxH = Math.round(cssH * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawPage(ctx, state, model, ui.page, pxW / model.page.w, { ui: { selectedId: ui.selectedId, swapping: ui.swapping, dpr } });
  updateControls();
}

// --- Controls -------------------------------------------------------------------

function selectedPhoto() {
  return state.photos.find((p) => p.id === ui.selectedId) || null;
}

function setPressed(el, on) {
  el.setAttribute('aria-pressed', on ? 'true' : 'false');
}

const layoutButtons = LAYOUTS.map((layout) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'layout-btn';
  btn.innerHTML = `<span class="thumb"></span><span>${layout.name}</span>`;
  btn.addEventListener('click', () => {
    ui.page = 0;
    set({ layoutId: layout.id });
  });
  $('layout-strip').appendChild(btn);
  return { layout, btn, key: '' };
});

function thumbSvg(spec, page) {
  const rects = cellRects(spec, page, 9, 12);
  const k = 58 / Math.max(page.w, page.h);
  const cells = rects
    .map((r) => `<rect class="cell" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="3"/>`)
    .join('');
  return `<svg viewBox="0 0 ${page.w} ${page.h}" style="width:${page.w * k}px;height:${page.h * k}px" aria-hidden="true">` +
    `<rect class="page" width="${page.w}" height="${page.h}" rx="8"/>${cells}</svg>`;
}

function updateLayoutStrip() {
  const page = pageSize(state.paper, state.orientation);
  for (const item of layoutButtons) {
    const spec = resolveLayout(item.layout.id, state.photos.length, state.orientation);
    const key = `${state.paper}|${state.orientation}|${JSON.stringify(spec.cells)}`;
    if (item.key !== key) {
      item.btn.querySelector('.thumb').innerHTML = thumbSvg(spec, page);
      item.key = key;
    }
    item.btn.hidden = state.mode === 'batch' && !item.layout.batch;
    setPressed(item.btn, item.layout.id === state.layoutId);
  }
}

function updatePager() {
  const batch = state.mode === 'batch';
  const count = state.photos.length;
  // Batch always shows this line, so the preview doesn't jump as photos arrive.
  $('pager').hidden = !batch && model.pageCount < 2;
  let label = `Page ${ui.page + 1} of ${model.pageCount}`;
  if (batch) label = count ? `${label} · ${count} photo${count > 1 ? 's' : ''}` : 'Choose photos per page, then tap Add';
  $('pager-label').textContent = label;
  for (const id of ['btn-prev', 'btn-next']) $(id).style.visibility = model.pageCount > 1 ? '' : 'hidden';
  $('btn-prev').disabled = ui.page === 0;
  $('btn-next').disabled = ui.page >= model.pageCount - 1;
}

function updateControls() {
  const photo = selectedPhoto();
  $('panel-main').hidden = !!photo;
  $('panel-photo').hidden = !photo;
  document.querySelectorAll('[data-mode]').forEach((b) => setPressed(b, b.dataset.mode === state.mode));
  updatePager();
  $('btn-output').disabled = state.photos.length === 0;

  if (photo) {
    $('zoom').value = photo.zoom;
    $('zoom-out').textContent = `${photo.zoom.toFixed(1)}×`;
    $('fit-label').textContent = photo.fit === 'fill' ? 'Show all' : 'Fill cell';
    setPressed($('btn-swap'), ui.swapping);
    const hint = $('photo-hint');
    hint.textContent = ui.swapping ? 'Tap another photo to swap places' : 'Drag to move · pinch or slide to zoom';
    hint.classList.toggle('active', ui.swapping);
    return;
  }

  updateLayoutStrip();
  document.querySelectorAll('.segmented[data-setting]').forEach((group) => {
    group.querySelectorAll('button').forEach((b) => setPressed(b, state[group.dataset.setting] === b.dataset.value));
  });
  document.querySelectorAll('input[type="range"][data-setting]').forEach((input) => {
    input.value = state[input.dataset.setting];
    document.querySelector(`output[data-for="${input.dataset.setting}"]`).textContent = `${state[input.dataset.setting]} mm`;
  });
  document.querySelectorAll('[data-bg]').forEach((b) => setPressed(b, b.dataset.bg === state.bg));
}

function select(id) {
  ui.selectedId = id;
  ui.swapping = false;
  requestDraw();
}

// --- Sheet & toast ----------------------------------------------------------------

let sheetDismissible = true;

function showSheet({ title, text = '', spinner = false, actions = [], dismissible = true }) {
  sheetDismissible = dismissible;
  $('sheet-title').textContent = title;
  $('sheet-text').textContent = text;
  const box = $('sheet-actions');
  box.replaceChildren();
  if (spinner) {
    const s = document.createElement('div');
    s.className = 'spinner';
    box.appendChild(s);
  }
  for (const action of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-block ${action.kind ? `btn-${action.kind}` : ''}`;
    b.textContent = action.label;
    b.addEventListener('click', action.onClick);
    box.appendChild(b);
  }
  $('sheet').hidden = false;
}

function setSheetText(text) {
  $('sheet-text').textContent = text;
}

function closeSheet() {
  $('sheet').hidden = true;
}

let toastTimer = 0;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// --- Photos ---------------------------------------------------------------------

let pickerMode = 'add';

function openPicker(mode) {
  pickerMode = mode;
  const input = mode === 'replace' ? $('file-replace') : $('file-add');
  input.value = '';
  input.click();
}

let storageWarned = false;

async function importFile(file) {
  const mode = MODES[state.mode];
  const blob = await downscale(file, mode.maxEdge);
  const photo = await photoFromBlob(blob, { fit: mode.fit });
  if (!(await saveBlob(photo.id, blob)) && !storageWarned) {
    storageWarned = true;
    toast("Phone storage is full: these photos won't be kept after closing");
  }
  return photo;
}

async function addFiles(files) {
  const max = MODES[state.mode].maxPhotos;
  const room = max - state.photos.length;
  if (room <= 0) {
    toast(`You can add up to ${max} photos`);
    return;
  }
  const list = files.slice(0, room);
  const firstNew = state.photos.length;
  const job = { cancelled: false };
  let failed = 0;
  let added = 0;
  showSheet({
    title: 'Adding photos',
    spinner: true,
    dismissible: false,
    actions: list.length > 1 ? [{ label: 'Stop', onClick: () => { job.cancelled = true; setSheetText('Stopping…'); } }] : [],
  });
  for (let i = 0; i < list.length && !job.cancelled; i++) {
    setSheetText(list.length > 1 ? `${i + 1} of ${list.length}` : '');
    try {
      state.photos.push(await importFile(list[i]));
      added++;
      changed();
    } catch (err) {
      console.warn('Import failed', err);
      failed++;
    }
  }
  closeSheet();
  ui.selectedId = null;
  ui.page = Math.floor(firstNew / pageModel(state).perPage);
  requestDraw();
  if (failed) toast(`${failed} photo${failed > 1 ? 's' : ''} couldn't be opened`);
  else if (job.cancelled) toast(`Added ${added} photo${added === 1 ? '' : 's'}`);
  else if (files.length > room) toast(`Added ${list.length}. The limit is ${max} photos.`);
}

async function replaceSelected(file) {
  const old = selectedPhoto();
  if (!old) return;
  showSheet({ title: 'Replacing photo', spinner: true, dismissible: false });
  try {
    const photo = await importFile(file);
    const index = state.photos.indexOf(old);
    if (index < 0) return;
    state.photos[index] = photo;
    deleteBlobs([old.id]);
    releasePhoto(old);
    ui.selectedId = photo.id;
    changed();
  } catch (err) {
    console.warn('Replace failed', err);
    toast("That photo couldn't be opened");
  } finally {
    closeSheet();
  }
}

function removeSelected() {
  const photo = selectedPhoto();
  if (!photo) return;
  state.photos.splice(state.photos.indexOf(photo), 1);
  deleteBlobs([photo.id]);
  releasePhoto(photo);
  ui.selectedId = null;
  ui.swapping = false;
  changed();
}

function editSelected(fn) {
  const photo = selectedPhoto();
  if (!photo) return;
  fn(photo);
  changed();
}

function startOver() {
  const name = state.mode === 'batch' ? 'Batch' : 'Collage';
  const other = state.mode === 'batch' ? 'Collage' : 'Batch';
  showSheet({
    title: 'Start over?',
    text: `This removes all photos from ${name}. ${other} and your page settings stay the same.`,
    actions: [
      {
        label: 'Remove all photos',
        kind: 'danger',
        onClick: () => {
          closeSheet();
          const ids = state.photos.map((p) => p.id);
          state.photos.forEach(releasePhoto);
          state.photos = [];
          ui.selectedId = null;
          ui.swapping = false;
          ui.page = 0;
          changed();
          deleteBlobs(ids);
        },
      },
      { label: 'Cancel', onClick: closeSheet },
    ],
  });
}

// --- Print / save -------------------------------------------------------------------

async function openOutput() {
  if (!state.photos.length) return;
  select(null);
  const job = { cancelled: false };
  showSheet({
    title: 'Getting your pages ready…',
    spinner: true,
    dismissible: false,
    actions: [{ label: 'Cancel', onClick: () => { job.cancelled = true; closeSheet(); } }],
  });
  try {
    const rendered = await renderPages(state, {
      dpi: MODES[state.mode].dpi,
      job,
      onProgress: (i, n) => setSheetText(n > 1 ? `Page ${i} of ${n}` : ''),
    });
    const count = rendered.pages.length;
    const direct = count <= DIRECT_PRINT_MAX_PAGES;
    if (direct) await preparePrint(rendered, state);
    else clearPrint();
    if (job.cancelled) return;

    const pdf = new File([buildPdf(rendered)], 'photo-grid.pdf', { type: 'application/pdf' });
    const images = rendered.pages.map((blob, i) =>
      new File([blob], count > 1 ? `photo-grid-${i + 1}.jpg` : 'photo-grid.jpg', { type: 'image/jpeg' }));
    const afterShare = (result) => {
      if (result === 'shared') closeSheet();
      if (result === 'downloaded') toast('Saved to your downloads');
    };
    const sharePdf = () => shareFiles([pdf]).then(afterShare);
    const actions = direct
      ? [{ label: 'Print', kind: 'primary', onClick: () => { closeSheet(); window.print(); } }, { label: 'Share as PDF', onClick: sharePdf }]
      : [{ label: 'Print or save PDF', kind: 'primary', onClick: sharePdf }];
    actions.push(
      { label: count > 1 ? `Save ${count} images` : 'Save image', onClick: () => shareFiles(images).then(afterShare) },
      { label: 'Cancel', onClick: closeSheet },
    );
    showSheet({
      title: count > 1 ? `Ready · ${count} pages` : 'Ready',
      text: direct
        ? `${state.paper}, ${state.orientation}`
        : `${state.paper}, ${state.orientation}. In the menu that opens, choose Print, or Save to Files.`,
      actions,
    });
  } catch (err) {
    if (err instanceof Cancelled) return;
    console.error('Output failed', err);
    showSheet({
      title: 'Something went wrong',
      text: 'The page could not be prepared. Please try again.',
      actions: [{ label: 'OK', onClick: closeSheet }],
    });
  }
}

// --- Gestures on the preview ------------------------------------------------------------

const TAP_SLOP = 8;
const pointers = new Map();
let gesture = null; // { kind: 'pan' | 'pinch', photo, ... }
let tap = null; // { x, y, cell, moved }

function cellAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const x = ((clientX - r.left) / r.width) * model.page.w;
  const y = ((clientY - r.top) / r.height) * model.page.h;
  return model.rects.findIndex((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
}

function photoInCell(cell) {
  return cell < 0 ? null : state.photos[ui.page * model.perPage + cell] || null;
}

function cellRectCss(cell) {
  const k = canvas.getBoundingClientRect().width / model.page.w;
  const r = model.rects[cell];
  return { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k };
}

function startPan(photo, cell, x, y) {
  const { ox, oy } = placement(photo, cellRectCss(cell));
  return { kind: 'pan', photo, cell, x0: x, y0: y, panX0: photo.panX, panY0: photo.panY, ox, oy };
}

function pointerDistance() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    const cell = cellAt(e.clientX, e.clientY);
    const photo = photoInCell(cell);
    tap = { x: e.clientX, y: e.clientY, cell, moved: false };
    gesture = photo && !ui.swapping ? startPan(photo, cell, e.clientX, e.clientY) : null;
  } else if (pointers.size === 2 && gesture) {
    tap = null;
    gesture = { kind: 'pinch', photo: gesture.photo, cell: gesture.cell, d0: pointerDistance(), zoom0: gesture.photo.zoom };
    select(gesture.photo.id);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (tap && !tap.moved && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP) {
    tap.moved = true;
    if (gesture && ui.selectedId !== gesture.photo.id) select(gesture.photo.id);
  }
  if (!gesture || (tap && !tap.moved)) return;

  const photo = gesture.photo;
  if (gesture.kind === 'pan' && pointers.size === 1) {
    photo.panX = gesture.ox ? clamp(gesture.panX0 + (e.clientX - gesture.x0) / gesture.ox, -1, 1) : 0;
    photo.panY = gesture.oy ? clamp(gesture.panY0 + (e.clientY - gesture.y0) / gesture.oy, -1, 1) : 0;
  } else if (gesture.kind === 'pinch' && pointers.size === 2) {
    photo.zoom = clamp(gesture.zoom0 * (pointerDistance() / gesture.d0), 1, 4);
  }
  requestDraw();
});

function endPointer(e) {
  if (!pointers.delete(e.pointerId)) return;
  if (pointers.size === 1 && gesture && gesture.kind === 'pinch') {
    // One finger left after a pinch: carry on panning from where it is.
    const [p] = pointers.values();
    gesture = startPan(gesture.photo, gesture.cell, p.x, p.y);
    return;
  }
  if (pointers.size > 0) return;

  // Taps are handled on 'click', which iOS always trusts for opening the photo picker.
  tapCell = tap && !tap.moved && e.type === 'pointerup' ? tap.cell : null;
  if (tapCell === null && gesture) changed();
  tap = null;
  gesture = null;
}

let tapCell = null;
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('click', () => {
  if (tapCell !== null) handleTap(tapCell);
  tapCell = null;
});

function handleTap(cell) {
  const photo = photoInCell(cell);
  if (ui.swapping) {
    const from = state.photos.findIndex((p) => p.id === ui.selectedId);
    ui.swapping = false;
    if (from >= 0 && cell >= 0 && photo && photo.id !== ui.selectedId) {
      const to = state.photos.indexOf(photo);
      [state.photos[from], state.photos[to]] = [state.photos[to], state.photos[from]];
    } else if (from >= 0 && cell >= 0 && !photo) {
      // Empty cells are always after the last photo, so move it to the end.
      state.photos.push(state.photos.splice(from, 1)[0]);
    }
    changed();
    return;
  }
  if (cell < 0) {
    select(null);
  } else if (!photo) {
    select(null);
    openPicker('add');
  } else {
    select(photo.id);
  }
}

// --- Wiring -----------------------------------------------------------------------

$('btn-add').addEventListener('click', () => openPicker('add'));
$('btn-new').addEventListener('click', startOver);
$('btn-output').addEventListener('click', openOutput);

$('file-add').addEventListener('change', (e) => {
  const files = [...e.target.files];
  if (files.length && pickerMode === 'add') addFiles(files);
});
$('file-replace').addEventListener('change', (e) => {
  const [file] = e.target.files;
  if (file) replaceSelected(file);
});

$('btn-prev').addEventListener('click', () => { ui.page--; select(null); });
$('btn-next').addEventListener('click', () => { ui.page++; select(null); });

document.querySelectorAll('[role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('[role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('[data-tab-body]').forEach((body) => { body.hidden = body.dataset.tabBody !== tab.dataset.tab; });
  });
});

$('mode').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.dataset.mode === state.mode) return;
  ui.selectedId = null;
  ui.swapping = false;
  ui.page = 0;
  switchMode(btn.dataset.mode);
});

document.querySelectorAll('.segmented[data-setting]').forEach((group) => {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) set({ [group.dataset.setting]: btn.dataset.value });
  });
});

document.querySelectorAll('input[type="range"][data-setting]').forEach((input) => {
  input.addEventListener('input', () => set({ [input.dataset.setting]: Number(input.value) }));
});

document.querySelectorAll('[data-bg]').forEach((b) => b.addEventListener('click', () => set({ bg: b.dataset.bg })));

$('zoom').addEventListener('input', (e) => editSelected((p) => { p.zoom = Number(e.target.value); }));
$('btn-rotate').addEventListener('click', () => editSelected((p) => {
  p.rotation = (p.rotation + 90) % 360;
  p.panX = p.panY = 0;
}));
$('btn-fit').addEventListener('click', () => editSelected((p) => {
  p.fit = p.fit === 'fill' ? 'fit' : 'fill';
  p.zoom = 1;
  p.panX = p.panY = 0;
}));
$('btn-swap').addEventListener('click', () => {
  ui.swapping = !ui.swapping;
  requestDraw();
});
$('btn-replace').addEventListener('click', () => openPicker('replace'));
$('btn-remove').addEventListener('click', removeSelected);
$('btn-done').addEventListener('click', () => select(null));

$('sheet').addEventListener('click', (e) => {
  if (sheetDismissible && e.target.hasAttribute('data-close')) closeSheet();
});

// Keep iOS from zooming the whole page when pinching photos.
document.addEventListener('gesturestart', (e) => e.preventDefault());

window.addEventListener('resize', requestDraw);
if ('ResizeObserver' in window) new ResizeObserver(requestDraw).observe($('stage'));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistNow();
});
window.addEventListener('pagehide', persistNow);

subscribe(requestDraw);

// --- Start --------------------------------------------------------------------------

function validSettings(saved, mode) {
  const s = { ...MODES[mode].defaults };
  if (saved.paper in PAPER) s.paper = saved.paper;
  if (saved.orientation === 'portrait' || saved.orientation === 'landscape') s.orientation = saved.orientation;
  if (LAYOUTS.some((l) => l.id === saved.layoutId && (mode !== 'batch' || l.batch))) s.layoutId = saved.layoutId;
  for (const key of ['gapMm', 'marginMm', 'radiusMm']) {
    if (Number.isFinite(saved[key])) s[key] = saved[key];
  }
  if (typeof saved.bg === 'string') s.bg = saved.bg;
  return s;
}

async function restorePhotos(items) {
  const photos = [];
  for (let i = 0; i < items.length; i += 20) {
    const loaded = await Promise.all(items.slice(i, i + 20).map(({ meta, blob }) =>
      photoFromBlob(blob, meta).catch((err) => console.warn('Could not restore a photo', err))));
    photos.push(...loaded.filter(Boolean));
  }
  return photos;
}

async function boot() {
  requestDraw();
  const saved = await loadSaved();
  if (saved) {
    const total = Object.values(saved.workspaces).reduce((n, ws) => n + ws.photos.length, 0);
    if (total > 40) showSheet({ title: 'Loading your photos…', spinner: true, dismissible: false });
    const workspaces = {};
    for (const [mode, ws] of Object.entries(saved.workspaces)) {
      workspaces[mode] = { ...validSettings(ws.settings, mode), photos: await restorePhotos(ws.photos) };
    }
    restore(saved.mode, workspaces);
    closeSheet();
    requestDraw();
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

boot();
