/* Autos: Werte (1–10), Farben und Abmessungen. Das 3D-Modell entsteht in render3d.js. */
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
  {
    id: 'monster',
    name: 'Monstertruck',
    description: 'Riesige Räder: fährt über alle anderen Autos drüber und macht sie platt. Auch im Gras kaum langsamer.',
    color: '#ff7a00',
    accent: '#1d1d1d',
    shape: 'monster',
    monster: true,
    stats: { speed: 7, accel: 6, handling: 4, weight: 10 },
  },
];

/* Verkehr: Autos, die nur herumfahren (und vom Monstertruck platt gemacht werden). */
const TRAFFIC_DEFS = [
  ['#c9ccd1', 'classic'], ['#f2f2f2', 'compact'], ['#2b2d33', 'classic'], ['#6c8ebf', 'compact'],
  ['#a33b3b', 'classic'], ['#5d7f4f', 'heavy'], ['#d9b26f', 'compact'], ['#3f5e8c', 'heavy'],
].map(([color, shape], i) => ({
  id: `verkehr-${i}`,
  name: 'Verkehr',
  color,
  accent: '#ffffff',
  shape,
  lite: true,
  stats: { speed: 3, accel: 3, handling: 6, weight: 4 },
}));

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
    case 'monster': return { length: 54, width: 32 };
    default: return { length: 44, width: 22 };
  }
}

if (typeof module !== 'undefined') {
  module.exports = { CAR_DEFS, TRAFFIC_DEFS, AI_DRIVERS, carPhysics, carSize };
}
