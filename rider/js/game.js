'use strict';
/*
 * Spielablauf: Menüs, Eingabe (Tastatur, Touch, Gamepad), Reitphysik,
 * geteilter Bildschirm, Sammeln und Entdecken, Speichern.
 */
(() => {
  const $ = id => document.getElementById(id);
  const SAVE_KEY = 'rider-save-v1';
  const SETUP_KEY = 'rider-setup-v1';

  // ------------------------------------------------------------ Einstellungen
  const GAIT_NAMES = ['Halt', 'Schritt', 'Trab', 'Galopp'];
  const GAIT_SPEED = { '-1': -1.2, 0: 0, 1: 1.9, 2: 4.8, 3: 11.5 };   // m/s
  const TURN_RATE = { '-1': 1.0, 0: 1.5, 1: 1.45, 2: 1.2, 3: 0.95 };  // rad/s
  const JUMP_TIME = 0.8;
  const HORSE_R = 0.85;

  const RIDERS = [
    { hair: 'blond', name: 'Lotta', horse: 'Sternchen', coat: 'fuchs', jacket: '#4f9fe0', pad: '#d6457a', color: '#e0457f' },
    { hair: 'red', name: 'Ronja', horse: 'Blitz', coat: 'schimmel', jacket: '#3c8d5a', pad: '#2f9e4f', color: '#2c9be0' },
  ];

  let setup = { count: 2, riders: [{}, {}] };
  try {
    const s = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
    if (s && s.riders) setup = s;
  } catch (e) { /* egal */ }
  for (let i = 0; i < 2; i++) {
    setup.riders[i] = Object.assign({}, { name: RIDERS[i].name, horse: RIDERS[i].horse, coat: RIDERS[i].coat, hair: RIDERS[i].hair }, setup.riders[i] || {});
  }
  if (setup.count !== 1 && setup.count !== 2) setup.count = 2;

  let save = loadSave();
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s && s.v === 1) return s;
    } catch (e) { /* egal */ }
    return { v: 1, shoes: [], disc: [], jumps: 0, eaten: 0, pos: null };
  }
  function writeSave() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* egal */ }
  }
  function writeSetup() {
    try { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch (e) { /* egal */ }
  }

  // ------------------------------------------------------------ Grafik
  const canvas = $('game');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    $('webgl-error').hidden = false;
    $('btn-start').disabled = true;
    return;
  }
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0xbfd9ee);

  const scene = new THREE.Scene();
  const SKY = new THREE.Color('#bcd6ea');
  scene.fog = new THREE.Fog(SKY, 220, 900);
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x7d8a55, 1.25));
  const sun = new THREE.DirectionalLight(0xfff1d8, 1.9);
  sun.position.set(-0.45, 1, 0.35);
  scene.add(sun);

  // Himmel als Kuppel mit Farbverlauf, wandert mit der Kamera
  const skyGeo = new THREE.SphereGeometry(1400, 24, 12);
  {
    const col = [];
    const p = skyGeo.attributes.position;
    const top = new THREE.Color('#5d9be0'), hor = new THREE.Color('#cfe2f0');
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, p.getY(i) / 1400);
      const c = hor.clone().lerp(top, Math.pow(t, 0.6));
      col.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -20;
  scene.add(sky);
  // ein paar Wolken
  const clouds = new THREE.Group();
  {
    const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.92, depthWrite: false });
    const cg = new THREE.SphereGeometry(1, 10, 6);
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * Math.PI * 2 + Math.random() * 0.2;
      const d = 900 + Math.random() * 300;
      const c = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(cg, cm);
        s.scale.set(50 + Math.random() * 40, 16 + Math.random() * 8, 40 + Math.random() * 20);
        s.position.set((k - 1.5) * 45 + Math.random() * 20, Math.random() * 10, Math.random() * 30);
        c.add(s);
      }
      c.position.set(Math.cos(a) * d, 260 + Math.random() * 160, Math.sin(a) * d);
      c.lookAt(0, c.position.y, 0);
      clouds.add(c);
    }
    clouds.renderOrder = -19;
    scene.add(clouds);
  }

  // ------------------------------------------------------------ Gegenstände (Hufeisen, Futter)
  let shoeMesh = null, appleMesh = null, carrotMesh = null;
  function buildItemMeshes() {
    const shoeGeo = new THREE.TorusGeometry(0.42, 0.09, 8, 20, Math.PI * 1.55);
    shoeGeo.rotateZ(-Math.PI / 2 - Math.PI * 0.775 + Math.PI);
    const shoeMat = new THREE.MeshLambertMaterial({ color: 0xffc928, emissive: 0x7a5200 });
    shoeMesh = new THREE.InstancedMesh(shoeGeo, shoeMat, World.items.shoes.length);
    shoeMesh.frustumCulled = false;
    scene.add(shoeMesh);
    const appleGeo = new THREE.SphereGeometry(0.28, 12, 10);
    appleMesh = new THREE.InstancedMesh(appleGeo, new THREE.MeshLambertMaterial({ color: 0xd7302a, emissive: 0x3a0505 }), World.items.food.length);
    appleMesh.frustumCulled = false;
    scene.add(appleMesh);
    const carrotGeo = new THREE.ConeGeometry(0.13, 0.7, 8);
    carrotGeo.rotateX(Math.PI);
    carrotMesh = new THREE.InstancedMesh(carrotGeo, new THREE.MeshLambertMaterial({ color: 0xf08a1c, emissive: 0x3a1a00 }), World.items.food.length);
    carrotMesh.frustumCulled = false;
    scene.add(carrotMesh);
    // grünes Kraut als eigene Instanzen
    const leafGeo = new THREE.ConeGeometry(0.12, 0.3, 5);
    leafGeo.translate(0, 0.5, 0);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x3f9a3a }), World.items.food.length);
    leaves.frustumCulled = false;
    carrotMesh.userData.leaves = leaves;
    scene.add(leaves);
  }

  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();
  const ZERO = new THREE.Vector3(0, 0, 0);
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  function updateItemMeshes(time) {
    const shoes = World.items.shoes;
    for (let i = 0; i < shoes.length; i++) {
      const s = shoes[i];
      if (s.got) { tmpM.makeScale(0, 0, 0); shoeMesh.setMatrixAt(i, tmpM); continue; }
      tmpQ.setFromAxisAngle(Y_AXIS, time * 1.8 + i);
      tmpM.compose(tmpV.set(s.x, s.z + Math.sin(time * 2 + i) * 0.12, s.y), tmpQ, tmpS.set(1, 1, 1));
      shoeMesh.setMatrixAt(i, tmpM);
    }
    shoeMesh.instanceMatrix.needsUpdate = true;
    const food = World.items.food;
    const leaves = carrotMesh.userData.leaves;
    for (let i = 0; i < food.length; i++) {
      const f = food[i];
      const show = f.respawn <= 0;
      const hide = tmpM.makeScale(0, 0, 0).clone();
      tmpQ.setFromAxisAngle(Y_AXIS, time * 1.2 + i);
      tmpM.compose(tmpV.set(f.x, f.z + Math.sin(time * 2.2 + i) * 0.1, f.y), tmpQ, tmpS.set(1, 1, 1));
      if (f.kind === 'apple') {
        appleMesh.setMatrixAt(i, show ? tmpM : hide);
        carrotMesh.setMatrixAt(i, hide);
        leaves.setMatrixAt(i, hide);
      } else {
        appleMesh.setMatrixAt(i, hide);
        carrotMesh.setMatrixAt(i, show ? tmpM : hide);
        leaves.setMatrixAt(i, show ? tmpM : hide);
      }
    }
    appleMesh.instanceMatrix.needsUpdate = true;
    carrotMesh.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ Spielerinnen
  let players = [];
  let running = false, paused = false, mapOpen = false;
  let worldReady = false;
  const discovered = new Set();

  function nameTag(text, color) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d');
    g.font = 'bold 34px system-ui, sans-serif';
    const w = Math.min(250, g.measureText(text).width + 30);
    g.fillStyle = 'rgba(20,20,30,0.6)';
    const x = (256 - w) / 2;
    g.beginPath();
    g.roundRect ? g.roundRect(x, 8, w, 48, 24) : g.rect(x, 8, w, 48);
    g.fill();
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 33);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, fog: false }));
    sp.scale.set(2.4, 0.6, 1);
    sp.renderOrder = 10;
    return sp;
  }

  function createPlayers() {
    for (const p of players) {
      scene.remove(p.model.root);
      if (p.hud) p.hud.root.remove();
    }
    players = [];
    $('views').innerHTML = '';
    const spawn = World.spawnPoint();
    for (let i = 0; i < setup.count; i++) {
      const cfg = setup.riders[i];
      const hairIdx = cfg.hair === 'red' ? 1 : 0;
      const look = RIDERS[hairIdx];
      const model = Horses.create({ coat: cfg.coat, hair: cfg.hair, jacket: look.jacket, pad: look.pad });
      scene.add(model.root);
      const tag = nameTag(cfg.name, look.color);
      tag.position.set(0, 3.3, 0);
      tag.layers.set(1 + i);
      model.root.add(tag);
      const cam = new THREE.PerspectiveCamera(60, 1, 0.3, 1500);
      cam.layers.enable(0);
      for (let j = 0; j < setup.count; j++) if (j !== i) cam.layers.enable(1 + j);
      const side = setup.count === 2 ? (i === 0 ? -1.6 : 1.6) : 0;
      const p = {
        idx: i, name: cfg.name, horseName: cfg.horse, hair: cfg.hair, color: look.color,
        model, cam,
        x: spawn.x + Math.cos(spawn.heading) * side, y: spawn.y + Math.sin(spawn.heading) * side, heading: spawn.heading,
        speed: 0, gait: 0, stamina: 1, jumpT: -1, jumpY: 0, jumpH: 1.2, steer: 0,
        camYaw: spawn.heading, camPos: new THREE.Vector3(), camInit: false,
        msgT: 0, bannerT: 0, regionT: 0, region: '', lastCleared: null, bumpT: 0, hintT: 0, surface: 'ground',
        tiredShown: false,
        input: { up: false, down: false, left: false, right: false, jump: false, touchSteer: 0, padSteer: 0 },
      };
      const saved = save.pos && save.pos[i];
      if (saved && World.insideBoundary(saved.x, saved.y)) { p.x = saved.x; p.y = saved.y; p.heading = p.camYaw = saved.h; }
      p.hud = makeHud(p);
      players.push(p);
    }
    layout();
  }

  // ------------------------------------------------------------ Anzeige je Spielerin
  function makeHud(p) {
    const root = $('tpl-hud').content.firstElementChild.cloneNode(true);
    $('views').appendChild(root);
    root.querySelector('.p-rider').textContent = p.name;
    root.querySelector('.p-rider').style.color = p.color;
    root.querySelector('.p-horse').textContent = p.horseName;
    const h = {
      root,
      region: root.querySelector('.p-region'),
      gaits: [...root.querySelectorAll('.gaits span')],
      stamina: root.querySelector('.stamina-fill'),
      mini: root.querySelector('.minimap'),
      msg: root.querySelector('.p-msg'),
      banner: root.querySelector('.p-banner'),
      touch: root.querySelector('.p-touch'),
    };
    if (isTouch) {
      h.touch.hidden = false;
      setupTouch(p, h.touch);
    }
    return h;
  }

  function layout() {
    const W = window.innerWidth, H = window.innerHeight;
    renderer.setSize(W, H);
    const n = players.length;
    const sideBySide = n === 2 && W >= H * 1.05;
    document.body.classList.toggle('split-v', n === 2 && sideBySide);
    document.body.classList.toggle('split-h', n === 2 && !sideBySide);
    players.forEach((p, i) => {
      let r;
      if (n === 1) r = { x: 0, y: 0, w: W, h: H };
      else if (sideBySide) r = { x: i * W / 2, y: 0, w: W / 2, h: H };
      else r = { x: 0, y: i * H / 2, w: W, h: H / 2 };
      p.rect = r;
      const aspect = r.w / r.h;
      // horizontales Sichtfeld etwa 80°, senkrecht begrenzt
      const vfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(40)) / aspect);
      p.cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(vfov), 48, 74);
      p.cam.aspect = aspect;
      p.cam.updateProjectionMatrix();
      const s = p.hud.root.style;
      s.left = r.x + 'px'; s.top = r.y + 'px'; s.width = r.w + 'px'; s.height = r.h + 'px';
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = Math.round(Math.max(110, Math.min(170, Math.min(r.w, r.h) * 0.26)));
      p.hud.mini.style.width = p.hud.mini.style.height = size + 'px';
      p.hud.mini.width = p.hud.mini.height = Math.round(size * dpr);
      p.hud.mini._dpr = dpr;
    });
  }
  window.addEventListener('resize', () => { if (players.length) layout(); else renderer.setSize(window.innerWidth, window.innerHeight); });

  function showMsg(p, text, time) {
    p.hud.msg.textContent = text;
    p.hud.msg.hidden = false;
    p.msgT = time || 2.5;
  }
  function showBanner(p, title, sub) {
    p.hud.banner.innerHTML = '';
    const a = document.createElement('div');
    a.className = 'b-sub';
    a.textContent = sub;
    const b = document.createElement('div');
    b.className = 'b-title';
    b.textContent = title;
    p.hud.banner.append(a, b);
    p.hud.banner.hidden = false;
    p.hud.banner.classList.remove('pop');
    void p.hud.banner.offsetWidth;
    p.hud.banner.classList.add('pop');
    p.bannerT = 3.5;
  }

  // ------------------------------------------------------------ Eingabe: Tastatur
  const keyMap = {
    KeyW: [0, 'up'], KeyS: [0, 'down'], KeyA: [0, 'left'], KeyD: [0, 'right'], Space: [0, 'jump'],
    ArrowUp: [1, 'up'], ArrowDown: [1, 'down'], ArrowLeft: [1, 'left'], ArrowRight: [1, 'right'],
    Enter: [1, 'jump'], NumpadEnter: [1, 'jump'], ShiftRight: [1, 'jump'], Numpad0: [1, 'jump'],
  };
  function playerFor(slot) {
    if (!players.length) return null;
    return players.length === 1 ? players[0] : players[slot];
  }
  function press(p, act) {
    if (!p || paused || mapOpen) return;
    if (act === 'up') gaitUp(p);
    else if (act === 'down') gaitDown(p);
    else if (act === 'jump') tryJump(p);
  }
  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT') return;
    Sound.init();
    if (running) {
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (mapOpen) closeMap(); else togglePause();
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyK' || e.code === 'Tab') { e.preventDefault(); if (mapOpen) closeMap(); else if (!paused) openMap(); return; }
      if (e.code === 'KeyM') { toggleMute(); return; }
    }
    const m = keyMap[e.code];
    if (m && running) {
      e.preventDefault();
      const p = playerFor(m[0]);
      if (!p) return;
      if (m[1] === 'left' || m[1] === 'right') p.input[m[1] + m[0]] = true;
      else if (!e.repeat) press(p, m[1]);
    }
  });
  window.addEventListener('keyup', e => {
    const m = keyMap[e.code];
    if (m && running) {
      const p = playerFor(m[0]);
      if (p && (m[1] === 'left' || m[1] === 'right')) p.input[m[1] + m[0]] = false;
    }
  });
  window.addEventListener('blur', () => {
    for (const p of players) for (const k of Object.keys(p.input)) if (/^(left|right)/.test(k)) p.input[k] = false;
  });

  // ------------------------------------------------------------ Eingabe: Touch
  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (isTouch) document.body.classList.add('touch');

  function setupTouch(p, el) {
    for (const btn of el.querySelectorAll('.t-btn')) {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        Sound.init();
        btn.classList.add('active');
        press(p, btn.dataset.act);
      });
      for (const t of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(t, () => btn.classList.remove('active'));
      btn.addEventListener('contextmenu', e => e.preventDefault());
    }
    const steer = el.querySelector('.steer'), knob = el.querySelector('.steer-knob');
    let pid = null;
    const setX = x => {
      const r = steer.getBoundingClientRect();
      const half = (r.width - knob.offsetWidth) / 2;
      const raw = Math.max(-1, Math.min(1, (x - (r.left + r.width / 2)) / half));
      knob.style.transform = `translateX(${raw * half}px)`;
      p.input.touchSteer = Math.sign(raw) * Math.pow(Math.abs(raw), 1.2);
    };
    const release = () => {
      pid = null;
      p.input.touchSteer = 0;
      knob.classList.remove('active');
      knob.style.transform = 'translateX(0px)';
    };
    steer.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (pid !== null) return;
      pid = e.pointerId;
      try { steer.setPointerCapture(pid); } catch (err) { /* egal */ }
      knob.classList.add('active');
      setX(e.clientX);
    });
    steer.addEventListener('pointermove', e => { if (e.pointerId === pid) setX(e.clientX); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) steer.addEventListener(t, e => { if (e.pointerId === pid) release(); });
    steer.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ------------------------------------------------------------ Eingabe: Gamepad
  const padPrev = [];
  function pollPads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let slot = 0;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const p = playerFor(slot);
      const prev = padPrev[slot] || {};
      const b = i => !!(pad.buttons[i] && pad.buttons[i].pressed);
      const ay = pad.axes[1] || 0;
      const now = {
        up: b(12) || b(5) || b(7) || ay < -0.65,
        down: b(13) || b(4) || b(6) || b(1) || ay > 0.65,
        jump: b(0) || b(2),
        pause: b(9),
        map: b(8) || b(3),
      };
      if (p) {
        const ax = pad.axes[0] || 0;
        p.input.padSteer = Math.abs(ax) > 0.15 ? ax : (b(14) ? -1 : b(15) ? 1 : 0);
        if (now.up && !prev.up) press(p, 'up');
        if (now.down && !prev.down) press(p, 'down');
        if (now.jump && !prev.jump) press(p, 'jump');
      }
      if (running && now.pause && !prev.pause) { if (mapOpen) closeMap(); else togglePause(); }
      if (running && now.map && !prev.map && !paused) { if (mapOpen) closeMap(); else openMap(); }
      padPrev[slot] = now;
      slot++;
    }
  }

  // ------------------------------------------------------------ Reiten
  function gaitUp(p) {
    if (p.gait < 0) { p.gait = 0; return; }
    if (p.gait >= 3) return;
    if (p.gait === 2 && p.stamina < 0.12) { showMsg(p, `${p.horseName} ist zu müde zum Galoppieren. Im Schritt erholt sich ${p.horseName}.`, 3); return; }
    p.gait++;
    if (p.gait === 3 && Math.random() < 0.35) Sound.whinny();
  }
  function gaitDown(p) {
    if (p.gait > 0) p.gait--;
    else if (p.gait === 0 && Math.abs(p.speed) < 0.3) p.gait = -1;
  }
  function tryJump(p) {
    if (p.jumpT >= 0) return;
    if (p.gait < 2 || p.speed < 3) {
      showMsg(p, 'Zum Springen erst traben oder galoppieren!', 2.2);
      return;
    }
    p.jumpT = 0;
    p.jumpH = p.gait === 3 ? 1.55 : 1.15;
    p.lastCleared = null;
    Sound.jump();
  }

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function stepPlayer(p, dt) {
    const inp = p.input;
    const slot = players.length === 1 ? null : p.idx;
    let key = 0;
    if (slot === null) {
      key = (inp.right0 || inp.right1 ? 1 : 0) - (inp.left0 || inp.left1 ? 1 : 0);
    } else {
      key = (inp['right' + slot] ? 1 : 0) - (inp['left' + slot] ? 1 : 0);
    }
    const target = THREE.MathUtils.clamp(key + inp.touchSteer + inp.padSteer, -1, 1);
    p.steer += (target - p.steer) * Math.min(1, dt * 8);

    // Ausdauer
    if (p.gait === 3 && p.speed > 6) p.stamina -= dt / 45;
    else if (p.gait === 2) p.stamina += dt / 70;
    else if (p.gait === 1) p.stamina += dt / 18;
    else p.stamina += dt / 10;
    p.stamina = THREE.MathUtils.clamp(p.stamina, 0, 1);
    if (p.gait === 3 && p.stamina <= 0.02) {
      p.gait = 2;
      showMsg(p, `${p.horseName} ist müde und fällt in den Trab. Äpfel und Möhren geben neue Kraft!`, 3.5);
      Sound.snort();
    }

    // Untergrund
    const surf = World.surface(p.x, p.y);
    p.surface = surf.kind;
    let targetSpeed = GAIT_SPEED[p.gait];
    if (surf.f < 1) targetSpeed = Math.sign(targetSpeed) * Math.min(Math.abs(targetSpeed), 2.4 * surf.f / 0.5);
    const acc = Math.abs(targetSpeed) > Math.abs(p.speed) ? 3.2 : 6;
    p.speed += THREE.MathUtils.clamp(targetSpeed - p.speed, -acc * dt, acc * dt);

    // Lenken
    const rate = TURN_RATE[p.gait] * (p.jumpT >= 0 ? 0.3 : 1);
    p.heading += p.steer * rate * dt;
    if (p.heading > Math.PI) p.heading -= Math.PI * 2;
    if (p.heading < -Math.PI) p.heading += Math.PI * 2;

    // Bewegen
    const ox = p.x, oy = p.y;
    p.x += Math.sin(p.heading) * p.speed * dt;
    p.y += -Math.cos(p.heading) * p.speed * dt;

    // Sprung
    if (p.jumpT >= 0) {
      p.jumpT += dt / JUMP_TIME;
      if (p.jumpT >= 1) {
        p.jumpT = -1;
        p.jumpY = 0;
        Sound.land();
      } else {
        p.jumpY = p.jumpH * Math.sin(Math.PI * p.jumpT);
      }
    }

    // Kollision
    const pos = { x: p.x, y: p.y };
    const res = World.collide(pos, HORSE_R, p.jumpY);
    p.x = pos.x; p.y = pos.y;
    if (res.building) {
      p.speed *= Math.pow(0.1, dt);
      if (p.bumpT <= 0 && Math.abs(p.speed) > 3) { Sound.bump(); p.bumpT = 0.6; }
    }
    if (res.obstacle) {
      if (p.speed > 2.5) {
        p.speed = 1;
        p.gait = 1;
        Sound.snort();
        showMsg(p, `${p.horseName} bleibt vor dem Hindernis stehen. Anreiten und mit Sprung drüber!`, 3);
      }
    }
    if (res.cleared && res.cleared !== p.lastCleared && p.jumpT >= 0) {
      p.lastCleared = res.cleared;
      save.jumps++;
      p.jumps = (p.jumps || 0) + 1;
      if (p.hintT <= 0) { showMsg(p, ['Super Sprung!', 'Toll gesprungen!', 'Wie ein Profi!', 'Hoch hinaus!'][Math.floor(Math.random() * 4)], 1.6); p.hintT = 1.5; }
    }
    if (!World.insideBoundary(p.x, p.y)) {
      p.x = ox; p.y = oy;
      p.speed *= 0.3;
      if (p.msgT <= 0) showMsg(p, 'Hier endet die Gemeinde Nörvenich. Reite zurück!', 2.5);
    }
    p.bumpT -= dt;
    p.hintT -= dt;
  }

  function separatePlayers() {
    if (players.length < 2) return;
    const a = players[0], b = players[1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy), min = HORSE_R * 2.1;
    if (d < min && d > 1e-4) {
      const push = (min - d) / 2;
      a.x -= dx / d * push; a.y -= dy / d * push;
      b.x += dx / d * push; b.y += dy / d * push;
    }
  }

  // ------------------------------------------------------------ Sammeln und Entdecken
  function checkItems(p, dt) {
    const pickY = 1.6 + p.jumpY;
    for (const s of World.items.shoes) {
      if (s.got) continue;
      const dx = s.x - p.x, dy = s.y - p.y;
      if (dx * dx + dy * dy > 2.2 * 2.2) continue;
      if (Math.abs(s.z - pickY) > 1.0) continue;
      s.got = true;
      save.shoes.push(s.id);
      Sound.collect();
      const all = World.items.shoes.filter(q => q.place === s.place);
      const have = all.filter(q => q.got).length;
      showMsg(p, `Hufeisen! ${s.place}: ${have} von ${all.length}`, 2.2);
      updateCounters();
      writeSave();
    }
    for (const f of World.items.food) {
      if (f.respawn > 0) { f.respawn -= dt / Math.max(1, players.length); continue; }
      const dx = f.x - p.x, dy = f.y - p.y;
      if (dx * dx + dy * dy > 2.3 * 2.3) continue;
      f.respawn = 120;
      p.stamina = Math.min(1, p.stamina + 0.4);
      save.eaten++;
      Sound.eat();
      showMsg(p, `${p.horseName} frisst ${f.kind === 'apple' ? 'einen Apfel' : 'eine Möhre'}. Mmh! Neue Kraft.`, 2.2);
    }
    for (const d of World.discoverables) {
      if (discovered.has(d.id)) continue;
      const dx = d.x - p.x, dy = d.y - p.y;
      if (dx * dx + dy * dy > d.r * d.r) continue;
      discovered.add(d.id);
      save.disc.push(d.id);
      Sound.discover();
      const sub = d.village ? (d.kind === 'Ortsteil' ? 'Ortsteil entdeckt' : 'Weiler entdeckt') : `${d.kind} entdeckt`;
      showBanner(p, d.name, sub);
      updateCounters();
      writeSave();
    }
  }

  function updateCounters() {
    const shoes = World.items.shoes;
    $('cnt-shoes').textContent = shoes.filter(s => s.got).length;
    $('cnt-shoes-all').textContent = shoes.length;
    $('cnt-places').textContent = discovered.size;
    $('cnt-places-all').textContent = World.discoverables.length;
  }

  // ------------------------------------------------------------ Kamera
  function updateCamera(p, dt) {
    const target = p.speed < -0.2 ? p.heading : p.heading;
    if (!p.camInit) { p.camYaw = target; }
    p.camYaw += angleDiff(target, p.camYaw) * Math.min(1, dt * 3.2);
    const fx = Math.sin(p.camYaw), fz = -Math.cos(p.camYaw);
    const rx = -fz, rz = fx;               // rechts
    let back = 3.9 + Math.max(0, p.speed) * 0.05;
    // nicht hinter eine Hauswand schauen
    const bx = p.x - fx * (back + 0.6) + rx * 0.75, bz = p.y - fz * (back + 0.6) + rz * 0.75;
    const t = World.rayBuildings(p.x, p.y, bx, bz, 2.5);
    let lift = 0;
    if (t < 1) {
      const full = back;
      back = Math.max(1.6, (back + 0.6) * t - 0.6);
      lift = (full - back) * 0.7;      // eng zwischen Häusern: Kamera höher statt näher
    }
    const desired = new THREE.Vector3(
      p.x - fx * back + rx * 0.75,
      3.35 + lift + p.jumpY * 0.65,
      p.y - fz * back + rz * 0.75);
    if (!p.camInit) { p.camPos.copy(desired); p.camInit = true; }
    p.camPos.lerp(desired, Math.min(1, dt * 10));
    p.cam.position.copy(p.camPos);
    p.cam.lookAt(p.x + fx * 14 + rx * 0.4, 1.45 + p.jumpY * 0.5, p.y + fz * 14 + rz * 0.4);
  }

  // ------------------------------------------------------------ Hauptschleife
  let last = 0, time = 0, birdT = 5, saveT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) { last = now; return; }
    let dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    pollPads();
    if (paused || mapOpen) dt = 0;
    time += dt;

    if (dt > 0) {
      const steps = dt > 1 / 45 ? 2 : 1;
      for (let s = 0; s < steps; s++) for (const p of players) stepPlayer(p, dt / steps);
      separatePlayers();
      for (const p of players) checkItems(p, dt);
    }

    let fastest = 0;
    for (const p of players) {
      p.model.root.position.set(p.x, 0, p.y);
      p.model.root.rotation.y = -p.heading;
      const pan = players.length === 2 && document.body.classList.contains('split-v') ? (p.idx === 0 ? -0.5 : 0.5) : 0;
      p.model.update(dt, { speed: p.speed, gait: p.gait, jump: p.jumpY, jumpT: p.jumpT, turn: p.steer },
        dt > 0 ? (gait) => Sound.hoof(p.surface, gait, pan) : null);
      updateCamera(p, dt);
      fastest = Math.max(fastest, Math.abs(p.speed) / 11.5);
      updateHud(p, dt);
    }
    Sound.setWind(paused || mapOpen ? 0 : fastest);
    updateItemMeshes(time);

    birdT -= dt;
    if (birdT <= 0) { Sound.bird(); birdT = 4 + Math.random() * 10; }
    saveT += dt;
    if (saveT > 5) { saveT = 0; storePositions(); }

    // Zeichnen: jede Bildschirmhälfte mit eigener Kamera
    const W = window.innerWidth, H = window.innerHeight;
    renderer.setScissorTest(true);
    for (const p of players) {
      const r = p.rect;
      World.updateVisibility(p.cam.position.x, p.cam.position.z);
      sky.position.copy(p.cam.position);
      clouds.position.set(p.cam.position.x, 0, p.cam.position.z);
      // die andere Reiterin ausblenden, wenn sie direkt vor der Kamera steht
      for (const o of players) {
        o.model.root.visible = o === p || Math.hypot(o.x - p.cam.position.x, o.y - p.cam.position.z) > 2.6;
      }
      const y = H - r.y - r.h;
      renderer.setViewport(r.x, y, r.w, r.h);
      renderer.setScissor(r.x, y, r.w, r.h);
      renderer.render(scene, p.cam);
    }
    renderer.setScissorTest(false);
    void W;
  }

  function updateHud(p, dt) {
    const h = p.hud;
    const g = Math.max(0, p.gait);
    h.gaits.forEach((el, i) => el.classList.toggle('on', i === g));
    h.root.classList.toggle('reverse', p.gait < 0);
    h.stamina.style.width = (p.stamina * 100).toFixed(1) + '%';
    h.stamina.classList.toggle('low', p.stamina < 0.25);
    p.regionT -= dt;
    if (p.regionT <= 0) {
      p.regionT = 0.5;
      const r = World.regionName(p.x, p.y);
      if (r !== p.region) { p.region = r; h.region.textContent = r; }
    }
    if (p.msgT > 0) { p.msgT -= dt; if (p.msgT <= 0) h.msg.hidden = true; }
    if (p.bannerT > 0) { p.bannerT -= dt; if (p.bannerT <= 0) h.banner.hidden = true; }
    const others = players.filter(o => o !== p);
    MapView.drawMini(h.mini, p, others, 240);
  }

  function storePositions() {
    save.pos = players.map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, h: Math.round(p.heading * 1000) / 1000 }));
    writeSave();
  }

  // ------------------------------------------------------------ Menüs
  const screens = ['main', 'setup', 'pause', 'loading'];
  function show(name) {
    for (const s of screens) $('screen-' + s).hidden = s !== name;
    const btn = name && $('screen-' + name) ? $('screen-' + name).querySelector('[data-primary]') : null;
    if (btn && !isTouch) setTimeout(() => btn.focus(), 30);
  }
  for (const b of document.querySelectorAll('[data-goto]')) b.addEventListener('click', () => show(b.dataset.goto));

  function refreshMain() {
    const has = save.shoes.length || save.disc.length || save.pos;
    $('btn-start').textContent = has ? 'Weiterreiten' : 'Losreiten';
    $('btn-reset').hidden = !has;
    $('save-info').hidden = !has;
    if (has) $('save-info').textContent = `Gespeichert: ${save.shoes.length} Hufeisen, ${save.disc.length} entdeckte Orte, ${save.jumps} Sprünge.`;
  }

  $('btn-start').addEventListener('click', () => { Sound.init(); buildSetup(); show('setup'); });
  $('btn-reset').addEventListener('click', () => {
    if (!confirm('Wirklich neu anfangen? Alle gesammelten Hufeisen und entdeckten Orte werden gelöscht.')) return;
    save = { v: 1, shoes: [], disc: [], jumps: 0, eaten: 0, pos: null };
    writeSave();
    if (worldReady) {
      for (const s of World.items.shoes) s.got = false;
      discovered.clear();
    }
    refreshMain();
  });

  // Auswahl der Reiterinnen
  function buildSetup() {
    for (const b of document.querySelectorAll('#count-list .seg-btn')) {
      b.classList.toggle('active', +b.dataset.count === setup.count);
      b.onclick = () => { setup.count = +b.dataset.count; writeSetup(); buildSetup(); };
    }
    const wrap = $('rider-cards');
    wrap.innerHTML = '';
    for (let i = 0; i < setup.count; i++) {
      const cfg = setup.riders[i];
      if (setup.count === 2) cfg.hair = i === 0 ? 'blond' : 'red';
      const card = $('tpl-rider').content.firstElementChild.cloneNode(true);
      card.classList.add(cfg.hair === 'red' ? 'hair-red' : 'hair-blond');
      card.querySelector('.rider-title').textContent = setup.count === 1 ? 'Deine Reiterin' : `Reiterin ${i + 1}: ${cfg.hair === 'red' ? 'rote Haare' : 'blond'}`;
      const hs = card.querySelector('.hair-switch');
      if (setup.count === 1) {
        hs.hidden = false;
        for (const b of hs.querySelectorAll('.seg-btn')) {
          b.classList.toggle('active', b.dataset.hair === cfg.hair);
          b.onclick = () => {
            cfg.hair = b.dataset.hair;
            const other = setup.riders[1];
            if (cfg.hair === 'red' && other.hair === 'red') other.hair = 'blond';
            writeSetup();
            buildSetup();
          };
        }
      }
      const inName = card.querySelector('.in-name'), inHorse = card.querySelector('.in-horse');
      inName.value = cfg.name;
      inHorse.value = cfg.horse;
      inName.oninput = () => { cfg.name = inName.value.trim() || RIDERS[i].name; writeSetup(); };
      inHorse.oninput = () => { cfg.horse = inHorse.value.trim() || RIDERS[i].horse; writeSetup(); };
      const list = card.querySelector('.coat-list');
      for (const c of Horses.COATS) {
        const b = document.createElement('button');
        b.className = 'coat' + (c.id === cfg.coat ? ' active' : '');
        b.innerHTML = `<span class="swatch ${c.pinto ? 'pinto' : ''}" style="--body:${c.body};--mane:${c.mane}"></span><b>${c.name}</b><small>${c.desc}</small>`;
        b.onclick = () => { cfg.coat = c.id; writeSetup(); buildSetup(); };
        list.appendChild(b);
      }
      wrap.appendChild(card);
    }
  }

  $('btn-go').addEventListener('click', () => {
    Sound.init();
    if (setup.count === 2) { setup.riders[0].hair = 'blond'; setup.riders[1].hair = 'red'; }
    writeSetup();
    if (!worldReady) {
      show('loading');
      // erst den Ladebildschirm zeigen, dann bauen
      setTimeout(() => { buildWorld(); startGame(); }, 60);
    } else startGame();
  });

  function buildWorld() {
    const t0 = performance.now();
    World.build(scene);
    MapView.build();
    buildItemMeshes();
    for (const id of save.shoes) { const s = World.items.shoes[id]; if (s) s.got = true; }
    for (const id of save.disc) discovered.add(id);
    worldReady = true;
    console.log('Welt gebaut in', Math.round(performance.now() - t0), 'ms');
  }

  function startGame() {
    // Positionen nur übernehmen, wenn die Anzahl passt
    if (save.pos && save.pos.length !== setup.count) save.pos = null;
    createPlayers();
    updateCounters();
    show(null);
    $('hud-top').hidden = false;
    $('osm-credit').hidden = true;
    running = true;
    paused = false;
    last = performance.now();
    for (const p of players) showMsg(p, `${p.name} und ${p.horseName}: ▲ für schneller, ▼ für langsamer`, 4);
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    if (paused) {
      storePositions();
      const sh = World.items.shoes;
      $('pause-stats').textContent = `${sh.filter(s => s.got).length} von ${sh.length} Hufeisen · ${discovered.size} von ${World.discoverables.length} Orten · ${save.jumps} Sprünge · ${save.eaten}× gefüttert`;
      show('pause');
    } else show(null);
  }
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-resume').addEventListener('click', togglePause);
  $('btn-home').addEventListener('click', () => {
    const sp = World.spawnPoint();
    players.forEach((p, i) => {
      const side = players.length === 2 ? (i === 0 ? -1.6 : 1.6) : 0;
      p.x = sp.x + Math.cos(sp.heading) * side; p.y = sp.y + Math.sin(sp.heading) * side;
      p.heading = sp.heading; p.speed = 0; p.gait = 0; p.camInit = false;
    });
    togglePause();
  });
  $('btn-quit').addEventListener('click', () => {
    storePositions();
    running = false;
    paused = false;
    $('hud-top').hidden = true;
    $('osm-credit').hidden = false;
    for (const p of players) { scene.remove(p.model.root); }
    players = [];
    $('views').innerHTML = '';
    document.body.classList.remove('split-v', 'split-h');
    refreshMain();
    show('main');
  });

  function toggleMute() {
    Sound.setMuted(!Sound.muted);
    $('btn-mute').textContent = Sound.muted ? '🔇' : '🔊';
  }
  $('btn-mute').addEventListener('click', toggleMute);
  $('btn-mute').textContent = Sound.muted ? '🔇' : '🔊';

  function openMap() {
    mapOpen = true;
    $('screen-map').hidden = false;
    MapView.drawBig($('bigmap'), players, discovered);
  }
  function closeMap() {
    mapOpen = false;
    $('screen-map').hidden = true;
  }
  $('btn-map').addEventListener('click', () => { if (mapOpen) closeMap(); else openMap(); });
  $('btn-map-close').addEventListener('click', closeMap);
  $('bigmap').addEventListener('click', closeMap);
  window.addEventListener('resize', () => { if (mapOpen) MapView.drawBig($('bigmap'), players, discovered); });

  // Vorschau im Hintergrund des Menüs: Himmel
  refreshMain();
  show('main');
  requestAnimationFrame(frame);
  renderer.render(scene, new THREE.PerspectiveCamera());

  // Für Tests von außen
  window.__rider = {
    get players() { return players; }, World, save: () => save, get running() { return running; },
    /** Physik ohne Zeichnen vorspulen (für automatische Tests). */
    sim(n, dt) {
      for (let k = 0; k < n; k++) {
        for (const p of players) stepPlayer(p, dt || 1 / 60);
        separatePlayers();
        for (const p of players) checkItems(p, dt || 1 / 60);
      }
    },
    info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    press(i, act) {
      const p = players[i];
      if (act === 'up') gaitUp(p); else if (act === 'down') gaitDown(p); else tryJump(p);
    },
  };
})();
