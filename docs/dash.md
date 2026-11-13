# Dash-Modus: Analyse, Änderungen und Tests

Stand: 31.10.2026, Branch `dash-rework` (Sicherungspunkt davor: Branch
`backup/dash-before-rework` = Commit `ba5b4f5`, Release 0.6.70).

## 1. Aufbau

| Baustein             | Datei                                                          | Aufgabe                                                                        |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Audioanalyse         | `src/lib/addons/dash/audio.ts`                                 | Lautstärke, Anschläge (Onsets) über Bass/Mitten/Höhen, Bass-Kicks; alle ~10 ms |
| Beatmap lesen        | `src/lib/addons/dash/chart.ts`                                 | Noten, BPM/Takt, Kiai, Pausen, Akzente des Mappers                             |
| Levelgenerierung     | `src/lib/addons/dash/generate.ts`, `build.ts`, `builders/*.ts` | Song → Abschnitte → Hindernisse; jedes Hindernis wird mit der Physik geprüft   |
| Spielbarkeitsprüfung | `src/lib/addons/dash/validate.ts` (neu)                        | Bericht: durchspielbar, Zeitfenster je Klick, Abstände, Sichtzeit              |
| Physik und Kollision | `src/lib/addons/dash/physics.ts`                               | fester Zeitschritt 240/s, Hitboxen, alle Spielmodi                             |
| Spielablauf          | `src/lib/addons/dash/game.ts`                                  | Versuche, Neustart, Practice, Autoplay, Eingaben mit Rollback                  |
| Songuhr              | `src/lib/addons/dash/clock.ts` (neu)                           | Songzeit zwischen den Audio-Updates, Audio-Verzögerung, Eingabe-Zeitstempel    |
| Darstellung          | `src/lib/addons/dash/render.ts`                                | Canvas, Kamera, Effekte, Licht auf Beat und Kicks                              |
| Oberfläche           | `src/lib/addons/dash/components/*.svelte`                      | Menü, Tasten/Maus, Sound-Einstellungen                                         |

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

## 7. Überarbeitung 0.6.75: Schwierigkeiten, Levelaufbau, eigene Checkpoints

Stand: 01.11.2026.

### 7.1 Ausgangslage, gemessen an echten Beatmaps

Bisher war nur an synthetischen Testsongs gemessen. Neu habe ich die Level von echten osu!-Beatmaps
gemessen (öffentlich unter `osu.ppy.sh/osu/<id>`, nur zum Messen geladen, nicht im Repo; ohne
Audio). Mit 0.6.74 zeigte sich:

- **Extreme war kaum strenger als Hard.** Der Median des Zeitfensters je Klick lag auf allen
  Stufen bei 250–300 ms: Ein Spike unter einem Sprung lässt bei Tempo 3x/4x fast den ganzen Sprung
  Platz. Die Toleranz der Stufe (Extreme 30 ms) war nur eine _Untergrenze_, nach oben gab es kein
  Ziel.
- **Tunnel von Ship und UFO** waren auf allen Stufen im Mittel 6–7 Blöcke offen (Wandspalten einen
  ganzen Beat breit, ganzzahlig gerundet, alle zwei Takte ganz offen).
- **Spider und Ball** hatten keine Hindernisse, die das Timing eines Klicks bestimmen.
- **Absturz:** Bei manchen Beatmaps brach die Generierung ab (`phrase` undefiniert). Ursache:
  `musicalPosition` rundet mit einem Epsilon, eine Note einen Hauch vor einem Taktstrich fiel
  zwischen zwei Phrasen. **Behoben:** Phrasen werden über ihren musikalischen Schlüssel gefunden
  (`phraseAt` in `composition.ts`).
- Der Cube-Builder übersprang ganze Abschnitte, wenn die Noten dichter als ein Sprung lagen (er
  konnte eine Note nicht bewusst überspringen), und verlangte, dass die Landung 1,5 Blöcke vor dem
  nächsten Klick liegt (bei 4x fast nie).

### 7.2 Recherche: Wie handgebaute Level aufgebaut sind

Quellen: RobTops Bewertungsdokument, das Geometry-Dash-Wiki (Abschnittslisten der offiziellen und
bekannter Demon-Level), Steam-Guides, die öffentliche API der GD Demon Ladder (Bewertungen und
Tags, keine Leveldateien). Daraus übernommen:

- **Klicks pro Sekunde steigen kaum mit der Stufe** (offizielle Level: ~0,6–1,3/s auf allen
  Stufen). Schwerer wird es durch engere Zeitfenster, engere Korridore (Extreme Demons: 1,5 Blöcke),
  Tempo und häufigere Moduswechsel.
- **Abschnittslängen:** Easy–Hard ~22–31 s, Insane ~4–10 s, Demons ~4–6 s.
- **Aufbau:** ruhiger Einstieg, vor dem Drop ein ruhigerer Anlauf, der Drop mit Modus- und
  Tempowechsel auf dem Schlag, keine Schwierigkeitsspitze am Ende.
- **Practice:** Z setzt einen Checkpoint, X entfernt den letzten; automatische Checkpoints
  zusätzlich.

### 7.3 Was geändert wurde

**Schwierigkeiten (`build.ts`).** Hard ist jetzt etwa das bisherige Extreme (Tempo 3x/4x, alle
Modi, Orb-Ketten); Insane und Extreme gehen darüber hinaus. Neue Werte je Stufe statt fester
Listen im Code: Ziel-Zeitfenster `window` (ruhig/intensiv), längste Pause ohne Klick `idle`,
Abschnittslängen `parts`, Enge der Flugteile `tight`, Orbs, Gravity-Wechsel.

| Stufe   | Toleranz je Seite | Ziel-Fenster (ruhig → intensiv) | Tempo  | Abschnitte | Ship-Tunnel (halbe Höhe) |
| ------- | ----------------- | ------------------------------- | ------ | ---------- | ------------------------ |
| easy    | 80 ms             | 340 → 280 ms                    | 1x     | 14–32 s    | 2,5                      |
| normal  | 60 ms             | 300 → 230 ms                    | 1x, 2x | 9–24 s     | 1,9                      |
| hard    | 32 ms             | 270 → 190 ms                    | 3x, 4x | 6–15 s     | 1,3                      |
| insane  | 28 ms             | 210 → 140 ms                    | 3x, 4x | 5–12 s     | 1,05                     |
| extreme | 24 ms             | 160 → 100 ms                    | 3x, 4x | 4–10 s     | 0,85                     |

**Intensitätskurve (`generate.ts: intensities`).** Jeder Abschnitt bekommt eine Intensität
0–1: sein Rang nach Dichte und Lautstärke unter den Abschnitten des Songs, Kiai oben. Erster
Abschnitt höchstens 0,3 (Einstieg), der Abschnitt direkt vor einem Drop höchstens 0,45 (Anlauf),
der letzte höchstens 0,55. Daraus folgen Tempo, Ziel-Zeitfenster, Enge der Tunnel, Anteil kleiner
Modi und auf den harten Stufen die Wahl schnellerer Modi (Wave, UFO, Spider) im Intensiven.

**Cube und Robot (`builders/runner.ts`, neu geschrieben).** Jeder Sprung wird als Ganzes geplant:
Absprung (Sprung, Orb am Boden, Pad, Dash-Orb auf gehaltener Note), Orbs in der Luft auf den
folgenden Noten (Ketten bis 4), Landung (gleiche Höhe, Stufe hoch, über eine Kante hinunter).
Das Hindernis wird so gesetzt, dass es das Zeitfenster bestimmt: der erste Spike (oder die
Absprungkante) so weit nach dem Absprung, wie ein später Klick kommen darf, der letzte Spike (oder
der Beginn der Landefläche) so weit vor der Landung, wie ein früher darf. Mehrere Layouts werden
gebaut und mit der Physik gespielt; gemessen wird das echte Fenster des Klicks, und wenn es zu
groß ist, wird das Layout um den Überschuss je Seite enger gebaut. Gewählt wird das Layout, das dem
Ziel am nächsten kommt (mit etwas Zufall, Abwechslung und Wiederholung, wo die Musik sich
wiederholt). Neue Formen: Spike-Reihen mit kleinen Spikes oder einer Säge in der Mitte, Stufen,
Gruben mit Kanten, Orb-Ketten, Ringe am Boden. Noten, die zu dicht für einen eigenen Sprung sind,
werden bewusst übersprungen statt den ganzen Takt leer zu lassen.

**Flugteile (`builders/flight.ts`).** Auf den harten Stufen im Intensiven: Wandspalten je halben
Beat und auf dem Halbblock-Raster, Öffnungen nur alle vier Takte, Ship-Pfad gerader
(Straight-Fly), Sägen halb in den Tunnelwänden. **Ball und Spider** bekommen Timing-Spikes: einer
auf der Seite, die sie verlassen (zu spät = tot), einer auf der Seite, auf der sie ankommen (zu früh
= tot). **Wave:** das „ungenaue Spieler“-Modell, nach dem Korridore verbreitert werden, ist auf
den höheren Stufen genauer.

**Eigene Checkpoints (`game.ts`, `DashView.svelte`).** Im Practice-Modus setzt **Z** einen
Checkpoint dort, wo man gerade ist (auch in der Luft, mit Geschwindigkeit), **X** entfernt den
letzten, auch während man auf den Neustart wartet. Wo Z/X Sprungtasten sind (osu!-Tasten), sind es
**C** und **V**. Dazu Knöpfe oben rechts (mit Anzahl) und im Pausenmenü. Automatische Checkpoints
lassen sich im Menü abschalten („Auto“). Ein eigener Checkpoint bleibt auch, wenn man kurz danach
stirbt (automatische werden dann wie bisher verworfen). Kommt ein Druck verspätet an und das Spiel
rechnet zurück (Rollback), wird ein eigener Checkpoint an derselben Stelle neu gesetzt.

**Sonstiges.** `GENERATOR_VERSION` ist `gd-2.2091-route2` (alte Level im Cache werden nicht
weiterverwendet). Im Menü steht zu jeder Stufe ein Satz, was sie bedeutet.

### 7.4 Gemessen

Siehe Tabelle 7.5 (fünf echte Beatmaps, je Stufe gemittelt). Tests (`npm run test:dash`) prüfen
auf den Testsongs zusätzlich:

- jede Stufe durchspielbar, jedes Klickfenster ≥ Toleranz, Sichtzeit ≥ 0,5 s (wie bisher);
- **Median der Cube/Robot-Klickfenster sinkt** von Hard zu Insane zu Extreme jeweils um mehr als
  20 ms, Extreme < 75 % von Hard; Gesamtmedian Extreme < 75 % von Easy;
- **mehr Abschnitte pro Minute** (Extreme > 1,8 × Easy) und **engere Ship/UFO-Tunnel**
  (Median auf Extreme ≤ 4 Blöcke, enger als Normal);
- Intensitätskurve: Einstieg ruhig, Anlauf vor dem Drop ruhiger, Kiai oben, Ende nicht am
  schwersten; intensive Abschnitte nie langsamer als ruhige;
- Checkpoints: setzen (am Boden und in der Luft), zwischen zwei Physikschritten angefordert,
  entfernen (auch im Tod), bleiben beim Tod direkt danach, überstehen den Rollback, ohne Practice
  keine.

### 7.5 Vorher/nachher an echten Beatmaps

Fünf Beatmaps (jeweils die schwerste der Map): Sparkling Daydream [Insane], Remote Control [Max
Control!], FREEDOM DiVE [FOUR DIMENSIONS], Tsukinami [Nostalgia], MONONOKE [Orientalism]. Je Stufe
gemittelt über die fünf Level; „vorher“ ist 0.6.74 mit dem Absturz-Fix aus 7.1. Alle 50 Level sind
durchspielbar, kein Klick hat weniger Platz als die Toleranz.

| Stufe   | Median-Fenster je Klick | Tempo Ø (Blöcke/s) | Klicks/s    | Sägen je Level |
| ------- | ----------------------- | ------------------ | ----------- | -------------- |
| easy    | 310 → 307 ms            | 10,4 → 10,4        | 0,55 → 0,56 | 0 → 0          |
| normal  | 302 → 296 ms            | 11,0 → 11,2        | 0,92 → 0,95 | 0 → 0          |
| hard    | 303 → 266 ms            | 11,0 → 16,8        | 1,22 → 1,69 | 0 → 8          |
| insane  | 296 → 223 ms            | 13,5 → 16,8        | 1,53 → 1,55 | 0 → 12         |
| extreme | 261 → 202 ms            | 16,4 → 16,7        | 1,56 → 1,41 | 0 → 13         |

Neues Hard ≈ altes Extreme (Fenster 266 zu 261 ms, Tempo 16,8 zu 16,4). Die Sprünge von Cube und
Robot allein: auf Extreme Median ~140–155 ms (vorher ~260 ms). Ship- und UFO-Tunnel auf Extreme im
Median 2,5–3,5 Blöcke hoch (vorher im Mittel aller Flugteile 6–7). Extreme hat nicht mehr Klicks
pro Sekunde als Hard; es ist enger, nicht dichter (wie bei handgebauten Levels, 7.2).

### 7.6 Grenzen

- **UFO und Swing** haben noch keine eigenen Timing-Hindernisse; ihre Fenster sind auch auf
  Extreme oft groß (Median ~250 ms). Orb-Klicks ebenso (der Orb wirkt in ±1,1 Blöcken).
- Gemessen ohne Audio (nur Beatmaps); mit Audio ändern sich Akzente und Intensität.
- Die Generierung dauert länger (lange Maps auf dem Rechner hier ~3–5 s statt ~2–4 s, im Worker).
- Nicht in der laufenden App gespielt (Tauri und osu!-Login fehlen hier).

## 8. 0.6.76: Robot, Wave, keine Rastplätze, Spider-Treppen

Nach Rückmeldung zum Spielen von 0.6.75. Alle Befunde habe ich an Bildern der generierten Abschnitte
(Blöcke, Spikes, geplanter Weg) und mit Messungen geprüft.

- **Robot:** Nach einem vollen Sprung ging kein sofortiger zweiter. Ein Robot-Sprung verlangte einen
  _neuen_ Druck, und ein Druck kurz vor der Landung wurde bei der Landung verworfen. **Jetzt** springt
  der Robot am Boden, sobald gedrückt ist, wie der Cube: gehalten durch die Landung gleich wieder,
  ein Druck kurz davor geht nicht verloren (`native-robot.ts`, Tests in `robot.test.ts`).
- **Wave:**
  - Der Pfad lief oft bis an Boden oder Decke und rutschte dort entlang. Bei flachen Korridorseiten
    war dann der Boden selbst die Wand, und die ist sicher: Man konnte einfach unten bleiben.
  - **Jetzt** zickzackt der Wave in einem Band mit Abstand zu Boden und Decke. Ist der Weg bis zur
    nächsten Note zu lang, knickt er am Bandrand auf einem Viertelbeat. Das Band steigt und fällt
    über vier Takte, auf den harten Stufen gibt es Engstellen.
  - Zwei Fehler dabei behoben: Knicke lagen zwischen den Physikschritten und summierten sich über
    viele Knicke zu bis zu 2 Blöcken Abweichung; jetzt liegt jeder Knick auf einem Schritt. Und ein
    Knick nach dem Abschnittsende fiel in den nächsten Abschnitt. Die Reparatur in `generate.ts`
    hat in solchen Fällen den ganzen Korridor gelöscht; jetzt weitet sie ihn nur an der Stelle.
- **Keine Rastplätze (UFO, Swing, Ship):**
  - Nach dem Bauen wird von jedem Klick aus „nichts tun“ gespielt, beim Ship auch „dauerhaft
    halten“. Rutscht der Spieler dann an einer Fläche entlang, kommt dorthin ein Spike. Wo dafür
    kein Platz ist, ein kleiner Spike, sonst eine halbe Stufe. Danach wird alles wieder mit allen
    Spielweisen geprüft.
  - Der nachträgliche Fairness-Pass entfernte in Flugteilen Hindernisse und öffnete so wieder
    Rastplätze. Er läuft jetzt nur noch für Cube und Robot; die Flug-Builder prüfen selbst mit
    einzeln verschobenen Drücken.
  - Gemessen auf drei echten Maps, Anteil der Klicks, nach denen 1,6 s Nichtstun überlebt
    (vorher → nachher):

    | Stufe   | Ship     | Swing     | UFO       | Wave     |
    | ------- | -------- | --------- | --------- | -------- |
    | normal  | 16 → 0 % | –         | 26 → 11 % | 0 → 0 %  |
    | extreme | 32 → 0 % | 33 → 10 % | 13 → 8 %  | 11 → 0 % |

- **Spider und Ball als Treppen:** Bisher waren Boden und Decke flach, und es ging nur hoch und
  runter. Jetzt bewegt sich, während der Spieler auf einer Seite ist, die andere Seite eine bis drei
  Stufen hoch oder runter, mitten im Aufenthalt und weg von Absprung und Landung. So ist jeder Wechsel
  anders weit; wo die Musik lauter wird, eher nach oben. Spike-Reihen haben 1–3 Spikes statt immer
  gleich. Beim Swing ist der Ausschlag auf den harten Stufen größer.
- **Gravity-Portale in jedem Modus:** Bisher gab es sie nur in Ship, UFO, Ball und Spider, und dort
  selten: Sie mussten auf einer Note liegen, und in 280 ms Nähe durfte kein Klick sein, was in
  schnellen Teilen fast nie zutraf. Neu:
  - _Flugteile_ (jetzt auch Swing): Portale auf den Taktanfängen jedes zweiten Takts, auch ohne Note
    dort, mit 160 ms Abstand zu Klicks.
  - _Wave_: Ab Hard wird ab und zu ein Knick auf einem starken Taktanfang zum Portal. Der Wave dreht
    dort ohne Klick, danach ist die Steuerung umgekehrt (halten = runter).
  - _Cube und Robot_: Kopfüber-Passagen. Ein Portal (ab Hard manchmal ein blauer Orb, also ein
    Klick) dreht die Schwerkraft, der Spieler läuft unter einer Platte und springt auf den Noten nach
    unten über hängende Spikes. Ein Portal oder Orb dreht zurück. Geprüft wird mit allen
    Spielweisen, und jeder Druck muss nötig sein.
  - Gemessen auf drei echten Maps: Auf Extreme kommen Gravity-Wechsel in bis zu sieben Modi pro
    Level vor (etwa 5–9 je Level, dazu Kopfüber-Passagen per blauem Orb).
- **Zwei Parser-Fixes (`chart.ts`):**
  - Manche Maps nutzen absurde Tempopunkte als Effekt (gefunden in „Acid Rain [Aspire]“: eine
    Beat-Länge von 1e-289 ms). Jede Schleife über Beats lief dann praktisch endlos, und das Level
    wurde nie fertig. Das betraf auch die bisherigen Versionen (gemessen: nach 90 s abgebrochen).
    Jetzt zählen Tempopunkte außerhalb 6–1200 BPM nicht als Takt; das Raster davor läuft weiter.
  - Aus solchen Effekten entstanden auch Slider von Minuten Länge. Noten dauern jetzt höchstens 30 s.
- **0.6.77, ein unfairer Klick:** Auf „Acid Rain“ (Hard) hatte ein Mini-UFO-Klick nur ±4 ms
  Spielraum. Das Fenster war nicht zusammenhängend: ±24 ms ging, ±8 ms nicht. Ursache: Am Ende
  entfernte der Builder einen Orb, weil der pünktliche Lauf ihn nicht brauchte – den leicht
  verfrühten Druck hatte aber genau dieser Orb abgefangen. Jetzt prüfen die Flug-Builder jeden
  Druck auch einzeln (jeden Physikschritt bis zur halben Toleranz und ±75 %, die anderen pünktlich).
  Ein Orb fliegt nur raus, wenn danach alle Spielweisen bestehen. Nachgemessen auf drei echten Maps ×
  vier Stufen: kein Klick unter der Toleranz.
- **Tests:** Robot springt gehalten weiter und nimmt einen Druck kurz vor der Landung mit. Kein
  Rastplatz in Flugteilen (unter 10 % auf den Testsongs). Spider- und Ball-Abschnitte haben Stufen.
  Gravity-Wechsel in mindestens vier Modi; Kopfüber-Passagen im Cube durchspielbar und richtig
  abgestützt. Absurde Tempopunkte: Das Level wird trotzdem gebaut.
  Dazu alle bisherigen Prüfungen: durchspielbar, jedes Fenster ≥ Toleranz.

## 9. 0.6.78: leichterer Wave, Orbs in Ship und Spider

- **Wave leichter**, vor allem der kleine bei hohem Tempo:
  - Breitere Korridore auf Hard, Insane und Extreme (halbe Höhe 1,85 / 1,6 / 1,35 statt 1,6 / 1,3 /
    1,05). Der kleine Wave bekommt ×1,55 statt ×1,3, und jede Tempostufe über 1x macht 10 % breiter.
  - Mehr Zeit zwischen zwei Knicken.
  - Der kleine Wave kommt auf Hard und Insane höchstens mit 2x, auf Extreme mit 3x Tempo.
  - Das Band, in dem der Pfad zickzackt, ist mindestens 4,5 Blöcke hoch (klein 5,5), damit er nicht
    ständig am Rand knicken muss.
  - Engstellen gibt es nur noch auf Extreme.
  - Gravity-Teile: ein Portal hinein, nach ein bis zwei Takten automatisch eins zurück, und der
    Korridor ist dazwischen breiter.
  - Gemessen auf vier echten Maps (vorher → nachher):

    | Stufe   | Wave  | Korridor Median | engste 10 % | Knicke/s  |
    | ------- | ----- | --------------- | ----------- | --------- |
    | extreme | groß  | 4,3 → 5,1       | 2,9 → 3,5   | 5,7 → 5,5 |
    | extreme | klein | 4,9 → 7,1       | 2,0 → 5,0   | 8,8 → 7,5 |
    | insane  | groß  | 4,5 → 5,8       | 2,7 → 4,3   | 6,2 → 6,3 |
    | insane  | klein | 5,3 → 7,5       | 2,7 → 5,7   | 8,9 → 6,9 |
    | hard    | groß  | 5,2 → 5,7       | 3,2 → 4,4   | 6,9 → 7,1 |

- **Orbs im Ship:** Auf starken Noten liegt ein Orb auf dem Weg. Ein gelber schießt das Ship sofort
  2–2,5 Blöcke hoch (20 Blöcke/s; durch Halten erreicht es nur 14,4 und auch die erst nach einer
  Weile), ein schwarzer drückt es ebenso schnell runter, und der Tunnel folgt dem Knick. Jeder Orb
  wird geprüft: Ohne ihn, mit normalem Steuern, darf der Abschnitt nicht zu schaffen sein, sonst
  fällt er weg. Auch Orbs, die der fertige Weg nicht berührt, werden entfernt.
- **Orbs im Spider:** Auf manchen Klicks steht ein gelber oder roter Orb auf dem Boden. Der Spider
  springt dann im Bogen über Spikes auf seiner Seite, statt zu teleportieren. Genau gegenüber dem
  Absprung liegt ein Spike: Wer stattdessen normal klickt, landet darauf; wer nicht klickt, läuft in
  die Spikes. Noten, die mitten im Sprung liegen, werden übersprungen.
- **Tests:** kein kleiner Wave mit 4x Tempo, Wave-Korridore (engste 10 %) mindestens 3 Blöcke, Orbs
  in Ship und Spider kommen vor und werden vom Plan auch benutzt.

## 10. 0.6.79: Modi und Gravity selbst wählen

Im Dash-Menü öffnet ein neuer Knopf (Zahnrad, neben dem Sound-Menü) eine Liste aller Modi mit zwei
Schaltern (`DashModesMenu.svelte`, gespeichert auf dem Gerät in `modes.ts`):

- **An:** Ob der Modus in den Leveln vorkommt. Der Cube bleibt immer an, jedes Level beginnt und
  endet mit ihm. Welche Modi eine Stufe überhaupt hat, bleibt ihre Sache (Easy hat z. B. keinen Wave);
  die Einstellung kann nur weglassen.
- **Gravity:** Ob in diesem Modus Gravity-Portale vorkommen. Bei Cube und Robot heißt das: keine
  Kopfüber-Passagen. Gravity-Orbs (blau, grün) in UFO und Ball sind Orbs und bleiben.

Der Generator bekommt die Auswahl als `modes` und `gravity` (`generateLevel`, über den Worker); mit
allem an ist das Level genau dasselbe wie ohne Einstellung. Levels mit anderen Einstellungen sind
andere Levels: Ihre Bestleistung wird getrennt gespeichert (`bestKey` mit Kennung), damit z. B. ein
Level ohne Wave nicht als 100 % des normalen zählt. Ein Punkt am Zahnrad zeigt, dass etwas
abgeschaltet ist.

Tests (`tests/dash/modes.test.ts`): abgeschaltete Modi kommen nie vor, nur Cube ergibt nur Cube, und
beides bleibt durchspielbar; ohne Gravity keine Portale und kein Cube kopfüber; Gravity nur im Ship
heißt Portale nur im Ship; Bestleistungen getrennt.

## 11. 0.6.80: weniger Leerlauf, jeder Klick nötig, Ship mit Slalom

Gemessen auf drei echten Maps (Hard und Extreme). „Leerlauf“ heißt hier: eine Strecke von mindestens
1 s ohne Klick, in der die Map mindestens drei Noten hat. „Unnötig“ heißt: Ohne diesen einen Klick
überlebt man die nächsten 1,2 s trotzdem.

| Modus  | Leerlauf vorher → nachher | unnötige Klicks vorher → nachher |
| ------ | ------------------------- | -------------------------------- |
| Cube   | 35 → 18 %                 | 5 → 5 %                          |
| Robot  | 26 → 15 %                 | 3 → 4 %                          |
| Spider | 29 → 2–10 %               | 29 → 7 %                         |
| Ball   | 1 → 5 %                   | 61 → 25 %                        |
| UFO    | 0 → 0 %                   | 28 → 7 %                         |

Was es war und was geändert wurde:

- **Ein Regelverstoß löschte alle Spikes eines Abschnitts.** Verletzte ein einziges Objekt eine
  Bauregel (seit den Treppen oft ein Orb, der in eine Stufe ragte), wurden alle Spikes des Flugteils
  entfernt. Ball- und Spider-Abschnitte waren dadurch oft ganz ohne Spikes: Klicks waren unnötig, und
  Orb-Sprünge gingen über nichts. Jetzt verschwindet nur, was die Regel verletzt.
- **Leere Mini-Cube-Abschnitte:** Der kleine Cube springt kurz; die angestrebten Fenster passten auf
  den höheren Stufen nicht hinein, und keine Variante wurde gebaut. Jetzt gibt es eine
  Rückfall-Variante, so knapp wie die Toleranz erlaubt (und einen Block unter dem Sprung).
- **Tote Zeit an den Abschnitts-Enden:** Cube und Robot ließen die ersten 0,65 s und die letzten
  0,85 s aus, Flugteile je 0,4 s. Jetzt sind es 0,3 / 0,35 s (Flugteile 0,25 s am Anfang; am Ende
  0,45 s, Ball und Spider 0,7 s, weil ein verschobener Klick sonst in den nächsten Abschnitt ragt).
  Kopfüber-Passagen drehen direkt nach dem letzten Sprung zurück.
- **Spider und Ball dichter:** mindestens 0,26 bzw. 0,24 s zwischen Klicks statt 0,42 bzw. 0,3 s.
- **Jeder Klick nötig:** Für UFO, Ball und Spider wird jeder Klick einzeln weggelassen. Überlebt man
  dann, an einer Fläche entlang, kommt dort ein Spike hin (oder ein kleiner, oder eine Stufe).
- **Orbs, die nichts bringen:** Ein Orb bleibt nur, wenn der Weg ihn braucht. Orbs, die der Weg gar
  nicht berührt, werden entfernt.
- **Ship:** Phrasenweise wechselt es zwischen engem Tunnel und Slalom (weiter Tunnel, Säulen von oben
  und unten auf den Akzenten), dazu Orbs und Gravity wie bisher. Auf den hohen Stufen ist der
  Slalom seltener.
- **Mehr Modi-Vielfalt:** Ein Abschnitt wiederholt seltener nur den vorigen Modus mit anderer Größe,
  und noch nicht vorgekommene Modi werden bevorzugt.
- **Schlussprüfung:** Am fertigen Level wird jeder UFO-, Ball- und Spider-Klick jeden Physikschritt
  bis zur halben Toleranz früh und spät gespielt, wie der Validator misst; was dabei stört, wird
  entfernt. Auf sechs Leveln von drei Maps: kein Klick unter der Toleranz.

Grenzen: Beim Ball ist noch ein Viertel der Klicks unnötig. Die Generierung eines 4,5-Minuten-Songs
auf Extreme dauert jetzt ~10–12 s (im Worker, vorher ~8 s).

## 12. 0.6.81: Generator v2 aus 50 Bausteinen

Rückmeldung zu 0.6.80: die Level fühlen sich nicht nach Geometry Dash an. Die Ursache lag im Aufbau
des Generators: Klicks folgten den osu!-Noten (der Melodie, nicht dem Schlagzeug), Hindernisse wurden
pro Klick frei erzeugt, und was danach die Prüfung nicht bestand, wurde herausgerissen
(`repair`, `fairness`). Dadurch blieben Klicks ohne Hindernis übrig, Strukturen wirkten zufällig.

Cube, Robot und Ship werden jetzt anders gebaut (Standard, im Zahnrad-Menü umschaltbar auf
„Classic“; Bestwerte werden getrennt gespeichert):

- **Rhythmus (`rhythm.ts`)**: Klicks liegen auf einer Ebene der Musik, dem Schlagzeug (Noten mit
  Finish/Clap, was im Song zu hören ist, Taktschwerpunkte), auf dem Beat-Raster (halbe Beats,
  ab Insane Viertel). Pro Abschnitt wird ein Zwei-Takt-Muster gewählt und Takt für Takt wiederholt,
  so wie Creator synchronisieren. Dichte nach Schwierigkeit (0,5 bis 1,5 Klicks pro Beat), keine
  langen Lücken im Muster, auf Easy mindestens ein ganzer Sprung Abstand (Easy hat keine Orbs).
- **38 Cube/Robot-Bausteine (`builders/blocks.ts`)**: einzelne, doppelte, dreifache Spikes,
  kleine Spikes, Säge in der Reihe, Säule, Block, Stufe hoch (1 und 2), Stufe runter, Abgang auf den
  Boden, Lücke, Ringe (gelb, rot, pink, über Lücke), Dash-Orb auf gehaltenen Noten, Orb über einer
  Reihe (gelb, pink, rot hoch, Stufe, über Lücke), Orb-Ketten (2 und 3), Treppen hoch/runter,
  Hügel, Lücken-Ketten, Säulenpaare, Zickzack, Kopfüber-Stücke (Blue Orbs oder Gravity-Portale).
  Ein Baustein springt auf einem Klick ab, nimmt seine Orbs auf den Klicks in der Luft und den
  nächsten Sprung auf dem ersten Klick nach der Landung.
- **12 Ship-Bausteine (`builders/ship.ts`)**: gerade, Anstieg, Abstieg, Zickzack, Engstelle,
  Säulen-Slalom, um eine Säge, gelber Orb hoch, schwarzer Orb runter, kopfüber zwischen zwei
  Portalen, zwischen Spike-Reihen, Trichter. Wände sind Blöcke auf dem Halbblock-Raster entlang der
  Mitte des Stücks, Steigungen nach der gemessenen Steigrate des Ships (~14 Blöcke/s).
- **Prüfen beim Einsetzen statt Reparieren danach**: Jeder Baustein wird gebaut und mit der Physik
  gespielt: pünktlich, alle Klicks früh und spät, jeder Klick einzeln verschoben, beim Robot kürzer
  und länger gehalten, zusammen mit dem Baustein davor. Jeder Klick muss nötig sein (ohne ihn: tot).
  Besteht er nicht, wird er ganz entfernt und der nächste versucht. Von den passenden wird der
  gewählt, der die wenigsten Klicks auslässt. Danach wird gemessen, wie viel Spielraum der erste
  Klick wirklich hat; ist es mehr als die Schwierigkeit verlangt, wird er enger nachgebaut.
  `fairness` läuft für diese Abschnitte nicht mehr: Genau dieser Durchlauf hatte nachträglich
  Spikes entfernt und Klicks unnötig gemacht (63 von 351 auf einem Extreme-Level).
- **Ship ohne Rastplatz**: Würde man in einem Stück am Boden (nicht drücken) oder an der Decke
  (halten) durchrutschen, kommen dort Spikes hin, sofern die Flugwege (Mitte, ±0,3 Blöcke) noch
  durchkommen. Ein Orb-Stück ist nur gültig, wenn man ohne den Orb in die Wand fliegt.
- **Höhe**: Bausteine nach oben werden seltener, je höher das Gelände ist, solche nach unten
  häufiger. Das Level kommt immer wieder auf den Boden zurück.

Gemessen auf vier echten Maps (Easy bis Extreme, 20 Level; Cube/Robot-Abschnitte):

|                         | Leerlauf (Lücken > 1 s mit Noten) | unnötige Klicks | Klicks/s |
| ----------------------- | --------------------------------- | --------------- | -------- |
| Classic, Extreme        | 16–20 %                           | 8–15 pro Level  | 1,3–1,5  |
| Bausteine, Hard–Extreme | 1–14 %                            | 0               | 1,3–1,9  |
| Bausteine, Easy         | 22–31 % (gewollt: ~1 Sprung/s)    | 0               | 1,0–1,2  |

Alle 20 Level sind durchspielbar. Generierung eines 4,5-Minuten-Songs: 9–16 s im Worker. Neue
Tests: `tests/dash/blocks.test.ts` (50 Bausteine, Raster, Durchspielbarkeit, jeder Klick nötig,
kein langer Leerlauf, Classic weiterhin verfügbar).

Grenzen: UFO, Ball, Spider, Wave und Swing nutzen noch die bisherigen Builder. Normal hat auf
manchen Songs noch ~30 % Leerlauf (der Cube kann bei hohem BPM nicht jeden Beat springen, und
Normal hat wenige Orbs).

## 13. 0.6.82: Geschwindigkeit und Abschnitte folgen den Wechseln der Musik

Rückmeldung: Wird der Song schneller oder kommt ein Drop, ändert sich oft nichts. Dafür wird es
manchmal schneller, obwohl sich in der Musik nichts ändert.

Ursachen (gemessen mit Testsongs, je Normal und Hard):

- **Rang statt Musik**: Die Geschwindigkeit hing an der _Intensität_, und die war der Rang eines
  Abschnitts unter allen Abschnitten. In einem Song, der durchgehend gleich klingt, landet trotzdem
  ein Abschnitt im oberen Fünftel. Gemessen: Normal 0 → 2 → 1 → … → 2 → 1, Hard 2 → 3 → 4 → 3,
  ohne jeden Wechsel in der Musik.
- **Schnitte nur im Phrasenraster und am Kiai**: Ein BPM-Wechsel (140 → 185 bei 60 s) fiel weg,
  weil er zu nah am vorherigen Rasterschnitt lag. Das Tempo selbst ging nie in die Geschwindigkeit
  ein. Ergebnis: Ab 70 s schneller, ab 91 s wieder langsamer, obwohl die BPM blieben.
- **Drops nur über das Kiai**: Ein Drop im Audio wurde nur bei Maps _ganz ohne_ Kiai erkannt.
  Hat eine Map ihr Kiai woanders, blieb ein Drop wirkungslos.
- **Slider-Velocity**: Schnellere Slider des Mappers (`drive ≥ 1,3`) machten einen Abschnitt
  schnell, auch wenn die Musik dort ruhig war.
- **Mini-Wave**: Sie wurde auf Speed 2 (Extreme: 3) gedeckelt. Fiel ein Drop auf eine Mini-Wave,
  blieb er langsam, und der Abschnitt danach war plötzlich schnell.

Was geändert wurde (`generate.ts`):

- **`musicalChanges`**: Wechsel der Musik sind BPM-Wechsel (ab 3 %), Kiai-Anfang und -Ende und
  Energiesprünge: Takt für Takt Notendichte und Lautstärke (`barEnergies`), die vier Takte vor
  einem Taktstrich gegen die vier danach, ab Faktor 1,4 (stärkster innerhalb von vier Takten).
  So werden Drops und Breakdowns auch ohne Kiai erkannt, und Breaks bekommen Anfang und Ende.
- **Abschnitte**: Jeder Wechsel ist eine Abschnittsgrenze (zwei nahe: der stärkere, Tempo vor
  Kiai vor Energie; mindestens 4 s, Easy 5,6 s, Abstand). Das Phrasenraster füllt nur die
  Strecken dazwischen, gezählt ab dem Wechsel.
- **`paces`**: Die Geschwindigkeit hat drei Stufen (ruhig, normal, intensiv →
  `speeds[0] − 1`, `speeds[0]`, `speeds[1]`), bestimmt aus der Musik selbst: intensiv im Kiai,
  bei Energie ≥ 1,25 × Songmittel, bei Tempo ≥ 1,1 × üblichem Tempo (oder schnellen Slidern,
  wenn die Energie mindestens dem Mittel entspricht). Ruhig ab Normal bei Energie ≤ 0,6 oder
  Tempo ≤ 0,9. Gewechselt wird nur an einem musikalischen Wechsel (oder wenn sich die Energie
  seit dem letzten Wechsel um mehr als 20 % verschoben hat). Vor einem schnelleren Drop ist der
  Anlauf nicht schon intensiv. Die Intensität der Builder folgt der Stufe (intensiv ≥ 0,72,
  ruhig ≤ 0,4).
- **Mini-Wave**: Bei zu hoher Geschwindigkeit wird sie zur normalen Wave. Die Geschwindigkeit
  bleibt die der Musik.
- **Pausen**: Ein Abschnitt, der überwiegend Pause ist (Break oder Stille), wird ein großer Cube.
  Das Ship setzt in Pausen keine Spikes gegen das Ausruhen mehr. Vorher fiel das nicht auf, weil
  Pausen mitten in anderen Abschnitten lagen.
- `GENERATOR_VERSION` ist jetzt `gd-3.1-blocks` (die Level ändern sich).

Gemessen (Abschnittsgrenzen und Geschwindigkeitsstufe, Seed fest):

| Testsong                             | vorher                                                      | nachher                                                         |
| ------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------- |
| gleichbleibend, 150 BPM              | Normal 0/2/1/1/1/1/2/1/1/1, Hard 2/2/3/…/4/3                | Normal überall 1, Hard überall 3                                |
| 140 → 185 BPM bei 60 s               | kein Schnitt bei 60 s, schneller ab 70 s, ab 91 s langsamer | Schnitt bei 60,0 s, Normal 0 → 1, Hard 2 → 3, bleibt            |
| ruhig, Drop bei 60 s, Kiai bei 100 s | kein Schnitt am Drop, nur 65–78 s schnell                   | Schnitt bei 60,2 s, Normal 0 → 2, Hard 2 → 4, bis zum Kiai-Ende |
| Kiai 45–75 s                         | Kiai schnell, Hard am Ende grundlos 2                       | Kiai schnell, sonst gleich                                      |

Neue Tests: `tests/dash/speeds.test.ts` (Wechsel werden erkannt, gleichbleibender Song hat eine
Geschwindigkeit, höheres Tempo ab dem Wechsel schneller, Drop ohne Kiai schneller, Regeln von
`paces`).

Grenzen: Easy hat weiterhin nur eine Geschwindigkeit (`speeds: [1, 1]`). Gemessen ist nur mit
synthetischen Testsongs. Wie gut die Energiesprünge auf echten Songs sitzen (z. B. bei
Build-ups mit langsam steigender Lautstärke), ist noch nicht an echten Maps überprüft.

## 14. 0.6.83: Flugteile, Pflicht-Orbs, Beat, Timing-Abgleich, Slider-Velocity

Rückmeldung: Beim Spider läuft man teils lange und die Spikes sind oben, beim UFO muss man an der
Decke nur spammen, viele Orbs braucht man nicht. Dazu: mehr auf dem Beat, BPM-Wechsel der Maps
manchmal zu früh/spät gesetzt, und seit 0.6.82 wird es dort, wo der Song bei gleichem BPM
intensiver wird, manchmal nicht mehr schneller.

Gemessen (vier Testsongs × Hard/Insane/Extreme × drei Seeds, vorher → nachher):

| Modus  | Orbs nötig        | Spikes außer Reichweite (> 2 Blöcke vom Weg) |
| ------ | ----------------- | -------------------------------------------- |
| Cube   | 213/268 → 192/192 | –                                            |
| Robot  | 162/230 → 141/141 | –                                            |
| Ball   | 39/71 → 42/42     | 535/915 → 48/414                             |
| Spider | 102/103 → 107/107 | 614/928 → 324/580 (Rest: Timing-Spikes)      |
| UFO    | 52/70 → 41/41     | UFO an der Decke 6 % → 2–4 %                 |

Was geändert wurde:

- **Pflicht-Orbs** (`blocks.ts`, `flight.ts`, `generate.ts`): Ein Cube/Robot-Baustein gilt nur,
  wenn jedes seiner Orbs nötig ist (ohne Orb, Klick bleibt: tot). In UFO, Ball und Spider wird ein
  Orb, den man pünktlich nicht braucht, nötig gemacht: ein Spike (auf hochgezogenem Boden oder
  heruntergezogener Decke) dort, wo der Weg ohne Orb hinführt und die Wege mit Orb nicht. Passt
  keiner, fällt das Orb weg. Vorher reichte es, dass ein zu früher/später Klick es brauchte. Am
  Ende prüft `uselessOrbs` das fertige Level: Orbs, die der Plan nicht berührt oder ohne die er
  durchkommt, gehen (die Nachbearbeitung entfernt Hindernisse und konnte Orbs überflüssig machen).
- **UFO nicht an der Decke**: Ein Klick, nach dem das UFO bis 0,9 Blöcke an die Decke käme, wird
  ausgelassen (zuerst nur sein Orb). Es sinkt bis zum nächsten Beat.
- **Spider und Ball ohne Deko-Spikes**: Die Spike-Reihen kamen auf die Seite mit dem meisten Platz,
  also immer die, auf der man nicht ist. Ab Normal kommen ihre Spikes nur noch von `timingSpikes`
  (der Zeitpunkt des Wechsels) und `noResting` (jeder Klick nötig). Easy bleibt wie bisher.
- **Mehr auf dem Beat**: UFO, Ball und Spider klicken wie Cube, Robot und Ship auf dem Schlagzeug
  (`drumClicks`: Zwei-Takt-Muster, Takt für Takt), nicht mehr auf den Noten. Gravity-Portale
  nehmen ihren Downbeat (kein Klick direkt daneben).
- **Timing-Abgleich** (`timing.ts`, neu): Die Timing-Punkte der Map werden gegen die Anschläge im
  Song geprüft. Ein BPM-Wechsel geht dorthin, wo das alte Raster aufhört und das neue passt
  (auf halben Beats verglichen, bis acht Beats in beide Richtungen, nur wenn klar besser). Ein
  Raster, das 10–60 ms neben dem Song liegt (gemessen gegen den Versatz des restlichen Songs), wird
  verschoben, die Noten darauf mit. Ohne Audio oder wenn es nicht klar ist, bleibt die Map.
- **Schneller bei gleichem BPM**: In 0.6.82 machte eine schnellere Slider-Velocity nur zusammen mit
  überdurchschnittlicher Energie schneller, und die Energie musste 25 % über dem Songmittel
  liegen. Jetzt sind SV-Sprünge des Mappers (4 Takte gegen 4 Takte, ab 20 %) eigene Wechsel, SV ≥
  1,25 macht schnell (außer es ist klar ruhig), und schnell ist auch, was im oberen Drittel der
  Energie-Spanne dieses Songs liegt (nur wenn der Song überhaupt Unterschiede hat).
- Testsongs: Das Audio folgt jetzt dem BPM-Wechsel (vorher lief es im alten Tempo weiter). Neue
  Optionen für falsch gesetzte Timing-Punkte, SV-Abschnitte und lautere Abschnitte. Der Test zum
  Klick-Spielraum mittelt über zwei Seeds (ein Seed allein schwankte um mehr als die geprüften
  20 ms).

Neue Tests: `tests/dash/timing.test.ts`, SV-Fall in `tests/dash/speeds.test.ts`.

Grenzen: Alles mit synthetischen Testsongs gemessen. Der Timing-Abgleich braucht klare Anschläge
im Audio; bei sehr dichter Musik bleibt die Map unverändert.

## 15. 0.6.84: Gravity-Portale, die wirken; mehr Klicks auf dem Beat; Drops nach Build-ups

Rückmeldung zu 0.6.83: Manche Gravity-Portale tun nichts, weil Orbs, die die Schwerkraft drehen,
nicht mitgerechnet werden. Zu wenig passiert zum Beat. Beim Drop eines Songs ändert sich teils
nichts.

Gemessen (vier Testsongs × Normal/Hard/Extreme × zwei Seeds):

|                                             | 0.6.83      | jetzt       |
| ------------------------------------------- | ----------- | ----------- |
| Gravity-Portale in Abschnitten ohne Wirkung | 28 von 89   | 0 (*)       |
| Portale an Abschnittsanfängen ohne Wirkung  | 94 von 125  | 0 von 30    |
| Klicks pro Beat, Cube/Robot Normal          | 0,55 / 0,47 | 0,58 / 0,52 |
| Klicks pro Beat, Cube/Robot Hard            | 0,63 / 0,63 | 0,73 / 0,70 |
| Klicks pro Beat, Cube/Robot Extreme         | 0,72 / 0,72 | 0,82 / 0,90 |

(*) Die Messung zählt zwei Swing-Portale mit, auf die genau ein Klick fällt: Das Portal dreht dort
den Klick zurück, wirkt also.

Ursachen und Änderungen:

- **Portale**: Ein Portal setzt die Schwerkraft auf einen festen Wert. Die Flugteile setzten ihre
  Portale abwechselnd (kopfüber, normal, …), ohne zu rechnen, dass Ball- und Spider-Klicks und
  blaue/grüne Orbs die Schwerkraft dazwischen drehen. Jetzt bekommt jedes Portal seine Richtung
  erst, wenn klar ist, mit welcher Schwerkraft man dort ankommt (`settle` in `flight.ts`). Am Ende
  prüft `uselessPortals` das fertige Level: ein Portal ohne Wirkung wird umgedreht (wenn das Level
  so durchspielbar bleibt) oder entfernt; jede Änderung wird bis zum Levelende gespielt. Das
  Rücksetz-Portal am Abschnittsanfang kommt nur noch, wenn man kopfüber ankommt (vorher bei jedem
  Moduswechsel), und wird nur im allerletzten Durchgang entfernt (eine frühere Fassung entfernte
  es zu früh, ein Robot flog danach kopfüber aus dem Level).
- **Mehr auf dem Beat**: Ein Cube-Sprung dauert etwa so lang wie ein Beat; der Klick danach wurde
  erst 40 ms nach der Landung angenommen und fiel deshalb meist weg. Jetzt darf er bis 30 ms vor
  der Landung kommen (gehalten bis zum Aufsetzen: der Cube springt beim Landen). Fällt der nächste
  Klick in die Luft, werden Bausteine mit Orb dort bevorzugt und bis zu acht Kandidaten verglichen.
  Eine Kopfüber-Strecke zählt bei der Auswahl wie ein ausgelassener Klick (sonst gewinnen die
  einfachen Sprünge immer).
- **Drops nach Build-ups**: Ein Build-up mit Snare-Roll hat in der Map einen Stream (viele Noten),
  aber keinen Kick; der Drop hat weniger Noten, ist lauter und hat den Kick. Die Energie zählte nur
  Notendichte und Lautstärke, also sah der Build-up intensiver aus als der Drop: schneller wurde
  es beim Build-up, am Drop nicht. Jetzt zählt der Kick mit (Energie = (Dichte × 0,5 + Lautstärke
  - Kick) / 2,5), und ein Wechsel ist auch, wo Lautstärke (ab × 1,35) oder Kick (ab × 1,6) allein
    klar springen; die Schwelle der Energie selbst ist von × 1,4 auf × 1,3 gesenkt.
- Tests: neuer Testsong mit Build-up und Drop, Prüfung, dass jedes Portal wirkt. Der Test zum
  Klick-Spielraum verlangt zwischen Insane und Extreme jetzt 10 statt 20 ms Abstand: Extreme liegt
  bei jedem Seed bei 163 ms (ein Sprung über einen Spike bei seiner Geschwindigkeit), Insane
  schwankt je Seed-Paar um etwa 20 ms.
- `GENERATOR_VERSION` ist `gd-3.3-blocks`.

Grenzen: Gemessen mit synthetischen Songs. Spider kommt weiterhin nur auf 0,55–0,64 Klicks pro
Beat.

## 16. 0.6.85: Volle Drops: Abschnitte pro Phrase, Gravity auf den Akzenten, Pads

Rückmeldung: Bei richtig schnellen Parts (Extreme) passiert zu wenig, im Song passiert doppelt so
viel wie im Spiel. Gemessen auf einem Testsong mit 174 BPM, intensiv, Kiai 30–75 s, Extreme: Der
Modus wechselte nur alle ~11 s (Abschnittslänge 5–12 s, acht Takte), im Kiai 2–3 Orbs, kein Pad,
Gravity-Portale höchstens alle zwei Takte und nur `preset.level` pro Abschnitt.

Änderungen:

- **Abschnitte pro Phrase** (`planParts`): In Teilen mit hoher Geschwindigkeitsstufe wird auf
  Extreme alle 2 oder 4 Takte geschnitten (das, was näher an 4,5 s liegt, mindestens 2,8 s), auf
  Insane näher an 6,5 s. Jeder Schnitt darf einen Takt vor- oder zurückrücken, auf den Taktstrich,
  den der Song deutlich härter trifft (`accentAt`: Anschlag und Kick). An diesen Schnitten kommt
  fast immer ein neuer Modus (oder derselbe in der anderen Größe). Ein Größenwechsel auf die kleine
  Wave, die bei der Geschwindigkeit nicht erlaubt ist, wird nicht mehr geplant (er ergab zwei
  gleiche Abschnitte hintereinander).
- **Gravity auf den Akzenten**: In intensiven Teilen auf Insane und Extreme setzen UFO, Ball,
  Spider und Swing Portale auf jedem Takt und jedem stark getroffenen Beat (mindestens zwei Beats
  auseinander, doppelt so viele); die Wave doppelt so viele Portale in 1,5 statt 3 Takten Abstand;
  das Ship-Stück mit Portalen und die Cube/Robot-Kopfüber-Stücke werden dort 3- bzw. 2-mal so oft
  gewählt.
- **Pads**: Sechs neue Cube/Robot-Bausteine (gelbes Pad über eine Reihe, pinkes über einen Spike,
  gelbes und rotes eine Stufe hoch, Pad mit Orb in der Luft, Pad und danach ein Sprung). Das Pad
  liegt so, dass es genau auf dem Klick auslöst, ohne Druck; auf starken Akzenten werden sie
  bevorzugt. Wie Orbs muss jedes Pad nötig sein (ohne: tot). Ball und Spider bekommen in
  intensiven Teilen auf starken Akzenten manchmal ein blaues Pad statt des Klicks (dreht die
  Schwerkraft auf dem Schlag). `uselessOrbs` prüft auch Pads.

Gemessen (Kiai, Ereignisse = Portale + Abschnittswechsel + Orbs + Pads):

|                       | vorher       | jetzt                               |
| --------------------- | ------------ | ----------------------------------- |
| Moduswechsel, 174 BPM | 2 in 22 s    | 7 in 45 s (alle 4 Takte)            |
| Moduswechsel, 128 BPM | –            | 11 in 40 s (alle 2 Takte)           |
| Gravity-Portale       | 5–15 je Kiai | 17–23 je Kiai                       |
| Pads                  | 0            | 3–11 je Kiai                        |
| Ereignisse pro Beat   | ~0,15        | Extreme 0,26–0,54, Insane 0,32–0,52 |

32 Level mit anderen Seeds: alle durchspielbar, alle 351 Gravity-Portale wirken. Neue Tests:
`tests/dash/busy.test.ts`. `GENERATOR_VERSION` ist `gd-3.4-blocks`.

Grenzen: Nur mit synthetischen Songs gemessen. Die Geschwindigkeit wechselt innerhalb eines
Drops noch nicht.

## 17. 0.6.86: Übergänge ohne Leerlauf, ein Level statt vieler Parts, Geschwindigkeit nach dem Song

Rückmeldung zu 0.6.85: Manche Parts sind zu leer, zwischen jedem Moduswechsel passiert kurz
nichts, alles fühlt sich wie eigene Parts an; auf Extreme nur 3× und 4×.

Gemessen (Extreme, Mediane je Modus): Nach jedem Portal 0,4–0,6 s ohne Klick, davor 0,8–1,3 s;
der Spider mit 0,9 Klicks/s und Lücken bis 3,2 s (ein Part ganz ohne Klick). Ursachen: große
Sicherheitsabstände der Builder zum Abschnittsanfang und -ende (Flugteile 300 ms Struktur, Klicks
erst ab 250 ms und bis 700 ms vor Ende; Cube/Robot ab 300 ms, Landung 150 ms vor Ende); die
dichten Gravity-Portale ließen den Spider quer fallen (im Fall kann er nicht klicken); jeder
Abschnitt bekam eine neue Farbpalette.

Änderungen:

- Abstände etwa gedrittelt: Flugteile bauen ab 150 ms nach dem Portal bis 150 ms vor dem nächsten,
  Klicks ab 120 ms; Cube/Robot ab 150 ms, und der letzte Sprung darf über das nächste Portal gehen
  (er landet im neuen Abschnitt, die Hindernisse bleiben im eigenen); Wave und Ship entsprechend.
- Der Spider bekommt keine dichten Portale mehr (sein Klick dreht die Schwerkraft schon); seine
  blauen Pads bleiben.
- Neue Farben nur, wo die Musik wechselt (Drop, Kiai, Tempo, Breakdown), nicht bei jedem
  Phrasenwechsel.
- Geschwindigkeit: ruhig ist auch, was im untersten Viertel der Energie-Spanne des Songs liegt
  (wie intensiv im obersten Drittel); ab Hard geht ein sehr ruhiger Teil oder eine Pause auf 1×,
  und ein Song unter 100 BPM eine Stufe langsamer. Extreme auf den Testsongs: 90 BPM 2×; gemischt
  2× / Break 1× / Kiai 4×; mit Build-up 2× / Build-up 3× / Drop 4×.

| Extreme | vorher (Kopf / Ende / Klicks pro s) | jetzt               |
| ------- | ----------------------------------- | ------------------- |
| Cube    | 453 / 888 ms / 1,89                 | 345 / 600 ms / 2,06 |
| Robot   | 469 / 893 ms / 2,16                 | 400 / 703 ms / 2,32 |
| Ball    | 469 / 937 ms / 1,73                 | 469 / 690 ms / 1,83 |
| Spider  | 600 / 1341 ms / 0,89                | 800 / 469 ms / 1,13 |
| UFO     | 469 / 800 ms / 1,78                 | 800 / 468 ms / 1,72 |

Tests: Übergänge (Median ≤ 600 ms nach dem Portal, ≤ 750 ms davor), Farben im Kiai; der
Pad/Portal-Test zählt über vier Seeds (welche Modi ein Kiai bekommt, ist Zufall); ein Song unter
100 BPM muss auf Extreme nur 2 statt 4 Blöcke/s schneller sein als auf Easy; der Build-up muss
langsamer sein als der Drop (nicht mehr: nicht schneller als das ruhige Intro).
`GENERATOR_VERSION` ist `gd-3.5-blocks`.

Grenzen: Der Spider bleibt der Modus mit den wenigsten Klicks.

## 18. 0.6.86: Bausteine für die Flugteile

Bisher hatten nur Cube/Robot (44) und Ship (12) eine Bibliothek fester Bausteine; UFO, Ball,
Spider und Swing waren ein Tunnel um den Flugweg (pro Abschnitt höchstens „Säulen“ oder „offen“).
Jetzt wählt `flight.ts` für jede Zwei-Takt-Phrase einen Baustein, wie die Cube-Bausteine: nach
Gewicht, Schwierigkeit, Intensität und Frische (nicht dasselbe wie gerade eben), und wo der
Rhythmus sich wiederholt, denselben wieder (Motiv).

| Baustein | Modi                     | Ab     | Was es ist                                                                                                               |
| -------- | ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| Tunnel   | alle                     | Easy   | der bisherige Tunnel um den Weg                                                                                          |
| Offen    | UFO                      | Easy   | nur Boden, Decke und ihre Spikes                                                                                         |
| Rohre    | UFO, Swing               | Normal | auf jedem Beat ein Tor, die Lücke um den Weg, dazwischen offen                                                           |
| Slalom   | UFO, Swing, Ball, Spider | Normal | auf den Beats Säulen von der Seite mit mehr Platz (Ball/Spider: von der Seite, auf der sie nicht sind), dazwischen offen |
| Zähne    | UFO, Ball, Spider        | Hard   | Spikes auf Boden und Decke überall, wo kein Weg (pünktlich, früh, spät) sie berührt: man landet in den Lücken            |
| Enge     | UFO                      | Hard   | der Tunnel halb so weit vom Weg                                                                                          |
| Sägen    | UFO, Swing               | Hard   | Sägen auf jedem gehörten Akzent und Beat, halb in der Wand                                                               |
| Orbs     | UFO                      | Hard   | ein Orb auf jedem Klick (rot auf harten Akzenten, pink/schwarz wo es hoch ist), jedes nötig                              |

Die Bausteine formen nur die Blöcke um den schon geprüften Weg (er ändert sich nicht); danach wird
wie bisher jede Variante gespielt (pünktlich, früh, spät, jeder Klick einzeln), und was im Weg
ist, geht. Nach den Treppen von Ball und Spider werden die Bausteine neu aufgelegt.

40 Level (vier Songs, Easy bis Extreme, andere Seeds): alle durchspielbar. Der Test der Ship- und
Spider-Orbs zählt jetzt über beide Seeds der Testsongs. `GENERATOR_VERSION` ist `gd-3.6-blocks`.

Grenzen: Die Wave hat noch keine eigenen Bausteine (ihr Korridor wechselt schon zwischen weit,
eng, einseitig flach).

Die neuen Grafiken aus 0.6.86 (das Sprite-Sheet mit transparentem Hintergrund) sind in 0.6.87
wieder entfernt: Sprites, Ausschneide-Skript und Renderer sind auf dem Stand von 0.6.85.

## 19. 0.6.88: Leere Stellen: gemessen an Songs wie echte Maps

Rückmeldung: Levels sind teils so gebaut, dass nichts oder sehr wenig da ist und man gefühlt nichts
drücken muss. Die bisherigen Testsongs waren zu gleichmäßig (jeder Takt gleich, immer mit Audio).
`tests/dash/emptiness.ts` baut Songs wie echte Maps (Synkopen, Triolen, leere Takte, lange
Slider, leises Intro, Build-up, Drop, Break; mit und ohne lesbares Audio) und misst, welche
Klicks wirklich nötig sind (ohne sie: tot), die längste Strecke ohne nötigen Klick und wie oft
ein Wechsel zur falschen Zeit bei Spider und Ball folgenlos bleibt.

Gefunden und behoben:

- **Komplett leere Mini-Cube-Teile** (11 s und 15 s ohne Klick und Hindernis): Der Abstand der
  Spikes zu Absprung und Landung war für den großen Cube bemessen; beim Mini-Cube passte damit
  kein Spike unter einen Sprung. Der Abstand richtet sich jetzt nach der Hitbox, und Mini-Cube und
  Mini-Robot gibt es erst ab Hard (mit Normals Spielraum für einen Klick passt unter einen
  Mini-Sprung trotzdem kaum etwas).
- **Robot, der 9 s ununterbrochen springt**: Der Ship-Builder drückte im letzten Schritt seines
  Teils, genau an der Grenze; die Taste blieb in den nächsten Teil hinein gedrückt. Ein Druck eines
  Builders am oder nach dem Ende seines Teils wird verworfen; ein Flugteil beginnt losgelassen.
- **Ball fast leer** (z. B. 11 Klicks, 2 nötig, 1 Hindernis): (a) Die Klicks kamen schneller als
  der Ball von Boden zu Decke braucht; jetzt mindestens seine gemessene Flugzeit plus die
  Toleranz plus 40 ms auseinander, und Klicks in der Luft entfallen (ab Insane die Hälfte als
  Orb-Klick). (b) Die blauen Pads saßen nach den Treppen nicht mehr auf der Fläche; das brach die
  Regeln, und die Reparatur entfernte alle Spikes des Teils. Pads gehen jetzt mit der Fläche
  mit, und die Reparatur nimmt erst regelwidrige Pads, dann einzelne Spikes. (c) Keine dichten
  Gravity-Portale mehr für den Ball (sein Klick dreht schon).
- **Jeder Klick nötig, auch bei UFO, Ball und Spider**: Wo ein Klick ausgelassen werden kann, setzt
  der Builder einen Spike dort, wo der Weg ohne ihn entlangfährt und kein gespielter Weg (pünktlich,
  früh, spät, alle Varianten) hinkommt, geprüft mit allen Varianten; eine Spalte darf jetzt oben
  und unten einen Spike haben. Die Wege werden dafür mit der aktuellen Geometrie neu gespielt.
- **Spider-Teil ganz ohne Blöcke**: Treppen, an deren Stufen eine Variante immer wieder lief,
  ließen die Reparatur den Teil Stück für Stück leeren. Scheitert es nach den Treppen 10-mal, wird
  der Teil wieder flach gebaut.
- **Spider und Ball: beide Seiten gefährlich**: Spikes auf Boden und Decke überall, wo kein
  gespielter Weg entlangfährt (die Lücken sind die Landestellen). Ein Wechsel zur falschen Zeit und
  danach nichts drücken überlebte vorher in 28 % der Fälle, jetzt in 16 %.
- **Unregelmäßige Strophen**: Das Zwei-Takt-Muster der Klicks fand dort kaum Stellen, die in jedem
  Takt stark sind. Danach füllt `rhythm.ts` jede Lücke, die länger ist als 6 (Easy), 3 (Normal),
  2,5 (Hard) oder 2 Beats (Insane, Extreme), mit der stärksten gehörten Note nahe ihrer Mitte.

Gemessen (vier Songs × Normal/Hard/Extreme × zwei Seeds × mit/ohne Audio = 48 Level):

|                                    | vorher                    | jetzt       |
| ---------------------------------- | ------------------------- | ----------- |
| längste Strecke ohne nötigen Klick | bis 32 Beats (11 s)       | ≤ 9,8 Beats |
| Level mit Lücke > 8 Beats          | 8 (nach ersten Fixes)     | 3           |
| unnötige Klicks                    | 2,2 % (bis 16 % je Level) | 0,8 %       |

40 weitere Level (Easy bis Extreme): alle durchspielbar. Der Test zum Klick-Spielraum verlangt
Extreme < 77 % von Hard (statt 75 %: Extreme liegt an der Grenze eines Sprungs über einen Spike).
`GENERATOR_VERSION` ist `gd-3.7-blocks`.

## 20. 0.6.89: Das Level in den Farben des Beatmap-Hintergrunds

Die Farben eines Levels kamen aus acht festen Paletten. Jetzt lädt die Dash-Ansicht den
Hintergrund der Beatmap (die Kopie im Songs-Ordner, sonst online in voller Größe, sonst das
Banner; `backgroundUrls`) und gibt ihn dem Renderer (`setTheme`):

- `theme.ts` zieht aus dem Bild (klein gerechnet) die prägenden Farbtöne: nach Fläche und
  Sättigung (Grau, Schwarz und Weiß zählen kaum), bis zu vier, mindestens 45° auseinander. Daraus
  werden die acht Paletten des Levels (dunkler Himmel im Farbton, Boden darin, helles Akzentlicht);
  die Abschnitte wechseln wie bisher an musikalischen Wechseln, jetzt innerhalb der Farbwelt des
  Bildes.
- Das Bild selbst liegt weich und abgedunkelt hinter dem Level, wird auf dem Beat ein wenig größer
  und wandert langsam mit; darüber ein Schleier in den Farben des Abschnitts, damit Blöcke und
  Spikes lesbar bleiben.
- Ohne Bild, ein Bild ohne Farbe oder eines, dessen Pixel nicht gelesen werden dürfen: die
  bisherigen Paletten.

Tests: `tests/dash/theme.test.ts`.

## 21. 0.6.90: Spider und Ball durchgehend klicken, mehr Moduswechsel passend zum Song

Rückmeldung: wenig Variation; bei Spider und Ball gibt es Strecken, auf denen man nichts tun muss
(die sollen ganz raus, man will viel drücken); Moduswechsel öfter, wo es zum Song passt, gerade
auf Extreme schwer und passend zur Musik.

Gemessen mit den Songs aus `tests/dash/emptiness.ts` (Hard/Insane/Extreme, zwei Seeds, mit
Audio): Spider und Ball hatten nur 0,8–1,1 nötige Klicks pro Sekunde (Cube 1,6) und verbrachten
rund 40 % ihrer Zeit in Lücken von mehr als zwei Beats ohne nötigen Klick. Ursachen:

- **Ball:** Klicks mindestens eine Boden-zu-Decke-Flugzeit (+ Toleranz + 40 ms) auseinander.
  Bei einem 8 Blöcke hohen Raum sind das ~480 ms, bei 174 BPM also nur jeder zweite Beat. Die
  Funktion, die die Flugzeit maß, fiel zudem auf ihren Ersatzwert 450 ms zurück.
- **Spider:** Gravity-Portale ließen ihn quer fallen (in der Luft zählt kein Klick), Orb-Sprünge
  ließen bis zu drei Klicks ausfallen, blaue Pads ersetzten Klicks, und wurde ein Pad später als
  unnötig entfernt, fehlte der Klick ganz.
- **Fehler in `uselessPortals`:** Die Schwerkraft wurde zwei Physikschritte vor dem Portal
  geprüft. Lag dazwischen noch ein Klick (die letzte Drehung eines Swing direkt an der Grenze),
  galt das Eingangsportal des nächsten Teils als wirkungslos und wurde entfernt. Der Ball-Teil
  danach lief dann gespiegelt, und keiner seiner Klicks war mehr nötig (6 Beats ohne Aufgabe).
  Jetzt zählt, ob das Portal beim Durchfliegen etwas dreht (mit und ohne Portal verglichen).

Änderungen:

- **Ball-Höhe nach Tempo** (`partCeiling`, ab Hard): so hoch, wie es ein Umschalten auf jedem
  Beat erlaubt (Flugzeit + Toleranz + 20 ms ≤ Beat), 5 bis 8 Blöcke, manchmal einen niedriger.
  Die Flugzeit wird jetzt in einem eigenen kleinen Teil gemessen (`ballCross`, zwischengespeichert).
- **Spider-Höhe** ab Hard zufällig 7–9 Blöcke (eigener Zufallsstrom je Teil, damit der Rest des
  Levels gleich bleibt).
- **Spider auch auf halben Beats:** mindestens 0,3 / 0,26 / 0,2 / 0,17 / 0,15 s zwischen Klicks
  (Easy bis Extreme, vorher immer 0,26 s).
- **Keine Lücken:** `drumClicks` füllt bei Ball und Spider jede Lücke über 2 / 1,5 / 1,25 / 1
  Beats (Normal bis Extreme; sonst 3 / 2,5 / 2 / 2).
- **Keine Gravity-Portale** im Spider und ab Hard im Ball (ihre Klicks drehen die Schwerkraft
  schon), **keine blauen Pads** mehr statt eines Klicks, **Orb-Sprünge des Spiders** nur, wo die
  Musik währenddessen höchstens einen Klick hat.
- **Treppen** passen zwischen die schnellen Klicks: kleinerer Abstand zu Absprung und Landung
  (Spider 0,4, Ball 0,8 Blöcke plus Toleranzweg), Mindestabstand Boden–Decke 3 Blöcke.
- **Moduswechsel passend zum Song** (`planParts`): An jeder Zwei-Takt-Grenze (vier Takte, wo zwei
  unter 2,6 s sind) misst `songTurn`, wie sehr sich der Song dreht: anderer Rhythmus (andere
  Sechzehntel), dichter oder lichter, lauter oder leiser als die zwei Takte davor. Dreht er sich
  genug und wird dort angeschlagen, kommt ein neuer Modus: auf Extreme überall (Schwelle 0,45, in
  ruhigen Teilen 0,5), auf Insane in normalen und intensiven Teilen (0,55), auf Hard nur in
  intensiven (0,65). Spätestens nach einer Phrase wechselt er ohnehin: Extreme intensiv ~4,5 s,
  normal ~7,5 s; Insane 6 / 10 s; Hard intensiv ~9 s (neu; vorher nur Insane und Extreme intensiv).
- **Ab Insane nie zweimal derselbe Modus** hintereinander (außer zum Ausruhen); ein Größenwechsel
  desselben Modus bleibt möglich.
- Die Swing-Fenster werden nach dem letzten Portal-Durchgang noch einmal geprüft.

Gemessen (vier Songs × Hard/Insane/Extreme × zwei Seeds, mit Audio):

|                                        | vorher             | jetzt              |
| -------------------------------------- | ------------------ | ------------------ |
| Ball: nötige Klicks/s (Hard/Ins./Ext.) | 1,13 / 0,96 / 0,84 | 1,88 / 1,73 / 1,72 |
| Ball: Zeit in Lücken > 2 Beats         | 45 / 39 / 39 %     | 5 / 8 / 2 %        |
| Spider: nötige Klicks/s                | 1,46 / 1,06 / 1,06 | 1,82 / 2,13 / 2,23 |
| Spider: Zeit in Lücken > 2 Beats       | 22 / 41 / 40 %     | 15 / 8 / 8 %       |
| längste Lücke Ball / Spider (Extreme)  | 4,2 / 5,0 Beats    | 2,0 / 3,0 Beats    |
| Moduswechsel pro Minute                | 4,6 / 6,7 / 9,0    | 5,7 / 7,0 / 11,2   |

`tests/dash/emptiness.ts` (48 Level, Normal/Hard/Extreme, mit und ohne Audio): alle
durchspielbar, unnötige Klicks weiter 0,8 %, ein Wechsel zur falschen Zeit bei Spider und Ball
bleibt in 13 % statt 16 % der Fälle folgenlos. Die längsten Lücken (bis 9,8 Beats) liegen wie
vorher in Cube- und UFO-Teilen auf Normal.

Die Zeitfenster pro Klick sind je Modus gleich oder enger als vorher (Extreme: Ball 304 → 292 ms,
Spider 192 → 163, UFO 288 → 271). Der Test „harder: less room for each click“ nahm bisher den
Median über alle Cube/Robot-Klicks aller Songs; der hing daran, welcher Song zufällig viele
Cube-Teile bekam (vorher 109 Robot-Klicks im schnellen Song). Er vergleicht jetzt den Median je
Modus, gemittelt über die Modi (besteht auch auf dem alten Stand). Der Gravity-Test im Kiai zählt
die Portale der Flugteile (Ship, UFO, Wave, Swing) pro Sekunde, weil Ball und Spider keine mehr
haben.

Neue Tests: `tests/dash/surfaces.test.ts` (keine Lücke über 4 Beats und unter 12 % der Zeit über
2 Beats bei Ball und Spider ab Hard, so oft geklickt wie der Cube, keine Gravity-Portale darin,
Ball-Höhe nach Tempo, verschiedene Spider-Höhen, keine Klicks in Breaks). Auf dem alten Stand
schlagen die ersten vier fehl. `GENERATOR_VERSION` ist `gd-3.8-blocks`.

## 22. 0.6.91: UFO und Swing durchgehend, Tempo pro Phrase, mehr Variation

Rückmeldung: UFO und Swing haben noch Lücken; die Geschwindigkeit soll sich öfter anpassen, wo
es die Map verlangt; mehr Variation. (Der neue Spider kam gut an.)

Gemessen wie in Abschnitt 21, jetzt auch für den Swing mit „Klick weglassen“ (bisher galt jede
Swing-Drehung als nötig): der Swing machte ~5 Drehungen pro Sekunde, aber nur ~62 % davon waren
nötig, weil er ohne eine Drehung an der (stachellosen) Tunnelwand entlangrutscht. Beim UFO kamen
Lücken von bis zu 9,5 Beats.

Änderungen:

- **UFO:** mindestens 0,3 / 0,26 / 0,22 / 0,2 / 0,18 s zwischen Klicks (vorher immer 0,22) und
  Lücken über 2 / 1,5 / 1,25 / 1 Beats gefüllt wie bei Ball und Spider. Würde ein Tap das UFO an
  die Decke drücken, entfiel der Klick bisher; ab Hard steht dort jetzt ein schwarzer Orb (wirft es
  auf dem Schlag nach unten). Die Blöcke bleiben mindestens 0,5 unter seinem Weg (Platz für einen
  kleinen Spike). Wo ein ausgelassener Tap das UFO nur tiefer (höher) durch freie Luft fliegen
  lässt, wird der Boden (die Decke) dort bis knapp an diesen Weg geholt, mit Spike drauf, sofern
  kein gespielter Weg (pünktlich, früh, spät) dorthin kommt.
- **Swing:** Spikes auf den Tunnelwänden (klein, wo weniger Platz ist), überall wo kein Weg
  hinkommt, auch nicht der „Mensch reagiert 60 ms später“-Weg und die verwackelten Varianten;
  was einen davon trifft, geht wieder. Eine ausgelassene Drehung endet im Spike.
- **Tempo pro Phrase** (ab Hard): Jede Phrase eines Abschnitts bekommt ihre eigene Musik
  (Energie, Slider-Velocity, Tempo, Kiai) und ihr eigenes Tempo; Stellen, an denen sich der Song
  dreht (`songTurn`), zählen als Wechsel. Die Art des Teils wird ebenso nach der Phrase gewählt.
- **Variation:** Raumhöhen ab Hard pro Teil: UFO 8–10, Ship und Swing 9–10 (Spider 7–9, Ball nach
  Tempo); Sägen auf den Akzenten auch in Ball und Spider; der Spider öfter und schon ab Normal.
- **Ball-Höhe:** Flugzeit + Toleranz + 20 ms ≤ 92 % des Beats (vorher 100 %): bei 128 BPM 7 statt
  8 Blöcke. Mit 8 lag der Ball nur ~50 ms auf einer Seite; für einen Spike gegen einen
  ausgelassenen Klick war kein Platz.

Gemessen (vier Songs × Hard/Insane/Extreme × zwei Seeds, mit Audio):

|                                 | vorher             | jetzt              |
| ------------------------------- | ------------------ | ------------------ |
| UFO: nötige Klicks/s            | 1,67 / 1,49 / 1,69 | 2,05 / 1,72 / 2,20 |
| UFO: Zeit in Lücken > 2 Beats   | 27 / 23 / 16 %     | 10 / 17 / 10 %     |
| UFO: längste Lücke              | 7 / 9,5 / 7 Beats  | 5 / 3,2 / 3,5      |
| Swing: nötige Drehungen         | 63 / 62 / 61 %     | 79 / 78 / 80 %     |
| Swing: Zeit in Lücken > 2 Beats | 12 / 17 / 17 %     | 1 / 5 / 5 %        |
| Tempowechsel pro Minute         | 2,1 / 2,1 / 2,5    | 2,1 / 2,1 / 2,9    |

Die Testsongs ändern sich innerhalb ihrer Teile kaum, daher kaum mehr Tempowechsel; auf einem
Song, dessen Mapper die Slider alle vier Takte schneller macht, folgte das Tempo schon vorher
jedem Wechsel (11 in 80 s). Ball und Spider bleiben wie in Abschnitt 21.

Grenze beim UFO: Die geprüften Spielweisen (jeder Tap etwas früh oder spät) streuen beim UFO über
bis zu vier Blöcke Höhe. Wo es gleichmäßig schwebt, bleibt ein ausgelassener Tap in diesem
Bereich, und dort darf kein Hindernis hin; solche Taps bleiben unnötig (Insane 17 % Lückenzeit,
einzelne Strecken bis ~10 Beats, z. B. Hard ohne Audio). `tests/dash/emptiness.ts` (48 Level):
alle durchspielbar, unnötige Klicks 0,9 % (vorher 0,8 %).

Tests: `tests/dash/surfaces.test.ts` prüft jetzt auch UFO (unter 17 % Lückenzeit) und Swing
(unter 7 %, mindestens 72 % der Drehungen nötig; der Teil fällt auf dem alten Stand durch) und
verschiedene UFO-Höhen. `GENERATOR_VERSION` ist `gd-3.9-blocks`.

## 23. 0.6.92: Neue Grafiken: Block-Stile, Spike- und Säge-Skins, Deko, Portale

Drei neue Sprite-Sheets (mit ChatGPT erzeugt, im Stil des ersten):

- `scripts/dash-sprite-sheet-objects.webp`: Tempo-Schilder (0,5× bis 4×), rotes und blaues Pad,
  Dash- und Spider-Orb, Schockwelle, je vier Spike-Skins (Kristall, Dorn, Stahl, Flamme, groß und
  klein), acht Sägen, Deko (Kette, Zahnräder, Lampe, Lautsprecher, Note, Schild, Pilz, Rohr,
  Antenne, Würfel, Funkeln, Wolke, …).
- `scripts/dash-sprite-sheet-tiles.webp`: sechs Block-Stile in Grau (Tech, Ziegel, Eis, Metall,
  Gitter, Ornament), je Block, Oberseite, Unterseite, Ecke, Platte, Säule, Spike, Deko.
- `scripts/dash-sprite-sheet-portals.webp`: alle Portale ohne eingebackene Partikel (Modus,
  Robot, Gravitation hoch/runter, klein/groß) und die Körper von Spider und Robot ohne Beine.

`scripts/dash-sprites.py` schneidet jetzt mehrere Sheets (mit Rasterlinien oder gleichmäßigem
Raster), nimmt den Hintergrund aus dem ganzen Sheet, entfernt Teile, die aus Nachbarzellen
hineinragen, und Pixelreste, behält bei Portalen nur den Ring, verkleinert auf höchstens 168 px
und packt alles eng in einen Atlas (1024 × 2584, 132 Sprites; ungenutzte Felder des ersten Sheets
fallen weg). Ship- und Spider-Portal werden weiter aus dem Wave-Portal umgefärbt.

Im Spiel (`render.ts`):

- **Ein Look pro Teil** (`LOOKS`): der Block-Stil (grau, im Spiel in die Farben des Teils
  eingefärbt; Oberseiten, Unterseiten, Platten und Säulen je nachdem, was frei liegt), die
  passenden Spikes und Sägen und die Deko im Hintergrund; oder das bisherige gezeichnete. Der Look
  hängt an der Farbwelt des Teils (wechselt also, wo die Musik wechselt) und am Level (dasselbe
  Level sieht immer gleich aus). Im Kiai Flammen-Spikes und rote Sägen.
- Spikes anderer Looks behalten ihre Form (so breit wie der Spike, auf der Fläche stehend); die
  Hitboxen sind unverändert.
- **Portale** aus dem neuen Sheet; ihre Partikel zeichnet das Spiel (Quadrate, die sich zum Ring
  drehen und hineinziehen, dazu aufsteigende Funken). Gravitations- und Größenportale,
  Tempo-Schilder (mit Schlieren in Schubrichtung), rotes und blaues Pad, Dash- und Spider-Orb
  haben jetzt Sprites; beim Auslösen eines Orbs oder Pads eine Schockwelle.
- **Spider und Robot:** Körper aus dem Sheet, die Beine weiter im Code animiert (ein
  Frame-Sheet aus einem Bildgenerator bleibt von Bild zu Bild selten gleich).
- **Hintergrund:** Noten, Funkeln, Wolken und Würfel weit hinten am Himmel; auf den fernen Hügeln
  Dinge des Looks (klein und blass, nichts Spitzes, damit nichts wie ein Hindernis aussieht).
  Schwebende Plattformen hängen an Ketten aus dem Sheet.

Geprüft mit Bildern aus einem Level (Extreme, Testsong mit Kiai): Block-Stile, Spikes, Portale
und Partikel; alle Dash-Tests grün, `npm run check` und der Web-Build laufen.

## 24. 0.6.93: Mehr FPS: halbe Auflösung für Fernes, adaptive Auflösung, keine Ruckler beim Teilwechsel

Rückmeldung: Bei manchen gibt es Verzögerung und FPS-Einbrüche.

Gemessen mit einem Level (Extreme, Testsong mit Kiai), Bild für Bild fertig gezeichnet, in
Chromium ohne Grafikkarte (wie WebKitGTK unter Linux oder ein Browser, der die GPU nicht nutzt):
Die Spielschleife und das JavaScript des Renderers kosten unter 3 % der Zeit; es ist das
Zeichnen der Pixel. Bei Pixel-Ratio 2 gingen über die Hälfte davon an den Hintergrund
(Verlauf, Beatmap-Bild, Wand, Licht: mehrmals über den ganzen Bildschirm), weitere ~15 % an Boden,
Hügel und Zahnräder.

Änderungen (`render.ts`):

- **Fernes in halber Auflösung**, wo das Bild mehr Pixel als der Bildschirm Punkte hat
  (Pixel-Ratio ab 1,4): Hintergrund, Wand, Zahnräder, schwebende Quadrate, Hügel, Deko und der
  Körper des Bodens werden in eine eigene Leinwand mit halber Auflösung gezeichnet und einmal
  pro Frame verdoppelt aufs Bild gelegt (ohne Glättung: so scharf wie die Punkte des Bildschirms,
  und in Software viel billiger). Was gespielt wird (Blöcke, Spikes, Kante des Bodens, Orbs,
  Portale, Spieler) bleibt in voller Auflösung.
- **Adaptive Auflösung:** Brauchen mehr als ein Viertel der letzten 60 Frames über 20 ms, wird
  eine Stufe weniger scharf gezeichnet (100 / 85 / 70 / 60 / 50 %); nach 4 s mit allen Frames unter
  14 ms wieder eine Stufe schärfer, aber nicht innerhalb von 20 s nach einem Absenken. Die
  FPS-Anzeige (F) zeigt die Stufe, wenn sie abgesenkt ist.
- **Undurchsichtige Leinwand** (`alpha: false`): Der Browser muss sie nicht mit der Seite
  verrechnen.
- **Keine Ruckler am Teilwechsel:** Blöcke und Spikes nehmen die Farben ihres eigenen Teils, statt
  während des Überblendens für jede Zwischenfarbe neu eingefärbt zu werden. Die eingefärbten
  Kacheln aller Teile des Levels werden vorab erzeugt (drei pro Frame), und der Zwischenspeicher
  verwirft nur die ältesten statt alle.
- **Kein Layout pro Frame:** Die Größe der Leinwand meldet ein `ResizeObserver`, statt sie jedes
  Frame abzufragen.

Gemessen (fertig gezeichnete Frames ohne Grafikkarte, mittlere Zeit pro Frame, Normal / Kiai):

| Auflösung                  | vorher     | jetzt                         |
| -------------------------- | ---------- | ----------------------------- |
| 1920 × 1080, Pixel-Ratio 1 | 12 / 14 ms | 12 / 14 ms                    |
| 1920 × 1080, Pixel-Ratio 2 | 44 / 49 ms | 24 / 28 ms                    |
| 2560 × 1440 Pixel: FPS     | 52 / 40    | 59,5 / 57                     |
| 3840 × 2160 Pixel: FPS     | 25 / 19    | 37 / 27                       |
| 3840 × 2160, adaptiv: FPS  | –          | 52 / 59 (Auflösung 60 / 50 %) |

Mit (emulierter) Grafikkarte liefen alter und neuer Stand bei 60 FPS; dort zählt die
Pixelmenge auf schwachen integrierten Grafikchips, die jetzt ebenfalls kleiner ist. Die Eingabe
war schon sauber gelöst (Zeitstempel der Eingabe, Rollback um bis zu 60 ms); FPS-Einbrüche
fühlten sich als Verzögerung an.

## 25. 0.6.93: Wave wie von Hand gebaut, Spider mit Plattformen, präziserer Ball

Rückmeldung: Die Wave-Teile sind viel komplizierter gebaut als in von Hand gebauten Levels; der
Spider hat immer noch öfter ganz leere Stellen.

**Wave** (`builders/wave.ts`, der Weg neu): Bisher drehte die Wave auf jeder Note (unregelmäßige
Abstände), in einem Band, das über vier Takte auf- und abwanderte; die Reparaturen verbreiterten
den Tunnel stellenweise. Das ergab gezackte Berge statt eines Zickzacks. Jetzt bekommt jede
Phrase (zwei Takte) einen Rhythmus auf dem Beat-Raster: alle 2, 1, ½ oder ¼ Beats, je nachdem wie
dicht die Musik dort ist (notfalls punktiert, ¾ oder 1½), und eine Figur: gleichmäßiger Zickzack,
Steigen (zwei Einheiten hoch, eine runter), Sinken, oder Spam (die schnellsten Drehungen in einem
engen geraden Tunnel); wo der Rhythmus sich wiederholt, dieselbe Figur (Motiv). Ein Zickzack fern
der Raummitte steigt oder sinkt erst zu ihr. Der Tunnel ist in einer Phrase überall gleich breit:
parallel zum Zickzack, oder gerade (oben und unten flach, oder nur auf einer Seite; nur um einen
Zickzack, der an seinem Platz bleibt). Der Spieler-Test folgt jetzt der Linie, die er sieht (je
Ecke ein eigener Versatz bis ½ Block, gedreht wird erst, wenn er merklich daneben ist); vorher
addierten sich seine Fehler von Ecke zu Ecke auf, und der Tunnel wurde unnötig verbreitert. Muss
doch verbreitert werden, dann die ganze Phrase gleichmäßig.

**Spider** (`builders/flight.ts`): Spider-Teile hatten außer Boden und Decke keine Blöcke; die
Stufen (Treppen) waren die einzige Struktur, und die wurden oft ganz zurückgenommen. Gemessen auf
den Testsongs war in 38 % der Spalten kein Block (14 %: weder Block noch Spike in der Nähe).
Gefunden: (a) scheiterte die Prüfung nach den Treppen zehnmal, wurde der ganze Teil flach, auch
wenn es nur an Spikes lag; (b) nach den Treppen wurden die Phrasen-Bausteine (Slalom) noch einmal
aufgelegt und öffneten Boden und Decke wieder, sodass die Spider anders landete; (c) ein Orb-Sprung
zählte als Strecke an der Decke, und die nächste Stufe kam unter sie; (d) die Reparatur entfernte
bei jedem Fehlschlag alle Spikes im Umkreis von drei Blöcken. Jetzt: jede Stufe wird beim Setzen
mit allen Spielweisen geprüft und geht allein wieder, wenn eine scheitert; beim Spider fast auf
jeder Strecke eine Stufe, bis drei Blöcke; die Bausteine nicht noch einmal; nur Strecken, auf denen
er wirklich steht; die Reparatur nimmt beim Ball und Spider nur den Spike, an dem eine Spielweise
starb. Ergebnis: 22 % der Spalten ohne Block, 9 % ohne Block und Spike.

**Ball und Spider präziser:** Ab Hard wird außerdem jeder Klick um mehr als den Spielraum der
Schwierigkeit zu früh und zu spät gespielt; kommt er durch, ein Spike, wo dieser Weg entlangrollt
und kein erlaubter hinkommt (beim Ball landete ein früher Klick sonst einfach etwas früher auf
derselben Fläche). Median-Spielraum je Klick (Hard / Insane / Extreme): Ball 212 / 308 / 296 →
200 / 204 / 196 ms, Spider 238 / 238 / 175 → 238 / 229 / 171 ms.

Tests (`tests/dash/surfaces.test.ts`): Wave-Teile gleichmäßig (über 75 % der Abstände zwischen
Drehungen gleich oder doppelt/halb so lang; vorher 60 %), Spider-Teile aufgebaut (unter 30 %
Spalten ohne Block, unter 12 % ganz leer); beide fallen auf dem alten Stand durch.
`GENERATOR_VERSION` ist `gd-3.10-blocks`.

## 26. 0.6.94: Weniger Zeichenbefehle pro Frame – in 0.6.95 zurückgenommen

0.6.94 hat gleichartige Formen (Wandraster, Bodenquadrate, schwebende Quadrate) zu großen Pfaden
mit vielen Rechtecken bzw. gedrehten Vierecken gesammelt und mit einem `fill`/`stroke` gezeichnet.
Das sind zwar weniger Befehle, aber auf der GPU teurer: Chrome/WebView2 bündelt einzelne
`fillRect`/`strokeRect`/`drawImage` ohnehin selbst und zeichnet sie über einen schnellen Weg,
während ein großer Pfad mit vielen Teilpfaden durch den allgemeinen Pfad-Renderer muss
(Zerlegung in Dreiecke oder Maske). Ergebnis bei einem Spieler: 240 → 129 FPS. Der Renderer ist
wieder auf dem Stand von 0.6.93.

Merke: Im Canvas nicht „Befehle sparen“, indem viele Rechtecke in einen Pfad wandern – einzelne
Rechteck- und Bildbefehle sind der schnelle Fall.

## 27. 0.6.96: Sync am Klang des Songs, sample-genaue Wiedergabe, Bauten über dem Weg, neues Menü

Rückmeldung: Songs sind teilweise nicht richtig zur Map gesynct; die Level fühlen sich teilweise
nicht wie von Hand gebaute an; das Dash-Menü ist schlecht zu bedienen.

### 27.1 Sync: zwei Ursachen, beide gemessen

Gemessen an neun echten Beatmaps mit ihrem Audio (von einem öffentlichen Mirror, nur zum Messen,
nicht im Repo), dekodiert wie im Browser:

- **Die Noten der Map liegen neben dem Klang, je Song anders.** Die Energie des Songs steigt nicht
  zur Notenzeit, sondern 11 bis 54 ms danach (einmal 9 ms davor): FREEDOM DiVE +25, No title +27,
  Blue Zenith +27, My Love +30, The Big Black +11, Harumachi Clover +16, Sound Chimera +38,
  ch3rry +54, ch3rry 1.1x −9 ms. Eine Map ist für osu!s eigene Audio-Ausgabe getimt; derselbe
  File kommt aus einem anderen Decoder früher oder später heraus. Das Level lief also je Song
  10–55 ms vor der Musik.
- **Der Browser springt im Song ungenau.** Gemessen in Chromium (der Song über ein
  `<audio>`-Element, der abgespielte Ton aufgenommen und gegen den dekodierten Song gelegt): Nach
  jedem Setzen von `currentTime` liegt der Ton bei MP3 mit fester Bitrate 20–50 ms daneben (ein
  MP3-Frame), bei variabler Bitrate mehrere hundert ms (gemessen −444 ms). Ab Songanfang ohne
  Sprung stimmt es. Betroffen war jeder Neustart ab einem Checkpoint und jedes Level, das nicht
  bei 0 beginnt (Intro länger als 2,6 s).

Änderungen:

- **Versatz je Song** (`timing.ts: songOffset`, `audio.ts`): Die Audioanalyse liefert zusätzlich
  den Energieanstieg in ~1-ms-Schritten. Gesucht wird die Verschiebung (−90 bis +90 ms), bei der
  die Noten der Map am besten auf diesen Anstiegen liegen; ist das klar (Spitze ≥ 1,35 × Mittel,
  mindestens 24 Noten), wird die ganze Map (Noten, Timing-Punkte, Kiai, Breaks) um diesen Wert
  verschoben, bevor das Level gebaut wird. Der Detektor selbst liest einen exakt gesetzten Schlag
  2 ms spät (mit erzeugtem Audio gemessen); das ist abgezogen. Ohne lesbares Audio bleibt die Map.
- **Sample-genaue Wiedergabe** (`player.ts`, `DashView.svelte`): Während ein Level läuft, spielt
  Dash den dekodierten Song selbst über Web Audio (`AudioBufferSourceNode`, durch Equalizer und
  Lautstärke der App). Start, Neustart und Checkpoint beginnen damit auf das Sample genau, und die
  Songzeit ist die Uhr des Audio-Kontexts minus Ausgabeverzögerung. Das `<audio>`-Element läuft
  stumm mit, damit der Rest der App (Warteschlange, Songende, Hitsounds) weiterläuft; die
  Hitsounds folgen der genauen Zeit. Zurück im Menü übernimmt das Element wieder. Bei Half Time
  und Double Time (Tempo geändert, Tonhöhe gehalten) und bei Songs, deren Audio nicht gelesen
  werden kann, bleibt es beim Element wie bisher.
- Das Menü zeigt unten, ob das Level am Klang ausgerichtet ist und um wie viel.

### 27.2 Level

- **Bauten über dem Weg** (`builders/canopy.ts`): Cube- und Robot-Teile bestanden aus Boden,
  Blöcken und Spikes unter freiem Himmel. Jetzt bekommt jede Zwei-Takt-Phrase eine von vier
  Formen über dem Weg: nichts, eine durchgehende Decke, eine Decke mit hängenden Spikes oder
  einzelne schwebende Blöcke. Gebaut wird nur, wo kein gespielter Weg hinkommt: mindestens einen
  Block (Robot: zwei) über dem höchsten Punkt des geplanten Wegs in den zwei Spalten davor und
  danach, nicht über Kopfüber-Strecken, Portalen und Orbs. Danach wird pünktlich und mit allen
  Klicks um ±75 % der Toleranz gespielt; scheitert das, geht der Aufbau des Teils wieder.
- **Breaks der Map sind keine Pausen mehr, wenn der Song weiterspielt.** Ein Break heißt nur,
  dass der Mapper dort nichts gesetzt hat. Bisher blieb so ein Teil leer (gemessen: 15 s Cube
  ohne Klick und Hindernis in „My Love“, bei laufender Musik). Jetzt gilt ein Break nur als
  Pause, wenn der Song dort leise ist (Lautstärke unter 0,3 des Songs); ohne Audio wie bisher.
- `GENERATOR_VERSION` ist `gd-3.11-blocks`.

### 27.3 Menü

`DashMenu.svelte` ersetzt die zwei schwebenden Karten: links die Songliste über die ganze Höhe
(mit Bestwert-Balken je Song), rechts das Level mit Cover, Schwierigkeit (fünf große Felder mit
Farbe und Beschreibung), einem Streifen der Teile entlang des Songs (Farbe je Modus, Drops
kräftiger), Länge, Klicks, Teile, Höchsttempo, Bestwert-Balken für Normal und Practice, darunter
Icon-Wahl, Normal/Practice-Umschalter, „Watch“ und der Play-Knopf in der Farbe der
Schwierigkeit. „Parts“, „Sound“ und „Leave“ stehen beschriftet oben rechts. Das Pausenmenü hat
beschriftete Knöpfe mit ihren Tasten und einen Fortschrittsbalken mit Bestwert-Marke. Die
FPS-Anzeige erscheint nur noch im Level.

### 27.4 Geprüft und Grenzen

- Tests: `tests/dash/timing.test.ts` (Versatz −30, 0, +45 ms wird auf ±4 ms gefunden und
  angewendet), `tests/dash/canopy.test.ts` (Bauten vorhanden, nichts davon am Weg, Level
  durchspielbar; Break mit und ohne Musik).
- Im Browser mit einem Test-Harness geprüft (echter Renderer, echte Songs, App-Stores
  nachgebildet): Menü, Pausenmenü, Start/Neustart/Fortsetzen über den dekodierten Song.
- **Nicht in der echten App gespielt** (Tauri und osu!-Login fehlen hier), und ob der Sync
  stimmt, habe ich gemessen, nicht gehört.
- Gemessen ist in Chromium (WebView2 unter Windows). Auf macOS und Linux (WebKit) dekodiert das
  System; dort gleicht der gemessene Versatz dasselbe aus, das Springen des `<audio>`-Elements
  habe ich dort nicht gemessen.
- Der dekodierte Song bleibt im Speicher, solange Dash sein Level zeigt (etwa 20 MB pro Minute).
- Gestreamte Songs ohne lesbares Audio: weder Versatz noch genaue Wiedergabe.

## 28. 0.6.97: Ball, Spider, UFO und Swing neu gebaut, aus ihren Klicks auf der Musik

Rückmeldung: Die anderen Modi (Ball, Spider usw.) fühlen sich nicht gut an, und öfter passt es
gar nicht zum Song.

### 28.1 Gemessen

Je Modus an echten Maps mit Audio (`No title`, `My Love`, `Blue Zenith`; Normal und Hard): wo im
Beat die Klicks liegen (auf dem Schlag, auf der Hälfte, auf dem Viertel, neben dem Raster) und ob
dort eine Note der Map ist.

- Cube, Robot, Ball, Spider und UFO klickten schon fast nur auf Schlag und Hälfte.
- **Der Swing nicht:** 14–32 % seiner Drehungen lagen neben dem Raster, je nach Song nur 16–79 %
  auf einer Note. Seine Drehungen kamen von einem Steuer-Modell („dreh, wenn du zu weit von der
  Mitte bist“), nicht aus dem Song. Das sind rund fünf Eingaben pro Sekunde ohne Bezug zur Musik.
- Bilder der Teile: Ball und Spider liefen durch einen flachen Schlauch mit verstreuten Spikes
  auf beiden Seiten; welcher Spike zu welchem Klick gehört, war nicht zu sehen. UFO und Swing
  schwebten in der Mitte eines 6–8 Blöcke hohen Tunnels, der Swing fast als gerade Linie.
- Das Ship drückt zu 40–60 % neben dem Raster. Das ist Steuern durch Halten und bleibt so.

### 28.2 Was geändert wurde (`builders/rooms.ts`, neu)

**Ball und Spider: von Plattform zu Plattform.** Aus den Klicks (wie bisher auf dem Schlagzeug,
`rhythm.ts`) wird der Weg gespielt. Jeder Klick verlässt eine Plattform, die kurz danach endet,
und kommt auf einer an, die kurz davor begonnen hat, abwechselnd Boden- und Deckenseite:

- Wie lang „kurz“ ist, ist das Zeitfenster der Schwierigkeit (mindestens das 1,2-Fache der
  Toleranz je Seite); Klicks, zwischen denen dafür kein Platz wäre, entfallen.
- Direkt hinter jeder Plattform stehen Spikes auf einer Stufe in ihrer Höhe (bis drei Blöcke),
  danach Spikes auf dem blanken Boden bzw. der Decke bis zur nächsten Plattform dieser Seite.
  Eine bloße Grube reichte nicht: gemessen fiel der Spider bei 3× über eine ein Block breite
  Grube einfach auf die nächste Plattform (fünf Klicks in Folge unnötig).
- Die Plattformen sind ein bis drei Blöcke dick, wie Treppen von einer zur nächsten.
- Was sauber ist, ist der Weg; was Spikes hat, nicht. Der Grund für den Klick ist zu sehen: die
  Plattform hört auf.

**UFO und Swing: ein Weg nur aus Klicks auf dem Raster.** Gesucht wird (Strahlsuche über die
Viertel des Beat-Rasters, 20 Wege gleichzeitig) die Folge von Klicks, die im Raum bleibt und am
meisten auf den starken Stellen des Songs liegt: zuerst die Klicks des Schlagzeugmusters, dann
gehörte Schläge und Hälften, Viertel nur ab Hard und nur mit Note, unbetonte Hälften nur, wenn der
Weg sie braucht. Der Weg bleibt in einem Band, dessen Höhe von Phrase zu Phrase steigt und fällt
(findet sich darin keiner, breiter, zuletzt der ganze Raum). Um den Weg (pünktlich, alle Klicks
früh, alle spät, jeder einzeln um die Toleranz verschoben) wird der Tunnel in Stücken von zwei
bis drei Blöcken gelegt, mit Spikes, wo Platz ist.

- Auf Easy und Normal hüpft das UFO am Boden entlang (seine Klicks liegen zu weit auseinander,
  um oben zu bleiben) und über die Spikes.
- Gravity-Portale auf den Taktanfängen: jedes dreht den besten Weg bis dahin; eines, an dem der
  fertige Weg schon richtig herum ankommt, entfällt.

Beide Builder prüfen den Teil wie die übrigen (pünktlich, früh, spät, jeder Klick einzeln). Geht
ein Teil so nicht auf, baut ihn der bisherige Builder (`flight.ts`); auf fünf Leveln aus echten
Songs waren das 2 Ball-Teile. Mit „Classic“ im Parts-Menü bleibt alles beim alten Builder.

### 28.3 Gemessen danach

|                                        | vorher   | jetzt         |
| -------------------------------------- | -------- | ------------- |
| Swing: Drehungen neben dem Beat-Raster | 14–32 %  | 0 %           |
| UFO: Klicks neben dem Raster           | 0 %      | 0 %           |
| Ball/Spider: Klicks nötig (Testsong)   | siehe 21 | ≥ 90 % (Test) |

Neun Level aus drei echten Songs (Easy bis Extreme): alle durchspielbar, jedes Klickfenster über
der Toleranz (engstes 54 ms bei 24 ms Toleranz). `npm run test:dash`: 191 Tests grün, neu
`tests/dash/rooms.test.ts`. `GENERATOR_VERSION` ist `gd-3.12-blocks`.

### 28.4 Grenzen und geänderte Tests

- **Nicht gespielt, nur gebaut, gemessen und im Renderer angesehen.** Ob sich die Modi jetzt gut
  anfühlen, kann nur Spielen zeigen.
- Der Tunnel von UFO und Swing ist weiter 5–6 Blöcke hoch: Ein einzelner um die Toleranz
  verschobener Klick muss überleben, und beim Swing ändert der den Weg danach um etwa einen Block.
- Spider-Teile haben keine Orbs mehr, Ball und Spider keine Sägen und Pads; Ship und Wave sind
  unverändert.
- Zwei bestehende Tests angepasst: „Orbs in Ship und Spider“ verlangt nur noch Ship-Orbs (und nur
  einen: welche Teile ein Level bekommt, hat sich mit dem Zufallsstrom verschoben); der
  Gravity-Test im Kiai verlangt ein Portal je 3,2 s statt 2,76 s Flugzeit (gemessen 28 in 79 s).

## 29. Neue Levelplanung aus handgebauten Leveln: Set-Pieces, Tempo, Flugteile

Auftrag: die Dash-Generierung grundlegend überarbeiten, abgeleitet aus vier hochgeladenen,
von Hand gebauten Leveln (`.gmd`/`.gdlvl`; nicht im Repo).

### 29.1 Analyse der Level

Gelesen wurden die Leveldaten (Base64 + gzip, Objekte mit ID, Position, Drehung, Skalierung).
Welche Objekt-ID was ist (Block, Spike, Säge, Schräge, Deko), stammt aus der Objekttabelle des
Python-Pakets `gmdkit` (Hitboxen von ~4100 Objekten); Portale, Orbs, Pads und Tempo-Portale aus
`gd.py`. Die Zeit entlang des Levels ergibt sich aus den Tempo-Portalen (8,4 / 10,4 / 12,9 /
15,6 / 19,2 Blöcke/s). Grenzen: Bewegungs-Trigger und Teleport-Portale sind nicht nachgespielt;
das Level „niwa“ besteht fast nur aus solchen Effekten und zählt bei Korridoren und Strukturen
nicht mit.

| Level              | Länge | Moduswechsel/min | Abschnitt (Median) | Tempowechsel/min | Mini |
| ------------------ | ----- | ---------------- | ------------------ | ---------------- | ---- |
| „Robtop Level Mix“ | 175 s | 5,5              | 10,7 s             | 2,7              | 15 % |
| „Future Funk“      | 260 s | 12,2             | 4,0 s              | 7,6              | 45 % |
| „CraZy III“        | 150 s | 18,4             | 1,6 s              | 14,0             | 36 % |
| „niwa“             | 60 s  | 81,5             | 0,55 s             | 12,9             | 29 % |

Was daraus folgt (über alle vier):

- **Abschnittslängen sind gemischt, nicht gleich:** je Modus p10/Median/p90 Cube 0,5 / 1,6 /
  12,9 s, Ship 0,7 / 2,0 / 9,0 s, Wave 0,3 / 0,7 / 4,0 s, Spider 0,3 / 0,6 / 3,0 s. Lange
  Strecken wechseln mit kurzen Einschüben (eine Wave von einem Takt, dann zurück) und Ketten
  kurzer Teile. Wave und Spider sind fast immer kurz.
- **Das Tempo wechselt oft und nicht nur am Modusportal:** 3–14 Tempowechsel pro Minute; nur
  ~30 % fallen mit einem Moduswechsel zusammen. Die Level liegen meist bei 0,5x–2x
  („Future Funk“: 17 % 0,5x, 43 % 1x, 28 % 2x, 12 % 3x), schneller nur in Spitzen.
- **Größe:** 30–45 % der Zeit klein, oft als Wechsel klein/groß desselben Modus.
- **Gravity:** in Ship und UFO etwa alle 3,3 s ein Portal, in der Wave alle 7 s.
- **Orbs und Pads** in den Flugteilen: Ball 1,0 Orbs/s, Spider 1,3 Orbs und 2,4 Pads/s, UFO
  und Ship 0,35 Orbs/s; im Cube 0,8 Orbs und 0,6 Pads/s.
- **Korridore** (Höhe des freien Raums um den Weg, Median): Ship 4,4 (klein 3,1), UFO 4,1,
  Wave 3,0, Ball 4,5, Spider 5,7 Blöcke. Wände sind meist mit Spikes ausgekleidet (Ship: 46 %
  der Spalten oben und unten, 27 % auf einer Seite). Dazu Hindernisse frei im Raum, um die der Weg
  herumführt, und Wave-Korridore aus Schrägen.

Gemessen am Generator vor dieser Version (vier Testsongs, Extreme): Moduswechsel 11/min, fast
alle Abschnitte gleich lang (p10/Median/p90 2,8 / 3,75 / 7,9 s), 1,4 Tempowechsel/min, 39 % der
Zeit 4x; Ball, UFO, Spider und Swing ohne Orbs; Ship- und UFO-Räume weit und leer.

### 29.2 Was geändert wurde

**Levelplanung neu (`plan.ts`, für den Standard-Generator; „Classic“ bleibt beim alten).**

- Der Song wird in Phrasen von zwei Takten geschnitten (vier bei sehr schnellen, einer bei sehr
  langsamen Songs). Jede Phrase hat ihre eigene Musik (Dichte, Lautstärke, Kick, Kiai,
  Slider-Velocity, Tempo) und ihr eigenes Tempo in vier Stufen: ruhig, normal, intensiv,
  Spitze. Die Stufe wechselt wie bisher nur, wo sich die Musik ändert (`paces`), jetzt aber
  Phrase für Phrase. Spitze ist ein intensiver Abschnitt, der lauter und dichter ist als die
  Hälfte der intensiven, oder die ersten zwei Phrasen eines Drops.
- **Geschwindigkeit je Stufe** (ruhig / normal / intensiv / Spitze): Easy 1x; Normal 0,5x / 1x /
  2x / 2x; Hard 1x / 2x / 3x / 3x; Insane 1x / 2x / 3x / 4x; Extreme 2x / 3x / 3x / 4x. Songs
  unter 100 BPM ohne 4x. Ein Tempowechsel kann jetzt auch ohne neuen Modus kommen (ein
  Tempo-Portal allein), wie in den Leveln.
- **Set-Pieces:** Zwischen zwei musikalischen Wechseln liegt ein Segment; jedes Segment wird in
  Blöcke von höchstens 11–32 s geteilt (je nach Schwierigkeit), und jeder Block bekommt eine
  Form, gewichtet nach Schwierigkeit und Tempostufe:
  - _Strecke:_ ein Modus über eine Weile (Easy 14–30 s, Extreme 3–7,5 s; ruhig länger, an der
    Spitze kürzer), dann ein anderer. Eine Wave nie länger als 5–7 s.
  - _Duett:_ zwei Modi, die sich Phrase für Phrase abwechseln, aus Paaren, die zusammen
    vorkommen (Cube–Ship, Ball–UFO, Wave–Ship, Robot–Spider …).
  - _Größenspiel:_ ein Modus, Phrase für Phrase klein und groß; auf Extreme an der Spitze Takt
    für Takt.
  - _Kette:_ jede Phrase in kurze Teile (Extreme ab ~1,1 s, Insane ab 1,5 s, Hard ab 2,2 s),
    jeder ein neuer Modus; schnelle Modi (Wave, UFO, Ball, Spider) bevorzugt.
  - _Burst:_ ein Grundmodus (Cube, Robot, Ship, UFO oder Ball), und auf den Phrasen mit einem
    Fill am Ende oder einer Wendung danach die letzten Beats als kurzer Einschub eines anderen
    Modus (gern Wave, wo die Musik streamt), danach zurück.
  - Pausen bleiben großer Cube; der erste Block ist eine Strecke (Aufwärmen); das Level beginnt
    und endet auf dem Cube.
- Die Moduswahl folgt der Musik wie bisher (gehaltene Noten fliegen, Streams werden Wave) und
  meidet Wiederholung; Ship und Swing nicht in Teilen unter 1,5 s. Kein Modus läuft länger als
  1,25 × die längste Strecke der Schwierigkeit; danach wechselt er an einer Phrasengrenze.

**Flugteile ausgekleidet und bestückt (`builders/dress.ts`, neu).** Nach dem Bau von Ship, UFO,
Swing, Ball und Spider (ab Normal):

- Der Teil wird gespielt wie bisher geprüft (pünktlich, alle früh, alle spät, sechsmal jeder
  etwas daneben, und jeder Klick allein um die ganze Toleranz früh und spät); um jeden dieser Wege
  bleibt ein Abstand frei (Ship 0,9, sonst 0,5–0,55 Blöcke über die Hitbox hinaus).
- **Wände:** auf jeder Fläche, die in den Raum zeigt (Boden, Decke, Blöcke), ein Spike, sonst ein
  kleiner, wo kein Weg hinkommt (Normal 40 % der Spalten, Extreme 90 %, intensiver mehr).
- **Im Raum:** auf den Beats (mindestens 2,5 Blöcke auseinander) eine schwebende Säge oder ein
  Block mit Spike zum Weg hin, direkt neben dem Weg auf der Seite mit Platz (Normal 18 %,
  Extreme 50 % der Beats).
- Danach wird alles noch einmal mit allen Wegen gespielt; was im Weg ist, geht, und klappt es
  nicht, bleibt nichts davon.

**Weiteres.**

- UFO und Swing: In kurzen, intensiven Teilen (unter 3,2 Takten, ab Insane) können
  Gravity-Portale auch auf halben Takten liegen, sonst hätten die Teile einer Kette keine.
- Wave: Ab Hard mindestens so viel Raum wie bisher bei 3x (die Level fahren jetzt öfter
  langsamer, der Korridor in Blöcken wäre sonst enger geworden).
- `GENERATOR_VERSION` ist `gd-4.0-pieces`.

### 29.3 Gemessen

Vier Testsongs (90, 128, 140 mit Build-up und Drop, 174 BPM; mit Audio), je Schwierigkeit
zusammengezählt; vorher → nachher:

| Stufe   | Moduswechsel/min | Teillänge p10 / Median / p90 (s)      | Tempowechsel/min | Tempo-Anteile nachher                      |
| ------- | ---------------- | ------------------------------------- | ---------------- | ------------------------------------------ |
| easy    | 3,4 → 3,2        | 6,9 / 14,8 / 23,1 → 6,9 / 13,7 / 30,0 | 0 → 0            | 1x                                         |
| normal  | 4,1 → 5,9        | 6,9 / 12,0 / 19,6 → 3,6 / 8,3 / 16,5  | 1,0 → 1,3        | 0,5x 38 %, 1x 18 %, 2x 44 %                |
| hard    | 6,7 → 8,9        | 3,4 / 7,5 / 12,0 → 2,8 / 3,8 / 10,7   | 1,5 → 1,3        | 1x 38 %, 2x 18 %, 3x 44 % (vorher 4x 37 %) |
| insane  | 8,9 → 13,6       | 2,8 / 5,3 / 8,9 → 1,7 / 3,4 / 6,3     | 1,4 → 3,5        | 1x 38 %, 2x 18 %, 3x 19 %, 4x 25 %         |
| extreme | 11,2 → 16,2      | 2,8 / 3,75 / 7,9 → 1,4 / 2,8 / 5,3    | 1,4 → 3,4        | 2x 38 %, 3x 37 %, 4x 25 % (vorher 4x 39 %) |

Extreme liegt damit zwischen „Future Funk“ (12/min) und „CraZy III“ (18/min). Die Testsongs
ändern sich innerhalb ihrer Teile kaum; auf echten Songs mit mehr Wendungen kommen mehr
Tempowechsel.

40 Level (vier Songs × fünf Stufen × zwei Seeds): alle durchspielbar, kein Klick mit weniger
Spielraum als die Toleranz (engstes Fenster 62 ms bei Extreme, Toleranz 24 ms). Generierung im
Mittel 3,6 s (vorher ~3 s; der Hindernis-Pass kostet 0,5–1 s pro Level). `npm run test:dash`:
191 Tests grün; `npm run check`: 0 Fehler.

### 29.4 Geänderte Tests und Grenzen

- `busy.test.ts`: Zweimal derselbe Modus in derselben Größe hintereinander ist erlaubt, wenn sich
  das Tempo ändert (ein Tempo-Portal allein, wie in den Leveln). Gravity-Portale im Kiai:
  mindestens eines je 4,2 s Flugzeit statt je 3,2 s (gemessen 21 in 81 s; die Level haben je
  Modus eines alle 3,3–7 s, und kurze Teile einer Kette haben für eines kaum Platz).
- `surfaces.test.ts`: Der Swing darf 10 % statt 7 % seiner Zeit in Lücken ohne nötigen Klick
  verbringen (gemessen 9 %): Er kommt jetzt auch bei 2x vor, wo die Wege eines etwas zu frühen oder
  späten Klicks nach einem Gravity-Portal weiter auseinandergehen; dort darf kein Spike hin.
- **Orbs in Ball, UFO und Spider** fehlen weiter (die Level haben dort 0,35–1,3 Orbs/s). Jedes Orb
  muss nötig sein; dafür müsste der Weg mit dem Orb gebaut werden, nicht danach dazugelegt.
- **Schrägen** gibt es nur im Wave (die Physik kennt keine schrägen Blöcke für die anderen
  Modi); Ship-Korridore steigen weiter in Halbblock-Stufen.
- Schwebende Hindernisse passen nur, wo der Raum um den Weg Platz hat: UFO- und Swing-Tunnel
  liegen schon eng am Weg, dort kommen vor allem Spikes an die Wände.
- **Nicht gespielt**, nur gebaut, gemessen und als Bild angesehen (Tauri und osu!-Login fehlen
  hier). Ob sich die neuen Abschnitte gut anfühlen, zeigt erst das Spielen.

## 30. Orb-Sprünge bei Ball und Spider, Ship-Korridore aus Schrägen, Spider stirbt an Sägen im Sprung

Die offenen Punkte aus 29.4.

**Orb-Sprünge (`builders/rooms.ts`, `buildPlatforms`).** Ab Normal werden einige Klicks eines
Ball- oder Spider-Teils zu Orb-Sprüngen (Anteil 18 / 28 / 33 / 38 % der Klicks, Normal bis
Extreme, mehr im Intensiven): Der Spieler bleibt auf seiner Seite und springt mit einem Orb
über eine Grube voller Spikes auf die nächste Plattform derselben Seite. Gelb, pink, wo der Raum
über dem Sprung niedrig ist. Ohne Orb ginge derselbe Klick auf die andere Seite, auf deren Spikes;
ohne Klick rollt er in die Grube. Jedes Orb ist also nötig, und ein Test prüft das einzeln (Orb
entfernt, gleiche Klicks: tot).

- Liegen die Klicks nur einen Beat auseinander (zu kurz für den Bogen), nimmt der Sprung zwei
  Beats, und der Klick dazwischen entfällt.
- In der Grube bleiben der Block nach der Absprungkante und der halbe Block vor der Landung frei
  (dort steigt bzw. sinkt der Bogen), und sie hat keine Stufe.
- Die Plattformen um einen Sprung lassen 1,5 Blöcke mehr Raum. Der Ball springt nur in Räumen ab
  6 Blöcken Höhe, der Spider ab 5.
- Landet ein Sprung nicht, wird dieser Klick wieder ein normaler Wechsel; die letzten zwei
  Versuche eines Teils bauen ganz ohne Sprünge.

Gemessen (vier Testsongs): Spider 0,2–0,35 Orbs/s (vorher 0), Ball auf Hard 0,18/s; bei 3x und
4x ist der Ball-Raum nur 5 Blöcke hoch, dort bleibt es bei Wechseln. Die Level haben im Ball etwa
1 Orb/s, im Spider 1,3; das UFO hat weiter keine (die Level dort 0,35/s, meist schwarze und grüne).

**Ship-Korridore aus Schrägen (`builders/ship.ts`, `physics.ts`).** Ab Normal ist etwa jeder
zweite Ship-Teil (35 / 45 / 50 / 55 %) ein Korridor aus Schrägen: seine Wände sind Linien entlang
der Mitte und Höhe der Bausteine (statt Blöcken auf dem Halbblock-Raster), Säulen werden zu
Zacken. Wie die Wände der Wave sind sie tödlich (die Physik prüft die Wände jetzt auch für das
Ship, mit 0,9 × seiner halben Höhe). Gebaut und geprüft wird wie bisher (auf dem Weg, 0,3 Blöcke
darüber und darunter, Orbs nötig). Der Hindernis-Pass legt dort keine Spikes an die Wände und
setzt Hindernisse nur zwischen die Linien. Auf den vier Testsongs: 16 Ship-Teile aus Schrägen,
14 aus Blöcken.

**Spider springt nicht mehr durch Sägen (`physics.ts`).** Rückmeldung: Der Spider teleportiert
durch Sägen und Spikes, statt zu sterben. Sein Sprung auf die andere Seite (Klick oder
Spider-Orb) geschieht in einem Physikschritt, und geprüft wurde nur die Stelle, an der er ankommt.
Jetzt zählt die ganze Strecke des Sprungs: Eine Säge oder ein Spike darauf tötet. Der
Hindernis-Pass hält diese Strecke frei (vorher sah er nur Anfang und Ende des Sprungs und konnte
eine Säge mitten hineinsetzen). Test in `physics.test.ts`.

**Swing.** Die Gravity-Portale auf halben Takten (29.2) gelten nur noch für das UFO, und auf
Insane setzt der Swing Portale nur jeden zweiten Takt (jeden Takt erst auf Extreme): Die Klicks
des Swing drehen ihn schon. Damit liegt er wieder unter 7 % Zeit ohne nötigen Klick; die
Lockerung des Tests auf 10 % ist zurückgenommen.

Neue Tests: Orb-Sprünge kommen vor, werden genutzt und sind nötig (`rooms.test.ts`); das Ship
stirbt an Schrägen und fliegt dazwischen (`physics.test.ts`); Ship-Teile aus Blöcken und aus
Schrägen kommen vor und werden durchflogen (`generate.test.ts`). `GENERATOR_VERSION` ist
`gd-4.1-slopes`.

## 31. Ship wieder aus Blöcken

Rückmeldung zu 0.6.114: Das Ship ist komisch, an manchen Stellen darf es die Blöcke nicht
berühren. Das waren die Korridore aus Schrägen (30): Sie sahen aus wie Blöcke, töteten aber bei
Berührung, während man beim Ship an Blöcken entlangfliegen kann. Sie sind wieder entfernt: Jeder
Ship-Teil ist ein Korridor aus Blöcken wie vor 0.6.114 (`builders/ship.ts` auf dem Stand von
29), und tödliche schräge Wände gibt es in der Physik wieder nur für die Wave. Ein Test prüft,
dass kein Ship-Teil solche Wände hat. Schrägen, an denen das Ship entlanggleiten kann, bräuchten
eigene Physik für schräge Flächen; die gibt es noch nicht. `GENERATOR_VERSION` ist `gd-4.2`.

## 32. Näher an den Leveln: Pads im Spider, blaue Pads im Cube, Orbs im UFO, Spiegel-Portale

Noch einmal gegen die hochgeladenen Level gemessen, welche Orbs und Pads es je Modus gibt:

| Modus  | in den Leveln (meiste Arten)                                      | bei uns vorher                 |
| ------ | ----------------------------------------------------------------- | ------------------------------ |
| Cube   | gelbe und **blaue Pads**, blaue, gelbe, **grüne** Orbs, rote Pads | gelbe/pinke/rote Pads und Orbs |
| Spider | **pinke Pads** (in „niwa“ 36), schwarze Orbs, blaue Pads          | Orb-Sprünge (30)               |
| UFO    | schwarze, grüne, gelbe Orbs                                       | keine                          |
| Ball   | gelbe, pinke, rote, blaue Orbs                                    | Orb-Sprünge (30)               |

Dazu **Spiegel-Portale** in zwei der vier Level (eine gespiegelte Strecke, hin und zurück).

**Pad-Sprünge (Ball, Spider; `builders/rooms.ts`).** Ein Teil der Sprünge aus 30 geht jetzt
über ein Pad statt ein Orb (Spider 55 %, Ball 35 % der Sprünge): Das Pad liegt am Ende der
Plattform und nimmt den Beat von selbst, ohne Klick. Ohne Pad rollt der Spieler in die Grube; ein
Test prüft jedes einzeln. Der Spider springt öfter (25 / 36 / 42 / 48 % seiner Klicks, Normal bis
Extreme). Die Plattform, auf der er landet, beginnt erst nach dem Absprung (vorher stieß ein Pad-
Sprung gegen ihre Kante).

**Blaue Pads im Cube (`builders/blocks.ts`, neuer Baustein `upsidePads`, ab Hard).** Ein blaues
Pad am Boden dreht die Schwerkraft auf dem Beat, ohne Klick, an eine Platte oben; dort zwei
Sprünge über hängende Spikes; ein blaues Pad unter der Platte dreht zurück. Wer nicht gedreht
wird, läuft unten in kleine Spikes. Das Kopfüber-Stück mit Orbs nimmt jetzt in 40 % der Fälle
grüne statt blauer Orbs (sie drehen mit einem Sprung). 45 Bausteine für Cube und Robot (vorher 44).

**Orbs im UFO (`builders/rooms.ts`, `buildTunnel`, ab Hard).** Die Wegsuche darf auf den
Klicks des Schlagzeugs (den stärksten) statt eines Hüpfers ein Orb nehmen: gelb (großer Sprung)
unten im Raum, schwarz (sofort nach unten) oben; höchstens eines je 1,2 s. Das Orb ist während der
Suche nur für diesen Weg da. Danach wird jedes Orb nötig gemacht: Wo der Weg ohne Orb (gleiche
Klicks) aus dem Raum hinausreicht, den alle geprüften Wege einnehmen, kommt eine Säge direkt an
dessen Rand; sie bleibt, wenn alle Wege weiter durchkommen. Ein Orb, das so nicht nötig wird,
entfernt die Schlussprüfung wie bisher.

**Spiegel-Portale (`plan.ts`, `portals.ts`, `render.ts`).** Ab Hard ist eine Strecke gespiegelt
(Hard in der Hälfte der Level eine, Insane eine, Extreme zwei): ab einem intensiven Wechsel (Drop)
6–14 s lang, nie am Anfang oder Ende. Ein orangefarbenes Portal schaltet um (`MIRROR`,
`MIRROR OFF`), die Welt klappt in einem Moment um, der Spieler läuft von rechts nach links; das
HUD bleibt. Die Physik ist dieselbe (es ist nur die Ansicht). Im Browser mit dem echten Renderer
angesehen.

Geänderte Tests: Der Test, ob Cube und Robot lange nichts zu tun haben, zählt Pads mit (ein Pad
nimmt seinen Beat wie ein Klick; sonst 17 % auf Extreme); der Test der Kopfüber-Strecken erkennt
auch grüne Orbs und blaue Pads als Einstieg.

Neue Tests: Pad-Sprünge kommen vor und jedes Pad ist nötig; UFO-Orbs kommen vor, werden genommen
und sind nötig (`rooms.test.ts`); gespiegelte Strecken ab Hard, nicht auf Easy und Normal, ein
Portal bei jedem Umschalten (`generate.test.ts`); 45 Cube-Bausteine (`blocks.test.ts`).
`GENERATOR_VERSION` ist `gd-4.3-orbs-mirror`.

## 33. Bewegung, Tempo nach dem Song, Portal-Tore, Ship-Hindernisse, Ball-Orbs, Teleport-Portale

### 33.1 Was sich in den Leveln bewegt (gemessen)

Die Trigger der vier Level, gezählt und ausgewertet (Ziel, Weg, Dauer, Kurve, wann im Verhältnis
zum Spieler):

| Trigger             | „Future Funk“ | „niwa“ | „CraZy III“ | was sie tun                              |
| ------------------- | ------------- | ------ | ----------- | ---------------------------------------- |
| Bewegen (Move)      | 2070          | 1366   | 1593        | Spikes und Blöcke an ihren Platz, Wippen |
| Ein/Aus, Ausblenden | 946           | 52     | 611         | Teile erscheinen                         |
| Drehen              | 331           | 49     | 434         | Sägen drehen, Spikes/Orbs wackeln 4–20°  |
| Puls (Farbe)        | –             | –      | 1503        | auf dem Beat, alle 0,06–0,36 s           |
| Wackeln (Shake)     | 3             | 90     | 135         | kurze Serien in den intensiven Stellen   |

Die Bewegungen: meist senkrecht (Median 0,4–1 Block, bis 5), 0,3–1 s lang, mit Kurven, die
nachschwingen, federn oder abprallen; Ziel meist Spikes und Blöcke; ausgelöst 0–2 s bevor der
Spieler dort ist (Median 0,1–1 s). Viele Gruppen wippen auf dem Beat (alle 0,2–0,6 s).

### 33.2 Was geändert wurde

**Bewegung (`render.ts`, nur die Ansicht).** Blöcke, Spikes, Sägen, Orbs und Pads kommen in
Gruppen (je drei Blöcke) an ihren Platz: von unten, von oben, nach außen geteilt (über dem Weg von
oben, darunter von unten) oder eingeblendet, 2,5–6 Blöcke weit, mit einer der Kurven aus den
Leveln (nachschwingen, federn, abprallen, weich, schnell). Was auf einem Block steht, bewegt sich
mit ihm. Jede Bewegung beginnt auf einem Beat und ist 0,32 s bevor der Spieler dort ist fertig; die
Physik sieht immer den echten Platz. Je Teil eine Art, aus dem Look des Levels (dasselbe Level sieht
immer gleich aus); Easy ohne, Normal nur sanft eingeblendet, Hard 40 %, Insane 50 %, Extreme 60 %
der Gruppen. Dazu wackelt die Kamera in den intensivsten Stellen (Kiai, Intensität ab 0,85) kurz
auf den Kicks.

**Tempo nach dem Song (`plan.ts`, ab Hard).** Ein Burst auf einem Fill am Phrasenende läuft eine
Stufe schneller (wo es nicht ruhig ist); der letzte Takt vor einem Drop eine Stufe langsamer, der
Drop dann wieder in seinem Tempo. Auf den Testsongs: Tempowechsel pro Minute Hard 1,3 → 2,4,
Insane 3,5 → 4,5, Extreme 3,4 → 4,3 (die Testsongs haben wenige Fills und Drops).

**Portal-Tore (`render.ts`).** Jedes Modusportal steht in einem Tor aus seinem Licht: ein Band vom
Boden bis zur Decke, an den Rändern hell, mit Kappen. Nur Licht, nichts zum Stehen; es sieht nicht
wie ein Block aus, durch den man fliegt.

**Ship mit Hindernissen (`builders/ship.ts`, neues Stück `weave`, ab Hard).** Ein weiterer Raum
mit zwei Hindernissen auf den Beats, das erste über dem Weg, das zweite darunter (oder umgekehrt):
eine Säge oder ein Spike-Kreuz (ein Block mit einem kleinen Spike oben und unten). Der Weg
schlängelt sich so steil, wie das Ship steigt, dazwischen durch; geprüft wie jedes Stück. 13
Ship-Stücke.

**Ball-Orbs auch in niedrigen Räumen (`builders/rooms.ts`).** Bei 3x und 4x ist der Ball-Raum 5
Blöcke hoch; dort springt er jetzt auch, mit pinken Orbs und Pads (flacher Bogen). Gelingt
selten: Die Ball-Teile bei 4x brauchen schon ohne Sprünge oft mehrere Versuche (bekannt seit 28).

**Teleport-Portale (`physics.ts`, `generate.ts`, `render.ts`, ab Insane).** Wo ein Teil den
Spieler weit weg von dort lässt, wo der nächste beginnt (ein Flugteil oben, ein Cube-Teil am
Boden; ab 3 Blöcken, in einen Flugteil ab 3,5), nimmt ihn an der Grenze ein blaues Portal auf, und
er kommt sofort aus einem orangen auf der richtigen Höhe (Boden, oder die Mitte des Raums), ohne
Geschwindigkeit nach oben oder unten. In 45 % (Insane) bzw. 60 % (Extreme) dieser Fälle. Gemessen:
Insane 7, Extreme 9 in 2 Minuten. Die Physik kennt sie (`World.teleports`), sie gehen mit dem Level
aus dem Worker.

Neue Tests: Teleport in der Physik (`physics.test.ts`); Teleports ab Insane, zwischen Teilen, auf
gültiger Höhe, über den Worker erhalten; Hindernisse in den Ship-Räumen (`generate.test.ts`); 13
Ship-Stücke (`blocks.test.ts`). Im Browser mit dem echten Renderer angesehen: Bewegung, Tor,
Teleport. `GENERATOR_VERSION` ist `gd-4.4-motion`.

### 33.3 Danach: Sprünge in Ball und Spider nötig, Tempo-Akzente nur mit der Musik

- **Tempo-Akzente streng an der Musik:** Der Schub auf einem Fill kommt nur, wo der letzte Takt der
  Phrase deutlich dichter ist (× 1,3) oder sich der Song danach dreht; die Bremse vor einem Drop nur,
  wo der Takt davor deutlich dünner ist (× 0,6) oder pausiert, und nur bei Takten bis 2 s. Ein Song,
  der gleich bleibt, bleibt so auf einem Tempo; nach einem Tempowechsel wird es nicht wieder
  langsamer (beides prüften die bestehenden Tests, und beides schlug zuerst fehl).
- **Orb-Sprünge wirklich nötig:** Nach dem Bau wird jeder Orb-Sprung geprüft (ohne den Klick, und
  mit dem Klick ohne das Orb: beides muss scheitern); einer, der so nicht nötig ist, wird ein
  normaler Wechsel. Gruben eines Sprungs bekommen Spikes ab einem halben Block nach der Kante (die
  ersten klein), eine schmale Grube einen kleinen Spike in der Mitte. In den niedrigen Ball-Räumen nur
  Pads. Im Spider 45 % der Sprünge über Pads, im Ball 30 %.
- **Rücksetz-Portal am Ende geprüft:** Die Aufräumrunden am Ende (Portale ohne Wirkung umdrehen)
  konnten einen Teil kopfüber erreichbar machen, der richtig herum gebaut war, ohne sichtbares
  Rücksetz-Portal davor. Ein letzter Durchgang setzt es jetzt an jedem Teilanfang, den man kopfüber
  erreicht (gefunden vom bestehenden Test, nach einem Swing-Teil).
- **Kopfüber-Stücke nicht in den letzten 3,5 s eines Teils:** Dort kamen sie nicht mehr herunter,
  und der Teil wurde ohne sie neu gebaut, mit 4 s ohne Klick am Ende (gefunden am Ende des ruhigen
  Testsongs).

### 33.4 FPS

Rückmeldung: Es ruckelt teils, auch auf einem schnellen PC. Gemessen im Browser mit dem echten
Renderer (ein Extreme-Level, jeder Frame mit erzwungenem Zeichnen; ohne Grafikkarte, daher nur der
Vergleich zählt). Gefunden und geändert (`render.ts`, `physics.ts`):

- **Wände der Wave:** Ihr Kachelmuster wurde in jedem Frame für jede Wand neu erzeugt; der Browser
  kopiert dabei die Kachel jedes Mal in ein neues Bild für die Grafikkarte. Jetzt einmal je Kachel.
- **Kachel-Cache:** Ab 24 Kacheln wurde er ganz geleert und alles neu gemacht (bei vielen
  Farbwelten immer wieder, ein Hänger jedes Mal). Jetzt bis 96, die ältesten gehen einzeln; der
  Cache der eingefärbten Sprites fasst 400 statt 160.
- **`World.timeAt`** suchte linear durch alle Abschnitte und wird für jedes gezeichnete Ding in
  jedem Frame aufgerufen; mit der neuen Planung haben Level doppelt so viele Abschnitte. Jetzt per
  Halbierung (auch die Generierung profitiert).
- **Bewegung:** Wann eine Gruppe ankommt, wird einmal je Level ausgerechnet, der Block unter einem
  Spike einmal gesucht; die Lichtbänder der Portal-Tore werden je Farbe einmal angelegt.

Nicht geprüft: auf einer echten Grafikkarte (hier nur Software-Zeichnen). Ob es auf deinem PC
flüssig läuft, zeigt erst das Spielen; die FPS-Anzeige (F) zeigt auch, ob die adaptive Auflösung
herunterregelt.

## 34. Teleport-Portale und Einflug-Bewegung wieder raus

Auf Wunsch entfernt: die Teleport-Portale (Erzeugung, Physik, Speicherformat, Zeichnung) und die
Einflug-Bewegung aus §33 (Blöcke, Spikes, Sägen, Pads und Orbs, die vor dem Erreichen von oben oder
unten an ihren Platz fliegen). Alles wird wieder dort gezeigt, wo es ist. Der Kick-Shake, die
Portal-Tore, die Ship-Hindernisse, die Ball-Orbs und das Tempo nach dem Song bleiben.
`GENERATOR_VERSION` ist `gd-4.5`, damit alte Level neu erzeugt werden.

## 35. Flüssiger: die App unter Dash schläft, weniger Schnitte, Auflösung nach der Bildwiederholrate

- Unter einer Ansicht, die alles verdeckt (Dash), war die App nur unsichtbar: Stile und Layout
  wurden bei jeder Änderung weiter berechnet, und Widgets (Visualizer, Lyrics, Karten) zeichneten
  jeden Frame. Jetzt hat sie `content-visibility: hidden`, und diese Schleifen zeichnen dort nicht.
- Blöcke, die auf ganzen Kacheln enden (fast alle), werden nicht mehr auf ihre Fläche
  zugeschnitten (`clip` kostet die Grafikkarte; gemessen 2,2 → 1,4 ms je Frame im Software-Pfad).
- Die Auflösung passt sich an verpasste Frames der Bildwiederholrate an (bei 144 oder 240 Hz
  ruckelt es lange vor 50 FPS), nicht mehr an feste 20 ms; wird es weniger scharf und nicht
  besser, liegt es nicht am Zeichnen: wieder scharf, eine Minute kein neuer Versuch.
- Versucht und verworfen: die Kachelwand im Hintergrund einmal vorzuzeichnen und zu verschieben
  (das große halbtransparente Bild kostete mehr als ihre Rechtecke), die Spieluhr anders zu
  glätten (sie läuft schon auf 1–3 % gleichmäßig).
