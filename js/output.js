// Print, image and PDF output. Every page is rendered once at print resolution and reused.
import { PAPER } from './layouts.js';
import { pageModel, drawPage } from './render.js';

const DPI = 300;
const JPEG_QUALITY = 0.92;
const PT_PER_MM = 72 / 25.4;

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create image'))), type, quality));
}

/** Render every page to a JPEG blob at 300 DPI. */
export async function renderPages(state, onProgress) {
  const model = pageModel(state);
  const pxPerMm = DPI / 25.4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(model.page.w * pxPerMm);
  canvas.height = Math.round(model.page.h * pxPerMm);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const pages = [];
  try {
    for (let i = 0; i < model.pageCount; i++) {
      if (onProgress) onProgress(i + 1, model.pageCount);
      drawPage(ctx, state, model, i, pxPerMm);
      pages.push(await toBlob(canvas, 'image/jpeg', JPEG_QUALITY));
    }
  } finally {
    canvas.width = canvas.height = 0;
  }
  return { pages, page: model.page, widthPx: Math.round(model.page.w * pxPerMm), heightPx: Math.round(model.page.h * pxPerMm) };
}

// --- Print -------------------------------------------------------------------

let printUrls = [];

export function clearPrint() {
  document.getElementById('print-root').replaceChildren();
  printUrls.forEach((u) => URL.revokeObjectURL(u));
  printUrls = [];
}

/** Put the rendered pages into the print-only container and wait until they are decoded. */
export async function preparePrint(rendered, state) {
  clearPrint();
  document.getElementById('page-style').textContent =
    `@page { size: ${PAPER[state.paper].css} ${state.orientation}; margin: 0; }`;
  const root = document.getElementById('print-root');
  const imgs = rendered.pages.map((blob) => {
    const url = URL.createObjectURL(blob);
    printUrls.push(url);
    const img = new Image();
    img.alt = '';
    img.src = url;
    root.appendChild(img);
    return img;
  });
  await Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
}

// --- PDF ---------------------------------------------------------------------

/** A minimal PDF with one full-page JPEG per page. */
export async function buildPdf(rendered) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n, ...body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body.forEach(push);
    push('\nendobj\n');
  };

  const pw = (rendered.page.w * PT_PER_MM).toFixed(2);
  const ph = (rendered.page.h * PT_PER_MM).toFixed(2);
  const count = rendered.pages.length;
  const kids = rendered.pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');

  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`);
  for (let i = 0; i < count; i++) {
    const pageN = 3 + i * 3;
    const contentN = pageN + 1;
    const imageN = pageN + 2;
    const jpeg = new Uint8Array(await rendered.pages[i].arrayBuffer());
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(pageN, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] ` +
      `/Resources << /XObject << /Im0 ${imageN} 0 R >> >> /Contents ${contentN} 0 R >>`);
    obj(contentN, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(imageN, `<< /Type /XObject /Subtype /Image /Width ${rendered.widthPx} /Height ${rendered.heightPx} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream');
  }

  const total = 3 + count * 3;
  const xref = length;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

// --- Share / download -----------------------------------------------------------

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Open the share sheet (on iPhone: "Save Image", "Print", "Save to Files"...) or fall back to downloads.
 * Must be called straight from a tap so Safari allows it.
 */
export async function shareFiles(files) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      console.warn('Share failed, downloading instead', err);
    }
  }
  files.forEach(download);
  return 'downloaded';
}
