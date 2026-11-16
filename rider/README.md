# Ausritt in Nörvenich

Ein 3D-Reitspiel für den Browser. Eine Reiterin mit blonden Haaren und eine mit roten Haaren reiten gleichzeitig durch die echte Gemeinde Nörvenich (Kreis Düren). Die Kamera schaut der Reiterin über die Schulter. Zu zweit wird der Bildschirm geteilt.

## Spielen

`index.html` im Browser öffnen. Es wird nichts installiert, das Spiel läuft auch offline. Der Browser muss WebGL unterstützen.

Alternativ über einen kleinen Webserver im Hauptordner des Repos:

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000/rider/> öffnen.

## Was man machen kann

- **Frei reiten**: durch alle 14 Ortsteile (Nörvenich, Hochkirchen, Eggersheim, Irresheim, Poll, Dorweiler, Pingsheim, Rath, Wissersheim, Oberbolheim, Eschweiler über Feld, Frauwüllesheim, Binsfeld, Rommelsheim) und die Weiler dazwischen. An den Ortseingängen stehen gelbe Ortsschilder.
- **Hufeisen sammeln**: 213 goldene Hufeisen, in jedem Ortsteil mindestens 10, in den Weilern ein paar, dazu draußen an den Feldwegen. Manche schweben über Hindernissen und sind nur mit einem Sprung zu erreichen.
- **Orte entdecken**: 49 Stempel für Ortsteile, Weiler und Sehenswürdigkeiten wie Schloss Nörvenich, die Harff'sche Burg, Burg Binsfeld, Burg Bubenheim, die Kirchen, den Wasserturm in Wissersheim, Mühlen, Höfe und den Fliegerhorst.
- **Springen**: Auf den Feldwegen liegen Baumstämme, Strohballen, Holzricks und Hecken. Am Gestüt Lindenkreuz gibt es einen Reitplatz mit einem bunten Parcours.
- **Füttern**: Äpfel und Möhren geben dem Pferd neue Kraft. Sie wachsen nach zwei Minuten nach.

Los geht es in **Wissersheim** auf der Dorfstraße bei der Kirche St. Martinus. Im Pausenmenü bringt „Zurück nach Wissersheim" beide wieder dorthin.

Die beiden spielen **zusammen**: Hufeisen und entdeckte Orte zählen für beide. Der Fortschritt wird im Browser gespeichert, beim nächsten Mal geht es dort weiter, wo ihr aufgehört habt. „Neu anfangen" im Hauptmenü löscht alles.

## Reiten

| Gangart | Tempo | |
|---|---|---|
| Halt | steht | erholt sich am schnellsten |
| Schritt | ca. 7 km/h | erholt sich |
| Trab | ca. 17 km/h | ab hier kann gesprungen werden |
| Galopp | ca. 41 km/h | kostet Ausdauer (reicht für etwa 45 Sekunden) |

Mit **schneller** und **langsamer** schaltet man eine Gangart hoch oder runter. Im Stand einmal mehr **langsamer** drücken, dann geht das Pferd rückwärts. Wird die Ausdauer leer, fällt das Pferd vom Galopp in den Trab.

Wer ohne Sprung gegen ein Hindernis reitet, bei dem bleibt das Pferd stehen. Im Wasser (Neffelbach, Teiche) geht es nur langsam voran. An der Gemeindegrenze stehen rot-weiße Pfähle, dort geht es nicht weiter.

## Steuerung

| | Reiterin 1 | Reiterin 2 |
|---|---|---|
| schneller | W | ↑ |
| langsamer | S | ↓ |
| lenken | A / D | ← / → |
| springen | Leertaste | Enter (oder rechte Umschalttaste) |

Für beide: **K** große Karte, **P** oder **Esc** Pause, **M** Ton an/aus. Mit einer Reiterin gehen beide Tastengruppen.

**Gamepads**: Das erste Gamepad steuert Reiterin 1, das zweite Reiterin 2. Stick oder Steuerkreuz links/rechts lenkt, Steuerkreuz hoch/runter (oder die Schultertasten) schaltet die Gangart, A springt, Start ist Pause.

**Tablet**: Jede Bildschirmhälfte hat ihre eigenen Knöpfe: links den Lenk-Schieber, rechts ▲ ▼ und den Sprung-Knopf. Im Querformat sind die Hälften nebeneinander, im Hochformat übereinander.

## Karten

- Die **kleine Karte** in jeder Bildschirmhälfte dreht sich mit, oben ist immer vorne. Gelbe Punkte sind Hufeisen in der Nähe, rote und orange Punkte Äpfel und Möhren, der zweite Pfeil ist die andere Reiterin.
- Die **große Karte** (K oder 🗺️) zeigt die ganze Gemeinde, beide Reiterinnen, die entdeckten Orte und wie viele Hufeisen in jedem Ortsteil schon gefunden sind.

## Kartendaten

Straßen, Feldwege, Gebäude, Bäche, Wälder, Wiesen und Ortsnamen stammen aus [OpenStreetMap](https://www.openstreetmap.org) (© OpenStreetMap-Mitwirkende, Lizenz [ODbL](https://www.openstreetmap.org/copyright)). Die Gebäude sind vereinfacht: Grundriss und, wo bekannt, Höhe stimmen, Dächer, Fenster und Farben sind erfunden. Felder, Bäume, Hindernisse und Futter sind ausgedacht.

Die Daten liegen fertig umgewandelt in `js/mapdata.js`. So werden sie neu erzeugt:

1. Die Abfrage aus `tools/query.overpassql` an einen Overpass-Server schicken, zum Beispiel auf <https://overpass-turbo.eu> (Export als „Rohdaten“) oder mit
   `curl --data-urlencode data@tools/query.overpassql https://overpass-api.de/api/interpreter -o noervenich.json`
2. `python3 tools/build_map.py noervenich.json js/mapdata.js`

Die Hufeisen werden aus den Kartendaten verteilt. Wer die Karte neu erzeugt, sollte im Spiel „Neu anfangen" wählen, sonst passen gespeicherte Hufeisen nicht mehr.

## Aufbau des Codes

| Datei | Inhalt |
|---|---|
| `index.html` | Seite, Menüs und Anzeige |
| `css/style.css` | Aussehen der Menüs und der Anzeige |
| `js/mapdata.js` | Kartendaten der Gemeinde (erzeugt) |
| `js/world.js` | 3D-Welt aus den Kartendaten, Kollision, Verteilung von Hufeisen, Futter und Hindernissen |
| `js/horse.js` | Pferd und Reiterin als 3D-Modell, Bewegung in Schritt, Trab, Galopp und beim Sprung |
| `js/minimap.js` | kleine und große Karte |
| `js/audio.js` | Hufschlag, Wiehern, Vögel und Effekte, mit der Web Audio API erzeugt |
| `js/game.js` | Eingabe, Reitphysik, geteilter Bildschirm, Sammeln, Speichern, Menüs |
| `tools/` | Umwandlung der OpenStreetMap-Daten |
| `vendor/three.min.js` | [Three.js](https://threejs.org) r159 (MIT-Lizenz, siehe `vendor/three.LICENSE`) |

Die Karte rechnet in Metern in der Ebene (x nach Osten, y nach Süden). In 3D wird daraus x → X, y → Z, Y zeigt nach oben.
