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

## 18. 0.6.86: Neue Grafiken

Ein neues Sprite-Sheet (8 × 9 Zellen, transparenter Hintergrund, mit einer Bild-KI gemacht) ersetzt
das alte. `scripts/dash-sprites.py` schneidet es neu: Jede zusammenhängende Form gehört zu der
Zelle, in der ihr Mittelpunkt liegt (die Bild-KI hält kein gleichmäßiges Raster ein), und jedes
Sprite bekommt in `sprites.webp` einen eigenen Platz von 176 × 176 px (so überlappt keins ein
anderes). Kein Magenta-Hintergrund mehr: pinke Objekte bleiben pink.

Neu im Sheet und im Renderer: Dash- und Spider-Orb, rotes und blaues Pad, Robot-, Gravity-
(normal/kopfüber), Größen- (mini/normal) und Speed-Portale (0,5× bis 4×), Robot, Spider und Swing
als Sprites (vorher von Hand gezeichnet; die Zeichnungen bleiben, solange die Sprites laden),
Deko (Säule, Rahmen, Lichtstrahl) für später. Die Portalfarben folgen der Farb-Logik des Genres:
Ball rot, UFO orange (vorher orange und gelb). Die Spurfarben der acht Spieler-Würfel passen zu den
neuen Würfeln.

## 19. 0.6.86: Bausteine für die Flugteile

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
