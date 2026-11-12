#!/usr/bin/env bash
# The add-ons' test, in Chromium (Playwright): the desktop app in a browser (Tauri mocked, see
# vite.config.js and harness.cjs), without a network but for a mock of the Stosufy API.
# Installing and removing add-ons, their title bar buttons, views, pages and widgets, what
# settings from before add-ons keep installed, the file converter's conversions and the editor.
set -euo pipefail
cd "$(dirname "$0")/../.."
if curl -s -o /dev/null http://127.0.0.1:5289/; then echo "Port 5289 is taken: stop what's serving there first" >&2; exit 1; fi
node node_modules/vite/bin/vite.js dev --config tests/addons/vite.config.js > /dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:5289/ && break; sleep 0.5; done
cd tests/addons
node addons.cjs
node convert.cjs
node edit.cjs
