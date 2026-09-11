#!/usr/bin/env bash
set -euo pipefail
AL60_PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
: "${AL60_UE_ROOT:?Set AL60_UE_ROOT to an existing Unreal Engine installation.}"
AL60_REQUESTED_PLATFORM="${1:-Mac}"
AL60_PLATFORM_ARGS=()
case "$AL60_REQUESTED_PLATFORM" in
  Android|android) AL60_PLATFORM=Android; AL60_PLATFORM_ARGS=(-cookflavor=ASTC) ;;
  IOS|ios|iOS) AL60_PLATFORM=IOS ;;
  Mac|mac) AL60_PLATFORM=Mac ;;
  *) echo 'Usage: package-native.sh Mac|Android|IOS' >&2; exit 2 ;;
esac
AL60_UAT="$AL60_UE_ROOT/Engine/Build/BatchFiles/RunUAT.sh"
if [ ! -f "$AL60_UAT" ]; then echo 'RunUAT.sh is missing.' >&2; exit 3; fi
if [ ! -f "$AL60_PROJECT_DIR/Content/Maps/AL60Prototype.umap" ]; then echo 'Run bootstrap-native.sh successfully first.' >&2; exit 4; fi
AL60_ARCHIVE_DIR="${AL60_ARCHIVE_DIR:-$AL60_PROJECT_DIR/Builds/$AL60_PLATFORM}"
bash "$AL60_UAT" BuildCookRun -noP4 "-project=$AL60_PROJECT_DIR/AL60.uproject" "-platform=$AL60_PLATFORM" -clientconfig=Development -build -cook -stage -pak -package -archive "-archivedirectory=$AL60_ARCHIVE_DIR" -map=/Game/Maps/AL60Prototype -utf8output "${AL60_PLATFORM_ARGS[@]}"
