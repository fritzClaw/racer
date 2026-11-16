/* Geräusche, komplett mit der Web Audio API erzeugt (keine Audiodateien nötig). */
'use strict';

const Sound = (() => {
  let ctx = null, master = null, noise = null, wind = null;
  let muted = false;
  try { muted = localStorage.getItem('rider-muted') === '1'; } catch (e) { /* egal */ }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startWind();
  }

  function startWind() {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    wind = { f, g };
  }

  /** Fahrtwind abhängig von der schnellsten Reiterin (0..1). */
  function setWind(level) {
    if (!ctx || !wind) return;
    const t = ctx.currentTime;
    wind.g.gain.setTargetAtTime(level * level * 0.12, t, 0.3);
    wind.f.frequency.setTargetAtTime(300 + level * 700, t, 0.3);
  }

  function burst(time, freq, q, dur, vol, type) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type || 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(f).connect(g).connect(master);
    src.start(time, Math.random() * 0.5);
    src.stop(time + dur + 0.05);
  }

  function tone(time, freq, dur, vol, type, freqEnd) {
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, time);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    o.connect(g).connect(master);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  /** Hufschlag. surface: 'road' | 'ground' | 'water'; pan: -1..1 (Bildschirmseite) */
  function hoof(surface, gait, pan) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const vol = gait === 3 ? 0.5 : gait === 2 ? 0.42 : 0.32;
    const out = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const prev = master;
    if (out) { out.pan.value = pan || 0; out.connect(master); master = out; }
    if (surface === 'road') {
      burst(t, 2200 + Math.random() * 600, 3, 0.05, vol * 0.7);
      tone(t, 260 + Math.random() * 40, 0.05, vol * 0.25, 'triangle', 180);
    } else if (surface === 'water') {
      burst(t, 900 + Math.random() * 400, 1.2, 0.18, vol * 0.6);
      burst(t + 0.03, 2500, 2, 0.12, vol * 0.3);
    } else {
      burst(t, 300 + Math.random() * 120, 1.4, 0.09, vol * 0.9, 'lowpass');
      tone(t, 95, 0.08, vol * 0.35, 'sine', 60);
    }
    master = prev;
  }

  function collect() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    [784, 988, 1175, 1568].forEach((f, i) => tone(t + i * 0.06, f, 0.22, 0.16, 'triangle'));
  }

  function eat() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) burst(t + i * 0.08, 1800 + Math.random() * 800, 2, 0.06, 0.25);
    tone(t + 0.35, 520, 0.15, 0.08, 'sine', 700);
  }

  function discover() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.12, f, 0.45, 0.14, 'square'));
    tone(t + 0.48, 1047, 0.8, 0.12, 'triangle');
  }

  function jump() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    burst(t, 600, 0.8, 0.35, 0.18);
  }

  function land() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    burst(t, 220, 1, 0.18, 0.6, 'lowpass');
    burst(t + 0.07, 260, 1, 0.14, 0.45, 'lowpass');
  }

  function bump() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    burst(t, 160, 1, 0.2, 0.5, 'lowpass');
  }

  /** Wiehern: Tonhöhe springt und zittert. */
  function whinny() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const lg = ctx.createGain();
    lg.gain.value = 60;
    lfo.connect(lg).connect(o.frequency);
    o.frequency.setValueAtTime(900, t);
    o.frequency.linearRampToValueAtTime(1250, t + 0.15);
    o.frequency.linearRampToValueAtTime(700, t + 0.9);
    o.frequency.linearRampToValueAtTime(450, t + 1.3);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1300;
    f.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.08);
    g.gain.setValueAtTime(0.12, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.35);
    o.connect(f).connect(g).connect(master);
    o.start(t); lfo.start(t);
    o.stop(t + 1.4); lfo.stop(t + 1.4);
  }

  function snort() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    burst(t, 700, 0.7, 0.45, 0.3);
  }

  function bird() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const base = 2500 + Math.random() * 1500;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) tone(t + i * 0.11, base, 0.08, 0.025, 'sine', base * (1.2 + Math.random() * 0.4));
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('rider-muted', m ? '1' : '0'); } catch (e) { /* egal */ }
    if (master) master.gain.value = m ? 0 : 0.8;
  }

  return {
    init, hoof, collect, eat, discover, jump, land, bump, whinny, snort, bird, setWind, setMuted,
    get muted() { return muted; },
  };
})();
