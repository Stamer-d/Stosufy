<p align="center">
<img src="https://i.imgur.com/ZTKDgna.png" width="128" alt="Stosufy Logo" />
</p>

<h1 align="center">Stosufy</h1>

<p align="center">
<b>The music player for osu! players.</b><br />
Every song from osu!'s beatmaps, with playlists, lyrics, the gameplay and a DJ mode.
</p>

<p align="center">
<a href="https://github.com/Stamer-d/Stosufy/releases/latest"><img alt="Download" src="https://img.shields.io/github/v/release/Stamer-d/Stosufy?label=download&style=for-the-badge&color=8b5cf6" /></a>
<img alt="Windows" src="https://img.shields.io/badge/platform-Windows-0078d4?style=for-the-badge" />
<a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/github/license/Stamer-d/Stosufy?style=for-the-badge" /></a>
</p>

> [!NOTE]
> Stosufy is in active development and gets updates often. Found a bug? [Open an issue](https://github.com/Stamer-d/Stosufy/issues/new) or add me on Discord: `Stamer_d`.

---

## What is Stosufy?

Stosufy is a desktop music player built on osu!. Log in with your osu! account to search
every beatmap's song and play it right away. You can also download songs, build playlists
and listen with friends. It can show the map being played to the music, or let you play it
yourself.

## Features

### 🎧 Music

- **Every osu! song.** Search all beatmaps and stream them, or download them to listen offline. Downloads run in a queue.
- **Your osu! songs.** Import the songs from your osu! folder or profile.
- **Playback.** Queue, shuffle and repeat, crossfade, speed mods (DT/NC/HT/DC), sleep timer and volume normalisation.
- **Hitsounds.** Play the map's hitsounds along with the song, using your own skin's sounds.
- **Backgrounds.** Beatmap backgrounds and videos behind the music.

### 📚 Library

- **Playlists.** Create them, edit them, sort them by drag & drop and give them a cover.
- **Liked Songs.** Like a song with one click. Your likes follow your account.
- **Community.** Make playlists public and browse or save other players' playlists.

### 🎤 Lyrics & Focus

- **Synced lyrics,** with romaji for Japanese songs.
- **Focus mode.** A clean full-screen view with the clock, lyrics and gameplay.

### 🎯 Gameplay

- **Watch the map.** It plays along with the song as autoplay, in your osu! skin, with approach circles, sliders, spinners, follow points, combo, score and the 300s.
- **Top 50 replays.** Watch any replay from the beatmap's leaderboard, in sync with the song.
- **Play it yourself.** Use mouse and keys with real hit windows and sounds, mods (EZ, HD, HR, HT, DT, NC, RX) and a results screen.
- **Any difficulty.** Pick which difficulty of the beatmap to show.

### 🧩 Puzzle

- **Your backgrounds as puzzles.** Put a song's background back together while it plays: a **jigsaw** with real pieces, a **sliding** puzzle, or tiles to **spin** the right way up. Five difficulties from Easy to Expert.
- **Muffled until it's whole.** The music sounds like it's coming through a wall and opens up with every piece, until the full song comes back when the picture is done.
- **Played on the beat.** Every move is judged like a hit in osu!: 300, 100, 50 or a miss, with combo, score, accuracy, a grade at the end and your skin's hitsounds. Kiai time counts double.
- **Mods.** Easy, Hidden, Flashlight (smaller the higher your combo) and Spun (the pieces come turned).
- **Daily puzzle** from your library (anime songs first), with a streak, and a **gallery** of every picture you've solved.

### 🎛️ DJ mode

- **Two decks** with waveforms, beat grids taken from the beatmap (checked against the audio), sync, key lock, a three-band EQ with kills, filter, loops, hot cues and recording.
- **Smart mixes.** Stosufy listens to both songs (intro, choruses, outro, how the song ends, key) and mixes on their phrases like a DJ: the new song's intro under the old one's outro with the basslines swapped on the one, tempos matched without changing the pitch, an echo out or a segue when the songs don't fit together. Every move is timed to the sample.
- **Easy mode.** Press MIX and Stosufy plans the transition for you, or pick blend, filter, crossfade, echo out, wash out, brake or cut yourself.
- **Auto DJ.** Mixes through a playlist by itself, and you can still pick the next song.

### 🌍 World center

One map of everything you can follow live, by category. Layers can be pinned to show in every category.

- **Weather.** Rain radar, lightning you can hear, the wind blowing, DWD warnings and satellite. Forecast maps for three days that play hour by hour (temperature, wind, rain and snow, clouds, gusts, pressure, storm risk, CAPE, lifted index, shear), and any place's forecast with its storm outlook and sounding.
- **Earth.** Earthquakes, tsunami alerts, disasters (GDACS), volcanoes, wildfires and fire hotspots, NASA's events, river levels.
- **Environment.** Maps of air quality, fine dust, NO₂, ozone, pollen, UV and waves; dust sensors and radiation probes.
- **Traffic.** Flights, buses, trams and trains moving along their lines with live delays, departures at any stop, ships, shared bikes, the Autobahn.
- **Space.** The ISS and when it flies over you, satellites and Starlink, rocket launches, the aurora and space weather.
- **Cameras.** Public traffic cameras and webcams worldwide with their live picture.

### 👥 Social & Customisation

- **Friends.** See what your friends are listening to, and **Listen Together** in sync.
- **Discord Rich Presence.**
- **Home.** Widgets, layouts and accent colours to make the home screen yours.
- **Shortcuts.** Customisable keyboard shortcuts and a built-in updater.

## Download

Get the latest installer from **[Releases](https://github.com/Stamer-d/Stosufy/releases/latest)**.
Stosufy keeps itself up to date after that.

## Building it yourself

You need [Node.js](https://nodejs.org) (20 or newer), [Rust](https://rustup.rs) and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev     # run the app while developing
npm run check         # type and icon checks
npm run tauri build   # build an installer
```

Stosufy is built with [Tauri 2](https://tauri.app), [SvelteKit](https://svelte.dev) and
[Svelte 5](https://svelte.dev), with Tailwind CSS for styling.

## FAQ

### Why does Windows say the app might be dangerous?

Stosufy isn't code-signed (that costs money every year), so Windows treats it as unknown
software. There's **no malware**: click _More info → Run anyway_.

### Something doesn't load. What can I do?

Click **Refresh login** in your profile menu (top right), which renews the connection to osu!. If it
still doesn't work, please [open an issue](https://github.com/Stamer-d/Stosufy/issues/new).

### Is this affiliated with osu!?

No. Stosufy is a fan project and isn't made or endorsed by ppy. All songs and beatmaps
belong to their artists and mappers.
