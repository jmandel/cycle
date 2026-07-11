#!/usr/bin/env bash
# site-gen test harness: build, link-check (in build), console-check + screenshot
# matrix across key pages at desktop + mobile. Exit non-zero on any failure.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "== build =="
# The harness intentionally replaces its prior verified smoke-test output. The
# renderer itself refuses an existing destination unless this policy is named.
export SITE_GEN_REPLACE_OUTPUT="${SITE_GEN_REPLACE_OUTPUT:-1}"
if [ -z "${SITE_BUILD_DIR:-}" ]; then
  echo "SITE_BUILD_DIR must name a fig prepare --target cycle-site/v2 bundle"
  exit 1
fi
bun test site-gen/core \
  || { echo "RENDERER/SEMANTIC TESTS FAILED"; exit 1; }
BUILD=$(bun site-gen/build.tsx 2>&1) || { echo "$BUILD"; echo "BUILD FAILED"; exit 1; }
echo "$BUILD" | grep -E "Rendered|bundle|output|link check"

O="$PWD/site-gen/out"
SHOTS="site-gen/.shots"; mkdir -p "$SHOTS"
PAGES="${PAGES:-index.html artifacts.html StructureDefinition-menstrual-bleeding.html ValueSet-menstrual-flow.html CodeSystem-cycle.html Bundle-period-tracking-longitudinal-example.html specification.html}"
NOISE='GPU|gpu_|vulkan|swiftshader|dawn|gcm|google_apis|D-Bus|signin|histogram|VizNull|sandbox|ImplementationParts|GL |Fontconfig|cfgmgr'
fail=0

echo "== console (JS enabled) =="
for p in $PAGES; do
  chromium --headless=new --no-sandbox --disable-gpu --enable-logging=stderr --v=1 \
    --virtual-time-budget=4000 --dump-dom "file://$O/$p" >/dev/null 2>/tmp/sgc.txt
  n=$(grep -iE "CONSOLE|Uncaught|Hydration|Warning: |Error: " /tmp/sgc.txt | grep -ivE "$NOISE" | wc -l)
  if [ "$n" -gt 0 ]; then echo "  ✗ $p ($n issues)"; grep -iE "CONSOLE|Hydration|Uncaught" /tmp/sgc.txt | grep -ivE "$NOISE" | head -3; fail=1; else echo "  ✓ $p"; fi
done

echo "== screenshots (desktop 1320 + mobile 390) =="
for p in $PAGES; do
  b="${p%.html}"
  chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1320,1700 --virtual-time-budget=4500 --screenshot="$SHOTS/$b.desktop.png" "file://$O/$p" >/dev/null 2>&1
  chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=390,1800 --virtual-time-budget=4500 --screenshot="$SHOTS/$b.mobile.png" "file://$O/$p" >/dev/null 2>&1
done
echo "  shots → $SHOTS/"

echo "== output assertions =="
assert() { if eval "$2"; then echo "  ✓ $1"; else echo "  ✗ $1"; fail=1; fi; }
assert "index.html present"            "[ -f '$O/index.html' ]"
assert "llms.txt present"              "[ -f '$O/llms.txt' ]"
assert "per-page .md published"        "[ -f '$O/specification.md' ]"
assert "machine JSON published"        "ls '$O'/StructureDefinition-*.json >/dev/null 2>&1"
assert "verified SiteOutput published" "[ -f '$O/site-output.json' ] && grep -q '\"schemaVersion\":\"site-output/v1\"' '$O/site-output.json'"
assert "project.css linked"            "grep -q 'assets/project.css' '$O/index.html'"
assert "no /en/ shell (root site)"     "[ ! -d '$O/en' ]"
assert "design from designs/ (cycle css)" "[ -f '$O/assets/cycle/base.css' ]"
assert "renderer has no Publisher template path dep" "[ -z \"\$(grep -rl 'template/' site-gen/core site-gen/fhir site-gen/chrome site-gen/client site-gen/ds --include=*.ts --include=*.tsx 2>/dev/null)\" ]"
# project artifacts (viewers/skill.zip) are injected by build:sitegen, not the
# renderer smoke test; the orchestrator's final strict link check covers those.

if [ "$fail" -eq 0 ]; then echo "== ALL TESTS PASSED =="; else echo "== TESTS FAILED =="; exit 1; fi
