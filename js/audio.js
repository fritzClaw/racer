/* Soundeffekte, komplett mit der Web Audio API erzeugt (keine Audiodateien nötig). */
'use strict';

const Sound = (() => {
  let ctx = null;
  let master = null;
  let muted = false;
  let engine = null;
  let rumble = null;
  let noiseBuffer = null;

  try {
    muted = localStorage.getItem('racer-muted') === '1';
  } catch (e) { /* Speicher nicht verfügbar */ }

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);

    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  function startEngine() {
    if (!ctx || engine) return;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    osc1.connect(filter);
    osc2.connect(g2).connect(filter);
    filter.connect(gain).connect(master);
    osc1.frequency.value = 50;
    osc2.frequency.value = 25;
    osc1.start();
    osc2.start();
    engine = { osc1, osc2, filter, gain };

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 300;
    const rg = ctx.createGain();
    rg.gain.value = 0;
    src.connect(rf).connect(rg).connect(master);
    src.start();
    rumble = { src, gain: rg };
  }

  function stopEngine() {
    if (!engine) return;
    const t = ctx.currentTime;
    for (const node of [engine, rumble]) node.gain.gain.setTargetAtTime(0, t, 0.05);
    const e = engine, r = rumble;
    setTimeout(() => {
      e.osc1.stop(); e.osc2.stop(); r.src.stop();
    }, 300);
    engine = null;
    rumble = null;
  }

  /* speedRatio: 0..1, throttle: 0..1, onGrass: bool */
  function updateEngine(speedRatio, throttle, onGrass) {
    if (!engine) return;
    const t = ctx.currentTime;
    // Kleine "Gangwechsel": Drehzahl steigt in 4 Stufen an
    const gears = 4;
    const g = Math.min(gears - 1, Math.floor(speedRatio * gears));
    const inGear = speedRatio * gears - g;
    const rpm = 0.25 + inGear * 0.6 + g * 0.08;
    const freq = 45 + rpm * 120 + speedRatio * 30;
    engine.osc1.frequency.setTargetAtTime(freq, t, 0.04);
    engine.osc2.frequency.setTargetAtTime(freq / 2, t, 0.04);
    engine.filter.frequency.setTargetAtTime(400 + throttle * 900 + speedRatio * 600, t, 0.05);
    engine.gain.gain.setTargetAtTime(0.06 + throttle * 0.05 + speedRatio * 0.03, t, 0.05);
    rumble.gain.gain.setTargetAtTime(onGrass ? 0.12 * Math.min(1, speedRatio * 3) : 0, t, 0.05);
  }

  function tone(freq, duration, type, volume, delay) {
    if (!ctx) return;
    const t = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume || 0.15, t + 0.01);
    gain.gain.setValueAtTime(volume || 0.15, t + duration * 0.7);
    gain.gain.linearRampToValueAtTime(0, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  function crash(intensity) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500 + Math.random() * 400;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    const v = Math.min(0.5, 0.08 + intensity * 0.4);
    gain.gain.setValueAtTime(v, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + 0.3);
  }

  /* Zerquetschen: dumpfer Schlag, Knirschen und ein absinkender Blechton */
  function crush() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const thump = ctx.createOscillator();
    const tg = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(110, t);
    thump.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    tg.gain.setValueAtTime(0.45, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    thump.connect(tg).connect(master);
    thump.start(t);
    thump.stop(t + 0.32);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.35);
    f.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(f).connect(ng).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.42);

    const metal = ctx.createOscillator();
    const mg = ctx.createGain();
    metal.type = 'square';
    metal.frequency.setValueAtTime(260, t);
    metal.frequency.exponentialRampToValueAtTime(70, t + 0.3);
    mg.gain.setValueAtTime(0.07, t);
    mg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    metal.connect(mg).connect(master);
    metal.start(t);
    metal.stop(t + 0.32);
  }

  return {
    init,
    crush,
    startEngine,
    stopEngine,
    updateEngine,
    crash,
    countdown() { tone(440, 0.18, 'square', 0.12); },
    go() { tone(880, 0.5, 'square', 0.14); },
    lap() {
      tone(660, 0.12, 'triangle', 0.18);
      tone(990, 0.2, 'triangle', 0.18, 0.12);
    },
    finish() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i === 3 ? 0.5 : 0.15, 'triangle', 0.2, i * 0.14));
    },
    click() { tone(700, 0.05, 'triangle', 0.08); },
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('racer-muted', muted ? '1' : '0'); } catch (e) { /* egal */ }
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.02);
      return muted;
    },
  };
})();
