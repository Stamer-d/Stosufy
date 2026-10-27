// The web app: the browser's own fetch (the desktop app's goes around the browser's rules,
// here a server has to allow it: see the checks page)
export const fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);
