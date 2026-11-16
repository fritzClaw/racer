# Spiele für den Browser

Zwei 3D-Spiele, die ohne Installation im Browser laufen, auch auf dem Tablet.

| Spiel | Ordner | |
|---|---|---|
| **Turbo-Rennen** | [`racer/`](racer/) | Autorennen gegen drei Computergegner, mit Cockpit-Ansicht und Monstertruck |
| **Ausritt in Nörvenich** | [`rider/`](rider/) | Zwei Reiterinnen reiten gleichzeitig durch die echte Gemeinde Nörvenich, sammeln Hufeisen, entdecken Orte und springen über Hindernisse |

## Spielen

`index.html` im Hauptordner öffnen und ein Spiel auswählen. Oder über einen kleinen Webserver:

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen. Über GitHub Pages lässt sich alles genauso veröffentlichen.

Mehr zu jedem Spiel steht in [`racer/README.md`](racer/README.md) und [`rider/README.md`](rider/README.md).
