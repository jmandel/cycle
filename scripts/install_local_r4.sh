#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/hl7.fhir.r4.core-4.0.1.tgz" >&2
  exit 2
fi
archive="$1"
cache_root="${FHIR_PACKAGE_CACHE:-$HOME/.fhir/packages}"
target="$cache_root/hl7.fhir.r4.core#4.0.1"
rm -rf "$target"
mkdir -p "$target"
tar -xzf "$archive" -C "$target"
if [[ ! -f "$target/package/package.json" ]]; then
  echo "The archive does not have the expected FHIR NPM package layout." >&2
  exit 1
fi
name=$(python3 -c 'import json,sys; o=json.load(open(sys.argv[1])); print(o["name"]+"#"+o["version"])' "$target/package/package.json")
echo "Installed $name at $target"
