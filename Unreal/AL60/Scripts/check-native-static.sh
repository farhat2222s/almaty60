#!/usr/bin/env bash
# Static pre-compile checks for the AL60 Unreal module. Runs without Unreal Engine.
# It cannot replace a real UE build; it only catches the classes of errors that
# are visible from the text of the sources (UHT ordering, delegate handlers,
# encoding, config syntax, script syntax).
set -euo pipefail
AL60_PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$AL60_PROJECT_DIR"
python3 - <<'PY'
import glob, json, os, re, subprocess, sys
errors = []
def err(msg): errors.append(msg)

# 1. Project descriptor is valid JSON with the AL60 runtime module.
project = json.load(open('AL60.uproject', encoding='utf-8'))
if not any(m.get('Name') == 'AL60' for m in project.get('Modules', [])): err('AL60.uproject: module AL60 missing')

# 2. Every header with GENERATED_BODY includes its own .generated.h as the LAST include.
for h in sorted(glob.glob('Source/AL60/*.h')):
    text = open(h, encoding='utf-8-sig').read()
    if 'GENERATED_BODY()' in text:
        includes = re.findall(r'^\s*#include\s+"([^"]+)"', text, re.M)
        want = os.path.basename(h).replace('.h', '.generated.h')
        if not includes or includes[-1] != want: err(f'{h}: last #include must be "{want}", got {includes[-1] if includes else None}')
    if re.search(r'UFUNCTION\([^)]*\)\s*(const\s+)?[\w:<>]+\s*&\s*\w+\s*\(', text): err(f'{h}: UFUNCTION returns a reference (UHT rejects this)')
    if re.search(r'UFUNCTION\([^)]*\)[^;{]*=\s*TEXT\(', text): err(f'{h}: UFUNCTION default argument uses TEXT() — remove to keep UHT parsing simple')

# 3. Files that contain non-ASCII text must be UTF-8 with BOM (UE/MSVC requirement for TEXT("...") literals).
for f in sorted(glob.glob('Source/AL60/*.cpp') + glob.glob('Source/AL60/*.h')):
    raw = open(f, 'rb').read()
    try: raw.decode('utf-8')
    except UnicodeDecodeError: err(f'{f}: not valid UTF-8')
    if any(b > 127 for b in raw) and not raw.startswith(b'\xef\xbb\xbf'): err(f'{f}: non-ASCII text without UTF-8 BOM')
    # brace balance
    body = raw.decode('utf-8-sig')
    stripped = re.sub(r'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"', '', body, flags=re.S)
    if stripped.count('{') != stripped.count('}'): err(f'{f}: unbalanced braces')

# 4. Every AddDynamic handler must be a UFUNCTION in the owning header.
for cpp in sorted(glob.glob('Source/AL60/*.cpp')):
    text = open(cpp, encoding='utf-8-sig').read()
    header = cpp[:-4] + '.h'
    htext = open(header, encoding='utf-8-sig').read() if os.path.exists(header) else ''
    for cls, fn in re.findall(r'AddDynamic\(\s*this\s*,\s*&(\w+)::(\w+)\)', text):
        if not re.search(r'UFUNCTION\([^)]*\)\s*(?:virtual\s+)?void\s+' + fn + r'\s*\(', htext): err(f'{cpp}: AddDynamic handler {cls}::{fn} is not a UFUNCTION in {header}')
    # 5. UE5 FMath integer rounding of doubles: use the explicit 32-bit variants.
    if re.search(r'FMath::(Ceil|Floor|Round)ToInt\(', text) and 'CeilToInt(Manager->GetRemainingSeconds())' not in text:
        err(f'{cpp}: FMath::*ToInt on a double returns int64 in UE5; use *ToInt32 or *ToInt64 explicitly')

# 6. Config files: sections and key=value lines only.
for ini in sorted(glob.glob('Config/*.ini')):
    for n, line in enumerate(open(ini, encoding='utf-8').read().splitlines(), 1):
        s = line.strip()
        if not s or s.startswith(';') or s.startswith('['): continue
        if '=' not in s: err(f'{ini}:{n}: expected key=value')

# 7. Scripts parse.
subprocess.run([sys.executable, '-m', 'py_compile', 'Scripts/bootstrap_arbat.py'], check=True)
for sh in ('Scripts/bootstrap-native.sh', 'Scripts/package-native.sh', 'Scripts/check-native-static.sh'):
    subprocess.run(['bash', '-n', sh], check=True)

# 8. Client/server contract: JSON field names used by the mission manager exist in StagingBackend/src/service.mjs.
service = '../../StagingBackend/src/service.mjs'
if os.path.exists(service):
    stext = open(service, encoding='utf-8').read()
    mm = open('Source/AL60/AL60MissionManager.cpp', encoding='utf-8-sig').read()
    for field in set(re.findall(r'TryGet(?:String|Number|Object|Array)Field\(TEXT\("(\w+)"\)', mm)):
        if field in ('redemptionCode', 'redemption_code', 'expires_at'): continue  # legacy fallbacks
        if not re.search(r'\b' + field + r'\b', stext):  # object keys, including {shorthand} properties
            err(f'AL60MissionManager.cpp reads "{field}" which StagingBackend never sends')
    for path in set(re.findall(r'TEXT\("(/api/[\w/]+)"\)', mm)):
        if path.rstrip('/').split('/')[-1] not in stext: err(f'AL60MissionManager.cpp calls {path} which StagingBackend does not route')

if errors:
    print('\n'.join('FAIL ' + e for e in errors)); sys.exit(1)
print('AL60 static checks passed:', len(glob.glob('Source/AL60/*.cpp')), 'cpp,', len(glob.glob('Source/AL60/*.h')), 'headers')
PY
