#!/bin/bash
set -e
cd "$(dirname "$0")/Playable"
AL60_NODE="$(command -v node || true)"
if [ -z "$AL60_NODE" ]; then
  AL60_NODE="/Users/farhat/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ ! -x "$AL60_NODE" ]; then
  echo 'Для запуска нужен Node.js 24 LTS. Установите его с https://nodejs.org и повторите запуск.'
  read -r -p 'Нажмите Enter для выхода.'
  exit 1
fi
if curl -fsS http://127.0.0.1:3060/api/state | "$AL60_NODE" -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{try{let d=JSON.parse(s);process.exit(d.demo&&d.player&&d.missions?0:1)}catch{process.exit(1)}})' 2>/dev/null; then
  open http://127.0.0.1:3060/
  echo 'Игра уже работает: http://127.0.0.1:3060/'
else
  "$AL60_NODE" server.mjs &
  AL60_PID=$!
  trap 'kill "$AL60_PID" 2>/dev/null || true' EXIT INT TERM
  for AL60_TRY in {1..30}; do
    if curl -fsS http://127.0.0.1:3060/api/state >/dev/null 2>&1; then
      open http://127.0.0.1:3060/
      break
    fi
    sleep 0.2
  done
  echo 'Игра: http://127.0.0.1:3060/ . Оставьте это окно открытым. Ctrl+C — остановить.'
  wait "$AL60_PID"
fi
