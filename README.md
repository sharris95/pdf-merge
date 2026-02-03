# PDF Kit (Merge + Images → PDF)

Two small, local-first tools that run fully in your browser:

- Merge PDFs
- Convert JPG/PNG images into a single PDF

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen?logo=github)](https://sharris95.github.io/pdf-merge/)
[![Vercel](https://img.shields.io/badge/Vercel-live-black?logo=vercel)](https://pdf-merge-lime.vercel.app/)

## Features

- Drag-and-drop PDF upload and reordering
- Local, in-browser merge (no server uploads)
- One-click download of the merged PDF

- Drag-and-drop JPG/PNG upload and reordering
- Basic per-image rotation
- Convert to PDF (Letter/A4, contain/cover, margin)

## Live Sites

- GitHub Pages: https://sharris95.github.io/pdf-merge/
- Vercel: https://pdf-merge-lime.vercel.app/

## Development

```bash
npm install
npm run dev
```

## Notes

- The tool uses hash routes for the two tabs:
  - `#merge`
  - `#img2pdf`

## Build

```bash
npm run build
```

## Deploy (GitHub Pages)

GitHub Pages is deployed via GitHub Actions from `main`.

Steps:
1. In GitHub: Settings → Pages → Source = GitHub Actions.
2. Push to `main` to trigger a deploy.
