#!/usr/bin/env bash
# The web app's tests, on a phone in Chromium (Playwright), against a mock of the Stosufy API,
# osu! and the mirror: builds the app, serves it on 127.0.0.1:5288 and runs
#   tall.cjs    the app through (login, playlists, player, search, downloads, offline…)
#   mobile.cjs  the phone: gestures and cancelling them, keyboard, a long session (leaks),
#               a performance budget on a slowed-down CPU, offline, song ends
#   audit.cjs   every page on three phone sizes: errors, overflow, small tap targets
# Usage: tests/web/run.sh [tall|mobile|audit]…   (all without arguments)
set -euo pipefail
cd "$(dirname "$0")/../.."
WEB_BASE=/Stosufy npm run build:web > /dev/null
site=$(mktemp -d)
cp -r build-web "$site/Stosufy"
python3 tests/web/serve.py "$site" > /dev/null 2>&1 &
server=$!
trap 'kill $server; rm -rf "$site"' EXIT
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
