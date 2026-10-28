# Photo Grid

A small web app for arranging photos in a grid on a page and printing it. It's built for iPhone Safari and works in any modern browser.

There is no build step and there are no dependencies: plain HTML, CSS and ES modules.

## Using it

1. Tap **Add photos** (or any empty cell) and pick photos.
2. **Layout** tab: choose a preset. **Auto** picks a grid based on how many photos there are. Extra photos go onto more pages.
3. **Page** tab: A4 or Letter, portrait or landscape, gap, margin, rounded corners and background color.
4. Tap a photo to edit it. Drag to move it, pinch or use the slider to zoom. You can also **Rotate**, switch between **Show all** and **Fill cell**, **Swap** it with another photo, **Replace** it or **Remove** it.
5. **Print or save** lets you print directly (AirPrint), save the page as an image to Photos, or share a PDF.

Work is saved in the browser automatically, so it's still there after the tab reloads.

On iPhone, use Safari: tap Share, then **Add to Home Screen**, and it opens like an app.

## Running locally

```sh
python -m http.server 8000
# open http://localhost:8000
```

## Code layout

| File | Role |
|---|---|
| `js/layouts.js` | Paper sizes, layout presets, and cell geometry (mm) |
| `js/render.js` | One canvas renderer used for the preview, printing and export |
| `js/images.js` | Photo import, downscaled to a 2048 px long edge to keep iPhone memory low |
| `js/store.js` | State plus IndexedDB persistence |
| `js/output.js` | 300 DPI page rendering, print, image and PDF export |
| `js/main.js` | UI and touch gestures |
