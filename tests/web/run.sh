#!/usr/bin/env bash
# The web app's tests, on a phone in Chromium (Playwright), against a mock of the Stosufy API,
# osu! and the mirror: builds the app, serves it on 127.0.0.1:5288 and runs
#   tall.cjs    the app through (login, playlists, player, search, downloads, offline…)
#   mobile.cjs  the phone: gestures and cancelling them, keyboard, a long session (leaks),
#               a performance budget on a slowed-down CPU, offline, song ends
#   audit.cjs   every page on three phone sizes: errors, overflow, small tap targets
# Usage: tests/web/run.sh [tall|mobile|audit]…   (all without arguments)
# BROWSER=webkit runs them in WebKit, Safari's engine (the iPhone's); Chromium otherwise.
# (WebKit: npx playwright install webkit, and its system libraries: install-deps webkit)
set -euo pipefail
cd "$(dirname "$0")/../.."
WEB_BASE=/Stosufy npm run build:web > /dev/null
if curl -s -o /dev/null http://127.0.0.1:5288/; then echo "Port 5288 is taken: stop what's serving there first" >&2; exit 1; fi
site=$(mktemp -d)
cp -r build-web "$site/Stosufy"
python3 tests/web/serve.py "$site" > /dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true; rm -rf "$site"' EXIT
sleep 1
cd tests/web
status=0
for suite in "${@:-tall mobile audit}"; do
	for name in $suite; do
		echo "== $name"
		if [ "$name" = audit ]; then LONG=1 node audit.cjs || status=1; else node "$name.cjs" || status=1; fi
	done
done
exit $status
