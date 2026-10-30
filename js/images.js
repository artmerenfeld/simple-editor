// Photo import. Phone photos are huge, so each is downscaled once to keep memory low.

const JPEG_QUALITY = 0.9;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = src;
  });
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Decode a picked file and re-encode it as a modest JPEG (EXIF rotation baked in). */
export async function downscale(file, maxEdge) {
  const url = URL.createObjectURL(file);
  try {
    const src = await loadImage(url);
    const scale = Math.min(1, maxEdge / Math.max(src.naturalWidth, src.naturalHeight));
    const w = Math.max(1, Math.round(src.naturalWidth * scale));
    const h = Math.max(1, Math.round(src.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent PNGs become white, not black
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    src.src = '';
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', JPEG_QUALITY));
    canvas.width = canvas.height = 0; // release canvas memory right away (iOS is strict)
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Build a drawable photo from a stored blob plus its saved edits. */
export async function photoFromBlob(blob, meta = {}) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return {
      id: meta.id || newId(),
      rotation: meta.rotation || 0,
      fit: meta.fit || 'fill',
      zoom: meta.zoom || 1,
      panX: meta.panX || 0,
      panY: meta.panY || 0,
      w: img.naturalWidth,
      h: img.naturalHeight,
      img,
      url,
      blob, // kept for output, which decodes each page's photos only while drawing it
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export function releasePhoto(photo) {
  if (photo && photo.url) URL.revokeObjectURL(photo.url);
}
