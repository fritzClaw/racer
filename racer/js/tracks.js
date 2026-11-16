/* Rennstrecken: Definition und Geometrie.
 * Jede Strecke ist eine geschlossene Kurve durch Kontrollpunkte (Catmull-Rom-Spline),
 * die in gleichmäßige Abstände (SAMPLE_SPACING) unterteilt wird. */
'use strict';

const TRACK_WIDTH = 150;
const SAMPLE_SPACING = 12;

const TRACK_DEFS = [
  {
    id: 'sonnenring',
    name: 'Sonnenring',
    level: 'Leicht',
    description: 'Ein schnelles Oval mit langen Geraden. Ideal zum Kennenlernen.',
    scale: 150,
    grass: '#4f8f3a',
    seed: 11,
    points: [
      [0, 0], [10, 0], [16, 1], [19, 5], [18, 10], [13, 12.5],
      [6, 12], [0, 13], [-6, 12.5], [-10, 9], [-10, 4], [-6, 0.5],
    ],
  },
  {
    id: 'waldkurs',
    name: 'Waldkurs',
    level: 'Mittel',
    description: 'Kurvige Strecke durch den Wald mit einer schnellen S-Kurve.',
    scale: 140,
    grass: '#3f7d35',
    seed: 23,
    points: [
      [0, 0], [12, 0], [18, 2], [20, 7], [17, 11], [12, 11], [9, 14],
      [11, 18], [16, 19], [18, 23], [14, 27], [6, 27], [0, 25], [-3, 20],
      [-1, 15], [-5, 11], [-8, 6], [-6, 1],
    ],
  },
  {
    id: 'bergpass',
    name: 'Bergpass',
    level: 'Schwer',
    description: 'Enge Haarnadelkurven. Hier gewinnt, wer rechtzeitig bremst.',
    scale: 130,
    grass: '#6d8f45',
    seed: 37,
    points: [
      [0, 0], [14, 0], [19, 2], [20, 6], [17, 8], [8, 8], [5, 10],
      [6, 13], [17, 13], [21, 15], [22, 20], [18, 23], [10, 22], [5, 25],
      [0, 28], [-5, 27], [-7, 22], [-4, 17], [-8, 13], [-9, 6], [-6, 1],
    ],
  },
];

/* Zentripetaler Catmull-Rom-Spline (vermeidet Schleifen und Überschwinger). */
function catmullRomClosed(points, subdivisions) {
  const n = points.length;
  const out = [];
  const tj = (ti, a, b) => ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5);
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const t0 = 0;
    const t1 = tj(t0, p0, p1);
    const t2 = tj(t1, p1, p2);
    const t3 = tj(t2, p2, p3);
    for (let s = 0; s < subdivisions; s++) {
      const t = t1 + (t2 - t1) * (s / subdivisions);
      const pt = [0, 0];
      for (let k = 0; k < 2; k++) {
        const a1 = (t1 - t) / (t1 - t0) * p0[k] + (t - t0) / (t1 - t0) * p1[k];
        const a2 = (t2 - t) / (t2 - t1) * p1[k] + (t - t1) / (t2 - t1) * p2[k];
        const a3 = (t3 - t) / (t3 - t2) * p2[k] + (t - t2) / (t3 - t2) * p3[k];
        const b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2;
        const b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3;
        pt[k] = (t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2;
      }
      out.push(pt);
    }
  }
  return out;
}

/* Kleiner deterministischer Zufallsgenerator, damit Deko immer gleich aussieht. */
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTrack(def) {
  const ctrl = def.points.map(p => [p[0] * def.scale, p[1] * def.scale]);
  const dense = catmullRomClosed(ctrl, 60);

  // Gleichmäßig nach Bogenlänge abtasten
  const xs = [];
  const ys = [];
  let carry = 0;
  xs.push(dense[0][0]);
  ys.push(dense[0][1]);
  for (let i = 0; i < dense.length; i++) {
    const a = dense[i];
    const b = dense[(i + 1) % dense.length];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let pos = SAMPLE_SPACING - carry;
    while (pos <= segLen) {
      const f = pos / segLen;
      xs.push(a[0] + (b[0] - a[0]) * f);
      ys.push(a[1] + (b[1] - a[1]) * f);
      pos += SAMPLE_SPACING;
    }
    carry = segLen - (pos - SAMPLE_SPACING);
  }
  // Letzten Punkt entfernen, wenn er fast auf dem ersten liegt
  const last = xs.length - 1;
  if (Math.hypot(xs[last] - xs[0], ys[last] - ys[0]) < SAMPLE_SPACING * 0.5) {
    xs.pop();
    ys.pop();
  }

  const n = xs.length;
  const x = new Float32Array(xs);
  const y = new Float32Array(ys);
  const tx = new Float32Array(n);
  const ty = new Float32Array(n);
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  const heading = new Float32Array(n);
  const curvature = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const dx = x[b] - x[a];
    const dy = y[b] - y[a];
    const len = Math.hypot(dx, dy) || 1;
    tx[i] = dx / len;
    ty[i] = dy / len;
    nx[i] = -ty[i];
    ny[i] = tx[i];
    heading[i] = Math.atan2(ty[i], tx[i]);
  }
  // Krümmung über ein Fenster geglättet (1/Radius)
  const win = 4;
  for (let i = 0; i < n; i++) {
    const h1 = heading[(i - win + n) % n];
    const h2 = heading[(i + win) % n];
    let d = h2 - h1;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    curvature[i] = Math.abs(d) / (2 * win * SAMPLE_SPACING);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]);
    minY = Math.min(minY, y[i]); maxY = Math.max(maxY, y[i]);
  }
  const margin = 700;
  const bounds = { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };

  const track = {
    def, n, x, y, tx, ty, nx, ny, heading, curvature,
    width: TRACK_WIDTH,
    spacing: SAMPLE_SPACING,
    length: n * SAMPLE_SPACING,
    bounds,
    path: null,
    trees: [],
  };

  if (typeof Path2D !== 'undefined') {
    const p = new Path2D();
    p.moveTo(x[0], y[0]);
    for (let i = 1; i < n; i++) p.lineTo(x[i], y[i]);
    p.closePath();
    track.path = p;
  }

  // Bäume und Büsche neben der Strecke verteilen
  const rnd = seededRandom(def.seed);
  const tries = Math.round((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY) / 90000);
  for (let k = 0; k < tries; k++) {
    const px = bounds.minX + rnd() * (bounds.maxX - bounds.minX);
    const py = bounds.minY + rnd() * (bounds.maxY - bounds.minY);
    const r = 22 + rnd() * 26;
    const d = distanceToTrack(track, px, py);
    if (d > TRACK_WIDTH / 2 + 110 + r) {
      track.trees.push({ x: px, y: py, r, shade: rnd() });
    }
  }
  return track;
}

/* Abstand eines Punktes zur Mittellinie (globale Suche, nur für Aufbauzwecke). */
function distanceToTrack(track, px, py) {
  let best = Infinity;
  for (let i = 0; i < track.n; i += 2) {
    const d = (track.x[i] - px) ** 2 + (track.y[i] - py) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/* Nächsten Punkt der Mittellinie in der Nähe eines bekannten Index suchen. */
function nearestOnTrack(track, px, py, hint) {
  const n = track.n;
  let bestIdx = hint;
  let best = Infinity;
  for (let k = -30; k <= 60; k++) {
    const i = (hint + k + n) % n;
    const dx = track.x[i] - px;
    const dy = track.y[i] - py;
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      bestIdx = i;
    }
  }
  const dx = px - track.x[bestIdx];
  const dy = py - track.y[bestIdx];
  return {
    idx: bestIdx,
    dist: Math.sqrt(best),
    lateral: dx * track.nx[bestIdx] + dy * track.ny[bestIdx],
  };
}

if (typeof module !== 'undefined') {
  module.exports = { TRACK_DEFS, TRACK_WIDTH, SAMPLE_SPACING, buildTrack, nearestOnTrack, catmullRomClosed };
}
