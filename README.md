# ShapeGen Web

Load a black-and-white mask, vectorize it into convex pieces, and export Source engine VMF brushes. Everything runs locally in the browser — no build step, no server.

## Use it

1. Open [the live app](https://ammarillo.github.io/ShapeGenWeb/), or `index.html` from a local static server.
2. Load a mask (white = solid).
3. Generate shapes, then export `.vmf` or `.svg`.

Chrome, Firefox, Safari, and Edge all work. Opening the file with `file://` will not, because the app uses ES modules and a web worker.

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## GitHub Pages

This repo is already a static site.

1. Push the project to GitHub.
2. In the repo: **Settings → Pages**.
3. Set **Source** to **Deploy from a branch**, branch `main`, folder `/ (root)`.
4. After a minute the app is at https://ammarillo.github.io/ShapeGenWeb/.

## Settings

| Control | What it does |
| --- | --- |
| Curve tolerance | Douglas–Peucker simplification. Higher = fewer vertices. |
| Merge convex pieces | Join adjacent triangles while they stay convex and under the angle cap. |
| Width / height / thickness | VMF world mapping. |
| Snap to grid | Snap exported vertices to the 1-unit grid. |

Pan the preview by dragging. Zoom with the mouse wheel or the toolbar.
