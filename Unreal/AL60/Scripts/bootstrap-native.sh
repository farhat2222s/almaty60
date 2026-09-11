#!/usr/bin/env bash
set -euo pipefail
AL60_PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
: "${AL60_UE_ROOT:?Set AL60_UE_ROOT to an existing Unreal Engine installation; this script does not install it.}"
AL60_PROJECT="$AL60_PROJECT_DIR/AL60.uproject"
AL60_EDITOR="$AL60_UE_ROOT/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"
AL60_BUILD="$AL60_UE_ROOT/Engine/Build/BatchFiles/Mac/Build.sh"
if [ ! -x "$AL60_EDITOR" ] || [ ! -f "$AL60_BUILD" ]; then
  echo 'Unreal macOS editor/build tools not found at AL60_UE_ROOT.' >&2
  exit 2
fi
if ! xcodebuild -version >/dev/null 2>&1; then
  echo 'A full compatible Xcode is required. Command Line Tools alone cannot build this native target.' >&2
  exit 3
fi
bash "$AL60_BUILD" AL60Editor Mac Development "-project=$AL60_PROJECT" -WaitMutex
AL60_BOOTSTRAP_QUIT=1 "$AL60_EDITOR" "$AL60_PROJECT" "-ExecutePythonScript=$AL60_PROJECT_DIR/Scripts/bootstrap_arbat.py" -unattended -nosplash -nop4
if [ ! -f "$AL60_PROJECT_DIR/Content/Maps/AL60Prototype.umap" ]; then
  echo 'Editor did not produce the map. Inspect Saved/Logs before packaging.' >&2
  exit 4
fi
printf '%s\n' 'Bootstrap complete. Open AL60.uproject and press Play.'
