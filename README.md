# Turbo-Rennen

Ein 3D-Autorennspiel für den Browser. Du wählst dein Auto, schaust aus dem Cockpit (oder von hinter dem Auto) auf die Strecke und fährst gegen drei Computergegner um den Sieg.

## Spielen

`index.html` im Browser öffnen, fertig. Es wird nichts installiert und nichts heruntergeladen, das Spiel läuft auch offline. Der Browser muss WebGL unterstützen (alle aktuellen Browser tun das).

Alternativ über einen kleinen lokalen Webserver:

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen. Über GitHub Pages lässt sich das Spiel genauso veröffentlichen.

## So läuft ein Rennen

1. **Auto wählen**: fünf Rennautos mit unterschiedlichen Stärken oder der Monstertruck
2. **Strecke wählen**: Sonnenring (leicht), Waldkurs (mittel) oder Bergpass (schwer)
3. **Gegner einstellen**: Leicht, Mittel oder Schwer
4. Countdown, dann **3 Runden**. Am Ende gibt es eine Ergebnisliste mit Platz, Zeit und bester Runde.

## Kameras

| Kamera | Ansicht |
|---|---|
| Cockpit (Standard) | Blick vom Fahrersitz: Motorhaube, Armaturenbrett und ein Lenkrad, das mitlenkt |
| Verfolger | Kamera hinter dem Auto |

Umschalten mit **C** oder dem 🎥-Knopf oben rechts. Die Wahl wird gespeichert.

## Die Autos

| Auto | Stärke |
|---|---|
| Roter Blitz | höchste Endgeschwindigkeit |
| Gelbe Biene | beste Beschleunigung, sehr leicht |
| Grüne Kurve | bestes Handling, ideal für enge Kurven |
| Blauer Brummer | schwer, schiebt andere Autos weg |
| Violetta | Allrounder |
| Monstertruck | fährt über alle anderen Autos drüber und zerquetscht sie, im Gras kaum langsamer |

Die Werte wirken sich wirklich auf das Fahren aus: Endgeschwindigkeit, Beschleunigung, Lenkung, Bodenhaftung und das Verhalten bei Zusammenstößen.

## Steuerung

| Taste | Aktion |
|---|---|
| ↑ / W | Gas |
| ↓ / S / Leertaste | Bremsen, im Stand rückwärts |
| ← → / A D | Lenken |
| C | Kamera wechseln |
| P / Esc | Pause |
| M | Ton an/aus |

Auf Handy und Tablet erscheinen Knöpfe auf dem Bildschirm.

## Verkehr und Monstertruck

In jedem Rennen fahren neben den drei Gegnern viele langsame **Verkehrsautos** mit (16 bis 24, je nach Streckenlänge). Sie fahren einfach ihre Runden und zählen nicht für die Platzierung. Mit einem normalen Rennauto musst du um sie herumfahren, sonst prallst du ab.

Mit dem **Monstertruck** fährst du einfach drüber:

- Verkehrsautos werden **platt gedrückt**, liegen ein paar Sekunden auf der Straße und verschwinden dann. Dafür taucht weiter vorne ein neues auf.
- Auch die **Gegner** werden platt gefahren. Sie bleiben etwa 3 Sekunden stehen, richten sich wieder auf und sind danach 2 Sekunden lang geschützt.
- Ein Zähler zeigt, wie viele Autos du zerquetscht hast. Am Ende steht die Zahl auch in der Ergebnisliste.

Den Monstertruck kannst nur du fahren, die Gegner nehmen ihn nie.

## Regeln

- Neben der Strecke ist **Gras**: Dort wird das Auto langsamer und rutscht mehr.
- Autos **prallen voneinander ab**. Schwere Autos schieben leichte weg.
- Wer falsch herum fährt, bekommt einen Hinweis. Rückwärts gefahrene Strecke zählt nicht.

## Aufbau des Codes

| Datei | Inhalt |
|---|---|
| `index.html` | Seite, Menüs und Anzeige |
| `css/style.css` | Aussehen der Menüs und der Anzeige |
| `js/tracks.js` | Strecken (Kontrollpunkte → glatte Kurve) |
| `js/cars.js` | Autos: Werte, Physik-Umrechnung und Abmessungen |
| `js/audio.js` | Soundeffekte, mit der Web Audio API erzeugt |
| `js/render3d.js` | 3D-Darstellung: Strecke, Landschaft, Automodelle, Cockpit und Kameras |
| `js/game.js` | Fahrphysik, Computergegner, Rennablauf, Anzeige und Menüsteuerung |
| `vendor/three.min.js` | [Three.js](https://threejs.org) r159 (MIT-Lizenz, siehe `vendor/three.LICENSE`) |

Die Spiellogik rechnet in der Ebene (x, y). `render3d.js` macht daraus die 3D-Welt (x → X, y → Z, Y zeigt nach oben).

### Eigene Strecke hinzufügen

In `js/tracks.js` einen neuen Eintrag in `TRACK_DEFS` anlegen. Die Strecke ist eine geschlossene Kurve durch die angegebenen `points`, die mit `scale` vergrößert werden. Der erste Punkt ist Start und Ziel und sollte auf einer Geraden liegen. Gefahren wird in Richtung des zweiten Punktes.
