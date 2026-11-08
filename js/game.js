/* Turbo-Rennen: Spiellogik, Fahrphysik, Computergegner, Darstellung und Menüs. */
'use strict';

(() => {
  const DT = 1 / 120;           // feste Physik-Schrittweite
  const LAPS = 3;
  const KMH = 0.4;              // Umrechnung Pixel/s -> km/h für die Anzeige
  const COUNTDOWN = 4;          // Sekunden bis "LOS!" (erste Sekunde: "Bereit?")
  const RESULTS_DELAY = 2.5;    // Sekunden nach dem Zieleinlauf bis zur Ergebnisliste

  const DIFFICULTIES = {
    leicht: { label: 'Leicht', hint: 'Gemütliche Gegner', speed: 0.85, accel: 0.85, corner: 0.72 },
    mittel: { label: 'Mittel', hint: 'Faire Gegner', speed: 0.94, accel: 0.95, corner: 0.84 },
    schwer: { label: 'Schwer', hint: 'Echte Profis', speed: 1.0, accel: 1.0, corner: 0.95 },
  };

  const $ = id => document.getElementById(id);
  const canvas = $('game');

  const tracks = TRACK_DEFS.map(buildTrack);

  const sel = loadSelection();
  let race = null;
  let screen = 'main';
  let viewW = 0, viewH = 0, dpr = 1;

  // ------------------------------------------------------------------
  // Eingabe
  // ------------------------------------------------------------------
  const keys = { up: false, down: false, left: false, right: false };
  const touchKeys = { up: false, down: false, left: false, right: false };
  const KEY_MAP = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down', Space: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
  };

  window.addEventListener('keydown', e => {
    const k = KEY_MAP[e.code];
    if (k && isRacing()) {
      keys[k] = true;
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (screen === 'pause') resume();
      else if (isRacing()) pause();
      else if (screen === 'car') showScreen('main');
      else if (screen === 'track') showScreen('car');
    } else if (e.code === 'KeyM') {
      toggleMute();
    } else if (e.code === 'KeyC') {
      toggleView();
    } else if (e.code === 'Enter' && document.activeElement === document.body) {
      const btn = document.querySelector(`#screen-${screen} [data-primary]`);
      if (btn) btn.click();
    } else if (screen === 'car' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      const d = e.code === 'ArrowLeft' ? -1 : 1;
      selectCar((sel.car + d + CAR_DEFS.length) % CAR_DEFS.length);
    }
  });
  window.addEventListener('keyup', e => {
    const k = KEY_MAP[e.code];
    if (k) keys[k] = false;
  });
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    if (isRacing()) pause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRacing()) pause();
  });

  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (isTouch) document.body.classList.add('touch');
  for (const btn of document.querySelectorAll('.touch-btn')) {
    const k = btn.dataset.key;
    const on = e => {
      e.preventDefault();
      touchKeys[k] = true;
      btn.classList.add('active');
      Sound.init();
    };
    const off = e => {
      e.preventDefault();
      touchKeys[k] = false;
      btn.classList.remove('active');
    };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  }

  function input(k) { return keys[k] || touchKeys[k]; }

  // ------------------------------------------------------------------
  // Rennen anlegen
  // ------------------------------------------------------------------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* playerCar = Index in CAR_DEFS, oder -1 für ein Demo-Rennen nur mit Computerautos. */
  function createRace(trackIndex, playerCar, diffKey, demo) {
    const track = tracks[trackIndex];
    const skill = DIFFICULTIES[diffKey];
    // Den Monstertruck fährt nur der Spieler
    const others = shuffle(CAR_DEFS.map((_, i) => i).filter(i => i !== playerCar && !CAR_DEFS[i].monster))
      .slice(0, playerCar >= 0 ? 3 : 4);
    const names = shuffle(AI_DRIVERS);
    const entries = others.map((ci, i) => ({ def: CAR_DEFS[ci], name: names[i], isPlayer: false }));
    if (playerCar >= 0) entries.push({ def: CAR_DEFS[playerCar], name: 'Du', isPlayer: true });

    const cars = entries.map((e, slot) => createCar(track, e, gridPos(track, slot), e.isPlayer ? null : skill));
    const player = cars.find(c => c.isPlayer) || null;
    const traffic = createTraffic(track);
    const r = {
      track,
      trackIndex,
      diffKey,
      playerCar,
      cars,
      traffic,
      all: cars.concat(traffic),
      player,
      crushed: 0,
      events: [],
      demo: !!demo,
      laps: demo ? Infinity : LAPS,
      state: demo ? 'race' : 'countdown',
      countdown: COUNTDOWN,
      time: 0,
      finishOrder: [],
      playerFinishedAt: null,
      resultsShown: false,
      paused: false,
      follow: player || cars[0],
      followTimer: 0,
      lastCountdownShown: null,
      message: null,
      wrongWayT: 0,
      cam: null,
    };
    updatePlaces(r);
    return r;
  }

  /* Startplatz: zwei Reihen hinter der Ziellinie */
  function gridPos(track, slot) {
    const k = Math.round((70 + slot * 62) / track.spacing);
    return {
      idx: (track.n - k) % track.n,
      progress: -k,
      lat: (slot % 2 === 0 ? -1 : 1) * track.width * 0.22,
    };
  }

  /* Verkehr gleichmäßig über die Strecke verteilen (nicht in der Startaufstellung). */
  function createTraffic(track) {
    const count = Math.round(track.length / 700);
    const from = Math.ceil(500 / track.spacing);
    const to = track.n - Math.ceil(450 / track.spacing);
    const list = [];
    for (let k = 0; k < count; k++) {
      const idx = from + Math.floor((k + Math.random() * 0.6) * (to - from) / count);
      const lat = (Math.random() - 0.5) * track.width * 0.6;
      const def = TRAFFIC_DEFS[k % TRAFFIC_DEFS.length];
      const car = createCar(track, { def, name: 'Verkehr', isPlayer: false }, { idx, progress: idx, lat }, null);
      makeTraffic(car);
      list.push(car);
    }
    return list;
  }

  function makeTraffic(car) {
    car.traffic = true;
    car.phys = {
      maxSpeed: 170 + Math.random() * 100,
      accel: 170,
      brake: 600,
      steerRate: 2.5,
      grip: 8,
      mass: 0.9,
    };
    car.ai.corner = 0.8;
  }

  /* Ein zerquetschtes Verkehrsauto weiter vorne (außer Sicht im Nebel) neu einsetzen. */
  function respawnTraffic(r, car) {
    const t = r.track;
    const ref = r.player || r.follow;
    let idx = (ref.idx + Math.round((2000 + Math.random() * 1500) / t.spacing)) % t.n;
    for (let tries = 0; tries < 8; tries++) {
      const lat = (Math.random() - 0.5) * t.width * 0.6;
      const x = t.x[idx] + t.nx[idx] * lat;
      const y = t.y[idx] + t.ny[idx] * lat;
      if (r.all.every(o => o === car || (o.x - x) ** 2 + (o.y - y) ** 2 > 90 * 90)) {
        car.x = x;
        car.y = y;
        car.ai.lane = car.ai.laneTarget = lat;
        break;
      }
      idx = (idx + 10) % t.n;
    }
    car.idx = idx;
    car.angle = t.heading[idx];
    car.vF = car.phys.maxSpeed * 0.6;
    car.vx = Math.cos(car.angle) * car.vF;
    car.vy = Math.sin(car.angle) * car.vF;
    car.steer = car.steerTarget = 0;
    car.flat = 0;
    car.vanish = 0;
    car.ai.stuck = 0;
    car.ai.reverse = 0;
  }

  function createCar(track, entry, pos, skill) {
    const phys = carPhysics(entry.def);
    if (skill) {
      phys.maxSpeed *= skill.speed;
      phys.accel *= skill.accel;
    }
    const { idx, progress, lat } = pos;
    return {
      def: entry.def,
      name: entry.name,
      isPlayer: entry.isPlayer,
      size: carSize(entry.def),
      phys,
      x: track.x[idx] + track.nx[idx] * lat,
      y: track.y[idx] + track.ny[idx] * lat,
      angle: track.heading[idx],
      vx: 0,
      vy: 0,
      vF: 0,
      steer: 0,
      steerTarget: 0,
      throttle: 0,
      brake: 0,
      idx,
      progress,
      lap: -1,
      lapStart: 0,
      lapTimes: [],
      bestLap: null,
      finished: false,
      finishTime: 0,
      place: 0,
      onGrass: false,
      speedMul: 1,
      traffic: false,
      flat: 0,          // > 0: zerquetscht, Sekunden bis es weitergeht
      invuln: 0,        // nach dem Wiederaufstehen kurz nicht zerquetschbar
      vanish: 0,        // Verkehr: 0..1 beim Verschwinden
      crushTilt: 0,
      bumpT: 0,         // Monstertruck: Hüpfer beim Überfahren
      autopilot: !entry.isPlayer,
      ai: {
        corner: skill ? skill.corner : 0.9,
        lane: lat,
        laneTarget: lat,
        laneTimer: 1 + Math.random() * 2,
        avoid: 0,
        stuck: 0,
        reverse: 0,
      },
    };
  }

  // ------------------------------------------------------------------
  // Simulation
  // ------------------------------------------------------------------
  function step(r, dt) {
    if (r.state === 'countdown') {
      r.countdown -= dt;
      const shown = r.countdown > 3 ? 'Bereit?' : r.countdown > 0 ? String(Math.ceil(r.countdown)) : 'LOS!';
      if (shown !== r.lastCountdownShown) {
        r.lastCountdownShown = shown;
        if (!r.demo) {
          if (shown === 'LOS!') Sound.go();
          else if (shown !== 'Bereit?') Sound.countdown();
          flashMessage(shown, shown === 'LOS!' ? 0.9 : 1.2, shown === 'Bereit?');
        }
      }
      if (r.countdown <= 0) r.state = 'race';
      // Spieler darf schon Gas geben, das Auto bleibt aber stehen
      if (r.player) controlPlayer(r.player, dt);
      return;
    }

    r.time += dt;
    for (const car of r.all) {
      if (car.flat > 0) continue;
      if (car.autopilot) controlAI(r, car, dt);
      else controlPlayer(car, dt);
    }
    for (const car of r.all) physics(r, car, dt);
    collisions(r);
    updateCrushed(r, dt);
    for (const car of r.cars) laps(r, car);
    updatePlaces(r);

    if (r.player && !r.demo) {
      const p = r.player;
      // Falsche Richtung erkennen
      const dot = Math.cos(p.angle) * r.track.tx[p.idx] + Math.sin(p.angle) * r.track.ty[p.idx];
      if (!p.finished && dot < -0.3 && Math.abs(p.vF) > 40) r.wrongWayT += dt;
      else r.wrongWayT = 0;

      if (r === race && p.finished && !r.resultsShown && r.time - r.playerFinishedAt > RESULTS_DELAY) {
        r.resultsShown = true;
        showResults();
      }
    }
  }

  /* Zerquetschte Autos: liegen platt, dann stehen Rennautos wieder auf und Verkehr verschwindet. */
  function updateCrushed(r, dt) {
    for (const car of r.all) {
      if (car.bumpT > 0) car.bumpT = Math.max(0, car.bumpT - dt);
      if (car.invuln > 0) car.invuln = Math.max(0, car.invuln - dt);
      if (car.flat <= 0) continue;
      car.flat -= dt;
      car.vx = car.vy = car.vF = 0;
      car.throttle = car.brake = 0;
      if (car.traffic) {
        car.vanish = Math.min(1, Math.max(0, 1 - car.flat / 0.6));
        if (car.flat <= 0) respawnTraffic(r, car);
      } else if (car.flat <= 0) {
        car.flat = 0;
        car.invuln = 2;
        car.ai.stuck = 0;
      }
    }
  }

  function crush(r, victim, truck) {
    victim.flat = victim.traffic ? 4 : 3;
    victim.vx = victim.vy = victim.vF = 0;
    victim.steer = victim.steerTarget = 0;
    victim.crushTilt = (Math.random() - 0.5) * 0.3;
    victim.vanish = 0;
    truck.bumpT = 0.35;
    truck.vx *= 0.93;
    truck.vy *= 0.93;
    r.events.push({ type: 'crush', x: victim.x, y: victim.y, color: victim.def.color });
    if (truck.isPlayer && !r.demo) {
      r.crushed++;
      Sound.crush();
      const el = $('hud-crush');
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    }
  }

  function controlPlayer(car, dt) {
    car.throttle = input('up') ? 1 : 0;
    car.brake = input('down') ? 1 : 0;
    car.steerTarget = (input('right') ? 1 : 0) - (input('left') ? 1 : 0);
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function controlAI(r, car, dt) {
    const t = r.track;
    const ai = car.ai;
    const p = car.phys;
    const vF = car.vF;
    const W = t.width;

    // Spurwahl: gelegentlich leicht variieren, damit die Autos nicht wie auf Schienen fahren
    ai.laneTimer -= dt;
    if (ai.laneTimer <= 0) {
      ai.laneTimer = 2 + Math.random() * 3;
      ai.laneTarget = (Math.random() - 0.5) * W * 0.4;
    }

    // Ausweichen: steht ein Auto knapp vor uns, auf die andere Seite ziehen
    const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    ai.avoid *= Math.exp(-dt * 1.5);
    for (const o of r.all) {
      if (o === car || o.flat > 0) continue;
      const dx = o.x - car.x, dy = o.y - car.y;
      const ahead = dx * fx + dy * fy;
      const side = -dx * fy + dy * fx;
      if (ahead > 0 && ahead < 130 && Math.abs(side) < 34 && o.vF < vF + 30) {
        // Seite relativ zur Strecke bestimmen
        const lateralOther = (o.x - t.x[car.idx]) * t.nx[car.idx] + (o.y - t.y[car.idx]) * t.ny[car.idx];
        const dir = lateralOther > ai.lane ? -1 : 1;
        ai.avoid = dir * W * 0.32;
      }
    }
    const laneGoal = Math.max(-W * 0.36, Math.min(W * 0.36, ai.laneTarget + ai.avoid));
    ai.lane += (laneGoal - ai.lane) * Math.min(1, dt * 2);

    // Zielpunkt voraus auf der Ideallinie
    const look = 80 + Math.abs(vF) * 0.4;
    const ti = (car.idx + Math.round(look / t.spacing)) % t.n;
    // In engen Kurven Spurversatz zurücknehmen
    const laneFactor = Math.max(0.2, 1 - t.curvature[ti] * 150);
    const gx = t.x[ti] + t.nx[ti] * ai.lane * laneFactor;
    const gy = t.y[ti] + t.ny[ti] * ai.lane * laneFactor;
    const diff = wrapAngle(Math.atan2(gy - car.y, gx - car.x) - car.angle);
    car.steerTarget = Math.max(-1, Math.min(1, diff * 3));

    // Gummiband: Gegner weit hinter dem Spieler holen ein bisschen auf, weit vorne bremsen sie leicht
    car.speedMul = 1;
    if (!car.traffic && r.player && !r.player.finished && !car.finished) {
      const gap = (r.player.progress - car.progress) / t.n;
      car.speedMul = Math.max(0.94, Math.min(1.05, 1 + gap * 0.12));
    }
    if (car.finished) car.speedMul = 0.75;

    // Geschwindigkeitsplanung: vor Kurven rechtzeitig bremsen
    const vmax = p.maxSpeed * car.speedMul;
    const c = ai.corner * p.steerRate;
    const brakePlan = p.brake * 0.7;
    const scanDist = (vF * vF) / (2 * brakePlan) + 120;
    const steps = Math.min(t.n, Math.ceil(scanDist / t.spacing));
    let target = vmax;
    for (let j = 0; j <= steps; j++) {
      const k = t.curvature[(car.idx + j) % t.n];
      if (k < 1e-4) continue;
      const vc = c / (k + c * 0.35 / p.maxSpeed);
      const allowed = Math.sqrt(vc * vc + 2 * brakePlan * j * t.spacing);
      if (allowed < target) target = allowed;
    }
    if (car.onGrass) target = Math.min(target, vmax * 0.5);

    if (vF < target - 8) {
      car.throttle = 1;
      car.brake = 0;
    } else if (vF > target + 15) {
      car.throttle = 0;
      car.brake = Math.min(1, (vF - target) / 60);
    } else {
      car.throttle = 0.35;
      car.brake = 0;
    }

    // Festgefahren? Kurz zurücksetzen.
    if (r.state === 'race' && Math.abs(vF) < 25 && ai.reverse <= 0) ai.stuck += dt;
    else ai.stuck = Math.max(0, ai.stuck - dt);
    if (ai.stuck > 1.2) {
      ai.stuck = 0;
      ai.reverse = 0.9;
    }
    if (ai.reverse > 0) {
      ai.reverse -= dt;
      car.throttle = 0;
      car.brake = 1;
      car.steerTarget = -Math.sign(diff);
    }
  }

  function physics(r, car, dt) {
    if (car.flat > 0) return;
    const t = r.track;
    const p = car.phys;
    const offroad = !!car.def.monster;

    // Position auf der Strecke und Fortschritt
    const near = nearestOnTrack(t, car.x, car.y, car.idx);
    let d = near.idx - car.idx;
    if (d > t.n / 2) d -= t.n;
    if (d < -t.n / 2) d += t.n;
    car.progress += d;
    car.idx = near.idx;
    car.onGrass = near.dist > t.width / 2 + 6;

    const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    let vF = car.vx * fx + car.vy * fy;
    let vR = -car.vx * fy + car.vy * fx;

    let maxV = p.maxSpeed * car.speedMul;
    if (car.onGrass) maxV *= offroad ? 0.82 : 0.5;

    if (car.throttle > 0) {
      if (vF < 0) vF += p.brake * car.throttle * dt;
      else if (vF < maxV) vF += p.accel * car.throttle * (1 - 0.65 * (vF / maxV) ** 2) * dt;
    }
    if (car.brake > 0) {
      if (vF > 5) vF = Math.max(0, vF - p.brake * car.brake * dt);
      else vF = Math.max(-170, vF - 230 * car.brake * dt);
    }
    if (car.throttle === 0 && car.brake === 0) {
      vF -= Math.sign(vF) * Math.min(Math.abs(vF), 60 * dt);
    }
    if (vF > maxV) vF -= (vF - maxV) * (car.onGrass ? 2.2 : 1.5) * dt;
    vF -= vF * 0.05 * dt;

    // Seitliche Haftung: Rutschen wird abgebaut, auf Gras weniger
    const grip = p.grip * (car.onGrass ? (offroad ? 0.85 : 0.55) : 1);
    vR *= Math.exp(-grip * dt);

    car.vx = fx * vF - fy * vR;
    car.vy = fy * vF + fx * vR;
    car.vF = vF;

    // Lenkung (weich nachgeführt)
    const sd = car.steerTarget - car.steer;
    car.steer += Math.max(-dt * 7, Math.min(dt * 7, sd));
    const lowSpeed = Math.min(1, Math.abs(vF) / 120);
    const highSpeed = 1 - 0.35 * Math.min(1, Math.abs(vF) / p.maxSpeed);
    car.angle = wrapAngle(car.angle + car.steer * p.steerRate * lowSpeed * highSpeed * Math.sign(vF) * dt);

    car.x += car.vx * dt;
    car.y += car.vy * dt;

    // Weltgrenzen
    const b = t.bounds;
    if (car.x < b.minX) { car.x = b.minX; car.vx = Math.abs(car.vx) * 0.3; }
    if (car.x > b.maxX) { car.x = b.maxX; car.vx = -Math.abs(car.vx) * 0.3; }
    if (car.y < b.minY) { car.y = b.minY; car.vy = Math.abs(car.vy) * 0.3; }
    if (car.y > b.maxY) { car.y = b.maxY; car.vy = -Math.abs(car.vy) * 0.3; }
  }

  /* Jedes Auto besteht aus zwei Kreisen (vorne und hinten). */
  function carCircles(car) {
    const off = (car.size.length - car.size.width) / 2;
    const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    const rad = car.size.width / 2 + 1;
    return [
      { x: car.x + fx * off, y: car.y + fy * off, r: rad },
      { x: car.x - fx * off, y: car.y - fy * off, r: rad },
    ];
  }

  function collisions(r) {
    const cars = r.all;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (a.flat > 0 || b.flat > 0) continue;  // über platte Autos fährt man einfach drüber
        if (Math.abs(a.x - b.x) > 70 || Math.abs(a.y - b.y) > 70) continue;
        const ca = carCircles(a), cb = carCircles(b);
        let best = null;
        for (const p of ca) {
          for (const q of cb) {
            const dx = q.x - p.x, dy = q.y - p.y;
            const dist = Math.hypot(dx, dy);
            const overlap = p.r + q.r - dist;
            if (overlap > 0 && (!best || overlap > best.overlap)) {
              best = { overlap, nx: dist > 0 ? dx / dist : 1, ny: dist > 0 ? dy / dist : 0 };
            }
          }
        }
        if (!best) continue;
        // Monstertruck fährt über andere Autos drüber und zerquetscht sie
        const truck = a.def.monster ? a : b.def.monster ? b : null;
        const victim = truck === a ? b : a;
        if (truck && !victim.def.monster && victim.invuln <= 0 && Math.abs(truck.vF) > 25) {
          crush(r, victim, truck);
          continue;
        }
        const ma = a.phys.mass, mb = b.phys.mass;
        const total = ma + mb;
        // Auseinanderschieben
        a.x -= best.nx * best.overlap * (mb / total);
        a.y -= best.ny * best.overlap * (mb / total);
        b.x += best.nx * best.overlap * (ma / total);
        b.y += best.ny * best.overlap * (ma / total);
        // Abprallen
        const rel = (b.vx - a.vx) * best.nx + (b.vy - a.vy) * best.ny;
        if (rel < 0) {
          const e = 0.35;
          const J = -(1 + e) * rel / (1 / ma + 1 / mb);
          a.vx -= (J / ma) * best.nx;
          a.vy -= (J / ma) * best.ny;
          b.vx += (J / mb) * best.nx;
          b.vy += (J / mb) * best.ny;
          // kleiner Dreh-Impuls, damit der Stoß spürbar ist
          const spin = Math.min(0.25, Math.abs(rel) / 2000);
          a.angle += (Math.random() - 0.5) * spin;
          b.angle += (Math.random() - 0.5) * spin;
          if ((a.isPlayer || b.isPlayer) && !r.demo && Math.abs(rel) > 40) Sound.crash(Math.abs(rel) / 400);
        }
      }
    }
  }

  function laps(r, car) {
    const n = r.track.n;
    const lapNow = Math.floor(car.progress / n);
    if (lapNow <= car.lap) return;
    car.lap = lapNow;
    if (lapNow < 1 || car.finished) return;

    const lapTime = r.time - car.lapStart;
    car.lapStart = r.time;
    car.lapTimes.push(lapTime);
    if (car.bestLap === null || lapTime < car.bestLap) car.bestLap = lapTime;

    if (lapNow >= r.laps) {
      car.finished = true;
      car.finishTime = r.time;
      r.finishOrder.push(car);
      if (car.isPlayer) {
        car.autopilot = true;
        r.playerFinishedAt = r.time;
        Sound.finish();
        flashMessage(car.place === 1 ? 'SIEG!' : 'ZIEL!', 2.5);
      }
    } else if (car.isPlayer) {
      Sound.lap();
      flashMessage(lapNow === r.laps - 1 ? 'Letzte Runde!' : `Runde ${lapNow + 1}`, 1.6, true);
    }
  }

  function updatePlaces(r) {
    const sorted = r.cars.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    sorted.forEach((c, i) => { c.place = i + 1; });
    r.standings = sorted;
  }

  // ------------------------------------------------------------------
  // Darstellung (3D)
  // ------------------------------------------------------------------
  let viewMode = 'cockpit';
  try {
    if (localStorage.getItem('racer-view') === 'chase') viewMode = 'chase';
  } catch (e) { /* egal */ }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    Render3D.resize(viewW, viewH, dpr);
  }

  function toggleView() {
    viewMode = viewMode === 'cockpit' ? 'chase' : 'cockpit';
    try { localStorage.setItem('racer-view', viewMode); } catch (e) { /* egal */ }
    if (isRacing()) flashMessage(viewMode === 'cockpit' ? 'Cockpit' : 'Verfolger', 0.9, true);
  }

  // ------------------------------------------------------------------
  // HUD
  // ------------------------------------------------------------------
  const hudCache = {};
  function setText(id, text) {
    if (hudCache[id] === text) return;
    hudCache[id] = text;
    $(id).textContent = text;
  }

  function fmtTime(sec) {
    if (sec === null || sec === undefined) return '–';
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
  }

  let messageTimer = 0;
  function flashMessage(text, duration, small) {
    const el = $('big-message');
    el.textContent = text;
    el.hidden = false;
    el.classList.toggle('small', !!small);
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    messageTimer = duration;
  }

  function updateHud(r, dt) {
    if (messageTimer > 0) {
      messageTimer -= dt;
      if (messageTimer <= 0) $('big-message').hidden = true;
    }
    if (!r.player || r.demo) return;
    const p = r.player;
    setText('hud-pos', String(p.place));
    setText('hud-count', String(r.cars.length));
    setText('hud-lap', String(Math.min(r.laps, Math.max(1, p.lap + 1))));
    setText('hud-laps', String(r.laps));
    const curLap = r.state === 'race' && !p.finished ? r.time - p.lapStart : null;
    setText('hud-time', fmtTime(p.finished ? p.finishTime : (r.state === 'race' ? r.time : 0)));
    setText('hud-last', p.lapTimes.length ? fmtTime(p.lapTimes[p.lapTimes.length - 1]) : (curLap !== null ? '–' : '–'));
    setText('hud-best', fmtTime(p.bestLap));
    setText('hud-speed', String(Math.round(Math.abs(p.vF) * KMH)));
    $('hud-crush').hidden = !p.def.monster;
    if (p.def.monster) setText('hud-crush-count', String(r.crushed));

    const key = r.standings.map(c => c.name).join('|');
    if (hudCache.standings !== key) {
      hudCache.standings = key;
      $('hud-standings').innerHTML = r.standings.map(c =>
        `<li class="${c.isPlayer ? 'me' : ''}"><span class="swatch" style="background:${c.def.color}"></span>${c.place}. ${escapeHtml(c.name)}</li>`
      ).join('');
    }
    $('wrong-way').hidden = !(r.wrongWayT > 1 && !r.paused && screen === 'race');

    if (!r.paused && r.state === 'race') {
      Sound.updateEngine(Math.min(1, Math.abs(p.vF) / p.phys.maxSpeed), p.throttle, p.onGrass && Math.abs(p.vF) > 30);
    } else if (r.state === 'countdown') {
      Sound.updateEngine(0, p.throttle, false);
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // ------------------------------------------------------------------
  // Menüs
  // ------------------------------------------------------------------
  function loadSelection() {
    const def = { car: 0, track: 0, diff: 'mittel' };
    try {
      const s = JSON.parse(localStorage.getItem('racer-selection') || '{}');
      if (Number.isInteger(s.car) && s.car >= 0 && s.car < CAR_DEFS.length) def.car = s.car;
      if (Number.isInteger(s.track) && s.track >= 0 && s.track < TRACK_DEFS.length) def.track = s.track;
      if (DIFFICULTIES[s.diff]) def.diff = s.diff;
    } catch (e) { /* egal */ }
    return def;
  }
  function saveSelection() {
    try { localStorage.setItem('racer-selection', JSON.stringify(sel)); } catch (e) { /* egal */ }
  }

  function showScreen(name) {
    screen = name;
    for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== `screen-${name}`;
    const racingUi = ['race', 'pause', 'results'].includes(name);
    $('hud').hidden = !racingUi;
    $('touch').hidden = !(name === 'race' && isTouch);
    if (!racingUi) {
      $('wrong-way').hidden = true;
      $('big-message').hidden = true;
      Sound.stopEngine();
      if (!race || !race.demo || race.trackIndex !== sel.track) startDemo();
    }
    if (name !== 'race') {
      for (const k in touchKeys) touchKeys[k] = false;
      for (const b of document.querySelectorAll('.touch-btn')) b.classList.remove('active');
    }
  }

  function isRacing() {
    return screen === 'race' && race && !race.demo;
  }

  function startDemo() {
    race = createRace(sel.track, -1, 'schwer', true);
    for (const c of race.cars) c.phys.maxSpeed *= 0.9;
    // ein paar Sekunden vorspulen, damit im Menü schon gefahren wird
    for (let i = 0; i < 6 / DT; i++) step(race, DT);
  }

  function buildCarCards() {
    const list = $('car-list');
    list.innerHTML = '';
    const thumbs = Render3D.ready ? Render3D.carThumbnails(CAR_DEFS, 400, 220) : [];
    CAR_DEFS.forEach((def, i) => {
      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';
      const img = document.createElement('img');
      img.className = 'car-thumb';
      img.alt = def.name;
      if (thumbs[i]) img.src = thumbs[i];
      const s = def.stats;
      const bar = (label, v) => `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${v * 10}%"></i></div></div>`;
      card.appendChild(img);
      card.insertAdjacentHTML('beforeend',
        `<div class="name">${def.name}</div>
         <div class="desc">${def.description}</div>
         <div class="stats">
           ${bar('Tempo', s.speed)}${bar('Beschleunigung', s.accel)}${bar('Handling', s.handling)}${bar('Gewicht', s.weight)}
         </div>`);
      card.addEventListener('click', () => { Sound.init(); Sound.click(); selectCar(i); });
      card.addEventListener('dblclick', () => $('btn-car-next').click());
      list.appendChild(card);
    });
    selectCar(sel.car);
  }

  function selectCar(i) {
    sel.car = i;
    saveSelection();
    [...$('car-list').children].forEach((c, k) => c.classList.toggle('selected', k === i));
  }

  function buildTrackCards() {
    const list = $('track-list');
    list.innerHTML = '';
    tracks.forEach((t, i) => {
      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';
      const cv = document.createElement('canvas');
      cv.width = 440;
      cv.height = 240;
      drawTrackPreview(cv, t);
      card.appendChild(cv);
      card.insertAdjacentHTML('beforeend',
        `<div class="name">${t.def.name}<span class="badge ${t.def.level}">${t.def.level}</span></div>
         <div class="desc">${t.def.description}</div>`);
      card.addEventListener('click', () => { Sound.init(); Sound.click(); selectTrack(i); });
      list.appendChild(card);
    });
    selectTrack(sel.track);

    const dl = $('diff-list');
    dl.innerHTML = '';
    for (const [key, d] of Object.entries(DIFFICULTIES)) {
      const b = document.createElement('button');
      b.className = 'seg-btn';
      b.type = 'button';
      b.dataset.diff = key;
      b.innerHTML = `<strong>${d.label}</strong><span>${d.hint}</span>`;
      b.addEventListener('click', () => { Sound.init(); Sound.click(); selectDiff(key); });
      dl.appendChild(b);
    }
    selectDiff(sel.diff);
  }

  function drawTrackPreview(cv, t) {
    const g = cv.getContext('2d');
    const b = t.bounds;
    const pad = 700 - 60;
    const w = b.maxX - b.minX - 2 * pad, h = b.maxY - b.minY - 2 * pad;
    const s = Math.min((cv.width - 40) / w, (cv.height - 40) / h);
    g.fillStyle = t.def.grass;
    g.fillRect(0, 0, cv.width, cv.height);
    g.save();
    g.translate(cv.width / 2, cv.height / 2);
    g.scale(s, s);
    g.translate(-(b.minX + b.maxX) / 2, -(b.minY + b.maxY) / 2);
    g.lineJoin = 'round';
    g.strokeStyle = '#c8302c';
    g.lineWidth = t.width + 60;
    g.stroke(t.path);
    g.strokeStyle = '#55585e';
    g.lineWidth = t.width + 20;
    g.stroke(t.path);
    // Start/Ziel
    g.translate(t.x[0], t.y[0]);
    g.rotate(t.heading[0]);
    g.fillStyle = '#fff';
    g.fillRect(-25, -t.width, 50, t.width * 2);
    g.restore();
  }

  function selectTrack(i) {
    sel.track = i;
    saveSelection();
    [...$('track-list').children].forEach((c, k) => c.classList.toggle('selected', k === i));
    if (race && race.demo && race.trackIndex !== i) startDemo();
  }

  function selectDiff(key) {
    sel.diff = key;
    saveSelection();
    for (const b of $('diff-list').children) b.classList.toggle('selected', b.dataset.diff === key);
  }

  function startRace() {
    Sound.init();
    race = createRace(sel.track, sel.car, sel.diff, false);
    hudCache.standings = null;
    showScreen('race');
    Sound.startEngine();
  }

  function pause() {
    if (!race || race.demo || race.resultsShown) return;
    race.paused = true;
    for (const k in keys) keys[k] = false;
    Sound.stopEngine();
    showScreen('pause');
  }

  function resume() {
    if (!race) return;
    race.paused = false;
    showScreen('race');
    Sound.init();
    Sound.startEngine();
  }

  function toggleMute() {
    Sound.init();
    const m = Sound.toggleMute();
    $('btn-mute').textContent = m ? '🔇' : '🔊';
  }

  function showResults() {
    showScreen('results');
    Sound.stopEngine();
    renderResults();
  }

  function renderResults() {
    const r = race;
    const p = r.player;
    const place = p.place;
    $('results-title').textContent = place === 1 ? 'Sieg! Du bist Erster!' : `Du bist ${place}. geworden`;
    const best = p.bestLap !== null ? ` · Beste Runde ${fmtTime(p.bestLap)}` : '';
    const crushed = p.def.monster ? ` · ${r.crushed} ${r.crushed === 1 ? 'Auto' : 'Autos'} zerquetscht` : '';
    $('results-sub').textContent = `${r.track.def.name} · ${DIFFICULTIES[r.diffKey].label} · ${p.def.name}${best}${crushed}`;
    $('results-body').innerHTML = r.standings.map(c => {
      const time = c.finished
        ? (c === r.standings[0] ? fmtTime(c.finishTime) : `+${fmtTime(c.finishTime - r.standings[0].finishTime)}`)
        : `<span class="pending">fährt noch (Runde ${Math.min(r.laps, Math.max(1, c.lap + 1))})</span>`;
      return `<tr class="${c.isPlayer ? 'me' : ''}">
        <td class="place">${c.place}.</td>
        <td><span class="swatch" style="background:${c.def.color}"></span>${escapeHtml(c.name)}</td>
        <td class="hide-sm">${c.def.name}</td>
        <td>${time}</td>
        <td class="hide-sm">${fmtTime(c.bestLap)}</td>
      </tr>`;
    }).join('');
  }

  // Knöpfe verbinden
  $('btn-start').addEventListener('click', () => { Sound.init(); Sound.click(); showScreen('car'); });
  $('btn-car-next').addEventListener('click', () => { Sound.click(); showScreen('track'); });
  $('btn-race').addEventListener('click', () => startRace());
  $('btn-resume').addEventListener('click', () => resume());
  $('btn-restart').addEventListener('click', () => startRace());
  $('btn-quit').addEventListener('click', () => showScreen('main'));
  $('btn-again').addEventListener('click', () => startRace());
  $('btn-menu').addEventListener('click', () => showScreen('main'));
  $('btn-pause').addEventListener('click', () => pause());
  $('btn-mute').addEventListener('click', () => toggleMute());
  $('btn-cam').addEventListener('click', () => toggleView());
  for (const b of document.querySelectorAll('[data-goto]')) {
    b.addEventListener('click', () => { Sound.click(); showScreen(b.dataset.goto); });
  }
  $('btn-mute').textContent = Sound.muted ? '🔇' : '🔊';

  // ------------------------------------------------------------------
  // Hauptschleife
  // ------------------------------------------------------------------
  let last = performance.now();
  let acc = 0;
  let resultsRefresh = 0;

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (race && !race.paused) {
      acc += dt;
      while (acc >= DT) {
        step(race, DT);
        acc -= DT;
      }
      if (race.demo) {
        // Im Menü wechselt die Kamera ab und zu das Auto
        race.followTimer += dt;
        if (race.followTimer > 9) {
          race.followTimer = 0;
          race.follow = race.cars[(race.cars.indexOf(race.follow) + 1) % race.cars.length];
        }
      }
    }
    if (race && Render3D.ready) {
      Render3D.render(race, dt, viewMode);
      updateHud(race, dt);
      if (screen === 'results') {
        resultsRefresh -= dt;
        if (resultsRefresh <= 0) {
          resultsRefresh = 0.3;
          renderResults();
        }
      }
    }
    requestAnimationFrame(frame);
  }

  try {
    Render3D.init(canvas);
  } catch (e) {
    console.error(e);
    $('webgl-error').hidden = false;
    $('btn-start').disabled = true;
  }
  window.addEventListener('resize', resize);
  resize();
  buildCarCards();
  buildTrackCards();
  showScreen('main');
  requestAnimationFrame(frame);

  // Schnittstelle für automatische Tests
  window.__racer = {
    get race() { return race; },
    get screen() { return screen; },
    startRace,
    simulate(seconds) {
      const steps = Math.round(seconds / DT);
      for (let i = 0; i < steps; i++) step(race, DT);
    },
    createRace,
    step,
    DIFFICULTIES,
  };
})();
