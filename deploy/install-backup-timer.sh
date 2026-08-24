#!/usr/bin/env bash
# ==============================================================================
# Operis — install the nightly database backup timer
# ==============================================================================
# Standalone because 01-bootstrap-server.sh cannot run on this host (it would
# restart Docker and bounce four other production stacks). The timer was part
# of that script, so on a shared host it has to be installed on its own —
# otherwise `backup.sh` exists on disk and nothing ever calls it.
#
# Additive and idempotent: it writes two unit files, reloads systemd and
# enables one timer. It touches no existing unit.
#
#   scp deploy/install-backup-timer.sh ubuntu@SERVER:/tmp/
#   ssh ubuntu@SERVER 'sudo bash /tmp/install-backup-timer.sh'
#
# Options:
#   --user NAME    account that owns /opt/operis (default: operis)
#   --at TIME      systemd OnCalendar time (default: *-*-* 03:17:00)
#   --verify       run one backup immediately after installing
# ==============================================================================

set -Eeuo pipefail

DEPLOY_USER="operis"
AT="*-*-* 03:17:00"
VERIFY=0
APP_DIR="/opt/operis"

while [ $# -gt 0 ]; do
  case "$1" in
    --user)   DEPLOY_USER="${2:?}"; shift ;;
    --at)     AT="${2:?}"; shift ;;
    --verify) VERIFY=1 ;;
    -h|--help) sed -n '1,25p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '\n\033[31mABORT:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "must run as root (sudo bash $0)"
id -u "$DEPLOY_USER" >/dev/null 2>&1 || fail "user '$DEPLOY_USER' does not exist"
[ -x "$APP_DIR/backup.sh" ] || fail "$APP_DIR/backup.sh missing or not executable — deploy once first, CI syncs it"
[ -f "$APP_DIR/.env" ] || fail "$APP_DIR/.env missing"

cat > /etc/systemd/system/operis-backup.service <<EOF
[Unit]
Description=Operis Postgres backup
# The backup shells into the running postgres container, so it is worthless
# before Docker is up and it must not race the daemon on boot.
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=$DEPLOY_USER
# Reaching the Docker socket needs the docker group. systemd normally derives
# supplementary groups from the user database, but stating it here means the
# unit keeps working if that ever changes.
SupplementaryGroups=docker
WorkingDirectory=$APP_DIR
ExecStart=/bin/bash $APP_DIR/backup.sh
# A stuck pg_dump must not hold the timer's slot forever.
TimeoutStartSec=1800

# Modest hardening. NOT ProtectSystem=strict or PrivateDevices — the unit has
# to write $APP_DIR/backups and talk to /var/run/docker.sock.
NoNewPrivileges=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target
EOF
ok "wrote /etc/systemd/system/operis-backup.service"

cat > /etc/systemd/system/operis-backup.timer <<EOF
[Unit]
Description=Nightly Operis Postgres backup

[Timer]
OnCalendar=$AT
# Spread the load: four other stacks share this host and several have their own
# nightly jobs.
RandomizedDelaySec=600
# Catch up after downtime rather than silently skipping a night.
Persistent=true

[Install]
WantedBy=timers.target
EOF
ok "wrote /etc/systemd/system/operis-backup.timer"

systemctl daemon-reload
systemctl enable --now operis-backup.timer
ok "timer enabled"

printf '\n'
systemctl list-timers operis-backup.timer --no-pager

if [ "$VERIFY" -eq 1 ]; then
  printf '\n--- running one backup now ---\n'
  systemctl start operis-backup.service
  systemctl status operis-backup.service --no-pager -n 20 || true
  printf '\n--- result ---\n'
  ls -lh "$APP_DIR/backups/" | tail -5
fi

cat <<EOF

Installed. Useful commands:

  systemctl list-timers operis-backup.timer     when it next runs
  systemctl start operis-backup.service         run a backup now
  journalctl -u operis-backup.service -n 50     what happened last time
  sudo -u $DEPLOY_USER $APP_DIR/backup.sh --list

REMINDER: these dumps live on the machine they protect. Losing the VPS loses
them. backup.sh ends with a worked rclone example for an off-site copy.
EOF
