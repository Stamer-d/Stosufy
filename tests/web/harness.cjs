// Mock backend + osu! + mirror for the web app tests
// A 20 s tone (8 kHz, 16 bit, mono): the songs' audio
const TONE = (() => {
  const rate = 8000, seconds = 20, samples = rate * seconds;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), 44 + i * 2);
  return wav;
})();
const N = Number(process.env.SONGS || 300);
const colors = ['#e11d48', '#7c3aed', '#0ea5e9', '#16a34a', '#f59e0b', '#db2777', '#14b8a6', '#6366f1'];
const LONG = process.env.LONG ? ' (TV Size) [feat. Someone With A Very Long Name] ~Extended Remix Version~' : '';
const mk = (n) => ({ id: 100 + n, title: `Song number ${n}${LONG}`, artist: `Artist ${n % (process.env.SONGS ? 37 : 7)}`, creator: 'mapper', bpm: 100 + (n % 80), source: n % 3 ? 'Some Anime' : '' });
const sets = Array.from({ length: N }, (_, i) => mk(i + 1));
const beatmaps = sets.map((s, i) => ({ id: 1000 + i, beatmapset_id: s.id, total_length: 150 + (i % 120), version: 'Hard', mode: 'osu', beatmapset: s, bpm: s.bpm }));
const now = Math.floor(Date.now() / 1000);
const PLAYS = Number(process.env.PLAYS || 0);
const playNs = PLAYS ? Array.from({ length: PLAYS }, (_, i) => 1 + ((i * 7919) % Math.min(N, 2000))) : [3, 5, 3, 7, 9, 3, 5, 11, 12, 14];
const plays = playNs.map((n, i) => ({ songKey: `${100 + n}:0`, at: now - Math.round((PLAYS ? 86400 * 300 : 72000) * (1 - i / playNs.length)), heard: 180, length: 200 }));
const songs = Object.fromEntries([...new Set(playNs)].map((n) => [`${100 + n}:0`, { setId: 100 + n, track: 0, mapId: 1000 + n - 1, title: `Song number ${n}`, artist: `Artist ${n % 37}`, creator: 'mapper', genre: ['Anime', 'Video Game', 'Electronic'][n % 3], language: 'Japanese', source: n % 3 ? 'Some Anime' : null, bpm: 100 + (n % 80) }]));
const ops = [];
const rows = (list) => list.map((m, i) => ({ ...m, rowId: 100000 + m.id }));
const state = {
  playlists: [{ id: 7, title: 'Big playlist' + (LONG ? ' with an extremely long name that goes on and on' : ''), createdBy: 1 }, { id: 2, title: 'Chill', createdBy: 1 }, { id: 3, title: 'Gaming', createdBy: 1 }, { id: 4, title: 'Anime openings', createdBy: 1 }],
  songs: { 7: rows(beatmaps), 2: rows(beatmaps.slice(20, 45)), 3: rows(beatmaps.slice(30, 55)), 4: rows(beatmaps.slice(40, 65)) },
  favs: beatmaps.slice(0, 12),
  settings: { appearance: { accent: 'teal', background: true, dim: 60 }, smartPlaylists: [{ id: 'abc', title: 'Smart mix', seeds: [{ id: 103, mapId: 1002, title: 'Song number 3', artist: 'Artist 3', genre: 'Anime', language: 'Japanese' }], filled: [], removed: [], online: false, size: 25 }] },
  settingsAt: 1000,
  publicLists: Array.from({ length: 40 }, (_, i) => ({ id: 500 + i, title: `Public list ${i}`, createdBy: 99, public: true, songAmount: 25, saves: 40 - i, creator: { osuId: 77, username: 'someone', avatarUrl: null } })),
  saved: new Set()
};
async function setup(ctx, { lyrics = true } = {}) {
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1).*/, async (original) => {
    // (every answer with CORS, as the real servers send: WebKit checks it, Chromium lets a
    // mocked answer through without)
    const asking = original.request().headers();
    const cors = { 'access-control-allow-origin': asking.origin || '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': asking['access-control-request-headers'] || 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS, HEAD', vary: 'Origin' };
    const route = { request: () => original.request(), abort: (...a) => original.abort(...a), fallback: (...a) => original.fallback(...a), fulfill: (o = {}) => original.fulfill({ ...o, headers: { ...cors, ...(o.headers || {}) } }) };
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, body: '' });
    // (DELAY=ms: a slow network, every answer that late)
    if (process.env.DELAY) await new Promise((r) => setTimeout(r, Number(process.env.DELAY)));
    if (url.includes('assets.ppy.sh')) {
      const id = Number((url.match(/beatmaps\/(\d+)/) || [])[1] || 0);
      const c = colors[id % colors.length];
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><text x="20" y="270" font-size="48" fill="white" font-family="sans-serif">${id}</text></svg>` });
    }
    if (url.includes('lrclib.net') || url.includes('/stosufy/lyrics/')) {
      if (!lyrics) return route.fulfill({ status: 404, json: {} });
      const lrc = Array.from({ length: 30 }, (_, i) => `[00:${String(i).padStart(2, '0')}.00] Line number ${i} of the song`).join('\n');
      return route.fulfill({ json: [{ trackName: 'x', artistName: 'y', duration: 20, instrumental: false, plainLyrics: 'plain', syncedLyrics: lrc }], headers: { 'access-control-allow-origin': '*' } });
    }
    if (url.includes('/stosufy/osufile/')) {
      ops.push('osufile:' + url.split('/').pop());
      const objs = Array.from({ length: 40 }, (_, i) => `256,192,${500 + i * 500},1,${i % 4 === 0 ? 2 : 0},0:0:0:0:`).join('\n');
      return route.fulfill({ body: `osu file format v14\n\n[General]\nSampleSet: Soft\n\n[TimingPoints]\n0,500,4,2,0,80,1,0\n\n[HitObjects]\n${objs}\n`, headers: { 'access-control-allow-origin': '*' } });
    }
    if (url.includes('/stosufy/web-login')) return route.fulfill({ status: 503, json: {} });
    if (url.includes('/stosufy/osu/beatmapsets/search')) ops.push('search:' + new URL(url).search);
    if (url.includes('/stosufy/osu/beatmapsets/search')) return route.fulfill({ json: { beatmapsets: sets.slice(0, 8).map((s, i) => ({ ...s, title: 'Found ' + s.title, beatmaps: [beatmaps[i]] })), cursor_string: null } });
    if (url.includes('/stosufy/osu/beatmapsets/')) {
      const sid = Number(url.match(/beatmapsets\/(\d+)/)[1]);
      const set = sets.find((x) => x.id === sid) || mk(sid - 100);
      return route.fulfill({ json: { ...set, title_unicode: set.title, artist_unicode: set.artist, status: 'ranked', user_id: 9, beatmaps: [{ id: 1000 + sid - 101, version: 'Insane', difficulty_rating: 4.6, mode: 'osu', total_length: 200 }, { id: 99000 + sid, version: 'Easy', difficulty_rating: 1.8, mode: 'osu', total_length: 200 }] } });
    }
    if (url.includes('/stosufy/osu/beatmaps')) {
      const ids = [...new URL(url).searchParams.getAll('ids[]')].map(Number);
      return route.fulfill({ json: { beatmaps: beatmaps.filter((m) => ids.includes(m.id)) } });
    }
    if (url.startsWith('https://api.stamer-d.de')) {
      const body = JSON.parse(req.postData() || '{}');
      const q = body.query || '';
      const v = body.variables || {};
      const name = (q.match(/^\s*(?:mutation|query)?[^{]*\{\s*(\w+)/) || [])[1];
      let data;
      switch (name) {
        case 'getStosufyUser': data = { getStosufyUser: { stosufyId: 1, osuProfile: { id: 5, username: 'tester' } } }; break;
        case 'getStosufyPlays': data = { getStosufyPlays: { plays, songs, cursor: 7, more: false } }; break;
        case 'addStosufyPlays': ops.push('addPlays:' + v.plays.length); data = { addStosufyPlays: true }; break;
        case 'getStosufyPlaylistSongs': {
          ops.push('songs:' + v.playlistId);
          const list = state.songs[v.playlistId] ?? (v.playlistId >= 500 ? rows(beatmaps.slice(100, 125)) : []);
          data = { getStosufyPlaylistSongs: list.map((m, i) => ({ id: m.rowId, setId: m.beatmapset_id, mapId: m.id, position: i })) };
          break;
        }
        case 'getStosufyFavourites': data = { getStosufyFavourites: state.favs.map((m, i) => ({ id: i + 1, setId: m.beatmapset_id, mapId: m.id, createdAt: '' })) }; break;
        case 'getStosufyPlaylists': data = { getStosufyPlaylists: state.playlists.map((p) => ({ ...p, songAmount: (state.songs[p.id] ?? []).length })) }; break;
        case 'createStosufyPlaylist': { const p = { id: 60 + state.playlists.length, title: v.title, createdBy: 1 }; state.playlists.push(p); state.songs[p.id] = []; ops.push('create:' + v.title); data = { createStosufyPlaylist: { ...p, songAmount: 0 } }; break; }
        case 'editStosufyPlaylist': { const p = state.playlists.find((x) => x.id === v.id); if (p) p.title = v.title; ops.push('edit:' + v.title); data = { editStosufyPlaylist: { ...p, songAmount: 0 } }; break; }
        case 'deleteStosufyPlaylist': state.playlists = state.playlists.filter((x) => x.id !== v.id); ops.push('delete:' + v.id); data = { deleteStosufyPlaylist: true }; break;
        case 'addSongToStosufyPlaylist': { const m = beatmaps.find((b) => b.id === v.mapId); const row = { ...m, rowId: 9000 + ops.length }; (state.songs[v.playlistId] ??= []).push(row); ops.push(`add:${v.playlistId}:${v.mapId}`); data = { addSongToStosufyPlaylist: { id: row.rowId, setId: v.setId, mapId: v.mapId, createdAt: '' } }; break; }
        case 'removeSongFromStosufyPlaylist': { state.songs[v.playlistId] = (state.songs[v.playlistId] ?? []).filter((m) => m.rowId !== v.songId); ops.push(`remove:${v.playlistId}:${v.songId}`); data = { removeSongFromStosufyPlaylist: true }; break; }
        case 'setStosufyFavourite': { const m = beatmaps.find((b) => b.id === v.mapId); if (v.favourite) state.favs.unshift(m); else state.favs = state.favs.filter((x) => x.id !== v.mapId); ops.push(`fav:${v.mapId}:${v.favourite}`); data = { setStosufyFavourite: true }; break; }
        case 'moveSongInStosufyPlaylist': { const list = state.songs[v.playlistId]; const at = list.findIndex((m) => m.rowId === v.songId); const [m] = list.splice(at, 1); list.splice(v.position, 0, m); ops.push(`move:${v.playlistId}:${v.songId}:${v.position}`); data = { moveSongInStosufyPlaylist: true }; break; }
        case 'getPublicStosufyPlaylists': ops.push('public:' + v.sort + ':' + (v.search || '')); data = { getPublicStosufyPlaylists: state.publicLists.filter((p) => !v.search || p.title.toLowerCase().includes(v.search.toLowerCase())).slice(v.offset, v.offset + v.limit) }; break;
        case 'getSavedStosufyPlaylists': data = { getSavedStosufyPlaylists: state.publicLists.filter((p) => state.saved.has(p.id)) }; break;
        case 'getStosufyPlaylist': data = { getStosufyPlaylist: state.publicLists.find((p) => p.id === v.id) }; break;
        case 'saveStosufyPlaylist': if (v.saved) state.saved.add(v.id); else state.saved.delete(v.id); ops.push(`save:${v.id}:${v.saved}`); data = { saveStosufyPlaylist: true }; break;
        case 'getFriendActivity': data = { getFriendActivity: { serverTime: Date.now(), friends: [
          { osuId: 11, username: 'alice', avatarUrl: null, online: true, lastSeen: Date.now(), roomCode: null, playback: { setId: 130, mapId: 1029, title: 'Song number 30', artist: 'Artist 2', position: 5, playing: true, mod: 'none', updatedAt: Date.now() - 3000 } },
          { osuId: 12, username: 'bob', avatarUrl: null, online: true, lastSeen: Date.now(), roomCode: null, playback: null },
          { osuId: 13, username: 'carol', avatarUrl: null, online: false, lastSeen: Date.now() - 3 * 3600e3, roomCode: null, playback: { setId: 140, mapId: 1039, title: 'Song number 40', artist: 'Artist 5', position: 80, playing: false, mod: 'none', updatedAt: Date.now() - 3 * 3600e3 } }
        ] } }; break;
        case 'setPresence': ops.push(`presence:${v.online}:${v.playback ? v.playback.title + '@' + Math.round(v.playback.position) + (v.playback.playing ? '>' : '|') : '-'}`); data = { setPresence: true }; break;
        case 'hidePresence': ops.push('hide'); data = { hidePresence: true }; break;
        case 'getStosufySettings': data = { getStosufySettings: state.settings ? { settings: state.settings, updatedAt: state.settingsAt } : null }; break;
        case 'saveStosufySettings': state.settings = v.settings; state.settingsAt = Date.now(); ops.push('saveSettings'); data = { saveStosufySettings: state.settingsAt }; break;
        default: data = { [name || 'x']: Array.isArray([]) ? [] : null };
      }
      return route.fulfill({ json: { data } });
    }
    if (url.includes('catboy.best') || url.includes('b.ppy.sh')) {
      // (with ranges, as the mirror: the audio can be seeked)
      const wav = TONE;
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] || '');
      if (range) {
        const from = Number(range[1]);
        const to = range[2] ? Number(range[2]) : wav.length - 1;
        return route.fulfill({ status: 206, body: wav.subarray(from, to + 1), contentType: 'audio/wav', headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'content-range': `bytes ${from}-${to}/${wav.length}` } });
      }
      return route.fulfill({ body: wav, contentType: 'audio/wav', headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
}
async function login(p) {
  await p.goto('http://127.0.0.1:5288/Stosufy/');
  await p.fill('textarea', JSON.stringify({ token: 'fake', expires: Date.now() + 3600e3 }));
  await p.click('button:has-text("Log in")');
  await p.waitForTimeout(2500);
}

// The engine: Chromium, or WebKit (Safari's, as on the iPhone) with BROWSER=webkit
const BROWSER = process.env.BROWSER || 'chromium';
const isChromium = BROWSER === 'chromium';
function launch() {
  return require('playwright')[BROWSER].launch(isChromium ? { args: ['--autoplay-policy=no-user-gesture-required'] } : {});
}
/** Options for a context in this engine (WebKit knows no clipboard permissions) */
const contextOptions = (options) => {
  if (isChromium) return options;
  const { permissions, ...rest } = options;
  return rest;
};

/**
 * A finger on the screen: touch(type, x, y) with type touchStart / touchMove / touchEnd.
 * Chromium: real touches (DevTools protocol). WebKit: touch events the page gets as from a
 * finger (on the element under it, moves and the end to the same one), without the browser's
 * own scrolling. `cdp` is Chromium's session (null in WebKit).
 */
async function touchInput(p) {
  if (isChromium) {
    const cdp = await p.context().newCDPSession(p);
    return { cdp, touch: (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] }) };
  }
  const touch = (type, x, y) => p.evaluate(({ type, x, y }) => {
    const name = { touchStart: 'touchstart', touchMove: 'touchmove', touchEnd: 'touchend', touchCancel: 'touchcancel' }[type];
    if (name === 'touchstart') window.__finger = { target: document.elementFromPoint(x, y) || document.body, x, y };
    const finger = window.__finger;
    if (!finger) return;
    if (x != null) { finger.x = x; finger.y = y; }
    const point = { identifier: 1, target: finger.target, clientX: finger.x, clientY: finger.y, pageX: finger.x + scrollX, pageY: finger.y + scrollY, screenX: finger.x, screenY: finger.y, force: 1 };
    const event = new Event(name, { bubbles: true, cancelable: name !== 'touchcancel', composed: true });
    const touches = name === 'touchend' || name === 'touchcancel' ? [] : [point];
    Object.defineProperty(event, 'touches', { value: touches });
    Object.defineProperty(event, 'targetTouches', { value: touches });
    Object.defineProperty(event, 'changedTouches', { value: [point] });
    finger.target.dispatchEvent(event);
    if (name === 'touchend' || name === 'touchcancel') window.__finger = null;
  }, { type, x, y });
  return { cdp: null, touch };
}

module.exports = { setup, login, ops, state, launch, contextOptions, touchInput, BROWSER, isChromium };
