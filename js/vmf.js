/** Valve Map Format export for convex 2D shapes extruded into brushes. */

import { stitchTJunctions } from "./geometry.js";

function snap(value, grid) {
  if (!grid) return value;
  return Math.round(value / grid) * grid;
}

function fmt(n) {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 1e6) / 1e6;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return r.toFixed(6);
}

function ringArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function nearlySame(a, b, eps) {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

function convexHull2D(points, keepColinear = false) {
  const pts = [];
  const seen = new Set();
  for (const p of points) {
    const k = `${p[0]},${p[1]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pts.push([p[0], p[1]]);
  }
  if (pts.length <= 2) return pts;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (src) => {
    const h = [];
    for (const p of src) {
      while (h.length >= 2) {
        const turn = cr(h[h.length - 2], h[h.length - 1], p);
        if (keepColinear ? turn < 0 : turn <= 0) h.pop();
        else break;
      }
      h.push(p);
    }
    return h;
  };
  const lower = build(pts);
  const upper = build(pts.slice().reverse());
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function planeArea3(a, b, c) {
  const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
  const ac = [c.x - a.x, c.y - a.y, c.z - a.z];
  return Math.hypot(
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  );
}

function dedupRingPoints(points, eps) {
  const raw = [];
  for (const p of points) {
    if (!raw.length || !nearlySame(raw[raw.length - 1], p, eps)) raw.push([p[0], p[1]]);
  }
  if (raw.length > 1 && nearlySame(raw[0], raw[raw.length - 1], eps)) raw.pop();
  return raw;
}

function finalizeWorldRing(points, gridSize) {
  const snapped = points.map(([x, y]) => [snap(x, gridSize), snap(y, gridSize)]);
  const eps = gridSize ? Math.max(1e-6, gridSize * 1e-4) : 1e-4;
  const raw = dedupRingPoints(snapped, eps);
  if (raw.length < 3) return [];

  let pts = convexHull2D(raw, true);
  pts = dedupRingPoints(pts, eps);
  if (pts.length < 3) return [];
  if (Math.abs(ringArea(pts)) < 0.5) return [];
  if (ringArea(pts) > 0) pts.reverse();
  return pts;
}

function stripShallow(pts, minDev) {
  let ring = pts.map((p) => [p[0], p[1]]);
  let guard = 0;
  while (ring.length > 3 && guard++ < 256) {
    let cut = -1;
    let best = minDev;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length];
      const b = ring[i];
      const c = ring[(i + 1) % ring.length];
      const d = perpDist(b, a, c);
      if (d <= best) {
        best = d;
        cut = i;
      }
    }
    if (cut < 0) break;
    ring.splice(cut, 1);
  }
  return ring;
}

function cleanWorldRing(points, gridSize) {
  const eps = gridSize ? Math.max(1e-6, gridSize * 1e-4) : 1e-4;
  const raw = [];
  for (const p of points) {
    if (!raw.length || !nearlySame(raw[raw.length - 1], p, eps)) raw.push([p[0], p[1]]);
  }
  if (raw.length > 1 && nearlySame(raw[0], raw[raw.length - 1], eps)) raw.pop();
  if (raw.length < 3) return [];

  let pts = convexHull2D(raw);
  pts = stripShallow(pts, gridSize ? gridSize * 0.51 : 0.51);
  if (pts.length < 3) return [];
  if (Math.abs(ringArea(pts)) < 0.5) return [];
  if (ringArea(pts) > 0) pts.reverse();
  return pts;
}

function capTriple(ring) {
  let best = null;
  let bestArea = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const area = Math.abs(ringArea([ring[i], ring[j], ring[k]]));
        if (area > bestArea) {
          bestArea = area;
          best = [ring[i], ring[j], ring[k]];
        }
      }
    }
  }
  if (!best || bestArea < 0.5) return null;
  if (ringArea(best) > 0) best.reverse();
  return best;
}

function vertexKey(x, y, z) {
  return `${x},${y},${z}`;
}

function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (!n) return v;
  return [v[0] / n, v[1] / n, v[2] / n];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vectorToStr(v, offset = 0) {
  return `[${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])} ${offset}] 0.25`;
}

function computeAxes(a, b, c) {
  const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
  const ac = [c.x - a.x, c.y - a.y, c.z - a.z];
  const normal = normalize(cross3(ab, ac));
  if (!Math.hypot(...normal)) {
    return ["[1 0 0 0] 0.25", "[0 -1 0 0] 0.25"];
  }
  const up = Math.abs(dot3(normal, [0, 0, 1])) < 0.99 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross3(up, normal));
  const v = normalize(cross3(normal, u));
  return [vectorToStr([-u[0], -u[1], -u[2]]), vectorToStr([-v[0], -v[1], -v[2]])];
}

function makePlane(a, b, c) {
  return `(${fmt(a.x)} ${fmt(a.y)} ${fmt(a.z)}) (${fmt(b.x)} ${fmt(b.y)} ${fmt(b.z)}) (${fmt(c.x)} ${fmt(c.y)} ${fmt(c.z)})`;
}

function indent(text, n = 1) {
  const pad = "\t".repeat(n);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

function sideBlock(id, plane, material, uaxis, vaxis, smoothing = 0) {
  return `side
{
	"id" "${id}"
	"plane" "${plane}"
	"material" "${material}"
	"uaxis" "${uaxis}"
	"vaxis" "${vaxis}"
	"rotation" "0"
	"lightmapscale" "16"
	"smoothing_groups" "${smoothing}"
}`;
}

export function exportVmf(shapes, imageWidth, imageHeight, options = {}) {
  const widthUnits = options.width ?? 1024;
  const heightUnits = options.height ?? 1024;
  const thickness = options.thickness ?? 16;
  const gridSize = options.snapToGrid === false ? 0 : 1;
  const mat = options.material ?? "dev/dev_measuregeneric01b";
  const wallSmooth = 1;

  const pxToX = widthUnits / imageWidth;
  const pxToY = heightUnits / imageHeight;

  const toWorld = (x, y) => {
    const wx = snap(x * pxToX, gridSize);
    const wy = snap((imageHeight - y) * pxToY, gridSize);
    return [wx, wy];
  };

  const vertexCache = new Map();
  const getVertex = (x, y, z) => {
    const sx = snap(x, gridSize);
    const sy = snap(y, gridSize);
    const sz = snap(z, gridSize);
    const key = vertexKey(sx, sy, sz);
    if (!vertexCache.has(key)) vertexCache.set(key, { x: sx, y: sy, z: sz });
    return vertexCache.get(key);
  };

  const zTop = snap(thickness, gridSize) || thickness;
  const overlapEps = Math.max(4, (gridSize || 1) * 4);
  const pieces = [];

  for (const poly of shapes) {
    if (!poly || poly.length < 3) continue;
    const coords =
      poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]
        ? poly.slice(0, -1)
        : poly;
    const world2d = cleanWorldRing(
      coords.map((p) => toWorld(p[0], p[1])),
      gridSize
    );
    if (world2d.length >= 3) pieces.push(world2d);
  }

  const stitched = stitchTJunctions(pieces, overlapEps);
  const prepared = [];
  for (const ring of stitched) {
    const finalRing = finalizeWorldRing(ring, gridSize);
    const cap = capTriple(finalRing);
    if (cap) prepared.push({ ring: finalRing, cap });
  }

  let nextId = 2;
  const solids = [];

  for (let p = 0; p < prepared.length; p++) {
    const { ring, cap } = prepared[p];
    const top = ring.map(([x, y]) => getVertex(x, y, zTop));
    const bottom = ring.map(([x, y]) => getVertex(x, y, 0));
    const capTop = cap.map(([x, y]) => getVertex(x, y, zTop));
    const capBot = cap.map(([x, y]) => getVertex(x, y, 0));

    const solidId = nextId++;
    const sides = [];
    if (planeArea3(capTop[0], capTop[1], capTop[2]) < 0.5) continue;
    if (planeArea3(capBot[2], capBot[1], capBot[0]) < 0.5) continue;
    sides.push(
      sideBlock(nextId++, makePlane(capTop[0], capTop[1], capTop[2]), mat, "[1 0 0 0] 0.25", "[0 -1 0 0] 0.25", 0)
    );
    sides.push(
      sideBlock(
        nextId++,
        makePlane(capBot[2], capBot[1], capBot[0]),
        mat,
        "[1 0 0 0] 0.25",
        "[0 1 0 0] 0.25",
        0
      )
    );

    let degenerate = false;
    for (let i = 0; i < top.length; i++) {
      const aBot = bottom[i];
      const bBot = bottom[(i + 1) % top.length];
      const bTop = top[(i + 1) % top.length];
      if (aBot.x === bBot.x && aBot.y === bBot.y) continue;
      if (planeArea3(aBot, bBot, bTop) < 0.5) {
        degenerate = true;
        break;
      }
      const [uaxis, vaxis] = computeAxes(aBot, bBot, bTop);
      sides.push(sideBlock(nextId++, makePlane(aBot, bBot, bTop), mat, uaxis, vaxis, wallSmooth));
    }
    if (degenerate || sides.length < 4) continue;

    solids.push(`solid
{
	"id" "${solidId}"
${indent(sides.join("\n"))}
	editor
	{
		"color" "0 180 0"
		"visgroupshown" "1"
		"visgroupautoshown" "1"
	}
}`);
  }

  return `versioninfo
{
	"editorversion" "400"
	"editorbuild" "0"
	"mapversion" "1"
	"formatversion" "100"
	"prefab" "0"
}
visgroups
{
}
viewsettings
{
	"bSnapToGrid" "1"
	"bShowGrid" "1"
	"bShowLogicalGrid" "0"
	"nGridSpacing" "64"
	"bShow3DGrid" "0"
}
world
{
	"id" "1"
	"mapversion" "1"
	"classname" "worldspawn"
	"skyname" "sky_day01_01"
	"maxpropscreenwidth" "-1"
	"detailvbsp" "detail.vbsp"
	"detailmaterial" "detail/detailsprites"
${indent(solids.join("\n"))}
}
cameras
{
	"activecamera" "-1"
}
cordon
{
	"mins" "(-1024 -1024 -1024)"
	"maxs" "(1024 1024 1024)"
	"active" "0"
}
`;
}

export function exportSvg(shapes, imageWidth, imageHeight, maskDataUrl) {
  const paths = shapes
    .map((poly, i) => {
      if (!poly || poly.length < 3) return "";
      const hue = (i * 137.508) % 360;
      const d = poly
        .map((p, idx) => `${idx === 0 ? "M" : "L"}${p[0].toFixed(3)} ${p[1].toFixed(3)}`)
        .join(" ");
      return `<path d="${d} Z" fill="hsla(${hue},70%,55%,0.35)" stroke="hsla(${hue},80%,65%,0.95)" stroke-width="1.25" stroke-linejoin="round"/>`;
    })
    .join("\n");

  const image = maskDataUrl
    ? `<image href="${maskDataUrl}" width="${imageWidth}" height="${imageHeight}" opacity="0.35"/>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${imageWidth} ${imageHeight}" width="${imageWidth}" height="${imageHeight}">
  <rect width="100%" height="100%" fill="#09090b"/>
  ${image}
  <g fill-rule="evenodd">
    ${paths}
  </g>
</svg>
`;
}
