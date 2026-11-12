<p align="center">
<img src="https://i.imgur.com/ZTKDgna.png" width="96" alt="Stosufy" />
</p>

<h1 align="center">Stosufy</h1>

<p align="center">
The music player for osu! players.<br />
Every song from osu!'s beatmaps, with playlists, lyrics and gameplay, and add-ons like a DJ mode
and Dash levels.
</p>

<p align="center">
<a href="https://github.com/Stamer-d/Stosufy/releases/latest"><img alt="Download" src="https://img.shields.io/github/v/release/Stamer-d/Stosufy?label=download&style=flat-square&color=8b5cf6" /></a>
<a href="https://stamer-d.github.io/Stosufy/"><img alt="Web app for your phone" src="https://img.shields.io/badge/phone-web%20app-8b5cf6?style=flat-square" /></a>
<a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/github/license/Stamer-d/Stosufy?style=flat-square" /></a>
</p>

## Features

- 🎧 **Every osu! song.** Search all beatmaps, stream them or download them for offline.
- 📚 **Playlists and likes.** Share playlists with the community and save other people's.
- 🎤 **Synced lyrics**, with romaji for Japanese songs, and a full-screen focus mode.
- 🎯 **Gameplay.** Watch the map play along with the song, watch top replays or play it yourself.
- 👥 **Friends.** See what your friends are listening to and listen together.

### Add-ons

The desktop app's extras are add-ons: install the ones you want in the app's add-on store (the
button next to the focus mode, top left), and remove them again just as easily. Each one gets
its button in the title bar.

- 🎛️ **DJ mode.** Two decks, and smart mixes that blend songs on their phrases.
- 🟩 **Dash.** Play the song as a one-button rhythm level made from its beatmap and what's heard in
  the song: cube, robot, ship, ball, UFO, wave, swing and spider parts on the beat (the cube, robot
  and ship built from 50 building blocks on the drums), with practice mode (checkpoints on their own
  or set yourself) and five difficulties, from easy to demon level.
- 🧩 **Puzzle.** Put a song's background back together, with leaderboards and a daily puzzle.
- 🌍 **World center.** The weather with its radar, live lightning, storms, flights, earthquakes,
  departures, the ISS and webcams on one live map, and widgets of them for the home screen.
- 🔁 **File converter.** Pictures, sound, video, data and text into other formats (PNG, JPG, WebP,
  GIF, ICO, PDF, MP3, FLAC, Opus, MP4, WebM, JSON, YAML, TOML, CSV, XML, Markdown, HTML and more),
  many files at once, ZIPs packed and unpacked. All on your computer, saved to `Stosufy/Converted`.

## Install

### 💻 Desktop

Download it from **[Releases](https://github.com/Stamer-d/Stosufy/releases/latest)** and log in
with your osu! account. Stosufy updates itself after that.

- **Windows:** the `.exe` installer. If Windows warns you, click _More info → Run anyway_ (see
  the [FAQ](#faq)).
- **macOS:** the `.dmg` (`aarch64` for Apple Silicon, `x64` for Intel). The first time,
  right-click the app and choose _Open_.
- **Linux:** the `.AppImage` (any distribution), `.deb` or `.rpm`.

### 📱 Phone

Stosufy runs as a web app on your phone. Add it to your home screen and it opens like a normal
app, and keeps playing when the screen is locked.

**iPhone (Safari)**

1. Open **[stamer-d.github.io/Stosufy](https://stamer-d.github.io/Stosufy/)** in Safari.
2. Tap **Share**, then **Add to Home Screen**.
3. Open Stosufy from your home screen and log in.

**Android (Chrome)**

1. Open **[stamer-d.github.io/Stosufy](https://stamer-d.github.io/Stosufy/)** in Chrome.
2. Tap **⋮**, then **Install app** (or **Add to Home screen**).
3. Open Stosufy from your home screen and log in.

To log in, tap **Log in with osu!**. If that button isn't there, copy your login from the
desktop app instead (_Settings → Library → Copy login_) and paste it in. A copied login lasts
a day.

## FAQ

**Why does Windows say the app might be dangerous?**

Stosufy isn't code-signed, because signing costs money every year, so Windows doesn't know the
app. It contains no malware.

**Something doesn't load.**

Click **Refresh login** in the profile menu (top right). If that doesn't help,
[open an issue](https://github.com/Stamer-d/Stosufy/issues/new) or message `Stamer_d` on
Discord.

**Is this affiliated with osu!?**

No. Stosufy is a fan project and isn't made or endorsed by ppy. The songs and beatmaps belong
to their artists and mappers.

<details>
<summary><b>Building it yourself</b></summary>

<br />

You need [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs) and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev     # run the app while developing
npm run check         # type and icon checks
npm run test:dash     # the Dash mode's tests (physics, levels, timing)
npm run tauri build   # build an installer
npm run build:web     # build the web app
```

Built with [Tauri 2](https://tauri.app), [Svelte 5](https://svelte.dev) and Tailwind CSS.

</details>
