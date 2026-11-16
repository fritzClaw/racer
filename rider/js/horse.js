'use strict';
/*
 * Pferd mit Reiterin: Modell aus einfachen Formen und Bewegung in den Gangarten
 * Schritt, Trab und Galopp, dazu der Sprung.
 *
 * Das Modell schaut nach -Z (vorne), Y ist oben. Im Spiel wird es mit
 * rotation.y = -heading gedreht.
 */
const Horses = (() => {
  const COATS = [
    { id: 'rappe', name: 'Rappe', desc: 'pechschwarz', body: '#232020', mane: '#0d0c0c', lower: '#1c1919', muzzle: '#2e2a28' },
    { id: 'schimmel', name: 'Schimmel', desc: 'weiß wie Schnee', body: '#e8e5de', mane: '#d6d2c9', lower: '#dedad2', muzzle: '#9a928c' },
    { id: 'fuchs', name: 'Fuchs', desc: 'rotbraun mit Blesse', body: '#a3521f', mane: '#b5622a', lower: '#a3521f', muzzle: '#7a3c18', blaze: true, socks: true },
    { id: 'brauner', name: 'Brauner', desc: 'braun, schwarze Mähne', body: '#6e3f22', mane: '#141010', lower: '#1d1714', muzzle: '#3a2416' },
    { id: 'schecke', name: 'Schecke', desc: 'braun-weiß gefleckt', body: '#ffffff', mane: '#2b211b', lower: '#f2efe9', muzzle: '#6b4a36', pinto: true },
    { id: 'haflinger', name: 'Haflinger', desc: 'goldbraun, helle Mähne', body: '#b9772f', mane: '#f1e2bd', lower: '#b9772f', muzzle: '#8a5a2a', blaze: true },
  ];

  const HAIR = {
    blond: { color: '#e9c46a', dark: '#c9a24a' },
    red: { color: '#b8461f', dark: '#8f3415' },
  };

  let pintoTex = null;
  function pintoTexture() {
    if (pintoTex) return pintoTex;
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#6b3a20';
    const blobs = [[30, 40, 34, 26], [100, 70, 40, 30], [170, 30, 36, 24], [220, 90, 30, 34], [60, 105, 30, 18], [140, 112, 28, 16], [250, 20, 20, 20], [0, 70, 18, 26]];
    for (const [x, y, rx, ry] of blobs) {
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0.4, 0, Math.PI * 2);
      g.fill();
    }
    pintoTex = new THREE.CanvasTexture(cv);
    pintoTex.colorSpace = THREE.SRGBColorSpace;
    pintoTex.wrapS = THREE.RepeatWrapping;
    return pintoTex;
  }

  const lam = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));

  function capsule(r, len, mat, seg) {
    return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, seg || 10), mat);
  }

  /** Gelenk: eine Gruppe, an der ein Körperteil hängt. */
  function joint(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  /** Erzeugt Pferd + Reiterin. opts: { coat, hair: 'blond'|'red', jacket, pad } */
  function create(opts) {
    const coat = COATS.find(c => c.id === opts.coat) || COATS[0];
    const hair = HAIR[opts.hair] || HAIR.blond;
    const root = new THREE.Group();       // Position und Richtung im Spiel
    const body = new THREE.Group();       // wippt und kippt
    root.add(body);

    const mBody = coat.pinto ? lam(0xffffff, { map: pintoTexture() }) : lam(coat.body);
    const mLower = lam(coat.lower);
    const mMane = lam(coat.mane);
    const mMuzzle = lam(coat.muzzle);
    const mHoof = lam('#2a2622');
    const mWhite = lam('#f2efe8');
    const mEye = lam('#111111');

    // ---- Rumpf
    const barrel = capsule(0.37, 1.05, mBody, 14);
    barrel.rotation.x = Math.PI / 2;
    barrel.scale.set(1, 1, 1.12);
    barrel.position.set(0, 1.27, 0);
    body.add(barrel);
    const croup = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), mBody);
    croup.scale.set(0.98, 0.98, 1.05);
    croup.position.set(0, 1.33, 0.52);
    body.add(croup);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 10), mBody);
    chest.position.set(0, 1.3, -0.55);
    body.add(chest);

    // ---- Hals und Kopf
    const neck = joint(body, 0, 1.45, -0.72);
    neck.rotation.x = -0.75;
    const neckMesh = capsule(0.2, 0.6, mBody, 10);
    neckMesh.scale.set(0.85, 1, 1.15);
    neckMesh.position.y = 0.38;
    neck.add(neckMesh);
    // Mähne: Kamm auf dem Hals
    const mane = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.85, 0.12), mMane);
    mane.position.set(0, 0.38, 0.18);
    neck.add(mane);
    const head = joint(neck, 0, 0.78, -0.02);
    head.rotation.x = -1.32;
    const skull = capsule(0.15, 0.4, mBody, 10);
    skull.scale.set(0.95, 1, 1.15);
    skull.position.y = 0.2;
    head.add(skull);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mMuzzle);
    muzzle.scale.set(0.95, 0.9, 1.1);
    muzzle.position.set(0, 0.47, 0.0);
    head.add(muzzle);
    if (coat.blaze) {
      const blaze = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.02), mWhite);
      blaze.position.set(0, 0.22, 0.14);
      head.add(blaze);
    }
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), mEye);
      eye.position.set(sx * 0.12, 0.06, 0.05);
      head.add(eye);
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 6), mBody);
      ear.position.set(sx * 0.07, -0.06, 0.13);
      ear.rotation.x = 1.25;
      ear.rotation.z = sx * -0.25;
      head.add(ear);
    }
    const forelock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.05), mMane);
    forelock.position.set(0, 0.02, 0.13);
    head.add(forelock);
    // Zaum
    const mStrap = lam('#3b2416');
    const nose = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.015, 4, 12), mStrap);
    nose.rotation.x = Math.PI / 2;
    nose.position.y = 0.36;
    head.add(nose);
    const bit = joint(head, 0, 0.42, -0.07);

    // ---- Schweif
    const tail = joint(body, 0, 1.5, 0.9);
    tail.rotation.x = -0.5;
    const tail1 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.45, 8), mMane);
    tail1.position.y = -0.22;
    tail.add(tail1);
    const tail2j = joint(tail, 0, -0.42, 0);
    const tail2 = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.55, 8), mMane);
    tail2.rotation.x = Math.PI;
    tail2.position.y = -0.27;
    tail2j.add(tail2);

    // ---- Beine
    const legs = [];
    const legDefs = [
      { name: 'LF', x: -0.19, y: 1.17, z: -0.56, front: true },
      { name: 'RF', x: 0.19, y: 1.17, z: -0.56, front: true },
      { name: 'LH', x: -0.19, y: 1.2, z: 0.58, front: false },
      { name: 'RH', x: 0.19, y: 1.2, z: 0.58, front: false },
    ];
    for (const d of legDefs) {
      const hip = joint(body, d.x, d.y, d.z);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(d.front ? 0.1 : 0.13, 0.075, 0.55, 8), mBody);
      upper.position.y = -0.26;
      hip.add(upper);
      const knee = joint(hip, 0, -0.52, 0);
      const useSock = coat.socks && (d.name === 'RF' || d.name === 'LH');
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.5, 7), useSock ? mWhite : mLower);
      lower.position.y = -0.25;
      knee.add(lower);
      const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 0.12, 8), mHoof);
      hoof.position.y = -0.56;
      knee.add(hoof);
      legs.push({ hip, knee, front: d.front, name: d.name, lastS: 0 });
    }

    // ---- Sattel
    const mPad = lam(opts.pad || '#2f6fd6');
    const mLeather = lam('#4a2c18');
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.05, 0.72), mPad);
    pad.position.set(0, 1.63, -0.12);
    body.add(pad);
    for (const sx of [-1, 1]) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.6), mPad);
      flap.position.set(sx * 0.385, 1.5, -0.12);
      flap.rotation.z = sx * 0.12;
      body.add(flap);
    }
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.56), mLeather);
    saddle.position.set(0, 1.69, -0.12);
    body.add(saddle);
    const cantle = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.08), mLeather);
    cantle.position.set(0, 1.76, 0.13);
    body.add(cantle);

    // ---- Reiterin
    const mJacket = lam(opts.jacket || '#5aa9e6');
    const mPants = lam('#efe8da');
    const mBoot = lam('#1b1a1a');
    const mSkin = lam('#f1c7a5');
    const mHelmet = lam('#1f2433');
    const mHair = lam(hair.color);
    const mHairDark = lam(hair.dark);

    const rider = joint(body, 0, 1.76, -0.08);     // Hüfte
    const torso = joint(rider, 0, 0, 0);
    const chestMesh = capsule(0.155, 0.3, mJacket, 10);
    chestMesh.scale.set(1.15, 1, 0.8);
    chestMesh.position.y = 0.3;
    torso.add(chestMesh);
    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mPants);
    hips.scale.set(1.1, 0.7, 0.9);
    hips.position.y = 0.04;
    torso.add(hips);
    const neckR = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), mSkin);
    neckR.position.y = 0.6;
    torso.add(neckR);
    const headR = joint(torso, 0, 0.75, 0);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), mSkin);
    face.scale.set(0.95, 1.08, 1);
    headR.add(face);
    // Haare unter dem Helm (hinten und an den Seiten)
    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), mHair);
    hairBack.scale.set(1.02, 0.95, 0.9);
    hairBack.position.set(0, -0.01, 0.03);
    headR.add(hairBack);
    for (const sx of [-1, 1]) {
      const strand = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.08), mHair);
      strand.position.set(sx * 0.105, -0.07, -0.01);
      headR.add(strand);
    }
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mHelmet);
    helmet.position.y = 0.02;
    headR.add(helmet);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.08), mHelmet);
    visor.position.set(0, 0.03, -0.14);
    visor.rotation.x = 0.25;
    headR.add(visor);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), mEye);
      eye.position.set(sx * 0.042, 0.0, -0.108);
      headR.add(eye);
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, 0.01), lam('#c0605a'));
    mouth.position.set(0, -0.06, -0.11);
    headR.add(mouth);
    // Pferdeschwanz: zwei Glieder, die mitschwingen
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.012, 4, 8), lam(opts.pad || '#2f6fd6'));
    tie.position.set(0, -0.03, 0.13);
    headR.add(tie);
    const pony1 = joint(headR, 0, -0.03, 0.14);
    const p1 = capsule(0.045, 0.14, mHair, 8);
    p1.position.y = -0.1;
    pony1.add(p1);
    const pony2 = joint(pony1, 0, -0.2, 0);
    const p2 = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.24, 8), mHairDark);
    p2.rotation.x = Math.PI;
    p2.position.y = -0.11;
    pony2.add(p2);

    // Arme: Schulter -> Ellbogen -> Hand an den Zügeln
    const hands = [];
    for (const sx of [-1, 1]) {
      const sh = joint(torso, sx * 0.19, 0.5, 0);
      sh.rotation.x = 0.55;
      sh.rotation.z = -sx * 0.05;
      const ua = capsule(0.05, 0.2, mJacket, 8);
      ua.position.y = -0.13;
      sh.add(ua);
      const el = joint(sh, 0, -0.27, 0);
      el.rotation.x = 0.85;
      el.rotation.z = -sx * 0.35;
      const fa = capsule(0.042, 0.18, mJacket, 8);
      fa.position.y = -0.12;
      el.add(fa);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), lam('#3a2a20'));
      hand.position.y = -0.25;
      el.add(hand);
      hands.push(hand);
    }
    // Beine der Reiterin
    for (const sx of [-1, 1]) {
      const hp = joint(rider, sx * 0.13, 0.02, 0);
      hp.rotation.x = 0.85;
      hp.rotation.z = sx * 0.62;
      const th = capsule(0.07, 0.3, mPants, 8);
      th.position.y = -0.2;
      hp.add(th);
      const kn = joint(hp, 0, -0.4, 0);
      kn.rotation.x = -1.0;
      kn.rotation.z = -sx * 0.5;
      const shin = capsule(0.055, 0.3, mBoot, 8);
      shin.position.y = -0.2;
      kn.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.2), mBoot);
      foot.position.set(0, -0.4, -0.05);
      kn.add(foot);
    }

    // Zügel
    const reinGeo = new THREE.BufferGeometry();
    reinGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    const reins = new THREE.LineSegments(reinGeo, new THREE.LineBasicMaterial({ color: 0x2a1a10 }));
    reins.frustumCulled = false;
    root.add(reins);

    // Schatten
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(0.75, 1.6, 1);
    shadow.position.y = 0.02;
    shadow.renderOrder = -4;
    root.add(shadow);

    // ---- Bewegung
    const st = {
      phase: 0, freq: 0, w: [0, 0, 0, 0], ponyA: 0, ponyV: 0, ponyS: 0, ponyVS: 0,
      idle: Math.random() * 10, prevBob: 0, bobV: 0,
    };
    const OFFS = [
      null,
      { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 },          // Schritt
      { LF: 0, RH: 0, RF: 0.5, LH: 0.5 },              // Trab
      { LH: 0, RH: 0.12, LF: 0.4, RF: 0.52 },          // Galopp
    ];
    const AMP = [null, [0.32, 0.55], [0.5, 1.05], [0.72, 1.3]];
    const FREQ = [0, 0.95, 1.4, 1.9];
    const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

    /**
     * s: { speed, gait (-1..3), jump (Höhe), jumpT (0..1 oder -1), turn (-1..1) }
     * onStep(gait): wird beim Aufsetzen eines Hufs aufgerufen
     */
    function update(dt, s, onStep) {
      const g = Math.max(0, s.gait);
      const moving = Math.abs(s.speed) > 0.15;
      const active = moving ? Math.max(1, g) : 0;
      for (let i = 1; i <= 3; i++) {
        const target = i === active ? Math.min(1, Math.abs(s.speed) / 1.2) : 0;
        st.w[i] += (target - st.w[i]) * Math.min(1, dt * 5);
      }
      const ref = [0, 1.8, 4.8, 11][Math.max(1, active)];
      const targetF = moving ? FREQ[Math.max(1, active)] * (0.75 + 0.25 * Math.min(1.4, Math.abs(s.speed) / ref)) : 0;
      st.freq += (targetF - st.freq) * Math.min(1, dt * 4);
      st.phase += st.freq * dt * (s.speed < 0 ? -1 : 1);
      st.idle += dt;
      const P = st.phase;
      const TAU = Math.PI * 2;

      const jumping = s.jumpT >= 0;
      const jt = jumping ? s.jumpT : 0;
      const tuck = jumping ? Math.sin(Math.PI * jt) : 0;

      for (const L of legs) {
        let a = 0, k = 0;
        for (let i = 1; i <= 3; i++) {
          if (st.w[i] < 0.01) continue;
          const ss = TAU * (P + OFFS[i][L.name]);
          a += st.w[i] * AMP[i][0] * Math.sin(ss);
          k += st.w[i] * AMP[i][1] * Math.max(0, Math.cos(ss)) * (L.front ? -1 : 0.8);
        }
        if (tuck > 0) {
          a = a * (1 - tuck) + tuck * (L.front ? 0.95 : -0.55);
          k = k * (1 - tuck) + tuck * (L.front ? -1.9 : 1.2);
        }
        L.hip.rotation.x = a;
        L.knee.rotation.x = k;
        // Hufschlag erkennen
        if (onStep && active > 0 && !jumping) {
          const ss = TAU * (P + OFFS[active][L.name]);
          const sn = Math.sin(ss);
          if (L.lastS > 0.92 && sn <= 0.92 && Math.cos(ss) < 0) onStep(active, L.name);
          L.lastS = sn;
        }
      }

      // Körper wippen und kippen
      let bob = 0, pitch = 0;
      bob += st.w[1] * 0.02 * Math.sin(TAU * P * 2);
      bob += st.w[2] * 0.055 * Math.abs(Math.sin(TAU * P * 2));
      bob += st.w[3] * 0.07 * Math.sin(TAU * P + 0.6);
      pitch += st.w[3] * 0.07 * Math.sin(TAU * P);
      if (jumping) pitch += 0.38 * Math.sin(TAU * jt);
      body.position.y = s.jump + bob;
      body.rotation.x = pitch;
      body.rotation.z = -s.turn * Math.min(1, Math.abs(s.speed) / 8) * 0.08;
      st.bobV = (bob - st.prevBob) / Math.max(dt, 1e-3);
      st.prevBob = bob;

      // Hals und Kopf
      const nod = st.w[1] * 0.08 * Math.sin(TAU * P * 2) + st.w[3] * 0.12 * Math.sin(TAU * P + 1.2);
      const idleNod = moving ? 0 : 0.04 * Math.sin(st.idle * 0.7);
      neck.rotation.x = -0.75 - st.w[3] * 0.3 + nod + idleNod - tuck * 0.15;
      neck.rotation.y = -s.turn * 0.2 * Math.min(1, Math.abs(s.speed) / 3 + 0.3);
      head.rotation.x = -1.32 + st.w[3] * 0.3;

      // Schweif
      tail.rotation.x = -(0.45 + st.w[3] * 0.5 + st.w[2] * 0.2 + tuck * 0.6);
      tail.rotation.z = 0.15 * Math.sin(st.idle * (moving ? 3 : 1.2)) * (moving ? 0.5 : 1);
      tail2j.rotation.x = -(0.1 + 0.08 * Math.sin(TAU * P));

      // Reiterin
      const post = st.w[2] * 0.06 * Math.max(0, Math.sin(TAU * P * 2));   // Leichttraben
      rider.position.y = 1.76 + post - st.w[3] * 0.4 * bob;
      torso.rotation.x = -(0.08 + st.w[3] * 0.32 + st.w[2] * 0.12 + tuck * 0.35) + pitch * -0.6;
      torso.rotation.z = -body.rotation.z * 0.5;
      headR.rotation.x = -torso.rotation.x * 0.7;

      // Pferdeschwanz als gedämpfte Feder
      const targetA = Math.min(0.9, Math.abs(s.speed) * 0.05) + tuck * 0.5;
      const kick = -st.bobV * 0.25;
      st.ponyV += ((targetA - st.ponyA) * 60 - st.ponyV * 7 + kick * 30) * dt;
      st.ponyA += st.ponyV * dt;
      st.ponyA = Math.max(-0.3, Math.min(1.4, st.ponyA));
      st.ponyVS += ((s.turn * 0.4 - st.ponyS) * 40 - st.ponyVS * 6) * dt;
      st.ponyS += st.ponyVS * dt;
      pony1.rotation.x = -(0.25 + st.ponyA);
      pony1.rotation.z = st.ponyS;
      pony2.rotation.x = -(st.ponyA * 0.4 + 0.1 * Math.sin(st.idle * 2));

      // Zügel von den Händen zum Gebiss
      root.updateMatrixWorld(true);
      const arr = reinGeo.attributes.position.array;
      bit.getWorldPosition(v2);
      root.worldToLocal(v2);
      for (let i = 0; i < 2; i++) {
        hands[i].getWorldPosition(v1);
        root.worldToLocal(v1);
        arr.set([v1.x, v1.y, v1.z, v2.x + (i ? 0.1 : -0.1), v2.y, v2.z], i * 6);
      }
      reinGeo.attributes.position.needsUpdate = true;

      // Schatten wird beim Sprung kleiner
      const sh = 1 - Math.min(0.5, s.jump * 0.25);
      shadow.scale.set(0.75 * sh, 1.6 * sh, 1);
    }

    return { root, body, rider, headR, update };
  }

  return { COATS, create };
})();
