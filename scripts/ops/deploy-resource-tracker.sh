#!/usr/bin/env bash
# deploy-resource-tracker.sh
# ---------------------------------------------------------------------------
# Continuously samples host + Docker resource usage to a rotating log so we can
# post-mortem the freezes that hit the EC2 host during Dokploy deploys.
#
# The theory: `docker build` / Node builds spike RAM+CPU during a deploy; the
# kernel OOM-kills or the box swap-thrashes and SSH becomes unresponsive. This
# tracker writes a timestamped snapshot every INTERVAL seconds so the RAMP UP to
# the freeze is on disk even when the box later locks up.
#
# Runs at idle priority so it never contributes to the load it measures.
#
# Usage (quick, survives your SSH session via nohup):
#   sudo mkdir -p /var/log/deploy-tracker
#   sudo INTERVAL=5 nohup /usr/local/bin/deploy-resource-tracker.sh &>/dev/null &
#
# Preferred: install as a systemd service (see deploy-resource-tracker.service)
#   so it starts at boot and restarts if killed.
#
# Read the trail after a freeze:
#   ls -lah /var/log/deploy-tracker/
#   grep -n "LOW MEMORY" /var/log/deploy-tracker/tracker-*.log
# ---------------------------------------------------------------------------
set -uo pipefail

INTERVAL="${INTERVAL:-5}"                       # seconds between samples
LOG_DIR="${LOG_DIR:-/var/log/deploy-tracker}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
LOW_MEM_MB="${LOW_MEM_MB:-250}"                 # MemAvailable below this => WARN

mkdir -p "$LOG_DIR"

current_log() { echo "$LOG_DIR/tracker-$(date +%Y%m%d).log"; }

# best-effort daily cleanup
find "$LOG_DIR" -name 'tracker-*.log' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true

echo "deploy-resource-tracker started (interval=${INTERVAL}s, dir=${LOG_DIR})" \
  >> "$(current_log)"

while true; do
  LOG="$(current_log)"
  TS="$(date '+%Y-%m-%dT%H:%M:%S%z')"

  # MemAvailable in MB (from /proc/meminfo, in kB)
  MEM_AVAIL_MB=$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
  FLAG=""
  if [ "${MEM_AVAIL_MB:-0}" -lt "$LOW_MEM_MB" ]; then
    FLAG="  !!! LOW MEMORY (${MEM_AVAIL_MB}MB avail) !!!"
  fi

  {
    echo "===== $TS  MemAvail=${MEM_AVAIL_MB}MB${FLAG} ====="
    echo "--- load / uptime ---"
    uptime 2>/dev/null
    echo "--- memory (MB) ---"
    free -m 2>/dev/null
    echo "--- swap ---"
    swapon --show 2>/dev/null || echo "(no swap configured)"
    echo "--- vmstat (1 sample) ---"
    vmstat 1 2 2>/dev/null | tail -n 1 || true
    echo "--- top 8 by MEM ---"
    ps -eo pid,ppid,comm,%cpu,%mem,rss --sort=-%mem 2>/dev/null | head -n 9
    echo "--- top 8 by CPU ---"
    ps -eo pid,ppid,comm,%cpu,%mem,rss --sort=-%cpu 2>/dev/null | head -n 9
    echo "--- disk ---"
    df -h / 2>/dev/null
    echo "--- docker stats (10s timeout — hangs when daemon is stressed) ---"
    timeout 10 docker stats --no-stream \
      --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' 2>/dev/null \
      || echo "(docker stats timed out / unavailable — daemon likely stressed)"
    echo ""
  } >> "$LOG" 2>&1

  sleep "$INTERVAL"
done
