#!/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
export TMPDIR="$PWD/tmp" XDG_CACHE_HOME="$PWD/.cache" PYTHONDONTWRITEBYTECODE=1
exec 9>.private/control.lock
flock -x 9
# Use the OS manager only after the prepared project unit was explicitly registered.
fragment=$(systemctl show -p FragmentPath --value vps-workspace.service 2>/dev/null || true)
if [ -n "$fragment" ] && [ "$(readlink -f "$fragment")" = "$PWD/deploy/vps-workspace.service" ]; then
  systemctl stop vps-workspace.service
  echo "VPS system service stopped."
  exit 0
fi
node "$PWD/bin/supervisor.mjs" stop
