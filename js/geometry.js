/** ShapeGen geometry pipeline: mask → contours → convex pieces. */

const EPS = 1e-9;

export function hypot2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

export function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function signedArea(ring) {
  const pts = openRing(ring);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function openRing(ring) {
  if (!ring.length) return [];
  const pts = ring.map((p) => [p[0], p[1]]);
  if (pts.length > 1 && hypot2(pts[0], pts[pts.length - 1]) < 1e-16) pts.pop();
  return pts;
}

export function closeRing(ring) {
  const pts = openRing(ring);
  if (!pts.length) return pts;
  return [...pts, [pts[0][0], pts[0][1]]];
}

export function cleanRing(ring, eps = 1e-8) {
  const open = openRing(ring);
  const out = [];
  for (const p of open) {
    if (!out.length || dist(p, out[out.length - 1]) > eps) out.push(p);
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) <= eps) out.pop();
  return out;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return dist(p, a);
  return Math.abs(cross(p[0] - a[0], p[1] - a[1], dx, dy)) / Math.sqrt(len2);
}

export function simplify(points, tolerance) {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);
  let src = points.map((p) => [p[0], p[1]]);
  if (hypot2(src[0], src[src.length - 1]) >= 1e-16) src = closeRing(src);
  if (src.length <= 3) return src;

  const keep = new Uint8Array(src.length);
  keep[0] = 1;
  keep[src.length - 1] = 1;
  const stack = [[0, src.length - 1]];

  while (stack.length) {
    const [start, end] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const a = src[start];
    const b = src[end];
    for (let i = start + 1; i < end; i++) {
      const d = perpDist(src[i], a, b);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([start, idx], [idx, end]);
    }
  }

  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (keep[i]) out.push([src[i][0], src[i][1]]);
  }
  if (out.length >= 2 && hypot2(out[0], out[out.length - 1]) < 1e-16) out.pop();
  if (out.length && hypot2(out[0], out[out.length - 1]) >= 1e-16) out.push([out[0][0], out[0][1]]);
  return out;
}

export function pointInRing(point, ring) {
  let inside = false;
  const pts = openRing(ring);
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if (yi === yj) continue;
    if ((yi > point[1]) !== (yj > point[1])) {
      const xint = ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
      if (point[0] < xint) inside = !inside;
    }
  }
  return inside;
}

function lerpPoint(p, q, vp, vq, level) {
  if (Math.abs(vq - vp) < EPS) return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const t = (level - vp) / (vq - vp);
  return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
}

function ptKey(p) {
  return `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
}

function stitchSegments(segments) {
  const byStart = new Map();
  for (const seg of segments) {
    const k = ptKey(seg[0]);
    let list = byStart.get(k);
    if (!list) {
      list = [];
      byStart.set(k, list);
    }
    list.push(seg);
  }

  const used = new Set();
  const contours = [];

  for (const seg of segments) {
    if (used.has(seg)) continue;
    used.add(seg);
    const contour = [seg[0], seg[1]];
    let current = seg[1];
    const startKey = ptKey(seg[0]);
    let guard = 0;
    const limit = segments.length + 2;
    while (guard++ < limit) {
      if (ptKey(current) === startKey) break;
      const nexts = byStart.get(ptKey(current));
      if (!nexts) break;
      const next = nexts.find((s) => !used.has(s));
      if (!next) break;
      used.add(next);
      current = next[1];
      contour.push(current);
    }
    if (contour.length >= 4) contours.push(contour);
  }
  return contours;
}

/** Marching squares, similar to skimage.measure.find_contours. Returns [x, y] image coords. */
export function findContours(data, width, height, level = 0.5) {
  const pw = width + 2;
  const ph = height + 2;
  const padded = new Float64Array(pw * ph);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      padded[(y + 1) * pw + (x + 1)] = data[y * width + x];
    }
  }

  const segments = [];

  for (let cy = 0; cy < ph - 1; cy++) {
    for (let cx = 0; cx < pw - 1; cx++) {
      const tl = padded[cy * pw + cx];
      const tr = padded[cy * pw + cx + 1];
      const br = padded[(cy + 1) * pw + cx + 1];
      const bl = padded[(cy + 1) * pw + cx];

      let idx = 0;
      if (tl > level) idx |= 8;
      if (tr > level) idx |= 4;
      if (br > level) idx |= 2;
      if (bl > level) idx |= 1;
      if (idx === 0 || idx === 15) continue;

      const ptl = [cx, cy];
      const ptr = [cx + 1, cy];
      const pbr = [cx + 1, cy + 1];
      const pbl = [cx, cy + 1];
      const top = () => lerpPoint(ptl, ptr, tl, tr, level);
      const right = () => lerpPoint(ptr, pbr, tr, br, level);
      const bottom = () => lerpPoint(pbl, pbr, bl, br, level);
      const left = () => lerpPoint(ptl, pbl, tl, bl, level);

      switch (idx) {
        case 1:
          segments.push([left(), bottom()]);
          break;
        case 2:
          segments.push([bottom(), right()]);
          break;
        case 3:
          segments.push([left(), right()]);
          break;
        case 4:
          segments.push([right(), top()]);
          break;
        case 5:
          segments.push([left(), top()], [bottom(), right()]);
          break;
        case 6:
          segments.push([bottom(), top()]);
          break;
        case 7:
          segments.push([left(), top()]);
          break;
        case 8:
          segments.push([top(), left()]);
          break;
        case 9:
          segments.push([top(), bottom()]);
          break;
        case 10:
          segments.push([top(), right()], [left(), bottom()]);
          break;
        case 11:
          segments.push([top(), right()]);
          break;
        case 12:
          segments.push([right(), left()]);
          break;
        case 13:
          segments.push([right(), bottom()]);
          break;
        case 14:
          segments.push([bottom(), left()]);
          break;
      }
    }
  }

  return stitchSegments(segments).map((contour) =>
    contour.map(([x, y]) => [x - 1, y - 1])
  );
}

export function labelComponents(data, width, height) {
  const labels = new Int32Array(width * height);
  const regions = [];
  let next = 0;
  const dx = [1, -1, 0, 0, 1, 1, -1, -1];
  const dy = [0, 0, 1, -1, 1, -1, 1, -1];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!data[i] || labels[i]) continue;
      next += 1;
      const stack = [i];
      labels[i] = next;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let count = 0;

      while (stack.length) {
        const idx = stack.pop();
        count += 1;
        const cx = idx % width;
        const cy = (idx / width) | 0;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (let k = 0; k < 8; k++) {
          const nx = cx + dx[k];
          const ny = cy + dy[k];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (data[ni] && !labels[ni]) {
            labels[ni] = next;
            stack.push(ni);
          }
        }
      }

      regions.push({ id: next, minX, maxX, minY, maxY, count });
    }
  }

  return { labels, regions };
}

function nestRings(rings) {
  const cleaned = rings
    .map((r) => cleanRing(r))
    .filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > EPS);
  const n = cleaned.length;
  const areas = cleaned.map((r) => Math.abs(signedArea(r)));
  const parent = new Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const testPt = centroid(cleaned[i]) || cleaned[i][0];
    let best = -1;
    let bestArea = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j || areas[j] <= areas[i]) continue;
      if (pointInRing(testPt, cleaned[j]) && areas[j] < bestArea) {
        best = j;
        bestArea = areas[j];
      }
    }
    parent[i] = best;
  }

  const depth = (i) => {
    let d = 0;
    let k = i;
    const seen = new Set();
    while (parent[k] !== -1 && !seen.has(k)) {
      seen.add(k);
      k = parent[k];
      d += 1;
    }
    return d;
  };

  const polygons = [];
  for (let i = 0; i < n; i++) {
    if (depth(i) % 2 !== 0) continue;
    const holes = [];
    for (let j = 0; j < n; j++) {
      if (parent[j] === i && depth(j) % 2 === 1) holes.push(cleaned[j]);
    }
    polygons.push({ outer: cleaned[i], holes });
  }
  return polygons;
}

export function centroid(ring) {
  const pts = openRing(ring);
  if (!pts.length) return null;
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

function uniquePoints(rings) {
  const pts = [];
  for (const ring of rings) {
    for (const p of openRing(ring)) {
      if (!pts.some((q) => hypot2(p, q) < 1e-16)) pts.push([p[0], p[1]]);
    }
  }
  return pts;
}

function inCircumcircle(a, b, c, p) {
  const adx = a[0] - p[0];
  const ady = a[1] - p[1];
  const bdx = b[0] - p[0];
  const bdy = b[1] - p[1];
  const cdx = c[0] - p[0];
  const cdy = c[1] - p[1];
  const abdet = adx * bdy - bdx * ady;
  const bcdet = bdx * cdy - cdx * bdy;
  const cadet = cdx * ady - adx * cdy;
  const alift = adx * adx + ady * ady;
  const blift = bdx * bdx + bdy * bdy;
  const clift = cdx * cdx + cdy * cdy;
  const det = alift * bcdet + blift * cadet + clift * abdet;
  const orient = cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
  return orient > 0 ? det > 0 : det < 0;
}

function samePt(a, b) {
  return hypot2(a, b) < 1e-16;
}

/** Unconstrained Delaunay of a point set (shapely.ops.triangulate / GEOS). */
export function delaunay(points) {
  const pts = uniquePoints([points]);
  if (pts.length < 3) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const d = Math.max(dx, dy) * 20;
  const st = [
    [minX - d, minY - d],
    [minX + dx / 2, maxY + d],
    [maxX + d, minY - d],
  ];

  let triangles = [st.map((p) => [p[0], p[1]])];

  for (const p of pts) {
    const bad = [];
    const good = [];
    for (const t of triangles) {
      if (inCircumcircle(t[0], t[1], t[2], p)) bad.push(t);
      else good.push(t);
    }

    const edges = [];
    const pushEdge = (a, b) => {
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if ((samePt(e[0], b) && samePt(e[1], a)) || (samePt(e[0], a) && samePt(e[1], b))) {
          edges.splice(i, 1);
          return;
        }
      }
      edges.push([a, b]);
    };
    for (const t of bad) {
      pushEdge(t[0], t[1]);
      pushEdge(t[1], t[2]);
      pushEdge(t[2], t[0]);
    }
    for (const e of edges) good.push([e[0], e[1], p]);
    triangles = good;
  }

  const isSuper = (p) => st.some((s) => samePt(p, s));
  return triangles.filter((t) => !isSuper(t[0]) && !isSuper(t[1]) && !isSuper(t[2]) && Math.abs(signedArea(t)) > 1e-10);
}

function inSolid(point, outer, holes) {
  if (!pointInRing(point, outer)) return false;
  return !holes.some((h) => pointInRing(point, h));
}

function triangleCentroid(t) {
  return [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
}

function edgeKey(a, b) {
  const ka = `${a[0].toFixed(4)},${a[1].toFixed(4)}`;
  const kb = `${b[0].toFixed(4)},${b[1].toFixed(4)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function constraintEdges(ring) {
  const pts = openRing(ring);
  const edges = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!samePt(a, b)) edges.push([a, b]);
  }
  return edges;
}

function meshHasEdge(tris, a, b) {
  const key = edgeKey(a, b);
  for (const t of tris) {
    if (edgeKey(t[0], t[1]) === key || edgeKey(t[1], t[2]) === key || edgeKey(t[2], t[0]) === key) {
      return true;
    }
  }
  return false;
}

function isInteriorTriangle(t, outer, holes) {
  const c = triangleCentroid(t);
  if (!inSolid(c, outer, holes)) return false;
  for (let i = 0; i < 3; i++) {
    const a = t[i];
    const b = t[(i + 1) % 3];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const probe = [mid[0] * 0.85 + c[0] * 0.15, mid[1] * 0.85 + c[1] * 0.15];
    if (!inSolid(probe, outer, holes)) return false;
  }
  return true;
}

/**
 * Delaunay of polygon vertices with Steiner points so outline/hole edges
 * stay in the mesh, then drop any triangle that leaves the solid region.
 * That matches shapely triangulate+intersection without keeping gap-spanning triangles.
 */
export function toConvex(poly) {
  const outer = cleanRing(poly.outer);
  const holes = (poly.holes || []).map(cleanRing).filter((h) => h.length >= 3);
  if (outer.length < 3) return [];

  const rings = [outer, ...holes];
  let points = uniquePoints(rings);
  let constraints = rings.flatMap(constraintEdges);

  let tris = [];
  for (let iter = 0; iter < 48; iter++) {
    tris = delaunay(points);
    const nextConstraints = [];
    let added = 0;
    for (const [a, b] of constraints) {
      if (meshHasEdge(tris, a, b)) {
        nextConstraints.push([a, b]);
        continue;
      }
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (!points.some((p) => hypot2(p, mid) < 1e-8)) {
        points.push(mid);
        added += 1;
      }
      nextConstraints.push([a, mid], [mid, b]);
    }
    constraints = nextConstraints;
    if (!added) break;
  }

  return tris.filter((t) => isInteriorTriangle(t, outer, holes)).map((t) => [t[0], t[1], t[2]]);
}

export function isConvex(ring) {
  const coords = closeRing(ring);
  if (coords.length < 4) return false;
  let sign = 0;
  for (let i = 0; i < coords.length - 2; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const c = coords[i + 2];
    const cr = cross(b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]);
    if (Math.hypot(cr) === 0) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function internalAngles(ring) {
  const pts = openRing(ring);
  const n = pts.length;
  if (n < 3) return [];
  const angles = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const v1x = p0[0] - p1[0];
    const v1y = p0[1] - p1[1];
    const v2x = p2[0] - p1[0];
    const v2y = p2[1] - p1[1];
    const n1 = Math.hypot(v1x, v1y);
    const n2 = Math.hypot(v2x, v2y);
    if (n1 === 0 || n2 === 0) continue;
    let dot = (v1x / n1) * (v2x / n2) + (v1y / n1) * (v2y / n2);
    dot = Math.min(1, Math.max(-1, dot));
    angles.push((Math.acos(dot) * 180) / Math.PI);
  }
  return angles;
}

function bboxOf(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

function bboxesOverlap(a, b, pad = 0.5) {
  return !(
    a.maxX + pad < b.minX ||
    b.maxX + pad < a.minX ||
    a.maxY + pad < b.minY ||
    b.maxY + pad < a.minY
  );
}

function convexHull(points) {
  const pts = [];
  const seen = new Set();
  for (const p of points) {
    const k = `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
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
      while (h.length >= 2 && cr(h[h.length - 2], h[h.length - 1], p) <= 1e-9) h.pop();
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

function stripNearCollinear(ring, maxDev = 0.4) {
  let pts = openRing(ring);
  let guard = 0;
  while (pts.length > 3 && guard++ < 256) {
    let cut = -1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (perpDist(b, a, c) <= maxDev) {
        cut = i;
        break;
      }
    }
    if (cut < 0) break;
    pts.splice(cut, 1);
  }
  return pts;
}

function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildAdjacency(polys) {
  const adj = Array.from({ length: polys.length }, () => new Set());
  const edges = new Map();
  for (let i = 0; i < polys.length; i++) {
    const r = polys[i];
    for (let e = 0; e < r.length; e++) {
      const key = edgeKey(r[e], r[(e + 1) % r.length]);
      const other = edges.get(key);
      if (other == null) {
        edges.set(key, i);
        continue;
      }
      if (other !== i) {
        adj[i].add(other);
        adj[other].add(i);
      }
    }
  }
  return adj;
}

function pickCandidate(candidates, trial, step) {
  if (trial === 0) {
    let best = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i];
      if (c.area > best.area || (c.area === best.area && c.maxAngle < best.maxAngle)) best = c;
    }
    return best;
  }
  const rand = mulberry32(trial * 10007 + step * 9176 + 13);
  return candidates[Math.floor(rand() * candidates.length)];
}

function mergeRun(origin, adj0, angleThreshold, trial, isCancelled) {
  const pieces = origin.map((p) => p.slice());
  const alive = new Uint8Array(pieces.length).fill(1);
  const adj = adj0.map((s) => new Set(s));
  let remaining = pieces.length;
  let step = 0;

  while (remaining > 1) {
    if (isCancelled?.()) break;
    const candidates = [];
    for (let i = 0; i < pieces.length; i++) {
      if (!alive[i]) continue;
      for (const j of adj[i]) {
        if (j <= i || !alive[j]) continue;
        const union = tryMerge(pieces[i], pieces[j], angleThreshold);
        if (!union) continue;
        const angles = internalAngles(union);
        candidates.push({
          i,
          j,
          union,
          area: Math.abs(signedArea(union)),
          maxAngle: angles.length ? Math.max(...angles) : 0,
        });
      }
    }
    if (!candidates.length) break;
    const pick = pickCandidate(candidates, trial, step++);
    pieces[pick.i] = pick.union;
    alive[pick.j] = 0;
    remaining -= 1;
    for (const n of adj[pick.j]) {
      adj[n].delete(pick.j);
      if (n !== pick.i && alive[n]) {
        adj[pick.i].add(n);
        adj[n].add(pick.i);
      }
    }
    adj[pick.j].clear();
    adj[pick.i].delete(pick.j);
  }

  return pieces.filter((_, i) => alive[i]);
}

export function tryMerge(p1, p2, angleThreshold = 160) {
  const A = openRing(p1);
  const B = openRing(p2);
  if (A.length < 3 || B.length < 3) return null;
  if (!bboxesOverlap(bboxOf(A), bboxOf(B), 0.35)) return null;

  const hull = stripNearCollinear(convexHull([...A, ...B]));
  if (hull.length < 3) return null;

  const areaA = Math.abs(signedArea(A));
  const areaB = Math.abs(signedArea(B));
  const areaH = Math.abs(signedArea(hull));
  const gap = Math.abs(areaH - areaA - areaB);
  if (gap > 0.35 && gap > 1e-3 * Math.max(1, areaH)) return null;

  const angles = internalAngles(hull);
  if (angles.some((a) => a > angleThreshold + 1e-6)) return null;
  return hull;
}

export function optimizeShapes(polygons, iterations, angleThreshold, isCancelled) {
  const origin = polygons.map((p) => openRing(p)).filter((p) => p.length >= 3);
  if (origin.length < 2) return origin;

  const adj = buildAdjacency(origin);
  const trials = Math.max(1, iterations | 0);
  const tLimit = performance.now() + (trials > 1 ? 4000 : 1e12);
  let best = mergeRun(origin, adj, angleThreshold, 0, isCancelled);

  for (let trial = 1; trial < trials; trial++) {
    if (isCancelled?.()) break;
    if (best.length <= 1) break;
    if (performance.now() > tLimit) break;
    const cand = mergeRun(origin, adj, angleThreshold, trial, isCancelled);
    if (cand.length < best.length) best = cand;
  }
  return best;
}

export function weldVertices(polygons, eps = 0.05) {
  const rings = polygons.map((p) => openRing(p)).filter((p) => p.length >= 3);
  const canon = [];
  const snapTo = (p) => {
    for (const q of canon) {
      if (hypot2(p, q) <= eps * eps) return [q[0], q[1]];
    }
    const c = [p[0], p[1]];
    canon.push(c);
    return [c[0], c[1]];
  };
  return rings
    .map((ring) => {
      const out = [];
      for (const p of ring) {
        const q = snapTo(p);
        if (!out.length || hypot2(out[out.length - 1], q) > eps * eps) out.push(q);
      }
      if (out.length > 1 && hypot2(out[0], out[out.length - 1]) <= eps * eps) out.pop();
      return out;
    })
    .filter((r) => r.length >= 3);
}

function projectOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-16) return null;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  const proj = [a[0] + t * dx, a[1] + t * dy];
  const d = Math.hypot(p[0] - proj[0], p[1] - proj[1]);
  return { t, proj, d, len: Math.sqrt(len2) };
}

function uniqueVerts(rings) {
  const verts = [];
  const seen = new Set();
  for (const ring of rings) {
    for (const p of ring) {
      const k = `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      verts.push([p[0], p[1]]);
    }
  }
  return verts;
}

function dedupRing(ring, eps) {
  const out = [];
  for (const p of ring) {
    if (!out.length || hypot2(out[out.length - 1], p) > eps * eps) out.push([p[0], p[1]]);
  }
  if (out.length > 1 && hypot2(out[0], out[out.length - 1]) <= eps * eps) out.pop();
  return out;
}

export function stitchTJunctions(polygons, edgeEps = 4) {
  const weldEps = Math.min(0.35, edgeEps);
  let rings = weldVertices(polygons, weldEps);
  if (rings.length < 2) return rings;

  for (let pass = 0; pass < 8; pass++) {
    let changed = false;

    const verts = uniqueVerts(rings);
    for (const v of verts) {
      let best = null;
      for (const ring of rings) {
        if (ring.some((p) => hypot2(p, v) <= weldEps * weldEps)) continue;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          const hit = projectOnSegment(v, a, b);
          if (!hit || hit.d > edgeEps || hit.t <= 0 || hit.t >= 1) continue;
          if (Math.hypot(v[0] - a[0], v[1] - a[1]) <= weldEps) continue;
          if (Math.hypot(v[0] - b[0], v[1] - b[1]) <= weldEps) continue;
          if (!best || hit.d < best.d) best = hit;
        }
      }
      if (!best || best.d <= 1e-12) continue;
      for (const ring of rings) {
        for (let k = 0; k < ring.length; k++) {
          if (hypot2(ring[k], v) <= 1e-12) {
            ring[k] = [best.proj[0], best.proj[1]];
            changed = true;
          }
        }
      }
    }

    rings = weldVertices(rings, weldEps);
    const verts2 = uniqueVerts(rings);
    const next = [];

    for (const ring of rings) {
      const out = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        out.push([a[0], a[1]]);
        const hits = [];
        for (const v of verts2) {
          const hit = projectOnSegment(v, a, b);
          if (!hit || hit.d > edgeEps || hit.t <= 0 || hit.t >= 1) continue;
          if (Math.hypot(v[0] - a[0], v[1] - a[1]) <= weldEps) continue;
          if (Math.hypot(v[0] - b[0], v[1] - b[1]) <= weldEps) continue;
          hits.push(hit);
        }
        hits.sort((x, y) => x.t - y.t);
        for (const h of hits) {
          const prev = out[out.length - 1];
          if (hypot2(prev, h.proj) <= weldEps * weldEps) continue;
          if (hypot2(h.proj, b) <= weldEps * weldEps) continue;
          out.push([h.proj[0], h.proj[1]]);
          changed = true;
        }
      }
      next.push(dedupRing(out, weldEps));
    }

    rings = weldVertices(next, weldEps);
    if (!changed) break;
  }

  return rings.filter((r) => r.length >= 3);
}

function regionMask(binary, labels, region, width) {
  const { minX, maxX, minY, maxY, id } = region;
  const rw = maxX - minX + 1;
  const rh = maxY - minY + 1;
  const mask = new Uint8Array(rw * rh);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (labels[y * width + x] === id) mask[(y - minY) * rw + (x - minX)] = 1;
    }
  }
  return { mask, rw, rh, minX, minY };
}

export function generateShapes(binary, width, height, options, hooks = {}) {
  const {
    tolerance = 10,
    optimize = true,
    iterations = 1000,
    angleThreshold = 160,
  } = options;
  const { onProgress, isCancelled } = hooks;
  const t0 = performance.now();
  const { labels, regions } = labelComponents(binary, width, height);
  const shapes = [];
  let processed = 0;

  for (const region of regions) {
    if (isCancelled?.()) break;
    if (region.count < 3) continue;

    const local = regionMask(binary, labels, region, width);
    const contours = findContours(local.mask, local.rw, local.rh, 0.5);
    const simplified = [];
    for (const contour of contours) {
      const shifted = contour.map(([x, y]) => [x + local.minX, y + local.minY]);
      const simple = simplify(shifted, tolerance);
      const cleaned = cleanRing(simple);
      if (cleaned.length >= 3 && Math.abs(signedArea(cleaned)) > 1e-6) {
        simplified.push(cleaned);
      }
    }

    const polygons = nestRings(simplified);
    for (const poly of polygons) {
      if (isCancelled?.()) break;
      let pieces = toConvex(poly);
      if (optimize) {
        pieces = optimizeShapes(pieces, iterations, angleThreshold, isCancelled);
      }
      if (pieces.length) pieces = stitchTJunctions(pieces, 4);
      for (const piece of pieces) {
        if (piece.length >= 3) shapes.push(openRing(piece));
      }
    }

    processed += 1;
    onProgress?.(shapes, {
      count: shapes.length,
      regions: processed,
      totalRegions: regions.length,
      elapsed: (performance.now() - t0) / 1000,
    });
  }

  return shapes;
}

export function maskFromImageData(imageData, threshold = 128) {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    mask[p] = lum > threshold ? 1 : 0;
  }
  return { mask, width, height };
}
