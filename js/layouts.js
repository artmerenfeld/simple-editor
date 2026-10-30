// Paper sizes and grid layout presets. All geometry is in millimetres.

export const PAPER = {
  A4: { w: 210, h: 297, css: 'A4' },
  Letter: { w: 215.9, h: 279.4, css: 'letter' },
};

export function pageSize(paper, orientation) {
  const p = PAPER[paper] || PAPER.A4;
  return orientation === 'landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

function grid(cols, rows) {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push({ c, r, cs: 1, rs: 1 });
  }
  return { cols, rows, cells };
}

// Specs are written for portrait pages and transposed for landscape.
// `batch` marks the plain grids offered in Batch mode.
export const LAYOUTS = [
  { id: 'auto', name: 'Auto' },
  { id: 'single', name: 'Single', batch: true, ...grid(1, 1) },
  { id: 'two', name: '2 photos', batch: true, ...grid(1, 2) },
  { id: 'g4', name: '4 grid', batch: true, ...grid(2, 2) },
  { id: 'g6', name: '6 grid', batch: true, ...grid(2, 3) },
  { id: 'g9', name: '9 grid', batch: true, ...grid(3, 3) },
  { id: 'g12', name: '12 grid', batch: true, ...grid(3, 4) },
  { id: 'g20', name: '20 small', batch: true, ...grid(4, 5) },
  {
    id: 'hero2', name: 'Big + 2', cols: 2, rows: 3,
    cells: [{ c: 0, r: 0, cs: 2, rs: 2 }, { c: 0, r: 2, cs: 1, rs: 1 }, { c: 1, r: 2, cs: 1, rs: 1 }],
  },
  {
    id: 'hero3', name: 'Big + 3', cols: 3, rows: 3,
    cells: [{ c: 0, r: 0, cs: 3, rs: 2 }, { c: 0, r: 2, cs: 1, rs: 1 }, { c: 1, r: 2, cs: 1, rs: 1 }, { c: 2, r: 2, cs: 1, rs: 1 }],
  },
  {
    id: 'side3', name: 'Side + 3', cols: 3, rows: 3,
    cells: [{ c: 0, r: 0, cs: 2, rs: 3 }, { c: 2, r: 0, cs: 1, rs: 1 }, { c: 2, r: 1, cs: 1, rs: 1 }, { c: 2, r: 2, cs: 1, rs: 1 }],
  },
];

const byId = Object.fromEntries(LAYOUTS.map((l) => [l.id, l]));

function autoLayoutId(count) {
  if (count <= 1) return 'single';
  if (count === 2) return 'two';
  if (count === 3) return 'hero2';
  if (count === 4) return 'g4';
  if (count <= 6) return 'g6';
  if (count <= 9) return 'g9';
  if (count <= 12) return 'g12';
  return 'g20';
}

function transpose(spec) {
  return {
    cols: spec.rows,
    rows: spec.cols,
    // Re-sort so photos still fill in reading order (left to right, top to bottom).
    cells: spec.cells
      .map(({ c, r, cs, rs }) => ({ c: r, r: c, cs: rs, rs: cs }))
      .sort((a, b) => a.r - b.r || a.c - b.c),
  };
}

/** Resolve a layout id ('auto' included) to a concrete spec for the given orientation. */
export function resolveLayout(layoutId, photoCount, orientation) {
  let spec = byId[layoutId] || byId.auto;
  if (spec.id === 'auto') spec = byId[autoLayoutId(photoCount)];
  return orientation === 'landscape' ? transpose(spec) : spec;
}

/** Cell rectangles in mm for a page of size {w, h}. */
export function cellRects(spec, page, gapMm, marginMm) {
  // Keep margins and gaps from swallowing the whole page.
  const margin = Math.max(0, Math.min(marginMm, page.w / 4, page.h / 4));
  const cw = page.w - 2 * margin;
  const ch = page.h - 2 * margin;
  const gap = Math.max(0, Math.min(gapMm, (cw / spec.cols) * 0.5, (ch / spec.rows) * 0.5));
  const colW = (cw - gap * (spec.cols - 1)) / spec.cols;
  const rowH = (ch - gap * (spec.rows - 1)) / spec.rows;
  return spec.cells.map(({ c, r, cs, rs }) => ({
    x: margin + c * (colW + gap),
    y: margin + r * (rowH + gap),
    w: cs * colW + (cs - 1) * gap,
    h: rs * rowH + (rs - 1) * gap,
  }));
}
