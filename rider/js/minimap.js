'use strict';
/*
 * Karten: kleine Karte in jeder Bildschirmhälfte (dreht sich mit, Blickrichtung oben)
 * und die große Karte der ganzen Gemeinde.
 */
const MapView = (() => {
  const S = 0.25;               // Pixel pro Meter auf dem vorgezeichneten Kartenbild
  const PAD = 300;              // Rand um die Gemeinde in Metern
  let img = null, ox = 0, oy = 0;

  const AREA = {
    1: '#bcd89a', 2: '#7fa968', 3: '#e3ddd0', 4: '#ddd3bd', 5: '#b8d0a0', 6: '#d8d2c6', 7: '#c4dc9c',
    8: '#b5da98', 9: '#a3d18a', 10: '#8fbde3', 11: '#dacbb0', 12: '#cddcae', 13: '#cfcfcf',
  };
  const ROAD = ['#f0c24a', '#f3d36b', '#fbe7a1', '#ffffff', '#ffffff', '#b89870', '#c9b391', '#9a9a9a', '#b4b4b4'];
  const RW = [9, 8, 7, 5.5, 4, 3.2, 2, 45, 18];

  function build() {
    const D = World.data;
    const [x0, y0, x1, y1] = D.bounds;
    ox = x0 - PAD; oy = y0 - PAD;
    const w = Math.ceil((x1 - x0 + PAD * 2) * S), h = Math.ceil((y1 - y0 + PAD * 2) * S);
    img = document.createElement('canvas');
    img.width = w; img.height = h;
    const g = img.getContext('2d');
    g.fillStyle = '#e8e6c8';
    g.fillRect(0, 0, w, h);
    const path = (p, close) => {
      g.beginPath();
      for (let i = 0; i < p.length; i += 2) {
        const X = (p[i] - ox) * S, Y = (p[i + 1] - oy) * S;
        if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
      }
      if (close) g.closePath();
    };
    for (const a of D.areas) {
      const c = AREA[a.cls];
      if (!c) continue;
      g.fillStyle = c;
      path(a.pts, true);
      g.fill();
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const wl of D.water) {
      g.strokeStyle = '#6ea6d6';
      g.lineWidth = Math.max(1, (wl.cls === 0 ? 5 : 2.5) * S);
      path(wl.pts);
      g.stroke();
    }
    for (const p of D.rail) {
      g.strokeStyle = '#7d7468';
      g.lineWidth = 1.5;
      path(p);
      g.stroke();
    }
    const order = D.roads.slice().sort((a, b) => b.cls - a.cls);
    for (const r of order) {
      g.strokeStyle = r.cls <= 2 ? '#a08a4a' : r.cls <= 4 ? '#b9b2a2' : null;
      if (g.strokeStyle && r.cls <= 4) {
        g.lineWidth = Math.max(1.6, (RW[r.cls] + 3) * S);
        path(r.pts);
        g.stroke();
      }
    }
    for (const r of order) {
      g.strokeStyle = ROAD[r.cls];
      g.lineWidth = Math.max(r.cls >= 5 && r.cls < 7 ? 0.9 : 1.2, RW[r.cls] * S);
      path(r.pts);
      g.stroke();
    }
    g.fillStyle = '#a8968a';
    for (const b of D.buildings) {
      path(b.pts, true);
      g.fill();
    }
    // außerhalb der Gemeinde abdunkeln
    g.save();
    g.beginPath();
    g.rect(0, 0, w, h);
    const bp = D.boundary;
    for (let i = 0; i < bp.length; i += 2) {
      const X = (bp[i] - ox) * S, Y = (bp[i + 1] - oy) * S;
      if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
    }
    g.closePath();
    g.fillStyle = 'rgba(70, 70, 60, 0.35)';
    g.fill('evenodd');
    g.restore();
    g.strokeStyle = '#c0392b';
    g.lineWidth = 2;
    g.setLineDash([8, 5]);
    path(D.boundary, true);
    g.stroke();
    g.setLineDash([]);
    // Reitplatz
    const A = World.arena;
    if (A) {
      g.fillStyle = '#e2cfa4';
      g.fillRect((A.x - A.w / 2 - ox) * S, (A.y - A.d / 2 - oy) * S, A.w * S, A.d * S);
    }
  }

  function arrow(g, x, y, ang, size, fill) {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.beginPath();
    g.moveTo(0, -size);
    g.lineTo(size * 0.7, size * 0.75);
    g.lineTo(0, size * 0.35);
    g.lineTo(-size * 0.7, size * 0.75);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = '#fff';
    g.stroke();
    g.restore();
  }

  /**
   * Kleine Karte. me/other: Spielerobjekte {x, y, heading, color}.
   * range: Meter vom Mittelpunkt bis zum Rand.
   */
  function drawMini(canvas, me, others, range) {
    if (!img) return;
    const dpr = canvas._dpr || 1;
    const size = canvas.width;
    const g = canvas.getContext('2d');
    const R = size / 2;
    const k = R / range;            // Pixel pro Meter
    g.save();
    g.clearRect(0, 0, size, size);
    g.beginPath();
    g.arc(R, R, R - 2 * dpr, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#e8e6c8';
    g.fillRect(0, 0, size, size);
    g.translate(R, R);
    g.rotate(-me.heading);
    // Bildausschnitt
    g.imageSmoothingEnabled = true;
    const sx = (me.x - range * 1.5 - ox) * S, sy = (me.y - range * 1.5 - oy) * S, sw = range * 3 * S;
    g.drawImage(img, sx, sy, sw, sw, -range * 1.5 * k, -range * 1.5 * k, range * 3 * k, range * 3 * k);
    // Hufeisen in der Nähe
    for (const s of World.items.shoes) {
      if (s.got) continue;
      const dx = s.x - me.x, dy = s.y - me.y;
      if (Math.abs(dx) > range * 1.5 || Math.abs(dy) > range * 1.5) continue;
      g.beginPath();
      g.arc(dx * k, dy * k, 3.6 * dpr, 0, Math.PI * 2);
      g.fillStyle = '#ffcc00';
      g.fill();
      g.lineWidth = 1.2 * dpr;
      g.strokeStyle = '#7a5a00';
      g.stroke();
    }
    for (const f of World.items.food) {
      if (f.respawn > 0) continue;
      const dx = f.x - me.x, dy = f.y - me.y;
      if (Math.abs(dx) > range * 1.5 || Math.abs(dy) > range * 1.5) continue;
      g.beginPath();
      g.arc(dx * k, dy * k, 2.2 * dpr, 0, Math.PI * 2);
      g.fillStyle = f.kind === 'apple' ? '#d8352a' : '#f08a1c';
      g.fill();
    }
    for (const o of others) {
      const dx = o.x - me.x, dy = o.y - me.y;
      let px = dx * k, py = dy * k;
      // am Rand festhalten, wenn weit weg
      const c = Math.cos(-me.heading), s = Math.sin(-me.heading);
      const rx = px * c - py * s, ry = px * s + py * c;
      const d = Math.hypot(rx, ry), lim = R - 10 * dpr;
      if (d > lim) { px *= lim / d; py *= lim / d; }
      arrow(g, px, py, o.heading, 7 * dpr, o.color);
    }
    g.restore();
    // eigener Pfeil in der Mitte, Norden am Rand
    arrow(g, R, R, 0, 9 * dpr, me.color);
    const nx = R - Math.sin(me.heading) * (R - 11 * dpr), ny = R - Math.cos(me.heading) * (R - 11 * dpr);
    g.fillStyle = '#c0392b';
    g.font = `bold ${12 * dpr}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny);
    g.beginPath();
    g.arc(R, R, R - 2 * dpr, 0, Math.PI * 2);
    g.lineWidth = 3 * dpr;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.stroke();
  }

  /** Große Karte: ganze Gemeinde, Ortsnamen, Entdeckungen, beide Reiterinnen. */
  function drawBig(canvas, players, discovered) {
    if (!img) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth * dpr, H = canvas.clientHeight * dpr;
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    g.fillStyle = '#d9d6b8';
    g.fillRect(0, 0, W, H);
    const scale = Math.min(W / img.width, H / img.height) * 0.98;
    const dw = img.width * scale, dh = img.height * scale;
    const x0 = (W - dw) / 2, y0 = (H - dh) / 2;
    g.drawImage(img, x0, y0, dw, dh);
    const k = S * scale;
    const P = (x, y) => [x0 + (x - ox) * k, y0 + (y - oy) * k];

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Sehenswürdigkeiten
    for (const d of World.discoverables) {
      if (d.village) continue;
      const [X, Y] = P(d.x, d.y);
      const got = discovered.has(d.id);
      g.beginPath();
      g.arc(X, Y, 6 * dpr, 0, Math.PI * 2);
      g.fillStyle = got ? '#ffb400' : 'rgba(255,255,255,0.85)';
      g.fill();
      g.lineWidth = 1.5 * dpr;
      g.strokeStyle = '#5a4300';
      g.stroke();
      g.fillStyle = '#3a2c00';
      g.font = `bold ${9 * dpr}px system-ui, sans-serif`;
      g.fillText(got ? '★' : '?', X, Y + 0.5 * dpr);
    }
    // Ortsnamen
    for (const p of World.places) {
      const [X, Y] = P(p.x, p.y);
      const got = discovered.has('p:' + p.name);
      const shoes = World.items.shoes.filter(s => s.place === p.name);
      const have = shoes.filter(s => s.got).length;
      const fs = (p.village ? 14 : 11) * dpr;
      g.font = `800 ${fs}px system-ui, sans-serif`;
      g.lineWidth = 4 * dpr;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeText(p.name, X, Y);
      g.fillStyle = got ? '#1d2a10' : '#6a6a5a';
      g.fillText(p.name, X, Y);
      if (shoes.length) {
        const t = `${have}/${shoes.length}`;
        g.font = `700 ${10 * dpr}px system-ui, sans-serif`;
        g.strokeText('U ' + t, X, Y + fs);
        g.fillStyle = have === shoes.length ? '#2e7d32' : '#7a5a00';
        g.fillText('U ' + t, X, Y + fs);
      }
    }
    players.forEach((pl, i) => {
      const [X, Y] = P(pl.x, pl.y);
      arrow(g, X, Y, pl.heading, 11 * dpr, pl.color);
      const ly = Y + (i === 0 ? -20 : 22) * dpr;
      g.font = `800 ${12 * dpr}px system-ui, sans-serif`;
      g.lineWidth = 4 * dpr;
      g.strokeStyle = '#fff';
      g.strokeText(pl.name, X, ly);
      g.fillStyle = pl.color;
      g.fillText(pl.name, X, ly);
    });
    // Nordpfeil und Maßstab
    g.fillStyle = '#c0392b';
    g.font = `900 ${16 * dpr}px system-ui, sans-serif`;
    g.fillText('N ↑', W - 40 * dpr, 24 * dpr);
    const km = 1000 * k;
    g.fillStyle = '#222';
    g.fillRect(20 * dpr, H - 24 * dpr, km, 4 * dpr);
    g.font = `700 ${11 * dpr}px system-ui, sans-serif`;
    g.textAlign = 'left';
    g.fillText('1 km', 20 * dpr, H - 34 * dpr);
    g.textAlign = 'right';
    g.fillText('Kartendaten © OpenStreetMap-Mitwirkende', W - 12 * dpr, H - 14 * dpr);
  }

  return { build, drawMini, drawBig };
})();
