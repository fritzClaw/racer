/* Autos: Werte (1–10) und Aussehen. Die Werte werden in game.js in Fahrphysik umgerechnet. */
'use strict';

const CAR_DEFS = [
  {
    id: 'blitz',
    name: 'Roter Blitz',
    description: 'Sehr hohe Endgeschwindigkeit, braucht aber Platz in den Kurven.',
    color: '#d7263d',
    accent: '#ffffff',
    shape: 'sport',
    stats: { speed: 9, accel: 6, handling: 6, weight: 5 },
  },
  {
    id: 'biene',
    name: 'Gelbe Biene',
    description: 'Klein und leicht. Zieht aus jeder Kurve blitzschnell heraus.',
    color: '#f6c90e',
    accent: '#222222',
    shape: 'compact',
    stats: { speed: 6, accel: 9, handling: 7, weight: 3 },
  },
  {
    id: 'kurve',
    name: 'Grüne Kurve',
    description: 'Liegt wie ein Brett auf der Straße. Perfekt für enge Strecken.',
    color: '#1b998b',
    accent: '#c5f4e0',
    shape: 'low',
    stats: { speed: 6, accel: 6, handling: 10, weight: 5 },
  },
  {
    id: 'brummer',
    name: 'Blauer Brummer',
    description: 'Schwer und kräftig. Wer ihn rammt, prallt einfach ab.',
    color: '#2e5eaa',
    accent: '#f0f0f0',
    shape: 'heavy',
    stats: { speed: 8, accel: 5, handling: 5, weight: 9 },
  },
  {
    id: 'violetta',
    name: 'Violetta',
    description: 'Der Allrounder: kann alles ein bisschen gut.',
    color: '#8e44ad',
    accent: '#f7d6ff',
    shape: 'classic',
    stats: { speed: 7, accel: 7, handling: 8, weight: 5 },
  },
];

const AI_DRIVERS = ['Rita Rakete', 'Klaus Kurve', 'Tina Turbo', 'Paul Piste', 'Greta Gas'];

/* Fahrphysik-Werte aus den Spielwerten berechnen. */
function carPhysics(def) {
  const s = def.stats;
  return {
    maxSpeed: 380 + s.speed * 20,      // Pixel pro Sekunde
    accel: 170 + s.accel * 25,         // Pixel pro Sekunde²
    brake: 650,
    steerRate: 1.8 + s.handling * 0.13, // Bogenmaß pro Sekunde
    grip: 4 + s.handling * 0.7,        // wie schnell seitliches Rutschen abgebaut wird
    mass: 0.6 + s.weight * 0.1,
  };
}

/* Abmessungen je Bauform */
function carSize(def) {
  switch (def.shape) {
    case 'compact': return { length: 38, width: 21 };
    case 'heavy': return { length: 48, width: 25 };
    case 'low': return { length: 45, width: 22 };
    default: return { length: 44, width: 22 };
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* Auto von oben zeichnen. Fahrtrichtung = +x im lokalen Koordinatensystem. */
function drawCar(ctx, def, x, y, angle, opts) {
  const { length: L, width: W } = carSize(def);
  const braking = opts && opts.braking;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Schatten
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(ctx, -L / 2 + 3, -W / 2 + 4, L, W, 6);
  ctx.fill();

  // Räder
  ctx.fillStyle = '#151515';
  const wl = 9, ww = 4;
  const wx = L / 2 - 10;
  for (const sx of [-wx, wx - wl]) {
    ctx.fillRect(sx, -W / 2 - 2, wl, ww);
    ctx.fillRect(sx, W / 2 - 2, wl, ww);
  }

  // Karosserie
  ctx.fillStyle = def.color;
  const r = def.shape === 'heavy' ? 4 : def.shape === 'compact' ? 9 : 7;
  roundRect(ctx, -L / 2, -W / 2, L, W, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Bauform-Details
  ctx.fillStyle = def.accent;
  if (def.shape === 'sport') {
    ctx.fillRect(-L / 2, -2.5, L, 5);                 // Mittelstreifen
    ctx.fillStyle = '#222';
    ctx.fillRect(-L / 2 - 2, -W / 2 + 1, 4, W - 2);   // Heckspoiler
  } else if (def.shape === 'compact') {
    ctx.beginPath();
    ctx.arc(-2, 0, 3.5, 0, Math.PI * 2);              // Punkt auf dem Dach
    ctx.fill();
  } else if (def.shape === 'low') {
    ctx.fillRect(-L / 2 + 4, -W / 2 + 1.5, L - 8, 2); // Seitenstreifen
    ctx.fillRect(-L / 2 + 4, W / 2 - 3.5, L - 8, 2);
  } else if (def.shape === 'heavy') {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-L / 2 + 6, -W / 2 + 4, 14, W - 8);  // Dachgepäckträger
    ctx.strokeStyle = def.accent;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-L / 2 + 8 + i * 5, -W / 2 + 4);
      ctx.lineTo(-L / 2 + 8 + i * 5, W / 2 - 4);
      ctx.stroke();
    }
  } else if (def.shape === 'classic') {
    ctx.fillRect(-L / 2, -5, L, 2.5);
    ctx.fillRect(-L / 2, 2.5, L, 2.5);
  }

  // Frontscheibe und Heckscheibe
  ctx.fillStyle = 'rgba(25,40,60,0.85)';
  const fx = def.shape === 'compact' ? 3 : 5;
  ctx.beginPath();
  ctx.moveTo(fx, -W / 2 + 3);
  ctx.lineTo(fx + 8, -W / 2 + 5);
  ctx.lineTo(fx + 8, W / 2 - 5);
  ctx.lineTo(fx, W / 2 - 3);
  ctx.closePath();
  ctx.fill();
  if (def.shape !== 'heavy') {
    ctx.beginPath();
    ctx.moveTo(-L / 2 + 6, -W / 2 + 5);
    ctx.lineTo(-L / 2 + 11, -W / 2 + 3.5);
    ctx.lineTo(-L / 2 + 11, W / 2 - 3.5);
    ctx.lineTo(-L / 2 + 6, W / 2 - 5);
    ctx.closePath();
    ctx.fill();
  }

  // Scheinwerfer und Rücklichter
  ctx.fillStyle = '#fff6b0';
  ctx.fillRect(L / 2 - 3, -W / 2 + 2, 3, 4);
  ctx.fillRect(L / 2 - 3, W / 2 - 6, 3, 4);
  ctx.fillStyle = braking ? '#ff2a2a' : '#8a1010';
  ctx.fillRect(-L / 2, -W / 2 + 2, 2.5, 4);
  ctx.fillRect(-L / 2, W / 2 - 6, 2.5, 4);
  if (braking) {
    ctx.fillStyle = 'rgba(255,40,40,0.35)';
    ctx.beginPath();
    ctx.arc(-L / 2 - 2, -W / 2 + 4, 5, 0, Math.PI * 2);
    ctx.arc(-L / 2 - 2, W / 2 - 4, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

if (typeof module !== 'undefined') {
  module.exports = { CAR_DEFS, AI_DRIVERS, carPhysics, carSize };
}
