#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
./_sushi.sh
if [[ ! -f input-cache/publisher.jar ]]; then
  echo "input-cache/publisher.jar is missing; run ./_updatePublisher.sh first" >&2
  exit 1
fi
java -jar input-cache/publisher.jar -ig . "$@"
