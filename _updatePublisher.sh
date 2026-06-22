#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p input-cache
url="https://github.com/HL7/fhir-ig-publisher/releases/latest/download/publisher.jar"
echo "Downloading current HL7 FHIR IG Publisher..."
curl -fL "$url" -o input-cache/publisher.jar
# Current publisher.jar throws on the bare -version flag; don't fail the build over it.
java -jar input-cache/publisher.jar -version 2>/dev/null || echo "(publisher -version not reported by this build; continuing)"
