#!/usr/bin/env bash
# verify-viewer.sh — serve the built IG output on :5525 and drive headless
# Chromium (new headless / CDP) against the published viewer two ways:
#   1. chooser         /viewer/index.html
#   2. canonical link  /viewer/index.html#shlink:/...  (a full SHL URI)
#   3. direct resolve   resolve the raw shlink:/ with recipient="Example User"
#   4. demo click       click Load synthetic demo, then Open link
# Asserts the chooser and prefilled SHLink form render, then checks the
# recipient-aware retrieval/decrypt path.
cd "$(dirname "$0")/.."
PORT=5525
SHOT=/tmp/viewer-verify
mkdir -p "$SHOT"

python3 -m http.server "$PORT" --directory output >/tmp/verify-server.log 2>&1 &
SRV=$!
sleep 1.5

check_chooser() { # label url shot
  local dom="$SHOT/$1.html"
  timeout 60 chromium --headless=new --no-sandbox --disable-gpu \
    --virtual-time-budget=4000 --window-size=1200,1400 \
    --screenshot="$3" --dump-dom "$2" > "$dom" 2>/dev/null
  local ok=1
  for s in "Your name" "Example User" "Link to load" "Paste a SMART Health Link" "Open link" "Load the synthetic demo"; do
    grep -qF "$s" "$dom" || { echo "  [$1] MISSING: $s"; ok=0; }
  done
  if [ "$ok" = 1 ]; then echo "  [$1] OK — chooser rendered ($(wc -c <"$dom") bytes DOM -> $3)"; fi
  return $((1 - ok))
}

check_prefilled() { # label url shot
  local dom="$SHOT/$1.html"
  timeout 60 chromium --headless=new --no-sandbox --disable-gpu \
    --virtual-time-budget=4000 --window-size=1200,1400 \
    --screenshot="$3" --dump-dom "$2" > "$dom" 2>/dev/null
  local ok=1
  for s in "Your name" "Example User" "Link to load" "Open link" "shlink:/"; do
    grep -qF "$s" "$dom" || { echo "  [$1] MISSING: $s"; ok=0; }
  done
  if grep -qF "Menstrual cycle review" "$dom"; then echo "  [$1] rendered before explicit Open"; ok=0; fi
  if [ "$ok" = 1 ]; then echo "  [$1] OK — link prefilled ($(wc -c <"$dom") bytes DOM -> $3)"; fi
  return $((1 - ok))
}

check_resolve() {
  PORT="$PORT" VERIFY_SHLINK="$(cat input/images/viewer/_shlink-local.txt)" bun -e '
import { parseShlink, resolveShl } from "./viewer-src/shl.mjs";

const payload = parseShlink(process.env.VERIFY_SHLINK);
const { bundle } = await resolveShl(payload, `http://localhost:${process.env.PORT}/viewer/index.html`, "Example User");
if (bundle?.resourceType !== "Bundle") throw new Error("resolved payload was not a FHIR Bundle");
if (!Array.isArray(bundle.entry) || bundle.entry.length < 100) throw new Error("resolved Bundle was unexpectedly small");
console.log(`  [resolve] OK — decrypted ${bundle.entry.length} resources as Example User`);
'
}

rc=0
echo "1) chooser:"
check_chooser chooser "http://localhost:$PORT/viewer/index.html" "$SHOT/chooser.png" || rc=1
echo "2) canonical shlink:/ link:"
check_prefilled shlink "$(cat input/images/viewer/_shlink-local-ig.txt)" "$SHOT/shlink.png" || rc=1
echo "3) recipient-aware resolve:"
check_resolve || rc=1
echo "4) demo button and Open link:"
VIEWER_URL="http://localhost:$PORT/viewer/index.html" bun scripts/verify-viewer-clicks.mjs || rc=1

kill $SRV 2>/dev/null
echo
[ $rc = 0 ] && echo "VIEWER VERIFICATION PASSED" || echo "VIEWER VERIFICATION FAILED"
exit $rc
