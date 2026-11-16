'use strict';
/*
 * Die Welt: Gemeinde Nörvenich aus den OpenStreetMap-Daten (js/mapdata.js).
 *
 * Koordinaten: Meter. Die Karte rechnet in der Ebene (x nach Osten, y nach Süden),
 * in 3D wird daraus x -> X, y -> Z, Y zeigt nach oben. Norden ist also -Z.
 *
 * Hier passiert:
 *  - Dekodieren der Kartendaten
 *  - Aufbau der 3D-Szene (Boden, Felder, Wege, Gebäude, Bäume, Schilder, Hindernisse)
 *  - Kollision (Gebäude, Bäume, Hindernisse, Gemeindegrenze)
 *  - Verteilung von Hufeisen, Futter und Entdeckungs-Orten
 */
const World = (() => {
  const M = window.MAP_DATA;
  const CHUNK = 500;            // Kantenlänge eines Kartenstücks für die Sichtweite
  const VIEW = 900;             // so weit werden Gebäude gezeichnet (dahinter ist Nebel)
  const VIEW_TREES = 520;       // Bäume nur in der Nähe

  // ------------------------------------------------------------ Hilfsfunktionen
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Dekodiert eine Punktliste (halbe Meter, Differenzen) in [x0, y0, x1, y1, ...]. */
  function dec(arr, start) {
    const out = [];
    let x = 0, y = 0;
    for (let i = start; i + 1 < arr.length; i += 2) {
      if (i === start) { x = arr[i]; y = arr[i + 1]; } else { x += arr[i]; y += arr[i + 1]; }
      out.push(x / 2, y / 2);
    }
    return out;
  }

  function polyArea(p) {
    let s = 0;
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      s += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
    }
    return s / 2;
  }

  function pointInPoly(p, x, y) {
    let inside = false;
    const n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function bbox(p) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < a) a = p[i];
      if (p[i] > c) c = p[i];
      if (p[i + 1] < b) b = p[i + 1];
      if (p[i + 1] > d) d = p[i + 1];
    }
    return [a, b, c, d];
  }

  function centroid(p) {
    let x = 0, y = 0;
    const n = p.length / 2;
    for (let i = 0; i < p.length; i += 2) { x += p[i]; y += p[i + 1]; }
    return [x / n, y / n];
  }

  /** Raster für schnelle Umgebungssuche. */
  class Grid {
    constructor(cell) { this.cell = cell; this.cells = new Map(); this.stamp = 0; }
    key(ix, iy) { return (ix + 10000) * 20000 + (iy + 10000); }
    add(item, x0, y0, x1, y1) {
      const c = this.cell;
      for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++) {
        for (let iy = Math.floor(y0 / c); iy <= Math.floor(y1 / c); iy++) {
          const k = this.key(ix, iy);
          let l = this.cells.get(k);
          if (!l) { l = []; this.cells.set(k, l); }
          l.push(item);
        }
      }
    }
    query(x0, y0, x1, y1, cb) {
      const c = this.cell;
      const s = ++this.stamp;
      for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++) {
        for (let iy = Math.floor(y0 / c); iy <= Math.floor(y1 / c); iy++) {
          const l = this.cells.get(this.key(ix, iy));
          if (!l) continue;
          for (const it of l) {
            if (it._q === s) continue;
            it._q = s;
            if (cb(it) === false) return;
          }
        }
      }
    }
  }

  /** Sammelt Dreiecke mit Farben (und optional UVs) für ein gemeinsames Mesh. */
  class Builder {
    constructor(withUv) { this.pos = []; this.nrm = []; this.col = []; this.uv = withUv ? [] : null; }
    tri(a, b, c, color, ua, ub, uc) {
      // a, b, c: [x, y, z]; Normale aus der Reihenfolge
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      this.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
      this.col.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
      if (this.uv) {
        ua = ua || [0.5, 0.5]; ub = ub || [0.5, 0.5]; uc = uc || [0.5, 0.5];
        this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
      }
    }
    /** Dreieck, dessen Vorderseite zur Richtung n zeigt (Reihenfolge wird angepasst). */
    triFacing(a, b, c, n, color, ua, ub, uc) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * n[0] + ny * n[1] + nz * n[2] < 0) this.tri(a, c, b, color, ua, uc, ub);
      else this.tri(a, b, c, color, ua, ub, uc);
    }
    quad(a, b, c, d, n, color, uvs) {
      if (uvs) {
        this.triFacing(a, b, c, n, color, uvs[0], uvs[1], uvs[2]);
        this.triFacing(a, c, d, n, color, uvs[0], uvs[2], uvs[3]);
      } else {
        this.triFacing(a, b, c, n, color);
        this.triFacing(a, c, d, n, color);
      }
    }
    /** Fügt eine Three.js-Geometrie mit Matrix und Farbe hinzu. */
    addGeometry(geo, matrix, color) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      const p = g.attributes.position, n = g.attributes.normal;
      const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(matrix), w = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(matrix);
        w.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
        this.pos.push(v.x, v.y, v.z);
        this.nrm.push(w.x, w.y, w.z);
        this.col.push(color.r, color.g, color.b);
        if (this.uv) this.uv.push(0.5, 0.5);
      }
    }
    get empty() { return this.pos.length === 0; }
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.computeBoundingSphere();
      return g;
    }
  }

  const C = hex => new THREE.Color(hex);
  function pick(r, list) { return list[Math.floor(r() * list.length)]; }
  function vary(r, color, amount) {
    const c = color.clone();
    const f = 1 + (r() - 0.5) * amount;
    c.r = Math.min(1, c.r * f); c.g = Math.min(1, c.g * f); c.b = Math.min(1, c.b * f);
    return c;
  }

  // ------------------------------------------------------------ Kartendaten dekodieren
  const boundary = dec(M.boundary, 0);
  const boundaryBox = bbox(boundary);

  const buildings = M.buildings.map((b, i) => {
    const pts = dec(b, 2);
    const box = bbox(pts);
    return { id: i, h: b[0] / 10, kind: b[1], pts, box, area: polyArea(pts), c: centroid(pts) };
  });
  const roads = M.roads.map(r => ({ cls: r[0], pts: dec(r, 1) }));
  const areas = M.areas.map(a => ({ cls: a[0], pts: dec(a, 1) }));
  const water = M.water.map(w => ({ cls: w[0], pts: dec(w, 1) }));
  const rail = M.rail.map(r => dec(r, 0));
  const hedges = M.hedges.map(h => dec(h, 0));
  const places = M.places.map(p => ({ name: p.n, x: p.x, y: p.y, village: p.t === 'v' }));
  const landmarks = M.landmarks.map(l => ({ name: l.n, kind: l.k, x: l.x, y: l.y }));

  const ROAD_WIDTH = [7.5, 6.5, 6, 5, 3.6, 3.2, 1.6, 45, 18];
  const ROAD_COLOR = ['#5d5f63', '#64666a', '#696b6e', '#6f7174', '#7a7b7c', '#a88c63', '#b59d77', '#4d4f52', '#5e6063'];

  // ------------------------------------------------------------ Raster für Kollision und Suche
  const buildingGrid = new Grid(40);
  for (const b of buildings) buildingGrid.add(b, b.box[0], b.box[1], b.box[2], b.box[3]);

  const solidGrid = new Grid(24);     // Bäume (Kreise) und Hindernisse (Quader)
  const roadGrid = new Grid(60);      // Wegabschnitte
  for (const r of roads) {
    const p = r.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const seg = { cls: r.cls, x0: p[i], y0: p[i + 1], x1: p[i + 2], y1: p[i + 3], w: ROAD_WIDTH[r.cls] };
      roadGrid.add(seg, Math.min(seg.x0, seg.x1) - seg.w, Math.min(seg.y0, seg.y1) - seg.w,
        Math.max(seg.x0, seg.x1) + seg.w, Math.max(seg.y0, seg.y1) + seg.w);
    }
  }
  const waterGrid = new Grid(60);
  for (const a of areas) {
    if (a.cls !== 10) continue;
    const box = bbox(a.pts);
    waterGrid.add({ poly: a.pts }, box[0], box[1], box[2], box[3]);
  }
  for (const w of water) {
    if (w.cls !== 0) continue;
    const p = w.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const seg = { x0: p[i], y0: p[i + 1], x1: p[i + 2], y1: p[i + 3], w: 2.2 };
      waterGrid.add(seg, Math.min(seg.x0, seg.x1) - 3, Math.min(seg.y0, seg.y1) - 3,
        Math.max(seg.x0, seg.x1) + 3, Math.max(seg.y0, seg.y1) + 3);
    }
  }

  function segDist(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const ll = dx * dx + dy * dy;
    let t = ll ? ((px - x0) * dx + (py - y0) * dy) / ll : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = x0 + t * dx, cy = y0 + t * dy;
    return [Math.hypot(px - cx, py - cy), cx, cy];
  }

  function nearBuilding(x, y, r) {
    let hit = false;
    buildingGrid.query(x - r, y - r, x + r, y + r, b => {
      if (x < b.box[0] - r || x > b.box[2] + r || y < b.box[1] - r || y > b.box[3] + r) return;
      if (pointInPoly(b.pts, x, y)) { hit = true; return false; }
      const p = b.pts, n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (segDist(x, y, p[2 * i], p[2 * i + 1], p[2 * j], p[2 * j + 1])[0] < r) { hit = true; return false; }
      }
    });
    return hit;
  }

  function nearRoad(x, y, r, maxCls) {
    let hit = false;
    roadGrid.query(x - r - 10, y - r - 10, x + r + 10, y + r + 10, s => {
      if (s.cls > maxCls) return;
      if (segDist(x, y, s.x0, s.y0, s.x1, s.y1)[0] < r + s.w / 2) { hit = true; return false; }
    });
    return hit;
  }

  function onRoad(x, y) {
    let best = null;
    roadGrid.query(x - 5, y - 5, x + 5, y + 5, s => {
      if (s.cls >= 7) return;
      const d = segDist(x, y, s.x0, s.y0, s.x1, s.y1)[0];
      if (d < s.w / 2 + 0.5 && (!best || s.cls < best.cls)) best = s;
    });
    return best;
  }

  function insideBoundary(x, y) {
    if (x < boundaryBox[0] || x > boundaryBox[2] || y < boundaryBox[1] || y > boundaryBox[3]) return false;
    return pointInPoly(boundary, x, y);
  }

  // ------------------------------------------------------------ Ortsteile: Ausdehnung
  for (const p of places) p.radius = p.village ? 250 : 120;
  {
    const dists = places.map(() => []);
    for (const b of buildings) {
      let bi = -1, bd = 1300;
      places.forEach((p, i) => {
        const d = Math.hypot(b.c[0] - p.x, b.c[1] - p.y);
        if (d < bd) { bd = d; bi = i; }
      });
      if (bi >= 0) dists[bi].push(bd);
    }
    places.forEach((p, i) => {
      const d = dists[i].sort((a, b) => a - b);
      if (d.length < 8) return;
      const q = d[Math.floor(d.length * (p.village ? 0.9 : 0.95))];
      p.radius = Math.max(p.village ? 160 : 90, Math.min(900, q + 25));
    });
    // Fliegerhorst ist kein Ort für die Schilder
  }

  /** Name der Gegend für die Anzeige „Du bist in …“. */
  function regionName(x, y) {
    let best = null, bd = Infinity;
    for (const p of places) {
      const d = Math.hypot(x - p.x, y - p.y) / p.radius;
      if (d < bd) { bd = d; best = p; }
    }
    if (best && bd <= 1) return best.name;
    if (best && bd <= 3) return 'Felder bei ' + best.name;
    return 'Gemeinde Nörvenich';
  }

  // ------------------------------------------------------------ Szene
  const chunks = new Map();
  function chunkAt(x, y) {
    const ix = Math.floor(x / CHUNK), iy = Math.floor(y / CHUNK);
    const k = ix * 1000 + iy;
    let c = chunks.get(k);
    if (!c) {
      c = {
        ix, iy, cx: (ix + 0.5) * CHUNK, cy: (iy + 0.5) * CHUNK,
        group: new THREE.Group(), treeGroup: new THREE.Group(),
        walls: new Builder(true), plain: new Builder(false), props: new Builder(false),
        trees: [],
      };
      chunks.set(k, c);
    }
    return c;
  }

  const textures = {};
  function canvasTexture(w, h, draw, repeat) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function makeTextures() {
    textures.window = canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#d9d9d9';
      g.fillRect(19, 13, 26, 34);
      g.fillStyle = '#3d4a58';
      g.fillRect(21, 15, 22, 30);
      g.fillStyle = '#6d8296';
      g.fillRect(21, 15, 22, 10);
      g.fillStyle = '#d9d9d9';
      g.fillRect(31, 15, 2, 30);
    }, true);
  }

  // ---- Boden mit prozeduralen Feldern (Lambert-Material mit eigenem Farbcode)
  function makeGround(scene) {
    const size = 40000;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, depthWrite: false });
    mat.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
        varying vec2 vW;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
        }
        vec3 crop(float k) {
          if (k < 0.22) return vec3(0.80, 0.70, 0.38);
          if (k < 0.42) return vec3(0.47, 0.64, 0.27);
          if (k < 0.56) return vec3(0.58, 0.47, 0.32);
          if (k < 0.70) return vec3(0.60, 0.72, 0.33);
          if (k < 0.80) return vec3(0.33, 0.50, 0.22);
          if (k < 0.88) return vec3(0.86, 0.80, 0.30);
          if (k < 0.95) return vec3(0.72, 0.62, 0.40);
          return vec3(0.42, 0.60, 0.30);
        }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 region = floor(vW / 900.0);
          float ang = (h21(region) - 0.5) * 1.2;
          mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
          vec2 q = R * vW;
          vec2 cellSize = vec2(110.0 + 60.0 * h21(region + 3.1), 320.0);
          q.y += floor(q.x / cellSize.x) * 97.0;
          vec2 cell = floor(q / cellSize);
          vec2 f = fract(q / cellSize);
          vec3 col = crop(h21(cell + region * 13.0));
          float fade = clamp(1.0 - length(vViewPosition) / 70.0, 0.0, 1.0);
          float rows = 0.5 + 0.5 * sin(q.x * 5.6);
          col *= 1.0 - 0.12 * rows * fade;
          vec2 edge = min(f, 1.0 - f) * cellSize;
          float e = min(edge.x, edge.y);
          col = mix(vec3(0.42, 0.58, 0.28), col, smoothstep(0.8, 2.2, e));
          float n = vnoise(vW * 0.05) * 0.6 + vnoise(vW * 0.35) * 0.4;
          col *= 0.86 + 0.24 * n;
          diffuseColor.rgb = pow(col, vec3(2.2));
        }`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -10;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  // ---- Flächen (Wiesen, Wald, Siedlung …)
  const AREA_COLORS = {
    0: null,                     // Ackerland: kommt vom Boden-Shader
    1: ['#7fae4f', '#86b356', '#78a64a'],
    2: ['#4b7136'],
    3: ['#8faa66', '#94ad6a'],
    4: ['#a9a28c'],
    5: ['#78a05a'],
    6: ['#a7a39a'],
    7: ['#85ae55'],
    8: ['#78b356'],
    9: ['#5ea648'],
    10: ['#4583b8'],
    11: ['#b8a585'],
    12: ['#8fae5c'],
    13: ['#9b9b97'],
  };

  function triangulate(pts) {
    const contour = [];
    for (let i = 0; i < pts.length; i += 2) contour.push(new THREE.Vector2(pts[i], pts[i + 1]));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = []; }
    return tris;
  }

  function makeAreas(scene) {
    const r = rng(7);
    const b = new Builder(false);
    const up = [0, 1, 0];
    for (const a of areas) {
      const cols = AREA_COLORS[a.cls];
      if (!cols) continue;
      const col = vary(r, C(pick(r, cols)), 0.08);
      const p = a.pts;
      for (const t of triangulate(p)) {
        b.triFacing([p[2 * t[0]], 0, p[2 * t[0] + 1]], [p[2 * t[1]], 0, p[2 * t[1] + 1]],
          [p[2 * t[2]], 0, p[2 * t[2] + 1]], up, col);
      }
    }
    const mesh = new THREE.Mesh(b.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false }));
    mesh.renderOrder = -9;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  // ---- Bänder für Wege, Bäche, Bahn
  function ribbon(b, p, width, color, y, noCaps) {
    const n = p.length / 2;
    if (n < 2) return;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const x = p[2 * i], z = p[2 * i + 1];
      let dx = 0, dz = 0;
      if (i > 0) { const l = Math.hypot(x - p[2 * i - 2], z - p[2 * i - 1]) || 1; dx += (x - p[2 * i - 2]) / l; dz += (z - p[2 * i - 1]) / l; }
      if (i < n - 1) { const l = Math.hypot(p[2 * i + 2] - x, p[2 * i + 3] - z) || 1; dx += (p[2 * i + 2] - x) / l; dz += (p[2 * i + 3] - z) / l; }
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      // Gehrung begrenzen
      let m = 1;
      if (i > 0 && i < n - 1) {
        const l1 = Math.hypot(x - p[2 * i - 2], z - p[2 * i - 1]) || 1;
        const ax = (x - p[2 * i - 2]) / l1, az = (z - p[2 * i - 1]) / l1;
        const cos = Math.max(0.35, ax * dx + az * dz);
        m = 1 / cos;
      }
      const hw = width / 2 * m;
      L.push([x - dz * hw, y, z + dx * hw]);
      R.push([x + dz * hw, y, z - dx * hw]);
    }
    const up = [0, 1, 0];
    for (let i = 0; i < n - 1; i++) b.quad(L[i], R[i], R[i + 1], L[i + 1], up, color);
    // runde Enden gegen Lücken an Kreuzungen
    if (noCaps || width < 2) return;
    for (const i of [0, n - 1]) {
      const cx = p[2 * i], cz = p[2 * i + 1], rr = width / 2;
      for (let k = 0; k < 6; k++) {
        const a0 = k / 6 * Math.PI * 2, a1 = (k + 1) / 6 * Math.PI * 2;
        b.triFacing([cx, y, cz], [cx + Math.cos(a0) * rr, y, cz + Math.sin(a0) * rr],
          [cx + Math.cos(a1) * rr, y, cz + Math.sin(a1) * rr], up, color);
      }
    }
  }

  function dashed(b, p, width, dash, gap, color, y) {
    let carry = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x0 = p[i], z0 = p[i + 1], x1 = p[i + 2], z1 = p[i + 3];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.1) continue;
      const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      let s = carry;
      while (s < len) {
        const e = Math.min(len, s + dash);
        ribbon(b, [x0 + dx * s, z0 + dz * s, x0 + dx * e, z0 + dz * e], width, color, y, true);
        s += dash + gap;
      }
      carry = s - len;
    }
  }

  function makeLines(scene) {
    const wb = new Builder(false);
    for (const w of water) ribbon(wb, w.pts, w.cls === 0 ? 3.2 : 1.4, C(w.cls === 0 ? '#3f7db0' : '#5b8fae'), 0);
    for (const p of rail) ribbon(wb, p, 4.2, C('#8a7f72'), 0);
    const wm = new THREE.Mesh(wb.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false }));
    wm.renderOrder = -8;
    wm.frustumCulled = false;
    scene.add(wm);

    const rb = new Builder(false);
    const sorted = roads.slice().sort((a, b) => {
      const ra = a.cls >= 7 ? -a.cls : a.cls, rb2 = b.cls >= 7 ? -b.cls : b.cls;
      return rb2 - ra;
    });
    for (const r of sorted) {
      ribbon(rb, r.pts, ROAD_WIDTH[r.cls], C(ROAD_COLOR[r.cls]), 0);
      if (r.cls === 5) ribbon(rb, r.pts, 0.9, C('#7f9c4f'), 0, true);  // Grasnarbe in der Mitte
    }
    const rm = new THREE.Mesh(rb.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false }));
    rm.renderOrder = -7;
    rm.frustumCulled = false;
    scene.add(rm);

    const mb = new Builder(false);
    for (const r of roads) {
      if (r.cls <= 1) dashed(mb, r.pts, 0.15, 3, 6, C('#e8e8e2'), 0);
      if (r.cls === 7) dashed(mb, r.pts, 0.9, 30, 20, C('#e8e8e2'), 0);
    }
    for (const p of rail) {
      // zwei Schienen
      const n = p.length / 2;
      for (const off of [-0.72, 0.72]) {
        const q = [];
        for (let i = 0; i < n; i++) {
          const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
          let dx = p[2 * i1] - p[2 * i0], dz = p[2 * i1 + 1] - p[2 * i0 + 1];
          const l = Math.hypot(dx, dz) || 1;
          dx /= l; dz /= l;
          q.push(p[2 * i] - dz * off, p[2 * i + 1] + dx * off);
        }
        ribbon(mb, q, 0.12, C('#4a4643'), 0);
      }
    }
    const mm = new THREE.Mesh(mb.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false }));
    mm.renderOrder = -6;
    mm.frustumCulled = false;
    scene.add(mm);
  }

  // ---- Gebäude
  const WALL = ['#efe9df', '#e8dcc6', '#d9cbb3', '#b86a4f', '#a85a43', '#f2efe8', '#d7d2c8', '#c98f6b', '#e9e2d0'];
  const ROOF = ['#8a3b2b', '#6b3127', '#3d3f45', '#55585e', '#9b4a32', '#7a3a2c'];

  function isRect(p) {
    if (p.length !== 8) return false;
    for (let i = 0; i < 4; i++) {
      const a = (i + 3) % 4, c = (i + 1) % 4;
      const ux = p[2 * a] - p[2 * i], uy = p[2 * a + 1] - p[2 * i + 1];
      const vx = p[2 * c] - p[2 * i], vy = p[2 * c + 1] - p[2 * i + 1];
      const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
      if (Math.abs(cos) > 0.2) return false;
    }
    return true;
  }

  /** Fläche des Polygons geteilt durch die Fläche seiner konvexen Hülle (1 = konvex). */
  function convexRatio(p) {
    const pts = [];
    for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]);
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    const hull = lo.slice(0, -1).concat(hi.slice(0, -1)).flat();
    const ha = Math.abs(polyArea(hull));
    return ha > 0 ? Math.abs(polyArea(p)) / ha : 0;
  }

  function addBuilding(b, r) {
    const ch = chunkAt(b.c[0], b.c[1]);
    const p = b.pts, n = p.length / 2;
    let wall, roof, windows = false;
    switch (b.kind) {
      case 1: wall = pick(r, ['#cfcac0', '#b8b3aa', '#d6d0c4']); roof = '#7d7f80'; break;
      case 2: wall = pick(r, ['#9b5a44', '#8f8f88', '#a9a090', '#b7aa92', '#7f7a70']); roof = pick(r, ['#5f6266', '#7a3a2c', '#6e7172']); break;
      case 3: wall = pick(r, ['#d8cfbf', '#c9bba3']); roof = '#4a4e57'; break;
      case 4: wall = '#b98a64'; roof = '#4a4e57'; windows = true; break;
      case 5: case 6: wall = '#c9c6bf'; roof = '#8a8a88'; break;
      case 7: wall = pick(r, ['#e6dccb', '#efe6d5']); roof = '#6b3127'; windows = true; break;
      default: wall = pick(r, WALL); roof = pick(r, ROOF); windows = true;
    }
    const wc = vary(r, C(wall), 0.1), rc = vary(r, C(roof), 0.12);
    if (b.kind === 5 || b.kind === 6) return addTower(b, ch, wc, rc);
    const h = b.h;
    const target = windows ? ch.walls : ch.plain;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.05) continue;
      const nrm = [(by - ay) / len, 0, -(bx - ax) / len];
      if (windows) {
        const u0 = u / 3.2, u1 = (u + len) / 3.2, v1 = h / 3.0;
        target.quad([ax, 0, ay], [bx, 0, by], [bx, h, by], [ax, h, ay], nrm, wc,
          [[u0, 0], [u1, 0], [u1, v1], [u0, v1]]);
      } else {
        target.quad([ax, 0, ay], [bx, 0, by], [bx, h, by], [ax, h, ay], nrm, wc);
      }
      u += len;
    }
    // Dach
    const up = [0, 1, 0];
    const gable = (b.kind === 0 || b.kind === 2 || b.kind === 3 || b.kind === 7) && isRect(p) && b.area < 2500;
    if (gable) {
      const e0 = Math.hypot(p[2] - p[0], p[3] - p[1]), e1 = Math.hypot(p[4] - p[2], p[5] - p[3]);
      // Reihenfolge so drehen, dass p0-p1 eine lange Seite ist
      const q = e0 >= e1 ? p : [p[2], p[3], p[4], p[5], p[6], p[7], p[0], p[1]];
      const short = Math.min(e0, e1);
      const pitch = b.kind === 2 ? 0.28 : b.kind === 3 ? 0.6 : 0.45;
      const rh = Math.min(b.kind === 2 ? 4 : 7, short * pitch);
      const P = i => [q[2 * i], h, q[2 * i + 1]];
      const R1 = [(q[6] + q[0]) / 2, h + rh, (q[7] + q[1]) / 2];
      const R2 = [(q[2] + q[4]) / 2, h + rh, (q[3] + q[5]) / 2];
      const cx = b.c[0], cy = b.c[1];
      const side = (a, bb) => {
        const mx = (a[0] + bb[0]) / 2 - cx, mz = (a[2] + bb[2]) / 2 - cy;
        const l = Math.hypot(mx, mz) || 1;
        return [mx / l, 0.8, mz / l];
      };
      ch.plain.quad(P(0), P(1), R2, R1, side(P(0), P(1)), rc);
      ch.plain.quad(P(2), P(3), R1, R2, side(P(2), P(3)), rc);
      const g1 = side(P(1), P(2)); g1[1] = 0;
      const g2 = side(P(3), P(0)); g2[1] = 0;
      ch.plain.triFacing(P(1), P(2), R2, g1, wc);
      ch.plain.triFacing(P(3), P(0), R1, g2, wc);
    } else if ((b.kind === 0 || b.kind === 7) && b.area < 420 && convexRatio(p) > 0.9) {
      // Walmdach: alle Kanten laufen zu einem First über dem Mittelpunkt
      const cx = b.c[0], cy = b.c[1];
      const top = [cx, h + Math.min(5, Math.sqrt(b.area) * 0.32), cy];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const A = [p[2 * i], h, p[2 * i + 1]], B = [p[2 * j], h, p[2 * j + 1]];
        const mx = (A[0] + B[0]) / 2 - cx, mz = (A[2] + B[2]) / 2 - cy;
        const l = Math.hypot(mx, mz) || 1;
        ch.plain.triFacing(A, B, top, [mx / l, 0.8, mz / l], rc);
      }
    } else {
      for (const t of triangulate(p)) {
        ch.plain.triFacing([p[2 * t[0]], h, p[2 * t[0] + 1]], [p[2 * t[1]], h, p[2 * t[1] + 1]],
          [p[2 * t[2]], h, p[2 * t[2] + 1]], up, rc);
      }
    }
    if (b.kind === 3 && b.area > 120) addChurchTower(b, ch, wc);
    if (b.kind === 4 && n <= 10) {
      for (let i = 0; i < n; i++) {
        const m = new THREE.Matrix4().makeTranslation(p[2 * i], (h + 4) / 2, p[2 * i + 1]);
        ch.props.addGeometry(geoTowerRound, m.multiply(new THREE.Matrix4().makeScale(2.2, h + 4, 2.2)), wc);
        const m2 = new THREE.Matrix4().makeTranslation(p[2 * i], h + 4 + 2.2, p[2 * i + 1]).multiply(new THREE.Matrix4().makeScale(2.8, 4.4, 2.8));
        ch.props.addGeometry(geoCone, m2, C('#4a4e57'));
      }
    }
  }

  let geoTowerRound, geoCone, geoBox, geoCyl, geoPyramid;
  function makeShared() {
    geoTowerRound = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
    geoCone = new THREE.ConeGeometry(0.5, 1, 10);
    geoBox = new THREE.BoxGeometry(1, 1, 1);
    geoCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
    geoPyramid = new THREE.ConeGeometry(0.71, 1, 4);
    geoPyramid.rotateY(Math.PI / 4);
  }

  function addChurchTower(b, ch, wc) {
    // Turm am westlichen Ende des Kirchenschiffs
    const p = b.pts;
    let minX = Infinity, zAt = b.c[1];
    for (let i = 0; i < p.length; i += 2) if (p[i] < minX) { minX = p[i]; }
    const s = 6;
    const x = minX + s / 2 + 0.5, z = zAt;
    const th = 24 + Math.min(10, b.area / 60);
    const m = new THREE.Matrix4().makeTranslation(x, th / 2, z).multiply(new THREE.Matrix4().makeScale(s, th, s));
    ch.props.addGeometry(geoBox, m, wc);
    const m2 = new THREE.Matrix4().makeTranslation(x, th + 7, z).multiply(new THREE.Matrix4().makeScale(s * 1.05, 14, s * 1.05));
    ch.props.addGeometry(geoPyramid, m2, C('#3f444d'));
  }

  function addTower(b, ch, wc, rc) {
    const rad = Math.sqrt(b.area / Math.PI);
    const x = b.c[0], z = b.c[1];
    if (b.kind === 5) {
      const h = b.h;
      ch.props.addGeometry(geoTowerRound, new THREE.Matrix4().makeTranslation(x, h * 0.4, z)
        .multiply(new THREE.Matrix4().makeScale(rad * 1.0, h * 0.8, rad * 1.0)), wc);
      ch.props.addGeometry(geoTowerRound, new THREE.Matrix4().makeTranslation(x, h * 0.88, z)
        .multiply(new THREE.Matrix4().makeScale(rad * 2.4, h * 0.2, rad * 2.4)), wc);
      ch.props.addGeometry(geoCone, new THREE.Matrix4().makeTranslation(x, h + 2, z)
        .multiply(new THREE.Matrix4().makeScale(rad * 2.5, 4, rad * 2.5)), rc);
    } else {
      ch.props.addGeometry(geoTowerRound, new THREE.Matrix4().makeTranslation(x, b.h / 2, z)
        .multiply(new THREE.Matrix4().makeScale(rad * 2, b.h, rad * 2)), wc);
    }
  }

  // ---- Bäume
  const trees = [];
  function addTree(x, y, r, kind) {
    if (arena && Math.abs(x - arena.x) < arena.w / 2 + 4 && Math.abs(y - arena.y) < arena.d / 2 + 4) return;
    const s = 0.75 + r() * 0.6;
    const t = { x, y, s, type: kind, r: 0.45 * s, c: r() };
    trees.push(t);
    chunkAt(x, y).trees.push(t);
    solidGrid.add(t, x - 1, y - 1, x + 1, y + 1);
  }

  function makeTrees() {
    const r = rng(42);
    // Wälder
    for (const a of areas) {
      if (a.cls !== 2) continue;
      const box = bbox(a.pts);
      const sp = 9.5;
      for (let x = box[0]; x < box[2]; x += sp) {
        for (let y = box[1]; y < box[3]; y += sp) {
          const px = x + (r() - 0.5) * 6, py = y + (r() - 0.5) * 6;
          if (!pointInPoly(a.pts, px, py)) continue;
          if (nearRoad(px, py, 2.5, 6)) continue;
          if (nearBuilding(px, py, 3)) continue;
          addTree(px, py, r, r() < 0.25 ? 1 : 0);
        }
      }
    }
    // Obstwiesen
    for (const a of areas) {
      if (a.cls !== 7) continue;
      const box = bbox(a.pts);
      for (let x = box[0]; x < box[2]; x += 12) {
        for (let y = box[1]; y < box[3]; y += 12) {
          const px = x + (r() - 0.5) * 3, py = y + (r() - 0.5) * 3;
          if (pointInPoly(a.pts, px, py) && !nearBuilding(px, py, 3) && !nearRoad(px, py, 2, 6)) addTree(px, py, r, 2);
        }
      }
    }
    // Gärten in den Dörfern
    for (const a of areas) {
      if (a.cls !== 3 && a.cls !== 8 && a.cls !== 5) continue;
      const box = bbox(a.pts);
      const area = Math.abs(polyArea(a.pts));
      const count = Math.floor(area / (a.cls === 3 ? 900 : 500));
      for (let i = 0; i < count; i++) {
        const px = box[0] + r() * (box[2] - box[0]), py = box[1] + r() * (box[3] - box[1]);
        if (!pointInPoly(a.pts, px, py)) continue;
        if (nearBuilding(px, py, 4) || nearRoad(px, py, 3, 6)) continue;
        addTree(px, py, r, r() < 0.2 ? 1 : 0);
      }
    }
    // Alleen an Landstraßen außerhalb der Orte
    for (const rd of roads) {
      if (rd.cls > 2) continue;
      const rr = rng(Math.floor(Math.abs(rd.pts[0] * 7 + rd.pts[1] * 13)));
      if (rr() < 0.45) continue;
      const p = rd.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const x0 = p[i], y0 = p[i + 1], x1 = p[i + 2], y1 = p[i + 3];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
        for (let s = 6; s < len - 6; s += 16) {
          for (const side of [-1, 1]) {
            const px = x0 + dx * s - dy * side * 7.5, py = y0 + dy * s + dx * side * 7.5;
            if (regionInside(px, py)) continue;
            if (nearBuilding(px, py, 4) || nearRoad(px, py, 1.5, 5)) continue;
            addTree(px, py, r, 0);
          }
        }
      }
    }
    // einzelne Bäume an Feldwegen
    for (const rd of roads) {
      if (rd.cls !== 5) continue;
      const p = rd.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        if (r() > 0.18) continue;
        const t = r();
        const x = p[i] + (p[i + 2] - p[i]) * t, y = p[i + 1] + (p[i + 3] - p[i + 1]) * t;
        const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) || 1;
        const side = r() < 0.5 ? -1 : 1;
        const px = x - (p[i + 3] - p[i + 1]) / len * side * 4.5, py = y + (p[i + 2] - p[i]) / len * side * 4.5;
        if (!nearRoad(px, py, 1.2, 6) && !nearBuilding(px, py, 4)) addTree(px, py, r, r() < 0.5 ? 0 : 2);
      }
    }
  }

  function regionInside(x, y) {
    for (const p of places) if (Math.hypot(x - p.x, y - p.y) < p.radius) return true;
    return false;
  }

  let treeGeo;
  function buildTreeMeshes() {
    const trunk = new THREE.CylinderGeometry(0.16, 0.24, 1, 5, 1, true);
    trunk.translate(0, 0.5, 0);
    const crownRound = new THREE.IcosahedronGeometry(1, 0);
    const crownCone = new THREE.ConeGeometry(1, 1, 6);
    crownCone.translate(0, 0.5, 0);
    treeGeo = { trunk, crownRound, crownCone };
    const matTrunk = new THREE.MeshLambertMaterial({ color: 0x6b4f36 });
    const matCrown = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const leafCols = [C('#4f7d36'), C('#5c8a3a'), C('#467231'), C('#6a9440'), C('#3f6a30')];
    const firCol = C('#355a33'), fruitCol = C('#6c9a3e');
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    for (const ch of chunks.values()) {
      if (!ch.trees.length) continue;
      const n = ch.trees.length;
      const it = new THREE.InstancedMesh(trunk, matTrunk, n);
      const round = ch.trees.filter(t => t.type !== 1), cone = ch.trees.filter(t => t.type === 1);
      ch.trees.forEach((t, i) => {
        const th = t.type === 1 ? 3 * t.s : t.type === 2 ? 1.8 * t.s : 3.4 * t.s;
        q.setFromAxisAngle(v.set(0, 1, 0), t.c * 6.28);
        m.compose(v.set(t.x, 0, t.y), q, s.set(t.s, th, t.s));
        it.setMatrixAt(i, m);
      });
      ch.treeGroup.add(it);
      if (round.length) {
        const ir = new THREE.InstancedMesh(crownRound, matCrown, round.length);
        round.forEach((t, i) => {
          const fruit = t.type === 2;
          const rad = (fruit ? 2.2 : 3.2) * t.s;
          const y = (fruit ? 1.8 : 3.4) * t.s + rad * 0.75;
          q.setFromAxisAngle(v.set(0, 1, 0), t.c * 6.28);
          m.compose(v.set(t.x, y, t.y), q, s.set(rad, rad * 0.9, rad));
          ir.setMatrixAt(i, m);
          ir.setColorAt(i, fruit ? fruitCol : leafCols[Math.floor(t.c * leafCols.length)]);
        });
        ch.treeGroup.add(ir);
      }
      if (cone.length) {
        const ic = new THREE.InstancedMesh(crownCone, matCrown, cone.length);
        cone.forEach((t, i) => {
          m.compose(v.set(t.x, 1.6 * t.s, t.y), q.identity(), s.set(2.4 * t.s, 10 * t.s, 2.4 * t.s));
          ic.setMatrixAt(i, m);
          ic.setColorAt(i, firCol);
        });
        ch.treeGroup.add(ic);
      }
    }
  }

  // ---- Hindernisse zum Springen
  const obstacles = [];
  const OBST = {
    log:   { h: 0.7, hw: 0.35, name: 'Baumstamm' },
    bales: { h: 0.9, hw: 0.6, name: 'Strohballen' },
    rick:  { h: 1.0, hw: 0.25, name: 'Holzrick' },
    hedge: { h: 1.1, hw: 0.45, name: 'Hecke' },
    vert:  { h: 1.1, hw: 0.2, name: 'Steilsprung' },
    oxer:  { h: 1.0, hw: 0.7, name: 'Oxer' },
  };

  function addObstacle(kind, x, y, dx, dy, hl, extra) {
    const o = Object.assign({ isObstacle: true, kind, x, y, dx, dy, hl, hw: OBST[kind].hw, h: OBST[kind].h }, extra || {});
    obstacles.push(o);
    const e = hl + 1;
    solidGrid.add(o, x - e, y - e, x + e, y + e);
    const ch = chunkAt(x, y);
    const ang = Math.atan2(dy, dx);
    const base = new THREE.Matrix4().makeTranslation(x, 0, y).multiply(new THREE.Matrix4().makeRotationY(-ang));
    const add = (geo, px, py, pz, sx, sy, sz, color, rotZ) => {
      const m = base.clone().multiply(new THREE.Matrix4().makeTranslation(px, py, pz));
      if (rotZ) m.multiply(new THREE.Matrix4().makeRotationZ(rotZ));
      m.multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
      ch.props.addGeometry(geo, m, color);
    };
    const L = hl * 2;
    switch (kind) {
      case 'log':
        add(geoCyl, 0, 0.35, 0, 0.7, L, 0.7, C('#6e5034'), Math.PI / 2);
        add(geoCyl, hl, 0.35, 0, 0.62, 0.06, 0.62, C('#b8925f'), Math.PI / 2);
        add(geoCyl, -hl, 0.35, 0, 0.62, 0.06, 0.62, C('#b8925f'), Math.PI / 2);
        break;
      case 'bales':
        for (let i = 0; i < 3; i++) add(geoBox, -hl + L / 6 + i * L / 3, 0.45, 0, L / 3 - 0.08, 0.9, 1.15, C(i % 2 ? '#d9bf6a' : '#e1c977'));
        break;
      case 'rick':
        for (const sx of [-hl, hl]) add(geoBox, sx, 0.65, 0, 0.14, 1.3, 0.14, C('#7b5a3c'));
        for (const yy of [0.35, 0.65, 0.95]) add(geoCyl, 0, yy, 0, 0.12, L, 0.12, C('#a07b52'), Math.PI / 2);
        break;
      case 'hedge':
        add(geoBox, 0, 0.55, 0, L, 1.1, 0.9, C('#3f6b2e'));
        break;
      case 'vert':
      case 'oxer': {
        const c1 = C(o.color || '#d63b3b');
        const rails = kind === 'oxer' ? [-0.55, 0.55] : [0];
        for (const rz of rails) {
          for (const sx of [-hl, hl]) add(geoBox, sx, 0.8, rz, 0.18, 1.6, 0.18, C('#f2f2f2'));
          for (const yy of [0.45, 0.8, 1.1]) {
            // gestreifte Stangen
            for (let k = 0; k < 4; k++) {
              add(geoCyl, -hl + (k + 0.5) * L / 4, yy, rz, 0.1, L / 4, 0.1, k % 2 ? C('#f4f4f4') : c1, Math.PI / 2);
            }
          }
        }
        break;
      }
    }
    return o;
  }

  function makeObstacles() {
    const r = rng(1234);
    const kinds = ['log', 'bales', 'rick', 'log', 'bales', 'hedge'];
    for (const rd of roads) {
      if (rd.cls !== 5) continue;
      const p = rd.pts;
      let acc = r() * 500;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const x0 = p[i], y0 = p[i + 1], x1 = p[i + 2], y1 = p[i + 3];
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 1) continue;
        const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
        let s = 600 - acc;
        while (s < len) {
          if (s > 12 && s < len - 12) {
            const x = x0 + dx * s, y = y0 + dy * s;
            if (!regionInside(x, y) && insideBoundary(x, y) && !nearBuilding(x, y, 8) && !nearRoad(x, y, 6, 4)) {
              // quer über den Weg
              addObstacle(pick(r, kinds), x, y, -dy, dx, 2.3);
            }
          }
          s += 450 + r() * 700;
        }
        acc = (acc + len) % 600;
      }
    }
    for (const h of hedges) {
      for (let i = 0; i + 3 < h.length; i += 2) {
        const x0 = h[i], y0 = h[i + 1], x1 = h[i + 2], y1 = h[i + 3];
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 0.5) continue;
        addObstacle('hedge', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / len, (y1 - y0) / len, len / 2);
      }
    }
  }

  // ---- Reitplatz am Gestüt
  let arena = null;
  function makeArena(scene) {
    const g = landmarks.find(l => l.kind === 'Gestüt') || { x: 0, y: 0 };
    let best = null;
    for (let rad = 80; rad <= 400 && !best; rad += 20) {
      for (let k = 0; k < 24; k++) {
        const a = k / 24 * Math.PI * 2;
        const x = g.x + Math.cos(a) * rad, y = g.y + Math.sin(a) * rad;
        if (nearBuilding(x, y, 48)) continue;
        if (nearRoad(x, y, 38, 6)) continue;
        if (!insideBoundary(x, y)) continue;
        best = { x, y };
        break;
      }
    }
    if (!best) best = { x: g.x + 150, y: g.y };
    arena = { x: best.x, y: best.y, w: 76, d: 44 };
    const geo = new THREE.PlaneGeometry(arena.w, arena.d);
    geo.rotateX(-Math.PI / 2);
    const sand = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xd8c39a, depthWrite: false }));
    sand.position.set(arena.x, 0, arena.y);
    sand.renderOrder = -5;
    scene.add(sand);
    // Bande aus weißen Pfosten
    const ch = chunkAt(arena.x, arena.y);
    for (let i = 0; i <= 19; i++) {
      for (const [px, py] of [[-arena.w / 2 + i * arena.w / 19, -arena.d / 2], [-arena.w / 2 + i * arena.w / 19, arena.d / 2]]) {
        ch.props.addGeometry(geoBox, new THREE.Matrix4().makeTranslation(arena.x + px, 0.4, arena.y + py)
          .multiply(new THREE.Matrix4().makeScale(0.15, 0.8, 0.15)), C('#f4f4f4'));
      }
    }
    // Parcours: acht Sprünge auf einem Oval
    const cols = ['#d63b3b', '#2f6fd6', '#2f9e4f', '#e6a019', '#8a3fc4', '#d63b3b', '#2f6fd6', '#e6a019'];
    const jumps = [[-22, -10], [0, -12], [22, -10], [30, 0], [22, 10], [0, 12], [-22, 10], [-30, 0]];
    jumps.forEach(([jx, jy], i) => {
      // Richtung entlang des Ovals -> Sprung steht quer dazu
      const tx = -jy / 12, ty = jx / 30;
      const l = Math.hypot(tx, ty) || 1;
      addObstacle(i % 3 === 1 ? 'oxer' : 'vert', arena.x + jx, arena.y + jy, -ty / l, tx / l, 1.9, { color: cols[i], arena: true });
    });
  }

  // ---- Grenzpfähle
  function makeBoundaryPosts() {
    const p = boundary, n = p.length / 2;
    let carry = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = p[2 * i], y0 = p[2 * i + 1], x1 = p[2 * j], y1 = p[2 * j + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      let s = carry;
      while (s < len) {
        const x = x0 + (x1 - x0) * s / len, y = y0 + (y1 - y0) * s / len;
        const ch = chunkAt(x, y);
        ch.props.addGeometry(geoBox, new THREE.Matrix4().makeTranslation(x, 0.6, y).multiply(new THREE.Matrix4().makeScale(0.18, 1.2, 0.18)), C('#f4f4f4'));
        ch.props.addGeometry(geoBox, new THREE.Matrix4().makeTranslation(x, 1.3, y).multiply(new THREE.Matrix4().makeScale(0.2, 0.25, 0.2)), C('#d33a2c'));
        s += 25;
      }
      carry = s - len;
    }
  }

  // ---- Ortsschilder und Infotafeln
  const signTextures = {};
  function signTexture(name, back) {
    const key = name + (back ? '#b' : '');
    if (signTextures[key]) return signTextures[key];
    const t = canvasTexture(512, 256, (g, w, h) => {
      g.fillStyle = '#f7c600';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#111';
      g.lineWidth = 12;
      g.strokeRect(14, 14, w - 28, h - 28);
      g.fillStyle = '#111';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let size = 74;
      g.font = `bold ${size}px "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
      while (g.measureText(name).width > w - 70 && size > 30) { size -= 4; g.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`; }
      g.fillText(name, w / 2, back ? h / 2 : h / 2 - 22);
      if (!back) {
        g.font = 'bold 30px Arial, sans-serif';
        g.fillText('Gemeinde Nörvenich', w / 2, h / 2 + 52);
      } else {
        g.strokeStyle = '#d0201a';
        g.lineWidth = 22;
        g.beginPath();
        g.moveTo(40, h - 40);
        g.lineTo(w - 40, 40);
        g.stroke();
      }
    });
    signTextures[key] = t;
    return t;
  }

  function boardTexture(title, sub) {
    return canvasTexture(512, 256, (g, w, h) => {
      g.fillStyle = '#5b3d25';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#f3ead6';
      g.fillRect(16, 16, w - 32, h - 32);
      g.fillStyle = '#3a2a1a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let size = 56;
      g.font = `bold ${size}px Georgia, serif`;
      while (g.measureText(title).width > w - 60 && size > 22) { size -= 3; g.font = `bold ${size}px Georgia, serif`; }
      g.fillText(title, w / 2, h / 2 - 16);
      g.font = 'italic 28px Georgia, serif';
      g.fillText(sub, w / 2, h / 2 + 46);
    });
  }

  function makeSigns(scene) {
    const signGeo = new THREE.PlaneGeometry(1.9, 0.95);
    const placed = [];
    for (const pl of places) {
      const front = new THREE.MeshLambertMaterial({ map: signTexture(pl.name, false) });
      const back = new THREE.MeshLambertMaterial({ map: signTexture(pl.name, true) });
      for (const rd of roads) {
        if (rd.cls > 3) continue;
        const p = rd.pts;
        for (let i = 0; i + 3 < p.length; i += 2) {
          const x0 = p[i], y0 = p[i + 1], x1 = p[i + 2], y1 = p[i + 3];
          const d0 = Math.hypot(x0 - pl.x, y0 - pl.y), d1 = Math.hypot(x1 - pl.x, y1 - pl.y);
          if ((d0 - pl.radius) * (d1 - pl.radius) > 0) continue;
          const t = (pl.radius - d0) / (d1 - d0);
          const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
          if (placed.some(q => Math.hypot(q[0] - x, q[1] - y) < 60)) continue;
          // Richtung ins Dorf hinein
          let dx = x1 - x0, dy = y1 - y0;
          const l = Math.hypot(dx, dy) || 1;
          dx /= l; dy /= l;
          if (d1 > d0) { dx = -dx; dy = -dy; }
          const off = ROAD_WIDTH[rd.cls] / 2 + 1.6;
          const sx = x - dy * off, sy = y + dx * off;  // rechts in Fahrtrichtung
          if (nearBuilding(sx, sy, 1)) continue;
          placed.push([x, y]);
          const g = new THREE.Group();
          g.position.set(sx, 0, sy);
          g.rotation.y = Math.atan2(-dx, -dy);
          const f = new THREE.Mesh(signGeo, front);
          f.position.y = 2.1;
          f.position.z = 0.03;
          const bk = new THREE.Mesh(signGeo, back);
          bk.position.y = 2.1;
          bk.position.z = -0.03;
          bk.rotation.y = Math.PI;
          g.add(f, bk);
          for (const px of [-0.7, 0.7]) {
            const post = new THREE.Mesh(geoCyl, postMat);
            post.scale.set(0.07, 2.6, 0.07);
            post.position.set(px, 1.3, 0);
            g.add(post);
          }
          chunkAt(sx, sy).group.add(g);
          solidGrid.add({ x: sx, y: sy, r: 0.3, sign: true }, sx - 1, sy - 1, sx + 1, sy + 1);
        }
      }
    }
    // Infotafeln an den Sehenswürdigkeiten ohne eigenes auffälliges Gebäude
    for (const l of landmarks) {
      if (l.kind === 'Kirche' || l.kind === 'Turm' || l.kind === 'Flugplatz') continue;
      let x = l.x, y = l.y;
      // freien Platz in der Nähe suchen
      for (let k = 0; k < 40 && nearBuilding(x, y, 2.5); k++) {
        const a = k * 2.4, rr = 4 + k * 1.5;
        x = l.x + Math.cos(a) * rr; y = l.y + Math.sin(a) * rr;
      }
      // zur nächsten Straße drehen
      let face = 0, bd = Infinity;
      roadGrid.query(x - 40, y - 40, x + 40, y + 40, s => {
        const [d, cx, cy] = segDist(x, y, s.x0, s.y0, s.x1, s.y1);
        if (d < bd) { bd = d; face = Math.atan2(cx - x, cy - y); }
      });
      const g = new THREE.Group();
      g.position.set(x, 0, y);
      g.rotation.y = face;
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 0.08),
        [woodMat, woodMat, woodMat, woodMat, new THREE.MeshLambertMaterial({ map: boardTexture(l.name, l.kind) }), woodMat]);
      board.position.y = 1.7;
      g.add(board);
      for (const px of [-0.85, 0.85]) {
        const post = new THREE.Mesh(geoBox, woodMat);
        post.scale.set(0.12, 2.2, 0.12);
        post.position.set(px, 1.1, -0.06);
        g.add(post);
      }
      if (l.kind === 'Wegkreuz') {
        const cross = new THREE.Group();
        const v = new THREE.Mesh(geoBox, stoneMat); v.scale.set(0.25, 3.2, 0.25); v.position.y = 1.6;
        const hz = new THREE.Mesh(geoBox, stoneMat); hz.scale.set(1.3, 0.25, 0.25); hz.position.y = 2.5;
        cross.add(v, hz);
        cross.position.set(2.5, 0, 0);
        g.add(cross);
      }
      chunkAt(x, y).group.add(g);
      solidGrid.add({ x, y, r: 1.0, sign: true }, x - 2, y - 2, x + 2, y + 2);
    }
  }
  let postMat, woodMat, stoneMat;

  // ------------------------------------------------------------ Gegenstände verteilen
  const items = { shoes: [], food: [] };
  const discoverables = [];

  function placeItems() {
    const r = rng(2024);
    const cand = [];
    for (const rd of roads) {
      if (rd.cls < 3 || rd.cls > 6) continue;
      const p = rd.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
        for (let s = 0; s < len; s += 25) {
          const t = s / len;
          cand.push({ x: p[i] + (p[i + 2] - p[i]) * t, y: p[i + 1] + (p[i + 3] - p[i + 1]) * t, cls: rd.cls });
        }
      }
    }
    const taken = [];
    const free = (x, y, d) => !taken.some(t => Math.abs(t[0] - x) < d && Math.abs(t[1] - y) < d && Math.hypot(t[0] - x, t[1] - y) < d);
    const shoes = items.shoes;
    const addShoe = (x, y, z, place) => {
      shoes.push({ id: shoes.length, x, y, z, place, got: false });
      taken.push([x, y]);
    };
    // pro Ortsteil
    for (const pl of places) {
      const want = pl.village ? 10 : 3;
      const list = cand.filter(c => Math.hypot(c.x - pl.x, c.y - pl.y) < pl.radius + 60);
      // mischen
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      let n = 0;
      for (const c of list) {
        if (n >= want) break;
        if (!free(c.x, c.y, pl.village ? 55 : 35)) continue;
        if (nearBuilding(c.x, c.y, 2) || !insideBoundary(c.x, c.y)) continue;
        addShoe(c.x, c.y, 1.7, pl.name);
        n++;
      }
    }
    // draußen auf den Feldwegen
    const field = cand.filter(c => c.cls === 5 && !regionInside(c.x, c.y) && insideBoundary(c.x, c.y));
    for (let i = field.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [field[i], field[j]] = [field[j], field[i]]; }
    let n = 0;
    for (const c of field) {
      if (n >= 30) break;
      if (!free(c.x, c.y, 350)) continue;
      addShoe(c.x, c.y, 1.7, null);
      n++;
    }
    // über Hindernissen: nur mit Sprung zu erreichen
    const obs = obstacles.filter(o => o.kind !== 'hedge' || o.arena);
    const jumpy = obs.filter(o => o.arena).concat(obs.filter(o => !o.arena && insideBoundary(o.x, o.y)));
    n = 0;
    for (const o of jumpy) {
      if (n >= 28) break;
      if (!o.arena && !free(o.x, o.y, 400)) continue;
      if (o.arena && n >= 4) continue;
      addShoe(o.x, o.y, o.h + 1.9, o.arena ? 'Reitplatz' : null);
      o.hasShoe = true;
      n++;
    }
    for (const s of shoes) if (!s.place) s.place = nearestPlaceName(s.x, s.y);

    // Futter: Äpfel und Möhren
    const all = cand.slice();
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    const ftaken = [];
    for (const c of all) {
      if (items.food.length >= 260) break;
      if (!insideBoundary(c.x, c.y)) continue;
      if (ftaken.some(t => Math.abs(t[0] - c.x) < 160 && Math.abs(t[1] - c.y) < 160 && Math.hypot(t[0] - c.x, t[1] - c.y) < 160)) continue;
      if (!free(c.x, c.y, 12) || nearBuilding(c.x, c.y, 2)) continue;
      const inVillage = regionInside(c.x, c.y);
      items.food.push({ id: items.food.length, x: c.x, y: c.y, z: 1.2, kind: inVillage ? 'apple' : (r() < 0.7 ? 'carrot' : 'apple'), respawn: 0 });
      ftaken.push([c.x, c.y]);
    }

    // Entdecken
    for (const pl of places) {
      discoverables.push({ id: 'p:' + pl.name, name: pl.name, kind: pl.village ? 'Ortsteil' : 'Weiler', x: pl.x, y: pl.y,
        r: Math.min(220, pl.radius * 0.6), village: true });
    }
    for (const l of landmarks) {
      discoverables.push({ id: 'l:' + l.name, name: l.name, kind: l.kind, x: l.x, y: l.y,
        r: l.kind === 'Flugplatz' ? 600 : l.kind === 'Hof' || l.kind === 'Gestüt' ? 70 : 45 });
    }
    discoverables.push({ id: 'l:Reitplatz', name: 'Reitplatz am Gestüt', kind: 'Reitplatz', x: arena.x, y: arena.y, r: 40 });
  }

  function nearestPlaceName(x, y) {
    let best = null, bd = Infinity;
    for (const p of places) {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? best.name : 'Nörvenich';
  }

  // ------------------------------------------------------------ Startpunkt
  // Start ist in Wissersheim: auf der Dorfstraße nahe der Kirche.
  let spawnCache = null;
  function findSpawn() {
    const home = places.find(p => p.name === 'Wissersheim') || places[0];
    const church = landmarks.find(l => l.name.startsWith('St. Martinus (Wissersheim'));
    const cx = church ? church.x : home.x, cy = church ? church.y : home.y;
    const cands = [];
    for (const r of roads) {
      if (r.cls < 2 || r.cls > 4) continue;
      const p = r.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const x0 = p[i], y0 = p[i + 1], x1 = p[i + 2], y1 = p[i + 3];
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 14) continue;
        const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
        for (let s2 = 7; s2 < len - 7; s2 += 4) {
          const x = x0 + dx * s2, y = y0 + dy * s2;
          const d = Math.hypot(x - cx, y - cy);
          if (d < 400) cands.push({ x, y, dx, dy, d });
        }
      }
    }
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands) {
      // beide Pferde nebeneinander, mit Platz drumherum
      const ok = [-1.3, 1.3].every(o => {
        const x = c.x - c.dy * o, y = c.y + c.dx * o;
        return insideBoundary(x, y) && !nearBuilding(x, y, 2.5) && !nearSolid(x, y, 2);
      });
      if (ok) {
        // Blick Richtung Dorfmitte (entlang der Straße)
        let dx = c.dx, dy = c.dy;
        if ((home.x - c.x) * dx + (home.y - c.y) * dy < 0) { dx = -dx; dy = -dy; }
        return { x: c.x, y: c.y, dx, dy };
      }
    }
    return { x: home.x, y: home.y, dx: 0, dy: -1 };
  }

  function nearSolid(x, y, r) {
    let hit = false;
    solidGrid.query(x - r - 3, y - r - 3, x + r + 3, y + r + 3, o => {
      const ox = o.x, oy = o.y;
      const rr = o.isObstacle ? o.hl + r : (o.r || 0.5) + r;
      if (Math.hypot(ox - x, oy - y) < rr) { hit = true; return false; }
    });
    return hit;
  }

  /** Startplatz für Reiterin i (0 oder 1). */
  function spawnPoint(i) {
    if (!spawnCache) spawnCache = findSpawn();
    const c = spawnCache;
    const o = i === 1 ? 1.3 : i === 0 ? -1.3 : 0;
    return { x: c.x - c.dy * o, y: c.y + c.dx * o, heading: Math.atan2(c.dx, -c.dy) };
  }

  // ------------------------------------------------------------ Aufbau
  let built = false;
  function build(scene) {
    if (built) return;
    built = true;
    makeShared();
    makeTextures();
    postMat = new THREE.MeshLambertMaterial({ color: 0x9a9da3 });
    woodMat = new THREE.MeshLambertMaterial({ color: 0x6e4c2f });
    stoneMat = new THREE.MeshLambertMaterial({ color: 0xbdb7aa });

    makeGround(scene);
    makeAreas(scene);
    makeLines(scene);
    const r = rng(99);
    for (const b of buildings) addBuilding(b, r);
    makeArena(scene);
    makeTrees();
    makeObstacles();
    makeBoundaryPosts();
    makeSigns(scene);
    placeItems();
    buildTreeMeshes();

    const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: textures.window });
    const plainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const ch of chunks.values()) {
      if (!ch.walls.empty) ch.group.add(new THREE.Mesh(ch.walls.geometry(), wallMat));
      if (!ch.plain.empty) ch.group.add(new THREE.Mesh(ch.plain.geometry(), plainMat));
      if (!ch.props.empty) ch.group.add(new THREE.Mesh(ch.props.geometry(), plainMat));
      ch.walls = ch.plain = ch.props = null;
      scene.add(ch.group);
      scene.add(ch.treeGroup);
    }
  }

  /** Nur Kartenstücke in Sichtweite zeichnen (pro Bildschirmhälfte aufrufen). */
  function updateVisibility(x, y) {
    const h = CHUNK / 2;
    for (const ch of chunks.values()) {
      // Abstand zum nächsten Punkt des Kartenstücks
      const dx = Math.max(0, Math.abs(ch.cx - x) - h), dy = Math.max(0, Math.abs(ch.cy - y) - h);
      const d = Math.hypot(dx, dy);
      ch.group.visible = d < VIEW;
      ch.treeGroup.visible = d < VIEW_TREES;
    }
  }

  // ------------------------------------------------------------ Kollision
  /**
   * Schiebt einen Kreis (Pferd) aus Gebäuden, Bäumen und Hindernissen heraus.
   * pos: {x, y}; jump: aktuelle Sprunghöhe in Metern.
   * Rückgabe: { building, obstacle, boundary }
   */
  function collide(pos, rad, jump) {
    const res = { building: false, obstacle: null, boundary: false, cleared: null };
    const x0 = pos.x - rad - 2, y0 = pos.y - rad - 2, x1 = pos.x + rad + 2, y1 = pos.y + rad + 2;
    buildingGrid.query(x0, y0, x1, y1, b => {
      if (pos.x < b.box[0] - rad || pos.x > b.box[2] + rad || pos.y < b.box[1] - rad || pos.y > b.box[3] + rad) return;
      const p = b.pts, n = p.length / 2;
      let bd = Infinity, bx = 0, by = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const [d, cx, cy] = segDist(pos.x, pos.y, p[2 * i], p[2 * i + 1], p[2 * j], p[2 * j + 1]);
        if (d < bd) { bd = d; bx = cx; by = cy; }
      }
      const inside = pointInPoly(p, pos.x, pos.y);
      if (!inside && bd >= rad) return;
      let nx = pos.x - bx, ny = pos.y - by;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l;
      if (inside) { nx = -nx; ny = -ny; }
      const push = inside ? bd + rad : rad - bd;
      pos.x += nx * push; pos.y += ny * push;
      res.building = true;
    });
    solidGrid.query(x0, y0, x1, y1, o => {
      if (o.isObstacle) {
        // Hindernis (gedrehter Quader)
        const rx = pos.x - o.x, ry = pos.y - o.y;
        const u = rx * o.dx + ry * o.dy, v = -rx * o.dy + ry * o.dx;
        const cu = Math.max(-o.hl, Math.min(o.hl, u)), cv = Math.max(-o.hw, Math.min(o.hw, v));
        const du = u - cu, dv = v - cv;
        const d = Math.hypot(du, dv);
        if (d >= rad) return;
        if (jump >= o.h - 0.2) { res.cleared = o; return; }
        let nu, nv, push;
        if (d > 1e-4) { nu = du / d; nv = dv / d; push = rad - d; } else {
          // Mittelpunkt im Hindernis: zur nächsten Seite
          nu = 0; nv = v >= 0 ? 1 : -1; push = rad + o.hw - Math.abs(v);
        }
        pos.x += (nu * o.dx - nv * o.dy) * push;
        pos.y += (nu * o.dy + nv * o.dx) * push;
        res.obstacle = o;
      } else {
        const rr = o.r + rad * 0.8;
        const dx = pos.x - o.x, dy = pos.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d >= rr || d < 1e-5) return;
        pos.x = o.x + dx / d * rr; pos.y = o.y + dy / d * rr;
        res.building = res.building || !!o.sign;
      }
    });
    return res;
  }

  /** Erster Schnitt der Strecke (x0,y0)->(x1,y1) mit einer Hauswand, als Anteil 0..1 (1 = frei). */
  function rayBuildings(x0, y0, x1, y1, minH) {
    let best = 1;
    const dx = x1 - x0, dy = y1 - y0;
    buildingGrid.query(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), b => {
      if (b.h < minH) return;
      if (Math.max(x0, x1) < b.box[0] || Math.min(x0, x1) > b.box[2] || Math.max(y0, y1) < b.box[1] || Math.min(y0, y1) > b.box[3]) return;
      const p = b.pts, n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ex = p[2 * j] - p[2 * i], ey = p[2 * j + 1] - p[2 * i + 1];
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const qx = p[2 * i] - x0, qy = p[2 * i + 1] - y0;
        const t = (qx * ey - qy * ex) / den;
        const u = (qx * dy - qy * dx) / den;
        if (t >= 0 && t < best && u >= 0 && u <= 1) best = t;
      }
    });
    return best;
  }

  /** Untergrund: 1 = normal, kleiner = langsamer (Wasser). */
  function surface(x, y) {
    let f = 1, kind = 'ground';
    waterGrid.query(x - 3, y - 3, x + 3, y + 3, w => {
      if (w.poly) {
        if (pointInPoly(w.poly, x, y)) { f = 0.35; kind = 'water'; return false; }
      } else if (segDist(x, y, w.x0, w.y0, w.x1, w.y1)[0] < w.w) { f = Math.min(f, 0.5); kind = 'water'; }
    });
    if (kind === 'ground' && onRoad(x, y)) kind = 'road';
    return { f, kind };
  }

  return {
    build, updateVisibility, collide, surface, rayBuildings, insideBoundary, regionName, spawnPoint,
    get arena() { return arena; },
    items, discoverables, places, landmarks, obstacles, trees,
    data: { boundary, buildings, roads, areas, water, rail, bounds: M.bounds },
    ROAD_WIDTH, ROAD_COLOR, AREA_COLORS,
  };
})();
