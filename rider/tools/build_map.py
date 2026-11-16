#!/usr/bin/env python3
"""Wandelt einen OpenStreetMap-Export (Overpass-JSON) der Gemeinde Nörvenich
in die kompakte Kartendatei js/mapdata.js um.

Aufruf:
    python3 tools/build_map.py noervenich.json js/mapdata.js

Die Overpass-Abfrage dazu steht in tools/query.overpassql.

Koordinaten: Meter, Ursprung im Mittelpunkt der Gemeinde.
x zeigt nach Osten, y nach Süden (wie im Racer: x -> X, y -> Z in 3D).
Alle Koordinaten werden in halben Metern als ganze Zahlen gespeichert; in jeder
Linie ist nur der erste Punkt absolut, die übrigen sind Differenzen zum Vorgänger.
"""
import json
import math
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'noervenich.json'
DST = sys.argv[2] if len(sys.argv) > 2 else 'js/mapdata.js'

data = json.load(open(SRC, encoding='utf-8'))
els = data['elements']

# ---------------------------------------------------------------- Projektion
boundary_rel = next(e for e in els if e['type'] == 'relation'
                    and e.get('tags', {}).get('boundary') == 'administrative')
blat = [p['lat'] for m in boundary_rel['members'] if m['type'] == 'way' for p in m['geometry']]
blon = [p['lon'] for m in boundary_rel['members'] if m['type'] == 'way' for p in m['geometry']]
LAT0 = (min(blat) + max(blat)) / 2
LON0 = (min(blon) + max(blon)) / 2
KX = math.cos(math.radians(LAT0)) * 111320.0
KY = 110574.0


def proj(p):
    return ((p['lon'] - LON0) * KX, -(p['lat'] - LAT0) * KY)


# ---------------------------------------------------------------- Helfer
def simplify(pts, tol):
    """Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        ll = dx * dx + dy * dy
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if ll == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / ll))
                d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def ring(pts, tol):
    """Geschlossener Ring ohne doppelten Endpunkt, vereinfacht."""
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return None
    # Douglas-Peucker auf offenem Ring: am weitesten entfernten Punkt teilen
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    a = simplify(pts[:far + 1], tol)
    b = simplify(pts[far:] + [pts[0]], tol)
    out = a[:-1] + b[:-1]
    return out if len(out) >= 3 else None


def area(pts):
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return s / 2


def enc(pts):
    """Halbe Meter, Differenzen."""
    out = []
    px = py = 0
    for i, (x, y) in enumerate(pts):
        qx, qy = int(round(x * 2)), int(round(y * 2))
        if i == 0:
            out += [qx, qy]
        else:
            if qx == px and qy == py:
                continue
            out += [qx - px, qy - py]
        px, py = qx, qy
    return out


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def assemble(ways):
    """Wege (Listen von Punkten) zu geschlossenen Ringen zusammensetzen."""
    ways = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while ways:
        cur = ways.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, w in enumerate(ways):
                if w[0] == cur[-1]:
                    cur += w[1:]
                elif w[-1] == cur[-1]:
                    cur += w[::-1][1:]
                elif w[-1] == cur[0]:
                    cur = w[:-1] + cur
                elif w[0] == cur[0]:
                    cur = w[::-1][:-1] + cur
                else:
                    continue
                ways.pop(i)
                changed = True
                break
        rings.append(cur)
    return rings


def geom(e):
    return [proj(p) for p in e.get('geometry', []) if p]


# ---------------------------------------------------------------- Grenze
outer = [[(p['lon'], p['lat']) for p in m['geometry']]
         for m in boundary_rel['members'] if m['type'] == 'way' and m['role'] == 'outer']
brings = assemble(outer)
brings.sort(key=len, reverse=True)
boundary = [proj({'lon': lo, 'lat': la}) for lo, la in brings[0]]
boundary = ring(boundary, 4)

# ---------------------------------------------------------------- Gebäude
BKIND = {
    'garage': 1, 'garages': 1, 'shed': 1, 'roof': 1, 'shelter': 1, 'hut': 1, 'carport': 1,
    'container': 1, 'tent': 1, 'greenhouse': 1,
    'farm_auxiliary': 2, 'barn': 2, 'industrial': 2, 'hangar': 2, 'warehouse': 2,
    'commercial': 2, 'retail': 2, 'construction': 2, 'silo': 6, 'storage_tank': 6,
    'church': 3, 'chapel': 3,
    'school': 7, 'kindergarten': 7, 'fire_station': 7, 'public': 7, 'office': 7,
    'apartments': 0, 'house': 0, 'detached': 0, 'residential': 0, 'yes': 0,
}
buildings = []
building_names = {}
for e in els:
    t = e.get('tags', {})
    if 'building' not in t or e['type'] not in ('way', 'relation'):
        continue
    if e['type'] == 'way':
        rings_ = [geom(e)]
    else:
        rings_ = [[proj({'lon': lo, 'lat': la}) for lo, la in r] for r in assemble(
            [[(p['lon'], p['lat']) for p in m['geometry']]
             for m in e['members'] if m['type'] == 'way' and m['role'] == 'outer' and m.get('geometry')])]
    for pts in rings_:
        r = ring(pts, 0.35)
        if not r:
            continue
        a = area(r)
        if a < 0:          # gegen den Uhrzeigersinn speichern (in x/y mit y nach Süden: a > 0)
            r = r[::-1]
            a = -a
        if a < 6:
            continue
        kind = BKIND.get(t['building'], 0)
        if t.get('amenity') == 'place_of_worship':
            kind = 3
        if t.get('historic') == 'castle':
            kind = 4
        if t.get('man_made') == 'water_tower':
            kind = 5
        if kind == 0 and a > 450:
            kind = 2       # große Hallen und Scheunen
        if kind == 0 and a < 22:
            kind = 1
        levels = t.get('building:levels')
        h = None
        try:
            if 'height' in t:
                h = float(t['height'].replace('m', '').strip())
            elif levels:
                h = float(levels) * 3.0 + 1.0
        except ValueError:
            h = None
        if h is None:
            h = {0: 6.5, 1: 2.7, 2: 7.5, 3: 11, 4: 12, 5: 28, 6: 9, 7: 8}[kind]
            if kind == 0 and a > 200:
                h = 8.0
        if kind == 5:
            h = max(h, 28)
        buildings.append([int(round(h * 10)), kind] + enc(r))
        if t.get('name') and kind in (3, 4, 5):
            building_names[t['name']] = centroid(r)

# ---------------------------------------------------------------- Straßen und Wege
RCLS = {
    'motorway': 0, 'trunk': 0, 'primary': 0, 'primary_link': 0,
    'secondary': 1, 'secondary_link': 1,
    'tertiary': 2, 'tertiary_link': 2,
    'residential': 3, 'unclassified': 3, 'living_street': 3, 'pedestrian': 3, 'road': 3,
    'service': 4, 'raceway': 4,
    'track': 5, 'bridleway': 5,
    'path': 6, 'footway': 6, 'cycleway': 6, 'steps': 6,
}
roads = []
for e in els:
    t = e.get('tags', {})
    if e['type'] != 'way':
        continue
    if 'highway' in t:
        c = RCLS.get(t['highway'])
        if c is None:
            continue
        if c == 5 and t.get('tracktype') == 'grade1':
            c = 4          # asphaltierter Wirtschaftsweg
        pts = simplify(geom(e), 0.8)
        if len(pts) >= 2:
            roads.append([c] + enc(pts))
    elif t.get('aeroway') in ('runway', 'taxiway', 'stopway'):
        c = 7 if t['aeroway'] in ('runway', 'stopway') else 8
        pts = simplify(geom(e), 1)
        if len(pts) >= 2:
            roads.append([c] + enc(pts))

# ---------------------------------------------------------------- Flächen
LCLS = {
    ('landuse', 'farmland'): 0,
    ('landuse', 'meadow'): 1, ('landuse', 'grass'): 1, ('landuse', 'village_green'): 1,
    ('landuse', 'greenfield'): 1, ('leisure', 'park'): 8, ('leisure', 'garden'): 8,
    ('landuse', 'forest'): 2, ('natural', 'wood'): 2,
    ('landuse', 'residential'): 3,
    ('landuse', 'farmyard'): 4, ('landuse', 'animal_keeping'): 4,
    ('landuse', 'cemetery'): 5,
    ('landuse', 'industrial'): 6, ('landuse', 'commercial'): 6, ('landuse', 'retail'): 6,
    ('landuse', 'construction'): 6, ('landuse', 'quarry'): 11, ('landuse', 'military'): 12,
    ('landuse', 'orchard'): 7, ('landuse', 'allotments'): 7,
    ('leisure', 'playground'): 8, ('leisure', 'pitch'): 9, ('leisure', 'sports_centre'): 8,
    ('leisure', 'stadium'): 8, ('leisure', 'track'): 9, ('landuse', 'religious'): 8,
    ('landuse', 'basin'): 10, ('natural', 'water'): 10, ('leisure', 'swimming_pool'): 10,
    ('aeroway', 'apron'): 13,
}
areas = []
for e in els:
    t = e.get('tags', {})
    if e['type'] not in ('way', 'relation') or 'building' in t:
        continue
    cls = None
    for k in ('natural', 'leisure', 'aeroway', 'landuse'):
        if (k, t.get(k)) in LCLS:
            cls = LCLS[(k, t.get(k))]
            break
    if cls is None:
        continue
    if e['type'] == 'way':
        g = e.get('geometry') or []
        if len(g) < 4 or g[0] != g[-1]:
            continue
        rings_ = [geom(e)]
    else:
        rings_ = [[proj({'lon': lo, 'lat': la}) for lo, la in r] for r in assemble(
            [[(p['lon'], p['lat']) for p in m['geometry']]
             for m in e['members'] if m['type'] == 'way' and m['role'] == 'outer' and m.get('geometry')])]
    for pts in rings_:
        if len(pts) < 4 or pts[0] != pts[-1]:
            continue
        r = ring(pts, 1.5)
        if not r:
            continue
        a = area(r)
        if a < 0:
            r = r[::-1]
            a = -a
        if a < 20:
            continue
        areas.append((a, [cls] + enc(r)))
# Große Flächen zuerst, damit kleine darüber gezeichnet werden
areas.sort(key=lambda a: -a[0])
areas = [a[1] for a in areas]

# ---------------------------------------------------------------- Gewässer, Bahn, Hecken
water = []
rail = []
hedges = []
for e in els:
    t = e.get('tags', {})
    if e['type'] != 'way':
        continue
    if t.get('waterway') in ('river', 'stream', 'canal'):
        if t.get('tunnel') or t.get('layer', '0').startswith('-'):
            continue
        pts = simplify(geom(e), 1)
        water.append([0] + enc(pts))
    elif t.get('waterway') in ('ditch', 'drain'):
        if t.get('tunnel'):
            continue
        pts = simplify(geom(e), 1)
        water.append([1] + enc(pts))
    elif t.get('railway') == 'rail':
        rail.append(enc(simplify(geom(e), 1)))
    elif t.get('barrier') == 'hedge':
        g = geom(e)
        if len(g) >= 2:
            hedges.append(enc(simplify(g, 0.5)))

# ---------------------------------------------------------------- Orte
places = []
for e in els:
    t = e.get('tags', {})
    if e['type'] == 'node' and t.get('place') in ('village', 'town', 'hamlet') and t.get('name'):
        x, y = proj(e)
        places.append({'n': t['name'], 'x': round(x), 'y': round(y),
                       't': 'v' if t['place'] in ('village', 'town') else 'h'})

# Sehenswürdigkeiten zum Entdecken
LANDMARK_NODES = {
    'Schloss Nörvenich': 'Schloss',
    'Gestüt Lindenkreuz': 'Gestüt',
    'Gut Kauweiler': 'Hof', 'Gut Ving': 'Hof', 'Antoniterhof': 'Hof', 'Heuserhof': 'Hof',
    'Hermannshof': 'Hof',
    'Kapelle St. Anna': 'Kapelle',
    'Eggersheimer Mühle': 'Mühle', 'Die "Obere Mühle" in Nörvenich': 'Mühle',
    'Schwarzes Kreuz': 'Wegkreuz',
}
RENAME = {'Die "Obere Mühle" in Nörvenich': 'Obere Mühle'}
landmarks = []
seen = set()
for e in els:
    t = e.get('tags', {})
    n = t.get('name')
    if e['type'] == 'node' and n in LANDMARK_NODES and n not in seen:
        x, y = proj(e)
        nn = RENAME.get(n, n)
        landmarks.append({'n': nn, 'k': LANDMARK_NODES[n], 'x': round(x), 'y': round(y)})
        seen.add(n)

# Benannte Kirchen, Burgen, Wasserturm (aus Gebäuden). Kirchen mit gleichem Namen
# bekommen den Ortsteil dazu.
def nearest_place(x, y):
    best = min(places, key=lambda p: (p['x'] - x) ** 2 + (p['y'] - y) ** 2)
    return best['n']


for e in els:
    t = e.get('tags', {})
    n = t.get('name')
    if e['type'] != 'way' or not n:
        continue
    if t.get('amenity') == 'place_of_worship' or t.get('historic') in ('castle', 'tower') \
            or t.get('man_made') == 'water_tower' or n == 'Burg Binsfeld':
        if n in ('Gemeindehaus Nörvenich',):
            continue
        g = geom(e)
        if not g:
            continue
        x, y = centroid(g)
        if t.get('historic') == 'castle' or n.startswith('Burg'):
            k = 'Burg'
        elif t.get('man_made') == 'water_tower':
            k = 'Turm'
        elif 'kapelle' in n.lower() or 'häuschen' in n.lower():
            k = 'Kapelle'
        else:
            k = 'Kirche'
        label = n
        if k in ('Kirche', 'Turm', 'Kapelle'):
            label = f'{n} ({nearest_place(x, y)})'
        if label in seen:
            continue
        seen.add(label)
        landmarks.append({'n': label, 'k': k, 'x': round(x), 'y': round(y)})

for e in els:
    t = e.get('tags', {})
    if t.get('aeroway') == 'aerodrome':
        pts = [proj(p) for m in e.get('members', []) for p in (m.get('geometry') or [])]
        if pts:
            x, y = centroid(pts)
            landmarks.append({'n': 'Fliegerhorst Nörvenich', 'k': 'Flugplatz', 'x': round(x), 'y': round(y)})

# ---------------------------------------------------------------- Ausgabe
xs = [p[0] for p in boundary]
ys = [p[1] for p in boundary]
out = {
    'origin': {'lat': round(LAT0, 6), 'lon': round(LON0, 6)},
    'bounds': [math.floor(min(xs)), math.floor(min(ys)), math.ceil(max(xs)), math.ceil(max(ys))],
    'boundary': enc(boundary),
    'buildings': buildings,
    'roads': roads,
    'areas': areas,
    'water': water,
    'rail': rail,
    'hedges': hedges,
    'places': places,
    'landmarks': landmarks,
}
js = ('// Automatisch erzeugt von tools/build_map.py – nicht von Hand ändern.\n'
      '// Kartendaten © OpenStreetMap-Mitwirkende, Lizenz ODbL 1.0 (openstreetmap.org/copyright)\n'
      'window.MAP_DATA = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
open(DST, 'w', encoding='utf-8').write(js)
print(f'{DST}: {len(js) / 1024:.0f} KB, {len(buildings)} Gebäude, {len(roads)} Wege, '
      f'{len(areas)} Flächen, {len(water)} Gewässer, {len(hedges)} Hecken, '
      f'{len(places)} Orte, {len(landmarks)} Sehenswürdigkeiten')
print('Ausdehnung', out['bounds'])
for l in landmarks:
    print('  ', l)
