# Photo Grid

A simple web app for putting several photos on one page and printing it. It's made for use on a phone.

**Open it:** https://artmerenfeld.github.io/simple-editor/

## What it does

- Pick photos from your phone and they're laid out in a grid
- Ready-made layouts: 1, 2, 4, 6, 9, 12 or 20 photos, plus a few with one large photo
- A4 or Letter, portrait or landscape
- Adjust the spacing, margins, rounded corners and background color
- Tap a photo to move, zoom, rotate, swap, replace or remove it
- Print it, save it as an image, or share it as a PDF

**Batch mode** is for lots of photos. Choose how many go on each page (for example 6), then add up to 300 photos. They're placed in order across as many pages as needed, and you get one PDF ready to print.

## Privacy

Photos never leave the device. Everything happens in the browser. Nothing is uploaded, and there's no tracking.

## Tip

On iPhone, open the link in Safari, then tap Share → **Add to Home Screen** to use it like an app.

## Running locally

No build step. Serve the folder with any static server:

```sh
python -m http.server 8000
```
