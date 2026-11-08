/* 3D-Darstellung mit Three.js.
 * Die Spiellogik rechnet weiter in der Ebene (x, y). Für die 3D-Welt wird
 * x -> X, y -> Z abgebildet, Y zeigt nach oben. Ein Auto mit Winkel a fährt
 * in Richtung (cos a, 0, sin a); im Modell zeigt die Front nach +X, rechts ist +Z. */
'use strict';

const Render3D = (() => {
  const T = window.THREE;
  const ROAD_Y = 0.8;          // Höhe der Fahrbahn
  const SKY_TOP = 0x3f86d6;
  const SKY_HORIZON = 0xd4e8f4;

  // Bauformen: Höhe der Karosserie und Maße der Fahrgastzelle
  const SHAPES = {
    sport:   { bodyH: 7,  cabLen: 0.36, cabOff: -0.08, cabH: 6.5, cabW: 0.80 },
    compact: { bodyH: 8,  cabLen: 0.50, cabOff: -0.06, cabH: 8,   cabW: 0.86 },
    low:     { bodyH: 6,  cabLen: 0.32, cabOff: -0.06, cabH: 5.5, cabW: 0.78 },
    heavy:   { bodyH: 10, cabLen: 0.46, cabOff: -0.04, cabH: 9,   cabW: 0.88 },
    classic: { bodyH: 8,  cabLen: 0.40, cabOff: -0.06, cabH: 7,   cabW: 0.82 },
  };
  const CLEARANCE = 3.5;
  const WHEEL_R = 5;

  let renderer = null;
  let scene, camera, sky, maxAniso = 1;
  const worlds = new Map();     // Strecke -> Gruppe mit Strecke und Landschaft
  const carViews = new Map();   // Auto-ID -> 3D-Modell
  let activeWorld = null;
  const cam = { yaw: 0, init: false, follow: null, shake: 0 };

  // ------------------------------------------------------------------
  // Hilfsfunktionen
  // ------------------------------------------------------------------
  function canvasTexture(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    if (repeat) tex.wrapS = tex.wrapT = T.RepeatWrapping;
    return tex;
  }

  function noise(g, w, h, count, alpha, seed) {
    const rnd = seededRandom(seed);
    for (let i = 0; i < count; i++) {
      g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha * 1.3})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
    }
  }

  function box(w, h, d, mat, x, y, z) {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    m.position.set(x || 0, y || 0, z || 0);
    return m;
  }

  /* Quader zwischen zwei Punkten (für Streben im Cockpit). */
  function beam(a, b, thick, mat) {
    const dir = new T.Vector3().subVectors(b, a);
    const len = dir.length();
    const m = new T.Mesh(new T.BoxGeometry(thick, len, thick), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
    return m;
  }

  // ------------------------------------------------------------------
  // Initialisierung
  // ------------------------------------------------------------------
  function init(canvas) {
    if (!T) throw new Error('Three.js fehlt');
    renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = T.SRGBColorSpace;
    maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    scene = new T.Scene();
    scene.fog = new T.Fog(SKY_HORIZON, 900, 4200);
    camera = new T.PerspectiveCamera(70, 1, 1, 14000);

    scene.add(new T.HemisphereLight(0xe4f2ff, 0x5a7a40, 1.6));
    const sun = new T.DirectionalLight(0xfff1d8, 2.2);
    sun.position.set(-0.6, 1, -0.35);
    scene.add(sun);

    // Himmel: große Kugel mit Farbverlauf, wandert mit der Kamera
    const geo = new T.SphereGeometry(11000, 32, 16);
    const top = new T.Color(SKY_TOP), hor = new T.Color(SKY_HORIZON);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new T.Color();
    for (let i = 0; i < pos.count; i++) {
      const f = Math.max(0, pos.getY(i) / 11000);
      c.copy(hor).lerp(top, Math.pow(f, 0.6));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new T.BufferAttribute(colors, 3));
    sky = new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -1;
    scene.add(sky);
  }

  function resize(w, h, dpr) {
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(dpr, 1.75));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------
  // Strecke und Landschaft
  // ------------------------------------------------------------------
  /* Band entlang der Mittellinie zwischen zwei seitlichen Abständen. */
  function ribbon(track, inner, outer, y, period, mat) {
    const n = track.n;
    const reps = Math.max(1, Math.round(track.length / period));
    const pos = new Float32Array((n + 1) * 6);
    const nor = new Float32Array((n + 1) * 6);
    const uv = new Float32Array((n + 1) * 4);
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const v = (i / n) * reps;
      pos.set([
        track.x[k] + track.nx[k] * inner, y, track.y[k] + track.ny[k] * inner,
        track.x[k] + track.nx[k] * outer, y, track.y[k] + track.ny[k] * outer,
      ], i * 6);
      nor.set([0, 1, 0, 0, 1, 0], i * 6);
      uv.set([0, v, 1, v], i * 4);
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(nor, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return new T.Mesh(g, mat);
  }

  /* Ist ein Rechteck (Mittelpunkt, Radius) frei von der Strecke? */
  function clearOfTrack(track, px, py, radius) {
    const minD = track.width / 2 + radius;
    for (let i = 0; i < track.n; i += 2) {
      if ((track.x[i] - px) ** 2 + (track.y[i] - py) ** 2 < minD * minD) return false;
    }
    return true;
  }

  function buildWorld(track) {
    const W = track.width;
    const group = new T.Group();
    const b = track.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);

    // Wiese
    const groundSize = size + 9000;
    const grassTex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = track.def.grass;
      g.fillRect(0, 0, w, h);
      noise(g, w, h, 2600, 0.07, track.def.seed * 3);
    }, true);
    grassTex.repeat.set(groundSize / 260, groundSize / 260);
    const ground = new T.Mesh(new T.PlaneGeometry(groundSize, groundSize), new T.MeshLambertMaterial({ map: grassTex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -1.5, cz);
    group.add(ground);

    // Asphalt mit Randlinien und Mittelstreifen
    const roadTex = canvasTexture(128, 256, (g, w, h) => {
      g.fillStyle = '#55585e';
      g.fillRect(0, 0, w, h);
      noise(g, w, h, 1400, 0.06, 5);
      g.fillStyle = '#f2f2f2';
      g.fillRect(4, 0, 4, h);
      g.fillRect(w - 8, 0, 4, h);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillRect(w / 2 - 1.5, 0, 3, h * 0.45);
    }, true);
    group.add(ribbon(track, -W / 2, W / 2, ROAD_Y, 260, new T.MeshLambertMaterial({ map: roadTex, side: T.DoubleSide })));

    // Randsteine rot-weiß
    const curbTex = canvasTexture(8, 64, (g, w, h) => {
      g.fillStyle = '#d0312b';
      g.fillRect(0, 0, w, h / 2);
      g.fillStyle = '#f4f4f4';
      g.fillRect(0, h / 2, w, h / 2);
    }, true);
    const curbMat = new T.MeshLambertMaterial({ map: curbTex, side: T.DoubleSide });
    group.add(ribbon(track, -W / 2 - 12, -W / 2, ROAD_Y - 0.4, 48, curbMat));
    group.add(ribbon(track, W / 2, W / 2 + 12, ROAD_Y - 0.4, 48, curbMat));
    // Schmaler Kiesstreifen außen
    const gravelMat = new T.MeshLambertMaterial({ color: 0xb9a77f, side: T.DoubleSide });
    group.add(ribbon(track, -W / 2 - 26, -W / 2 - 12, ROAD_Y - 0.9, 100, gravelMat));
    group.add(ribbon(track, W / 2 + 12, W / 2 + 26, ROAD_Y - 0.9, 100, gravelMat));

    buildStartArea(track, group);
    buildTrees(track, group);
    buildMountains(track, group, cx, cz, size);

    group.visible = false;
    scene.add(group);
    return group;
  }

  function buildStartArea(track, group) {
    const W = track.width;
    const h0 = track.heading[0];
    const x0 = track.x[0], z0 = track.y[0];

    // Start-/Ziellinie
    const checker = canvasTexture(16, 128, (g, w, h) => {
      const s = 8;
      for (let yy = 0; yy < h; yy += s) {
        for (let xx = 0; xx < w; xx += s) {
          g.fillStyle = ((xx + yy) / s) % 2 === 0 ? '#ffffff' : '#111111';
          g.fillRect(xx, yy, s, s);
        }
      }
    });
    const lineGeo = new T.PlaneGeometry(16, W).rotateX(-Math.PI / 2);
    const line = new T.Mesh(lineGeo, new T.MeshLambertMaterial({ map: checker }));
    line.position.set(x0, ROAD_Y + 0.3, z0);
    line.rotation.y = -h0;
    group.add(line);

    // Startaufstellung
    const markMat = new T.MeshBasicMaterial({ color: 0xe8e8e8 });
    for (let slot = 0; slot < 4; slot++) {
      const back = 70 + slot * 62;
      const k = Math.round(back / track.spacing);
      const i = (track.n - k) % track.n;
      const lat = (slot % 2 === 0 ? -1 : 1) * W * 0.22;
      const m = new T.Group();
      m.add(box(2, 0.2, 34, markMat, 30, 0, 0));
      m.add(box(12, 0.2, 2, markMat, 25, 0, -16));
      m.add(box(12, 0.2, 2, markMat, 25, 0, 16));
      m.position.set(track.x[i] + track.nx[i] * lat, ROAD_Y + 0.25, track.y[i] + track.ny[i] * lat);
      m.rotation.y = -track.heading[i];
      group.add(m);
    }

    // Startbogen über der Strecke
    const gantry = new T.Group();
    const postMat = new T.MeshLambertMaterial({ color: 0x30343c });
    const half = W / 2 + 20;
    gantry.add(box(6, 82, 6, postMat, 0, 41, -half));
    gantry.add(box(6, 82, 6, postMat, 0, 41, half));
    const banner = canvasTexture(512, 64, (g, w, h) => {
      g.fillStyle = '#16181d';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < w; i += 16) {
        g.fillStyle = (i / 16) % 2 ? '#fff' : '#111';
        g.fillRect(i, 0, 16, 8);
        g.fillStyle = (i / 16) % 2 ? '#111' : '#fff';
        g.fillRect(i, h - 8, 16, 8);
      }
      g.fillStyle = '#ffb400';
      g.font = 'italic 900 34px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('START · ZIEL', w / 2, h / 2 + 1);
    });
    const bannerMats = [
      new T.MeshLambertMaterial({ map: banner }), new T.MeshLambertMaterial({ map: banner }),
      postMat, postMat, postMat, postMat,
    ];
    const bannerMesh = new T.Mesh(new T.BoxGeometry(5, 18, half * 2 + 6), bannerMats);
    // Text auf beiden Seiten lesbar ausrichten
    bannerMats[0].map = banner.clone();
    bannerMats[0].map.needsUpdate = true;
    bannerMats[0].map.wrapS = T.RepeatWrapping;
    bannerMats[0].map.repeat.x = -1;
    bannerMesh.position.y = 76;
    gantry.add(bannerMesh);
    gantry.position.set(x0, ROAD_Y, z0);
    gantry.rotation.y = -h0;
    group.add(gantry);

    // Tribüne neben der Startgeraden (auf der Seite, wo Platz ist)
    const fx = Math.cos(h0), fz = Math.sin(h0);
    for (const side of [1, -1]) {
      const lat = side * (W / 2 + 95);
      const along = 120;
      const gx = x0 + fx * along + track.nx[0] * lat;
      const gz = z0 + fz * along + track.ny[0] * lat;
      let free = true;
      for (const a of [-200, -100, 0, 100, 200]) {
        for (const l of [W / 2 + 80, W / 2 + 175]) {
          const px = x0 + fx * (along + a) + track.nx[0] * side * l;
          const pz = z0 + fz * (along + a) + track.ny[0] * side * l;
          if (!clearOfTrack(track, px, pz, 35)) free = false;
        }
      }
      if (!free) continue;
      const stand = new T.Group();
      const crowd = canvasTexture(256, 32, (g, w, h) => {
        g.fillStyle = '#3b3f4a';
        g.fillRect(0, 0, w, h);
        const rnd = seededRandom(track.def.seed + 99);
        const cols = ['#e74c3c', '#f1c40f', '#3498db', '#ecf0f1', '#2ecc71', '#e67e22', '#9b59b6'];
        for (let i = 0; i < 260; i++) {
          g.fillStyle = cols[Math.floor(rnd() * cols.length)];
          g.beginPath();
          g.arc(rnd() * w, 6 + rnd() * (h - 10), 2.4, 0, Math.PI * 2);
          g.fill();
        }
      });
      crowd.repeat.set(3, 1);
      crowd.wrapS = T.RepeatWrapping;
      const crowdMat = new T.MeshLambertMaterial({ map: crowd });
      const concrete = new T.MeshLambertMaterial({ color: 0x8d9099 });
      const len = 360;
      for (let s = 0; s < 4; s++) {
        // Stufen steigen nach außen an; Vorderseite (zur Strecke) zeigt das Publikum
        const mats = [concrete, concrete, concrete, concrete, concrete, concrete];
        mats[side > 0 ? 5 : 4] = crowdMat;
        const step = new T.Mesh(new T.BoxGeometry(len, 10 + s * 10, 18), mats);
        step.position.set(0, (10 + s * 10) / 2, side * (s * 18));
        stand.add(step);
      }
      const roofMat = new T.MeshLambertMaterial({ color: 0xc0392b });
      stand.add(box(len + 10, 3, 80, roofMat, 0, 72, side * 27));
      for (const px of [-len / 2, 0, len / 2]) stand.add(box(4, 72, 4, concrete, px, 36, side * 62));
      stand.position.set(gx, ROAD_Y - 0.8, gz);
      stand.rotation.y = -h0;
      group.add(stand);
      track.standPos = { x: gx, y: gz };
      break;
    }
  }

  function buildTrees(track, group) {
    const trees = track.trees.filter(t =>
      !track.standPos || (t.x - track.standPos.x) ** 2 + (t.y - track.standPos.y) ** 2 > 300 * 300);
    const cones = trees.filter(t => t.shade > 0.45);
    const rounds = trees.filter(t => t.shade <= 0.45);
    const m = new T.Matrix4();
    const q = new T.Quaternion();
    const s = new T.Vector3();
    const p = new T.Vector3();
    const col = new T.Color();

    const trunkGeo = new T.CylinderGeometry(0.5, 0.65, 1, 6).translate(0, 0.5, 0);
    const trunks = new T.InstancedMesh(trunkGeo, new T.MeshLambertMaterial({ color: 0x6b4a2b }), trees.length);
    trees.forEach((t, i) => {
      m.compose(p.set(t.x, 0, t.y), q.identity(), s.set(t.r * 0.25, t.r * (t.shade > 0.45 ? 0.6 : 1.1), t.r * 0.25));
      trunks.setMatrixAt(i, m);
    });
    group.add(trunks);

    const coneGeo = new T.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
    const coneMesh = new T.InstancedMesh(coneGeo, new T.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), cones.length);
    cones.forEach((t, i) => {
      m.compose(p.set(t.x, t.r * 0.45, t.y), q.identity(), s.set(t.r * 0.95, t.r * 2.8, t.r * 0.95));
      coneMesh.setMatrixAt(i, m);
      coneMesh.setColorAt(i, col.setHSL(0.31 + t.shade * 0.04, 0.5, 0.2 + (t.shade - 0.45) * 0.2));
    });
    group.add(coneMesh);

    const ballGeo = new T.IcosahedronGeometry(1, 1);
    const ballMesh = new T.InstancedMesh(ballGeo, new T.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), rounds.length);
    const qr = new T.Quaternion();
    rounds.forEach((t, i) => {
      qr.setFromAxisAngle(new T.Vector3(0, 1, 0), t.shade * 20);
      m.compose(p.set(t.x, t.r * 1.5, t.y), qr, s.set(t.r, t.r * 0.9, t.r));
      ballMesh.setMatrixAt(i, m);
      ballMesh.setColorAt(i, col.setHSL(0.27 + t.shade * 0.08, 0.45, 0.22 + t.shade * 0.15));
    });
    group.add(ballMesh);
  }

  function buildMountains(track, group, cx, cz, size) {
    const rnd = seededRandom(track.def.seed + 7);
    const R = size / 2 + 3200;
    const mat = new T.MeshLambertMaterial({ color: 0x9db8c4, flatShading: true, fog: false });
    const snow = new T.MeshLambertMaterial({ color: 0xf4f8fb, flatShading: true, fog: false });
    const count = 30;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd() * 0.2;
      const r = R + rnd() * 900;
      const h = 500 + rnd() * (track.def.id === 'bergpass' ? 1500 : 800);
      const rad = 700 + rnd() * 700;
      const mtn = new T.Mesh(new T.ConeGeometry(rad, h, 6 + Math.floor(rnd() * 3)), mat);
      mtn.position.set(cx + Math.cos(a) * r, h / 2 - 2, cz + Math.sin(a) * r);
      mtn.rotation.y = rnd() * Math.PI;
      group.add(mtn);
      if (h > 1000) {
        const capH = h * 0.22;
        const cap = new T.Mesh(new T.ConeGeometry(rad * 0.22, capH, mtn.geometry.parameters.radialSegments), snow);
        cap.position.set(mtn.position.x, h - capH / 2 - 1, mtn.position.z);
        cap.rotation.y = mtn.rotation.y;
        group.add(cap);
      }
    }
  }

  // ------------------------------------------------------------------
  // Autos
  // ------------------------------------------------------------------
  let shadowTex = null;
  function blobShadowTexture() {
    if (shadowTex) return shadowTex;
    shadowTex = canvasTexture(64, 64, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(0,0,0,0.55)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
    return shadowTex;
  }

  function buildCarModel(def) {
    const { length: L, width: W } = carSize(def);
    const sp = SHAPES[def.shape] || SHAPES.classic;
    const group = new T.Group();
    const paint = new T.MeshPhongMaterial({ color: def.color, shininess: 90, specular: 0x555555 });
    const accent = new T.MeshPhongMaterial({ color: def.accent, shininess: 60 });
    const dark = new T.MeshLambertMaterial({ color: 0x1b1c20 });
    const glass = new T.MeshPhongMaterial({ color: 0x1c2a3c, shininess: 120, specular: 0x8899aa });
    const tail = new T.MeshBasicMaterial({ color: 0x6e1010 });
    const head = new T.MeshBasicMaterial({ color: 0xfff4c2 });

    const bodyTop = CLEARANCE + sp.bodyH;
    const cabLen = L * sp.cabLen;
    const cabX = L * sp.cabOff;
    const cabW = W * sp.cabW;

    // Schatten
    const shadow = new T.Mesh(new T.PlaneGeometry(L * 1.35, W * 1.7).rotateX(-Math.PI / 2),
      new T.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }));
    shadow.position.y = 0.3;
    group.add(shadow);

    // Karosserie mit Stoßstangen
    group.add(box(L - 2, sp.bodyH, W, paint, 0, CLEARANCE + sp.bodyH / 2, 0));
    group.add(box(2, sp.bodyH * 0.6, W - 2, dark, L / 2 - 1, CLEARANCE + sp.bodyH * 0.3, 0));
    group.add(box(2, sp.bodyH * 0.6, W - 2, dark, -L / 2 + 1, CLEARANCE + sp.bodyH * 0.3, 0));

    // Lichter
    for (const z of [-W / 2 + 3.5, W / 2 - 3.5]) {
      group.add(box(0.6, 2.2, 4, head, L / 2 - 0.8, CLEARANCE + sp.bodyH * 0.68, z));
      group.add(box(0.6, 2.2, 4, tail, -L / 2 + 0.8, CLEARANCE + sp.bodyH * 0.68, z));
    }

    // Oberteil (Fahrgastzelle). Im Cockpit-Modus wird es beim eigenen Auto ausgeblendet.
    const upper = new T.Group();
    upper.add(box(cabLen, sp.cabH, cabW, glass, cabX, bodyTop + sp.cabH / 2, 0));
    upper.add(box(cabLen * 0.8, 1.4, cabW + 0.4, paint, cabX - cabLen * 0.05, bodyTop + sp.cabH + 0.5, 0));
    group.add(upper);

    // Bauform-Details
    if (def.shape === 'sport') {
      group.add(box(L - 2.2, 0.4, 4, accent, 0, bodyTop + 0.2, 0));
      upper.add(box(cabLen * 0.8, 0.3, 4, accent, cabX - cabLen * 0.05, bodyTop + sp.cabH + 1.35, 0));
      upper.add(box(4, 1, W, dark, -L / 2 + 3, bodyTop + 4.5, 0));
      upper.add(box(1.5, 4, 1.5, dark, -L / 2 + 3, bodyTop + 2, -W / 2 + 4));
      upper.add(box(1.5, 4, 1.5, dark, -L / 2 + 3, bodyTop + 2, W / 2 - 4));
    } else if (def.shape === 'classic') {
      for (const z of [-3.5, 3.5]) {
        group.add(box(L - 2.2, 0.4, 2.2, accent, 0, bodyTop + 0.2, z));
        upper.add(box(cabLen * 0.8, 0.3, 2.2, accent, cabX - cabLen * 0.05, bodyTop + sp.cabH + 1.35, z));
      }
    } else if (def.shape === 'low') {
      for (const z of [-W / 2 - 0.15, W / 2 + 0.15]) group.add(box(L - 8, 1.6, 0.3, accent, 0, CLEARANCE + sp.bodyH * 0.55, z));
    } else if (def.shape === 'compact') {
      const dot = new T.Mesh(new T.CylinderGeometry(3.5, 3.5, 0.4, 16), accent);
      dot.position.set(cabX - cabLen * 0.05, bodyTop + sp.cabH + 1.3, 0);
      upper.add(dot);
    } else if (def.shape === 'heavy') {
      const rack = new T.MeshLambertMaterial({ color: 0xcfd3d8 });
      for (const dx of [-5, 0, 5]) upper.add(box(1, 1, cabW - 1, rack, cabX + dx, bodyTop + sp.cabH + 2, 0));
      for (const z of [-cabW / 2 + 1, cabW / 2 - 1]) upper.add(box(cabLen * 0.7, 1, 1, rack, cabX, bodyTop + sp.cabH + 2.5, z));
    }

    // Räder (vordere lenken mit)
    const wheelGeo = new T.CylinderGeometry(WHEEL_R, WHEEL_R, 4, 14).rotateX(Math.PI / 2);
    const hubGeo = new T.CylinderGeometry(2.3, 2.3, 4.4, 6).rotateX(Math.PI / 2);
    const hubMat = new T.MeshLambertMaterial({ color: 0xb8bcc4 });
    const wheels = [];
    const frontPivots = [];
    const wx = L / 2 - 9;
    for (const x of [wx, -wx]) {
      for (const z of [-W / 2 + 1.5, W / 2 - 1.5]) {
        const pivot = new T.Group();
        pivot.position.set(x, WHEEL_R, z);
        const wheel = new T.Group();
        wheel.add(new T.Mesh(wheelGeo, dark));
        wheel.add(new T.Mesh(hubGeo, hubMat));
        pivot.add(wheel);
        group.add(pivot);
        wheels.push(wheel);
        if (x > 0) frontPivots.push(pivot);
      }
    }

    const eye = new T.Vector3(cabX + cabLen * 0.1, bodyTop + sp.cabH * 0.9, 0);
    return { group, upper, wheels, frontPivots, tail, eye, spin: 0, cockpit: null, sp, L, W, cabW, cabLen, cabX, bodyTop };
  }

  /* Armaturenbrett, Lenkrad und Dachrahmen für die Sicht aus dem Fahrersitz. */
  function buildCockpit(view) {
    const g = new T.Group();
    const e = view.eye;
    const dash = new T.MeshLambertMaterial({ color: 0x24262c });
    const trim = new T.MeshLambertMaterial({ color: 0x15161a });
    const half = view.cabW / 2;
    const roofY = view.bodyTop + view.sp.cabH;

    // Armaturenbrett unten im Blickfeld, darüber bleibt die Motorhaube sichtbar
    g.add(box(3, 2.5, view.cabW, dash, e.x + 9, e.y - 4.7, 0));
    // Innenraum unterhalb (sichtbar bei weitem Sichtfeld im Hochformat)
    g.add(box(3, 4, view.cabW, trim, e.x + 9, e.y - 7.9, 0));
    g.add(box(13, 1, view.cabW, trim, e.x + 2, view.bodyTop + 0.6, 0));
    const gauge = new T.MeshBasicMaterial({ color: 0x0d0e10 });
    const needle = new T.MeshBasicMaterial({ color: 0xff5a36 });
    for (const z of [-1.3, 1.3]) {
      const c = new T.Mesh(new T.CylinderGeometry(0.75, 0.75, 0.2, 16).rotateZ(Math.PI / 2), gauge);
      c.position.set(e.x + 7.45, e.y - 4.15, z);
      g.add(c);
      g.add(box(0.1, 0.6, 0.08, needle, e.x + 7.3, e.y - 3.95, z));
    }

    // Lenkrad
    const wheelPivot = new T.Group();
    wheelPivot.position.set(e.x + 6, e.y - 2.8, 0);
    wheelPivot.rotation.z = 0.35;
    const wheel = new T.Group();
    wheel.add(new T.Mesh(new T.TorusGeometry(1.2, 0.17, 8, 28).rotateY(Math.PI / 2), trim));
    wheel.add(box(0.2, 0.25, 2.3, trim, 0, 0, 0));
    wheel.add(box(0.2, 1.2, 0.3, trim, 0, -0.6, 0));
    wheel.add(box(0.25, 0.4, 0.4, new T.MeshBasicMaterial({ color: 0xffb400 }), 0.02, 1.13, 0));
    wheelPivot.add(wheel);
    g.add(wheelPivot);

    // A-Säulen
    for (const s of [-1, 1]) {
      g.add(beam(new T.Vector3(e.x + 10, e.y - 3.5, s * half), new T.Vector3(e.x + 3, roofY + 1, s * (half - 0.4)), 0.5, trim));
    }

    view.group.add(g);
    view.cockpit = g;
    view.steeringWheel = wheel;
  }

  function viewFor(car) {
    let v = carViews.get(car.def.id);
    if (!v) {
      v = buildCarModel(car.def);
      v.group.visible = false;
      scene.add(v.group);
      carViews.set(car.def.id, v);
    }
    return v;
  }

  // ------------------------------------------------------------------
  // Bild zeichnen
  // ------------------------------------------------------------------
  /* mode: 'cockpit' oder 'chase' */
  function render(race, dt, mode) {
    if (!renderer) return;
    const t = race.track;
    let world = worlds.get(t);
    if (!world) {
      world = buildWorld(t);
      worlds.set(t, world);
    }
    if (activeWorld !== world) {
      if (activeWorld) activeWorld.visible = false;
      world.visible = true;
      activeWorld = world;
      cam.init = false;
    }

    const used = new Set();
    const follow = race.follow;
    const cockpit = mode === 'cockpit' && !race.demo;
    for (const car of race.cars) {
      const v = viewFor(car);
      used.add(v);
      v.group.visible = true;
      v.group.position.set(car.x, ROAD_Y, car.y);
      v.group.rotation.y = -car.angle;
      v.spin -= (car.vF * dt) / WHEEL_R;
      for (const w of v.wheels) w.rotation.z = v.spin;
      for (const p of v.frontPivots) p.rotation.y = -car.steer * 0.45;
      const braking = car.brake > 0.1 && car.vF > 10;
      v.tail.color.setHex(braking ? 0xff2a2a : 0x6e1010);
      const inside = cockpit && car === follow;
      v.upper.visible = !inside;
      if (inside && !v.cockpit) buildCockpit(v);
      if (v.cockpit) {
        v.cockpit.visible = inside;
        if (inside) v.steeringWheel.rotation.x = car.steer * 1.7;
      }
    }
    for (const v of carViews.values()) if (!used.has(v)) v.group.visible = false;

    updateCamera(race, dt, cockpit ? 'cockpit' : 'chase');
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
  }

  function updateCamera(race, dt, mode) {
    const car = race.follow;
    const v = viewFor(car);
    const fx = Math.cos(car.angle), fz = Math.sin(car.angle);
    const speedRatio = Math.min(1, Math.abs(car.vF) / car.phys.maxSpeed);

    if (cam.follow !== car) {
      cam.follow = car;
      cam.init = false;
    }

    let baseFov;
    if (mode === 'cockpit') {
      const e = v.eye;
      cam.shake = car.onGrass ? Math.min(1, Math.abs(car.vF) / 200) : cam.shake * Math.exp(-dt * 8);
      const sx = (Math.random() - 0.5) * cam.shake * 0.8;
      const sy = (Math.random() - 0.5) * cam.shake * 0.8;
      camera.position.set(car.x + fx * e.x, ROAD_Y + e.y + sy, car.y + fz * e.x);
      camera.position.x += -fz * sx;
      camera.position.z += fx * sx;
      // Im Hochformat (großes Sichtfeld) etwas nach unten schauen, damit weniger Himmel zu sehen ist
      const pitch = 1 + Math.max(0, camera.fov - 60) * 0.25;
      camera.lookAt(camera.position.x + fx * 100, camera.position.y - pitch, camera.position.z + fz * 100);
      cam.yaw = car.angle;
      baseFov = 50;
    } else {
      // Verfolgerkamera: Blickrichtung folgt dem Auto mit etwas Verzögerung
      if (!cam.init) cam.yaw = car.angle;
      let d = car.angle - cam.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      cam.yaw += d * (1 - Math.exp(-dt * 5));
      const cx = Math.cos(cam.yaw), cz = Math.sin(cam.yaw);
      const dist = race.demo ? 110 : 88;
      const height = race.demo ? 42 : 32;
      camera.position.set(car.x - cx * dist, ROAD_Y + height, car.y - cz * dist);
      camera.lookAt(car.x + cx * 40, ROAD_Y + 10, car.y + cz * 40);
      baseFov = 62;
    }
    cam.init = true;

    // Im Hochformat das Sichtfeld weiter machen, damit man genug von der Strecke sieht
    const minHFov = 80 * Math.PI / 180;
    const neededV = 2 * Math.atan(Math.tan(minHFov / 2) / camera.aspect) * 180 / Math.PI;
    const fov = Math.min(100, Math.max(baseFov, neededV)) + speedRatio * 8;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  /* Vorschaubild eines Autos für das Auswahlmenü (als Daten-URL). */
  function carThumbnails(defs, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    let r;
    try {
      r = new T.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) {
      return defs.map(() => null);
    }
    r.outputColorSpace = T.SRGBColorSpace;
    const s = new T.Scene();
    s.add(new T.HemisphereLight(0xe4f2ff, 0x404040, 2));
    const sun = new T.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-0.4, 1, 0.8);
    s.add(sun);
    const camT = new T.PerspectiveCamera(30, w / h, 1, 1000);
    camT.position.set(44, 34, 56);
    camT.lookAt(0, 7, 0);
    const out = defs.map(def => {
      const v = buildCarModel(def);
      v.group.rotation.y = 0.35;
      s.add(v.group);
      r.render(s, camT);
      const url = c.toDataURL('image/png');
      s.remove(v.group);
      return url;
    });
    r.dispose();
    r.forceContextLoss();
    return out;
  }

  return { init, resize, render, carThumbnails, get ready() { return !!renderer; } };
})();
