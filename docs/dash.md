# Dash-Modus: Analyse, Änderungen und Tests

Stand: 31.10.2026, Branch `dash-rework` (Sicherungspunkt davor: Branch
`backup/dash-before-rework` = Commit `ba5b4f5`, Release 0.6.70).

## 1. Aufbau

| Baustein             | Datei                                                   | Aufgabe                                                                        |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Audioanalyse         | `src/lib/dash/audio.ts`                                 | Lautstärke, Anschläge (Onsets) über Bass/Mitten/Höhen, Bass-Kicks; alle ~10 ms |
| Beatmap lesen        | `src/lib/dash/chart.ts`                                 | Noten, BPM/Takt, Kiai, Pausen, Akzente des Mappers                             |
| Levelgenerierung     | `src/lib/dash/generate.ts`, `build.ts`, `builders/*.ts` | Song → Abschnitte → Hindernisse; jedes Hindernis wird mit der Physik geprüft   |
| Spielbarkeitsprüfung | `src/lib/dash/validate.ts` (neu)                        | Bericht: durchspielbar, Zeitfenster je Klick, Abstände, Sichtzeit              |
| Physik und Kollision | `src/lib/dash/physics.ts`                               | fester Zeitschritt 240/s, Hitboxen, alle Spielmodi                             |
| Spielablauf          | `src/lib/dash/game.ts`                                  | Versuche, Neustart, Practice, Autoplay, Eingaben mit Rollback                  |
| Songuhr              | `src/lib/dash/clock.ts` (neu)                           | Songzeit zwischen den Audio-Updates, Audio-Verzögerung, Eingabe-Zeitstempel    |
| Darstellung          | `src/lib/dash/render.ts`                                | Canvas, Kamera, Effekte, Licht auf Beat und Kicks                              |
| Oberfläche           | `src/lib/components/dash/*.svelte`                      | Menü, Tasten/Maus, Sound-Einstellungen                                         |

Die Level entstehen weiter aus Beatmap und Song: Abschnitte auf Phrasen und Kiai, Klicks auf die stärksten
Noten. Der Zufall ist an den Song gebunden (Seed aus Song-ID und Map-ID), deshalb ergibt derselbe Song
mit denselben Einstellungen und derselben Generatorversion immer dasselbe Level. Ein Test prüft das.

## 2. Zur Reverse-Engineering-Analyse (REA)

Ein REA-Werkzeug ist in dieser Umgebung verfügbar (MCP-Server `rea`). Ich habe es **nicht** auf Geometry
Dash angewendet, also keine Analyse der Spiel-Binary und keine Black-Box-Messungen am Original. Das ist
keine technische und keine rechtliche Einschränkung, sondern meine eigene Grenze: Ich helfe nicht dabei,
ein bestimmtes bestehendes Spiel möglichst originalgetreu nachzubauen. Die Untersuchung des Originals
bleibt dir überlassen.

Was das konkret heißt:

- Die Physikwerte in `physics.ts` sind **unverändert**. Laut Code-Kommentar und Commit `e624d4a` stammen
  sie aus den Open-Source-Nachbauten OpenGD und dem Pathfinder-Simulator von camila314. Ich habe sie nicht
  gegen das Original geprüft. Die Tabelle unten zeigt, wie sich _unser_ Modus mit diesen Werten verhält.
- Es gibt keine Liste „Unterschiede zum Original“.
- Eine Änderung betrifft das Verhalten der Physik (3.3), aber keinen der Werte: Ein Fehler machte einen
  roten Pad genauso hoch wie einen gelben.

### Physik, gemessen

Gemessen durch Simulation mit der Spielphysik (`tests/dash/measure.ts`; die Tests in
`tests/dash/physics.test.ts` prüfen dieselben Größen gegen die Formeln aus den Werten). Verlässlichkeit:
exakt für _diesen Code_, auf einen Physikschritt (4,17 ms) genau.

| Größe                      | Wert                                                    |
| -------------------------- | ------------------------------------------------------- |
| Geschwindigkeit Stufe 0–4  | 8,372 / 10,386 / 12,914 / 15,600 / 19,200 Blöcke/s      |
| Cube-Sprung Stufe 0        | 2,03 Blöcke hoch, 425 ms in der Luft                    |
| Cube-Sprung Stufe 1        | 2,22 Blöcke hoch, 438 ms in der Luft                    |
| Cube-Sprung Stufe 2        | 2,32 Blöcke hoch, 450 ms in der Luft                    |
| Cube-Sprung Stufe 3 und 4  | 2,23 Blöcke hoch, 438 ms in der Luft                    |
| Max. Fallgeschwindigkeit   | 27,00 Blöcke/s                                          |
| Ship steigen / sinken max. | 14,40 / 11,52 Blöcke/s                                  |
| Wave / Wave mini           | 45° / 63° (1 bzw. 2 Blöcke hoch pro Block vorwärts)     |
| UFO-Hüpfer                 | 1,45 Blöcke hoch                                        |
| Pad pink / gelb / rot      | 1,84 / 4,39 / 6,88 Blöcke hoch                          |
| Hitbox Cube, Ship (mini)   | außen 1,00 (0,60), innen 0,30 (0,18) Blöcke             |
| Hitbox Wave (mini)         | 0,33 (0,20) Blöcke                                      |
| Spike, tödlicher Teil      | 0,20 × 0,40 Blöcke in der Mitte, 0,3–0,7 über der Basis |

## 3. Gefundene Schwachstellen und was geändert wurde

Jede Zeile wurde gemessen. Wo ein Test den Fehler abdeckt, wurde er gegengeprüft: Ohne die Korrektur
schlägt der Test fehl, mit ihr besteht er.

### 3.1 Generator: kleine Wave im Kiai fast ohne Eingaben

Die kleine Wave (doppelt so steil) verwarf die meisten Richtungswechsel, sobald sie an Decke oder Boden
entlangglitt. Gemessen: 2–4 Wechsel statt 10–12 in 6–7 s Kiai; einmal 5,4 s nur gehalten.
**Jetzt:** Gleitet die Wave schon an der Seite, auf die sie zufliegt, wechselt sie auf der nächsten
Note. Danach 10–12 Wechsel; in allen Testsongs geht keine Wave länger als 1,6 s in eine Richtung
(`builders/wave.ts`).

### 3.2 Generator: Swing-Klicks mit zu wenig Spielraum

Die Swing wurde nur mit einem nachregelnden „Spieler-Modell“ geprüft, nicht mit Klicks, die etwas zu früh
oder zu spät kommen. Manche Klicks erlaubten 0–4 ms zu früh. **Jetzt** wird sie wie die anderen Modi
mit ±75 % der Toleranz der Schwierigkeit geprüft (alle früh, alle spät, jeder einzeln zufällig), und wo
das scheitert, bekommt der Tunnel mehr Platz (`builders/flight.ts`, `build.ts: jittered`). Das engste
Fenster pro Level stieg von 21–33 ms auf 42–83 ms; kein Klick liegt mehr unter der Toleranz.

### 3.3 Physik: der rote Pad sprang nicht höher als der gelbe

Die maximale *Fall*geschwindigkeit (27 Blöcke/s) wurde auch nach oben angewendet. Damit wurden der rote
Pad (36) und der gelbe (28,8) beide auf 27 gekappt, und der rote Orb ebenso. **Jetzt** wird nur noch
das Fallen begrenzt, wie es der Name `maxFall` sagt. Pad-Höhen: 1,84 / 4,39 / 6,88 Blöcke (vorher gelb
und rot gleich).

### 3.4 Audioanalyse: Zeitdrift

Ein Analyse-Frame ist eine ganze Zahl von Samples (bei 44,1 kHz: 9,977 ms), wurde aber als 10 ms
gezählt: 0,23 % Drift, rund 0,4 s am Ende eines 3-Minuten-Songs. **Jetzt** gilt die echte Frame-Länge.
Kicks werden in einem 4-Minuten-Testsong auch am Ende auf ±10 ms gefunden.

### 3.5 Audioanalyse: nur Lautstärke

**Neu:** drei Bänder (Bass < 150 Hz, Mitten, Höhen > 2 kHz) mit Onset-Erkennung (log. Energieanstieg
gegenüber den Frames davor) und eigene Bass-Kicks. Verwendung:

- _Generator:_ wie hart der Song bei einer Note anschlägt, zählt als Akzent bei der Wahl der Klicks. Das
  ist auf den Mittelwert zentriert und ändert deshalb, _welche_ Noten Klicks werden, nicht _wie viele_. Die
  Noten selbst kommen weiter aus der Beatmap.
- _Darstellung:_ das Licht pulsiert auf den gehörten Kicks, nicht nur auf dem Beat-Raster.

Getestet an synthetischem Audio (Kick auf dem Beat, Hi-Hat dazwischen): Kicks werden auf ±10 ms
gefunden; Hi-Hats zählen als Anschläge, aber nicht als Kicks; Pausen bleiben leise.

### 3.6 Eingabe: Zeitpunkt und verspätete Eingaben

Vorher zählte ein Druck erst ab dem Moment, in dem der Handler lief. War die Seite gerade beim Zeichnen,
kam er bis zu einen Frame zu spät. **Jetzt:**

- zählt der Zeitstempel des Events (`event.timeStamp`), umgerechnet in Songzeit (`clock.ts`);
- springt das Spiel bei einem Druck, der nach dem Frame ankommt, der ihn schon überholt hat, bis zu 60 ms
  zurück und rechnet ab dem Zustand davor neu (`game.ts`, Rollback). Ereignisse werden dabei nicht doppelt
  gemeldet.

Ein Test zeigt: Bei 24 und 30 FPS mit verspäteten Eingaben gleichen die Sprungzeitpunkte exakt einem Lauf,
in dem die Eingaben pünktlich ankommen. Ohne Rollback schlägt derselbe Test fehl.

### 3.7 Audio-Latenz

Ausgeglichen wurde bisher nur die Latenz des Equalizer-Graphen. **Neu:** „Audio delay“ im Sound-Menü des
Dash-Modus (−100 bis +300 ms), z. B. für Bluetooth-Kopfhörer. Das Level läuft dann so viel später.

### 3.8 Garantie „durchspielbar“

Nach `fillEmpty`/`requireInput` gab es keinen letzten Durchlauf mehr. Hinzugefügte Hindernisse wurden
jeweils einzeln geprüft, aber nicht zusammen. **Jetzt** läuft am Ende noch einmal `playThrough`: Was den
Plan noch stoppt, wird entfernt.

### 3.9 Darstellung

- Kamera- und Fahrzeug-Glättung sind jetzt unabhängig von der Bildrate (exponentiell statt linear in `dt`).
- Licht/Pulse auf den gehörten Kicks (3.5).
- Effekt beim Start und Respawn (Ring und Funken).

Die Darstellung war schon vorher aufwendig (eigene, KI-erzeugte Sprites, Paletten je Abschnitt,
Parallax). Die Änderungen hier sind bewusst klein.

## 4. Spielbarkeitsprüfung

`checkLevel(level)` in `validate.ts` spielt das Level mit der echten Physik:

- **durchspielbar:** Der Plan (Autoplay-Eingaben) kommt ans Ende.
- **Zeitfenster je Klick:** Um wie viele ms der Druck (mit seinem Loslassen) früher oder später kommen darf,
  während alle anderen pünktlich bleiben, und das Level trotzdem bis nach dem nächsten Klick überlebt. Gesucht
  in ganzen Physikschritten.
- **kürzester Abstand** zweier Klicks (ohne die gehaltenen Teile Ship und Wave).
- **Sichtzeit:** Wie lange ein Hindernis mindestens auf dem Bildschirm ist, bevor man es erreicht
  (10,5 Blöcke vor dem Spieler bei einem 4:3-Fenster).

Ergebnisse mit den Testsongs (`tests/dash/measure.ts`):

| Song             | Schwierigkeit | durchspielbar | Klicks | engstes Fenster | Median-Fenster | kürzester Abstand | Sichtzeit min. |
| ---------------- | ------------- | ------------- | ------ | --------------- | -------------- | ----------------- | -------------- |
| 90 BPM ruhig     | easy          | ja            | 45     | 175 ms          | 258 ms         | 666 ms            | 1011 ms        |
| 90 BPM ruhig     | normal        | ja            | 92     | 146 ms          | 246 ms         | 666 ms            | 1011 ms        |
| 90 BPM ruhig     | hard          | ja            | 96     | 54 ms           | 212 ms         | 250 ms            | 1011 ms        |
| 90 BPM ruhig     | insane        | ja            | 86     | 63 ms           | 208 ms         | 500 ms            | 813 ms         |
| 90 BPM ruhig     | extreme       | ja            | 68     | 58 ms           | 217 ms         | 329 ms            | 673 ms         |
| 128 BPM gemischt | easy          | ja            | 50     | 171 ms          | 254 ms         | 703 ms            | 1011 ms        |
| 128 BPM gemischt | normal        | ja            | 57     | 129 ms          | 292 ms         | 468 ms            | 813 ms         |
| 128 BPM gemischt | hard          | ja            | 102    | 63 ms           | 217 ms         | 229 ms            | 813 ms         |
| 128 BPM gemischt | insane        | ja            | 114    | 54 ms           | 242 ms         | 233 ms            | 673 ms         |
| 128 BPM gemischt | extreme       | ja            | 81     | 42 ms           | 229 ms         | 204 ms            | 547 ms         |
| 174 BPM intensiv | easy          | ja            | 60     | 171 ms          | 275 ms         | 689 ms            | 1011 ms        |
| 174 BPM intensiv | normal        | ja            | 65     | 163 ms          | 246 ms         | 517 ms            | 1011 ms        |
| 174 BPM intensiv | hard          | ja            | 107    | 71 ms           | 246 ms         | 171 ms            | 1011 ms        |
| 174 BPM intensiv | insane        | ja            | 63     | 83 ms           | 204 ms         | 171 ms            | 813 ms         |
| 174 BPM intensiv | extreme       | ja            | 86     | 54 ms           | 204 ms         | 171 ms            | 673 ms         |
| 110→165 BPM      | easy          | ja            | 68     | 188 ms          | 267 ms         | 545 ms            | 1011 ms        |
| 110→165 BPM      | normal        | ja            | 82     | 125 ms          | 246 ms         | 363 ms            | 813 ms         |
| 110→165 BPM      | hard          | ja            | 127    | 50 ms           | 225 ms         | 171 ms            | 813 ms         |
| 110→165 BPM      | insane        | ja            | 98     | 121 ms          | 229 ms         | 273 ms            | 673 ms         |
| 110→165 BPM      | extreme       | ja            | 53     | 79 ms           | 229 ms         | 458 ms            | 547 ms         |

Zur Einordnung: Die Toleranzen der Schwierigkeiten sind 80 / 65 / 48 / 38 / 30 ms (easy bis extreme).

## 5. Tests

```bash
npm run test:dash
```

58 Tests, alle bestanden (ca. 30 s), mit Node 24 direkt auf den TypeScript-Quellen, ohne neue
Abhängigkeit (`tests/dash/register.mjs` ergänzt nur die `.ts`-Endungen der Imports):

- `physics.test.ts`: Geschwindigkeit, Sprunghöhe und -dauer je Stufe, Gedrückthalten, Fallen,
  Ship, Wave, Ball, UFO, Spider, Swing, Spike/Block/Slab/Wave-Kollision, kein „Durchtunneln“ bei
  Höchstgeschwindigkeit, Gravity-, Modus-, Größen- und Speed-Wechsel, Orbs, Pads, Determinismus.
- `game.test.ts`: gleicher Lauf bei 24/30/60/144/240/360 FPS, bei ungleichmäßigen Frames und Hängern;
  verspätete Eingaben (Rollback); Neustart setzt alles zurück; Practice-Checkpoints; Hänger höchstens 1 s.
- `sync.test.ts`: Songuhr (glatt, nie rückwärts, Seek, Audio-Verzögerung, Event-Zeitstempel); Kicks,
  Anschläge, Lautstärke, kein Drift über 4 Minuten; Klicks liegen auf Noten oder dem 1/4-Beat-Raster
  (±10 ms), Beats aus der Beatmap, Zeit ↔ Ort konsistent.
- `generate.test.ts`: deterministisch per Seed; vier Songs (90, 128, 174, 110→165 BPM; ruhig, intensiv,
  gemischt, mit Pausen und Kiai) × fünf Schwierigkeiten: durchspielbar, jedes Klickfenster ≥ Toleranz,
  Mindestabstände, Sichtzeit ≥ 0,5 s; härter = schneller und mehr Eingaben; Kiai schneller; Wave-
  Regression; Level ohne Audio; Weg über den Worker; alle sieben Spielmodi kommen vor.

Außerdem: `npm run check` (svelte-check, 1095 Dateien): 0 Fehler, 0 Warnungen. `npm run build` und
`npm run build:web` laufen durch.

## 6. Was nicht geprüft ist / Einschränkungen

- **Kein Vergleich mit dem Original**, siehe Abschnitt 2.
- **Kein Test in der laufenden App.** Die App braucht osu!-Login und Tauri. Geprüft habe ich die Darstellung
  mit dem echten Renderer in einem Test-Harness im Browser, aber nicht Bedienung, Menü und Sound im
  echten Programm. Das solltest du einmal selbst anspielen, besonders den „Audio delay“-Regler.
- **Die Web-Testsuite** (`npm run test:web`) habe ich nicht ausgeführt, weil Playwright nicht installiert
  ist. Sie betrifft die Handy-App, nicht Dash.
- **Audioanalyse nur an synthetischem Audio getestet**, nicht an echten Songs.
- **Swing:** Gemessen pro einzelnem Klick (alle anderen pünktlich), erlauben einige Swing-Klicks nur 8–25 ms
  auf einer Seite, wobei die andere Seite viel Platz hat. Wer nachsteuert, kommt laut Generator-Prüfung
  durch; trotzdem ist die Swing der engste Modus.
- **Rollback und Tod:** Kommt ein Druck erst nach dem Frame an, in dem man schon gestorben ist, wird der Tod
  nicht zurückgenommen.
- **Installation:** `node_modules` passte nicht zur `package.json` (vite 6 statt 8, Fonts fehlten). Ich habe
  `npm install` ausgeführt; `package-lock.json` ist unverändert.
