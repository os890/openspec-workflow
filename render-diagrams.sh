#!/usr/bin/env bash
# Renders every diagram in diagrams/ to SVG and PNG with podman; no local Node or Java needed.
#   ./render-diagrams.sh
# Images: ghcr.io/mermaid-js/mermaid-cli/mermaid-cli (Mermaid), docker.io/plantuml/plantuml (PlantUML).
# Override with MERMAID_IMAGE / PLANTUML_IMAGE.
set -euo pipefail
cd "$(dirname "$0")/diagrams"
mermaid="${MERMAID_IMAGE:-ghcr.io/mermaid-js/mermaid-cli/mermaid-cli}"
plantuml="${PLANTUML_IMAGE:-docker.io/plantuml/plantuml}"
run() { podman run --rm --userns=keep-id -v "$PWD:/data" "$@"; }

for f in *.mmd; do
  base="${f%.mmd}"
  width=1200 scale=2
  case "$base" in *horizontal*) width=4100 scale=1 ;; esac
  run "$mermaid" -i "/data/$f" -o "/data/$base.svg" -b white
  run "$mermaid" -i "/data/$f" -o "/data/$base.png" -b white -w "$width" -s "$scale"
done
for f in *.puml; do
  # keep Java's font cache out of the mounted directory
  run -e JAVA_TOOL_OPTIONS=-Duser.home=/tmp "$plantuml" -charset UTF-8 -tsvg "/data/$f"
  run -e JAVA_TOOL_OPTIONS=-Duser.home=/tmp "$plantuml" -charset UTF-8 -tpng "/data/$f"
done
ls -1 *.svg *.png
