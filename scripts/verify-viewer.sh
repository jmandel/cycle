#!/usr/bin/env bash
# verify-viewer.sh — serve the built IG output on :5525 and drive headless
# Chromium (new headless / CDP) against the published viewer two ways:
#   1. default link    /viewer/index.html              (reads ./shl.json -> ./example.jwe)
#   2. canonical link  /viewer/index.html#shlink:/...  (a full SHL URI)
# Asserts the decrypted clinician summary actually renders, and saves screenshots.
cd "$(dirname "$0")/.."
PORT=5525
SHOT=/tmp/viewer-verify
mkdir -p "$SHOT"

python3 -m http.server "$PORT" --directory output >/tmp/verify-server.log 2>&1 &
SRV=$!
sleep 1.5

check() { # label url shot
  local dom="$SHOT/$1.html"
  timeout 60 chromium --headless=new --no-sandbox --disable-gpu \
    --virtual-time-budget=12000 --window-size=1200,2400 \
    --screenshot="$3" --dump-dom "$2" > "$dom" 2>/dev/null
  local ok=1
  # marker strings (avoid '&' which serialises to &amp; in the dumped DOM)
  for s in "Menstrual cycle review" "decrypted" "Cycle comparison" "Symptom pattern" "Fertility observations"; do
    grep -qF "$s" "$dom" || { echo "  [$1] MISSING: $s"; ok=0; }
  done
  if grep -qF "Could not render" "$dom"; then echo "  [$1] error banner present"; ok=0; fi
  if [ "$ok" = 1 ]; then echo "  [$1] OK — rendered ($(wc -c <"$dom") bytes DOM -> $3)"; fi
  return $((1 - ok))
}

rc=0
echo "1) default link:"
check default "http://localhost:$PORT/viewer/index.html" "$SHOT/default.png" || rc=1
echo "2) canonical shlink:/ link:"
check shlink "http://localhost:$PORT/viewer/index.html#$(cat input/images/viewer/_shlink-local.txt)" "$SHOT/shlink.png" || rc=1

kill $SRV 2>/dev/null
echo
[ $rc = 0 ] && echo "VIEWER VERIFICATION PASSED" || echo "VIEWER VERIFICATION FAILED"
exit $rc
