# Claude-Verbindung (MCP)

Stand: 22.11.2026 (27 Tools). Claude (die Claude-App und Claude Code) kann über das Model Context Protocol
mit Stosufy reden: den Hörverlauf und die Bibliothek lesen, alle Songs auf osu! durchsuchen,
Playlists anlegen und ändern und Musik abspielen. Eingerichtet wird es unter
_Einstellungen → Claude_.

Zwei Wege: lokal über die Desktop-App (Abschnitt 1) und als Connector auf dem Server
(`https://api.stamer-d.de/v2/stosufy/mcp`, Abschnitt 5) – der geht auch auf dem Handy und auf
claude.ai, während die Desktop-App zu ist.

## 1. Aufbau

```
Claude ──stdio──▶ Stosufy --mcp (Brücke) ──HTTP 127.0.0.1 + Token──▶ Stosufy (App)
                                                                       │ Event "mcp-call"
                                                                       ▼
                                                          Fenster: src/lib/mcp/tools.ts
```

| Baustein          | Datei                                      | Aufgabe                                                                         |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| Tools und Prompts | `src/lib/mcp/tools.json`, `prompts.json`   | Namen, Beschreibungen und Argumente, so wie Claude sie sieht                    |
| Protokoll, Server | `src-tauri/src/mcp.rs`                     | JSON-RPC, die Brücke (`--mcp`), der lokale Server, Claude-Desktop-Einstellungen |
| Start             | `src-tauri/src/main.rs`, `lib.rs`          | `--mcp` startet nur die Brücke; `--background` startet die App minimiert        |
| Tools             | `src/lib/mcp/tools.ts`, `songs.ts`         | die Tools selbst, mit den Stores der App                                        |
| Fenster-Seite     | `src/lib/mcp/connection.ts`                | nimmt die Aufrufe an, schickt die Antworten zurück                              |
| Einstellungen     | `src/lib/components/ClaudeSettings.svelte` | Ein/Aus, „Änderungen erlauben", Hinzufügen zu Claude, Anleitung                 |

- **Die Brücke** ist die App selbst mit `--mcp`: Claude startet sie und spricht über stdin/stdout
  (eine JSON-Nachricht pro Zeile). `initialize`, `tools/list` und die Prompts beantwortet sie
  selbst, auch wenn die App zu ist. Tool-Aufrufe gibt sie an die App weiter; ist die App nicht
  offen, startet sie sie minimiert und wartet bis zu 45 s. Mehrere Aufrufe laufen gleichzeitig.
- **Der Server in der App** hört nur auf 127.0.0.1, will den Token aus der Verbindungsdatei und
  lehnt jede Anfrage mit `Origin`-Header ab (Webseiten können ihn so nicht erreichen). Er ist ein
  gültiger MCP-Endpunkt (`POST /mcp`, JSON-Antworten), bevorzugt auf Port 47821.
- **Die Verbindungsdatei** `claude-connection.json` im Datenordner der App
  (`%APPDATA%\com.Stosufy.app` usw.): an/aus, Änderungen erlaubt, Token, Port. Die Brücke liest
  sie bei jedem Aufruf.
- **Nur lesen**: Ist „Let Claude make changes" aus, lehnt die App jedes Tool ohne
  `readOnlyHint` ab, mit einer Erklärung für Claude.
- **Zeitlimit**: Claude wartet etwa eine Minute. Lange Arbeiten (viele Songs in eine Playlist,
  eine Smart Playlist füllen) antworten nach 45 s mit dem Stand und laufen in der App weiter.

## 2. Tools

| Tool                         | Was es tut                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `get_now_playing`            | aktueller Song, Position, Pause, Mod, Warteschlange                                                         |
| `get_listening_stats`        | wie Wrapped: Top-Songs/-Künstler/-Quellen/-Genres, Uhrzeiten, Tempo, oft übersprungen, vergessene Lieblinge |
| `get_listening_history`      | einzelne Plays (Ortszeit), Filter nach Zeit, Song, Skips                                                    |
| `get_library_overview`       | Größe und Zusammensetzung der Bibliothek, Streaming, Download möglich                                       |
| `search_library`             | heruntergeladene Songs: Wörter, Künstler, Quelle, Genre, Sprache, BPM, Länge, gespielt, geliked, Sortierung |
| `search_osu`                 | alle Beatmaps auf osu! mit osu!-Suchsyntax, Status, Sortierung, Cursor                                      |
| `get_song_details`           | alles zu bis zu 20 Songs, osu!-Daten und die eigenen Plays, Playlists                                       |
| `find_similar_songs`         | ähnliche Songs nach dem Radio-Modell (`fitTo`) aus Bibliothek und osu!, mit Begründung                      |
| `get_osu_profile_songs`      | Favoriten, meistgespielte und Top-Plays des osu!-Profils                                                    |
| `get_mixes`                  | Stosufys Mixes („Made for you“): Tagesmixe, vergessene Lieblinge, zuletzt gehört (`mix:…`)                  |
| `search_community_playlists` | öffentliche Playlists anderer, beliebteste oder neueste, mit Suche                                          |
| `list_playlists`             | eigene, Smart Playlists, Liked, Downloaded, gespeicherte fremde                                             |
| `get_playlist_songs`         | Songs einer Playlist                                                                                        |
| `create_playlist`            | neue Playlist mit Songs in Reihenfolge, optional öffnen, abspielen, herunterladen                           |
| `add_to_playlist`            | Songs anhängen (`liked` liked sie, Smart Playlist: als Grundlage)                                           |
| `remove_from_playlist`       | Songs herausnehmen                                                                                          |
| `reorder_playlist`           | neue Reihenfolge oder sortieren (BPM, Länge, Titel, Künstler, umgedreht, zufällig)                          |
| `edit_playlist`              | Titel, Beschreibung, öffentlich; bei Smart Playlists Titel und Größe                                        |
| `create_smart_playlist`      | Stosufys eigene Smart Playlist aus Seeds, gleich gefüllt                                                    |
| `delete_playlist`            | eigene Playlist oder Smart Playlist löschen, nur auf ausdrücklichen Wunsch                                  |
| `save_playlist`              | öffentliche Playlist anderer in die Bibliothek speichern (oder wieder heraus)                               |
| `download_songs`             | Songs oder eine ganze Playlist herunterladen (braucht den osu!-Session-Key)                                 |
| `get_downloads`              | Stand der Downloads: läuft, wartet, fertig, fehlgeschlagen, Pause wegen osu!                                |
| `play`                       | Songs/Playlist jetzt, als Nächstes, ans Ende oder als Radio                                                 |
| `edit_queue`                 | „Als Nächstes“ umsortieren, Songs herausnehmen, leeren                                                      |
| `control_playback`           | Pause, weiter, nächster, vorheriger                                                                         |
| `set_playback`               | Lautstärke, Mod (DT/NC/HT/DC), Shuffle, Repeat, Springen, Sleep-Timer, Autoplay                             |

Songs heißen für Claude immer gleich: die Beatmap-Set-ID, bei Sets mit mehreren Songs mit
`:track` („1234567", „1234567:1"); osu!-Links gehen auch. Leere und unbekannte Felder fehlen in
den Antworten, damit Claude weniger lesen muss.

Prompts (in der Claude-App unter „+" → Stosufy, in Claude Code `/mcp__stosufy__…`):
`playlist_from_my_listening`, `playlist_from_description`, `listening_recap`,
`discover_new_songs`.

## 3. Tests

- Server-Connector: `test/stosufy/mcp.test.ts` im Backend (OAuth mit osu!, die Tools gegen
  Postgres, Abspielen über Connect, Weitergabe an die Desktop-App).

- `npm run test:mcp`: alle Tools mit den echten Stores, osu! und die Stamer-API als Attrappen
  (`tests/mcp/`). Prüft u. a., dass `tools.json` und die Tools übereinstimmen.
- `cargo test --lib mcp` in `src-tauri`: Protokoll, Prompts, Server (Token, Origin),
  Verbindungsdatei.

## 4. Bekannt

- Während Claude läuft, hält die Brücke `Stosufy.exe` offen. Das Windows-Update beendet sie
  (gleicher Prozessname); Claude zeigt Stosufy danach als getrennt, bis Claude neu startet.
- Claude Desktop liest seine Einstellungen nur beim Start: nach „Add to Claude" Claude ganz
  beenden (auch im Tray) und neu öffnen.
- Genres und Sprachen schickt osu! in der Sprache des Nutzers; die Bibliothek hat deshalb oft
  beide („Video Game“ und „Videospiel“). Die Tools (und Radio und Smart Playlists) vergleichen sie
  über `englishName` in `src/lib/genres.ts`, das die deutschen Namen kennt.
- Die Windows-Store-Version von Claude hat ihre Einstellungen ggf. in
  `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude`; „Add to Claude" schreibt in jede
  gefundene Installation.

## 5. Auf dem Server (Handy, claude.ai)

```
Claude (Handy/Web) ──HTTPS + OAuth──▶ api.stamer-d.de/v2/stosufy/mcp (stamer-v2-backend)
                                        │ Hörverlauf, Playlists, Likes, Einstellungen, osu!
                                        │ Wiedergabe: Stosufy Connect ──▶ offenes Gerät
                                        └ mcp-Befehl über Connect ──▶ Desktop-App (tools.ts)
```

- **Einrichten**: in Claude Einstellungen → Connectors → _Add custom connector_, Name Stosufy,
  URL `https://api.stamer-d.de/v2/stosufy/mcp`. Angemeldet wird mit osu! (über die osu!-App der
  Web-App: osu! schickt zurück an deren `/callback`, die Seite reicht Logins mit
  `state=stosufy-mcp.…` an den Server weiter). Auf der Freigabe-Seite: „Änderungen erlauben" und die
  Zeitzone (für Statistik und Verlauf).
- **Auf dem Server** (`src/stosufy/mcp/` im Backend) laufen dieselben 27 Tools (Namen, Argumente und
  Beschreibungen aus einer Kopie von `tools.json`, mit Hinweisen, wo es anders ist), mit dem, was
  der Server hat: Hörverlauf, Playlists, Likes, gespeicherte Playlists, Smart Playlists (in den
  Einstellungen) und osu! (mit dem osu!-Login der Verbindung).
- **Abspielen** geht an das Gerät, das spielt, sonst an die Desktop-App, sonst an ein anderes
  offenes Gerät (die Web-App auf dem Handy), über die Connect-Befehle (`playSongs`, `queueSong`,
  `pause`, `volume` …).
- **Nur mit Desktop-App**: heruntergeladene Songs (`search_library`, Downloaded Songs), Downloads,
  Mixes, Mod/Autoplay/Sleep-Timer und die Warteschlange bearbeiten. Ist die Desktop-App offen (und
  „Allow Claude" an), meldet sie sich bei Connect mit `mcp: true`; der Server schickt ihr den Aufruf
  als Befehl `mcp`, sie führt ihr eigenes Tool aus (`connection.ts`, mit den lokalen Einstellungen)
  und antwortet mit `answerConnectMcp`. `find_similar_songs` und `get_library_overview` laufen
  dann auch dort (mit der Bibliothek).
- **Änderungen** von Claude auf dem Server schickt der Server den offenen Apps als Befehl
  `refresh` (`claudeChanges.ts`): sie laden Playlists, Likes oder Einstellungen neu.
- Ändert sich `tools.json` oder `prompts.json` hier, die Kopie im Backend
  (`src/stosufy/mcp/tools.json`, `prompts.json`) und dessen Tools mitziehen.
