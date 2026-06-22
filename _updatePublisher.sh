#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p input-cache
url="https://github.com/HL7/fhir-ig-publisher/releases/latest/download/publisher.jar"
echo "Downloading current HL7 FHIR IG Publisher..."
curl -fL "$url" -o input-cache/publisher.jar
java -jar input-cache/publisher.jar -version
