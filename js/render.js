// The single renderer used for the on-screen preview, printing and image export.
import { pageSize, resolveLayout, cellRects } from './layouts.js';

const ACCENT = '#2f6bff';

/** Page size, layout and cell rects for the current state. */
export function pageModel(state) {
  const page = pageSize(state.paper, state.orientation);
  const spec = resolveLayout(state.layoutId, state.photos.length, state.orientation);
  const rects = cellRects(spec, page, state.gapMm, state.marginMm);
  const perPage = rects.length;
  const pageCount = Math.max(1, Math.ceil(state.photos.length / perPage));
  return { page, spec, rects, perPage, pageCount };
}

/** Where a photo lands inside a cell rect (same units as the rect). */
export function placement(photo, rect) {
  const turned = photo.rotation === 90 || photo.rotation === 270;
  const iw = turned ? photo.h : photo.w;
  const ih = turned ? photo.w : photo.h;
  const base = photo.fit === 'fit'
    ? Math.min(rect.w / iw, rect.h / ih)
    : Math.max(rect.w / iw, rect.h / ih);
  const scale = base * photo.zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  // How far the photo may slide each way from centre before showing an edge.
  const ox = Math.max(0, (dw - rect.w) / 2);
  const oy = Math.max(0, (dh - rect.h) / 2);
  return { scale, ox, oy };
}

function roundedRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawPhoto(ctx, photo, rect) {
  const { scale, ox, oy } = placement(photo, rect);
  ctx.translate(rect.x + rect.w / 2 + photo.panX * ox, rect.y + rect.h / 2 + photo.panY * oy);
  ctx.rotate((photo.rotation * Math.PI) / 180);
  const w = photo.w * scale;
  const h = photo.h * scale;
  ctx.drawImage(photo.img, -w / 2, -h / 2, w, h);
}

function drawPlaceholder(ctx, rect, dpr) {
  ctx.fillStyle = 'rgba(128,128,128,0.14)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const s = Math.min(rect.w, rect.h, 120 * dpr) * 0.18;
  ctx.strokeStyle = 'rgba(128,128,128,0.7)';
  ctx.lineWidth = Math.max(1.5 * dpr, s * 0.12);
  ctx.lineCap = 'round';
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy);
  ctx.lineTo(cx + s, cy);
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx, cy + s);
  ctx.stroke();
}

/**
 * Draw one page onto ctx, scaled at pxPerMm.
 * Pass `ui` ({ selectedId, swapping, dpr }) for the interactive preview; omit it for output.
 */
export function drawPage(ctx, state, model, pageIndex, pxPerMm, ui = null) {
  const { page, rects, perPage } = model;
  const radius = state.radiusMm * pxPerMm;

  ctx.save();
  ctx.fillStyle = state.bg;
  ctx.fillRect(0, 0, page.w * pxPerMm, page.h * pxPerMm);

  rects.forEach((mm, i) => {
    const rect = { x: mm.x * pxPerMm, y: mm.y * pxPerMm, w: mm.w * pxPerMm, h: mm.h * pxPerMm };
    const photo = state.photos[pageIndex * perPage + i];

    ctx.save();
    roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, radius);
    ctx.clip();
    if (photo) drawPhoto(ctx, photo, rect);
    else if (ui) drawPlaceholder(ctx, rect, ui.dpr);
    ctx.restore();

    if (ui && photo && photo.id === ui.selectedId) {
      const lw = 3 * ui.dpr;
      ctx.save();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = lw;
      if (ui.swapping) ctx.setLineDash([8 * ui.dpr, 6 * ui.dpr]);
      roundedRect(ctx, rect.x + lw / 2, rect.y + lw / 2, rect.w - lw, rect.h - lw, Math.max(0, radius - lw / 2));
      ctx.stroke();
      ctx.restore();
    }
  });
  ctx.restore();
}
