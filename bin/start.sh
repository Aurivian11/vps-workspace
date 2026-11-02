#!/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
export TMPDIR="$PWD/tmp" XDG_CACHE_HOME="$PWD/.cache" PYTHONDONTWRITEBYTECODE=1
[ -f .private/config.json ] || { echo 'Run node bin/init.mjs first.'; exit 1; }
exec 9>.private/control.lock
flock -x 9
# Use the OS manager only after the prepared project unit was explicitly registered.
fragment=$(systemctl show -p FragmentPath --value vps-workspace.service 2>/dev/null || true)
if [ -n "$fragment" ] && [ "$(readlink -f "$fragment")" = "$PWD/deploy/vps-workspace.service" ]; then
  systemctl start vps-workspace.service
  echo "VPS system service started."
  exit 0
fi
if node "$PWD/bin/supervisor.mjs" status; then echo 'VPS supervisor already running.'; exit 0; fi
# flock remains held for the supervisor lifetime, including restart backoff.
nohup flock --nonblock --no-fork "$PWD/.private/supervisor.lock" node "$PWD/bin/supervisor.mjs" --locked >/dev/null 2>&1 </dev/null 9>&- &
launcher=$!
for ((attempt=0; attempt<30; attempt++)); do
  if node "$PWD/bin/supervisor.mjs" status; then
    echo 'VPS supervisor started; health checks run every 30 seconds.'
    exit 0
  fi
  kill -0 "$launcher" 2>/dev/null || { echo 'Supervisor failed to start; check for an existing server process.' >&2; exit 1; }
  sleep 0.1
done
echo 'Supervisor startup is still pending; do not start another server.' >&2
exit 1
