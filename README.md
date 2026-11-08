# Turbo-Rennen

Ein 2D-Autorennspiel für den Browser. Du siehst die Strecke von oben, wählst dein Auto und fährst gegen drei Computergegner um den Sieg.

## Spielen

`index.html` im Browser öffnen, fertig. Es wird nichts installiert und nichts heruntergeladen.

Alternativ über einen kleinen lokalen Webserver:

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen. Über GitHub Pages lässt sich das Spiel genauso veröffentlichen.

## So läuft ein Rennen

1. **Auto wählen**: fünf Autos mit unterschiedlichen Stärken
2. **Strecke wählen**: Sonnenring (leicht), Waldkurs (mittel) oder Bergpass (schwer)
3. **Gegner einstellen**: Leicht, Mittel oder Schwer
4. Countdown, dann **3 Runden**. Am Ende gibt es eine Ergebnisliste mit Platz, Zeit und bester Runde.

## Die Autos

| Auto | Stärke |
|---|---|
| Roter Blitz | höchste Endgeschwindigkeit |
| Gelbe Biene | beste Beschleunigung, sehr leicht |
| Grüne Kurve | bestes Handling, ideal für enge Kurven |
| Blauer Brummer | schwer, schiebt andere Autos weg |
| Violetta | Allrounder |

Die Werte wirken sich wirklich auf das Fahren aus: Endgeschwindigkeit, Beschleunigung, Lenkung, Bodenhaftung und das Verhalten bei Zusammenstößen.

## Steuerung

| Taste | Aktion |
|---|---|
| ↑ / W | Gas |
| ↓ / S / Leertaste | Bremsen, im Stand rückwärts |
| ← → / A D | Lenken |
| P / Esc | Pause |
| M | Ton an/aus |

Auf Handy und Tablet erscheinen Knöpfe auf dem Bildschirm.

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
| `js/cars.js` | Autos: Werte, Physik-Umrechnung und Zeichnung |
| `js/audio.js` | Soundeffekte, mit der Web Audio API erzeugt |
| `js/game.js` | Fahrphysik, Computergegner, Rennablauf, Grafik und Menüsteuerung |

### Eigene Strecke hinzufügen

In `js/tracks.js` einen neuen Eintrag in `TRACK_DEFS` anlegen. Die Strecke ist eine geschlossene Kurve durch die angegebenen `points`, die mit `scale` vergrößert werden. Der erste Punkt ist Start und Ziel und sollte auf einer Geraden liegen. Gefahren wird in Richtung des zweiten Punktes.
