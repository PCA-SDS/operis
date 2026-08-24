#!/usr/bin/env bash
# ==============================================================================
# Operis — Server Bootstrap (idempotent, DRY-RUN BY DEFAULT)
# ==============================================================================
# NOT USED BY THE CURRENT DEPLOYMENT. The production host (148.113.44.174)
# already runs four other stacks; it arrived with Docker installed, ufw
# configured and sshd hardened, and this script's `systemctl restart docker`
# would have bounced all 23 running containers at once. Operis was installed
# there with the targeted steps in README.md instead.
#
# Kept because it is the right first move on a FRESH single-purpose VPS.
# Run 00-audit-server.sh first, every time, and believe what it says.
# ==============================================================================
# Prepares a fresh Ubuntu 22.04/24.04 VPS to receive deploys:
#   deploy user + CI key -> SSH hardening -> firewall -> fail2ban ->
#   unattended security upgrades -> Docker CE -> log rotation -> swap ->
#   /opt/operis layout
#
# SAFETY MODEL
#   * Nothing happens without --apply. The default run only PRINTS the plan.
#   * Every step is idempotent: re-running changes nothing already correct.
#   * It refuses to run if something already listens on :80 or :443 (pass
#     --force to override once you have decided what to do about it).
#   * sshd changes go into a drop-in file, are validated with `sshd -t`, and
#     are applied with `reload` (never `restart`) so your current session
#     cannot be killed mid-change. The old config is backed up first.
#
# Usage (as root on the VPS):
#   bash 01-bootstrap-server.sh --ci-key "ssh-ed25519 AAAA... github-actions"
#   bash 01-bootstrap-server.sh --ci-key "ssh-ed25519 AAAA..." --apply
#
# Options:
#   --ci-key "<pubkey>"   public key GitHub Actions will authenticate with (required)
#   --apply               actually make changes (default: dry-run)
#   --ssh-port N          SSH port to keep open in the firewall (default: current sshd port)
#   --user NAME           deploy account name (default: deploy)
#   --no-swap             skip swapfile creation
#   --force               proceed even if :80/:443 are occupied
# ==============================================================================

set -Eeuo pipefail

APPLY=0
FORCE=0
MAKE_SWAP=1
CI_KEY=""
DEPLOY_USER="deploy"
SSH_PORT=""
APP_DIR="/opt/operis"

while [ $# -gt 0 ]; do
  case "$1" in
    --apply)     APPLY=1 ;;
    --force)     FORCE=1 ;;
    --no-swap)   MAKE_SWAP=0 ;;
    --ci-key)    CI_KEY="${2:-}"; shift ;;
    --user)      DEPLOY_USER="${2:-}"; shift ;;
    --ssh-port)  SSH_PORT="${2:-}"; shift ;;
    -h|--help)   sed -n '1,40p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; BLU=$'\033[34m'; OFF=$'\033[0m'
step() { printf '\n%s==>%s %s\n' "$BLU" "$OFF" "$1"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$OFF" "$1"; }
skip() { printf '  %s·%s %s\n' "$YLW" "$OFF" "$1"; }
warn() { printf '  %s!%s %s\n' "$YLW" "$OFF" "$1"; }
die()  { printf '\n%sABORT:%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

# run CMD... — executed only with --apply, echoed otherwise
run() {
  if [ "$APPLY" -eq 1 ]; then
    "$@"
  else
    printf '  %s[dry-run]%s %s\n' "$YLW" "$OFF" "$*"
  fi
}
# write_file PATH MODE  (content on stdin)
write_file() {
  local path="$1" mode="$2" content
  content="$(cat)"
  if [ -f "$path" ] && [ "$content" = "$(cat "$path" 2>/dev/null)" ]; then
    skip "$path already correct"
    return
  fi
  if [ "$APPLY" -eq 1 ]; then
    [ -f "$path" ] && cp -a "$path" "$path.bak.$(date +%s)"
    mkdir -p "$(dirname "$path")"
    printf '%s\n' "$content" > "$path"
    chmod "$mode" "$path"
    ok "wrote $path (mode $mode)"
  else
    printf '  %s[dry-run]%s write %s (mode %s):\n' "$YLW" "$OFF" "$path" "$mode"
    printf '%s\n' "$content" | sed 's/^/      | /'
  fi
}

# ------------------------------------------------------------------------------
# Preconditions
# ------------------------------------------------------------------------------
printf '%s' "$BLU"
cat <<'BANNER'
==============================================================================
 OPERIS SERVER BOOTSTRAP
==============================================================================
BANNER
printf '%s' "$OFF"

[ "$(id -u)" -eq 0 ] || die "must run as root (use: sudo bash $0 ...)"
[ -r /etc/os-release ] || die "cannot read /etc/os-release — is this Ubuntu?"
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || warn "expected Ubuntu, found '${ID:-unknown}' — proceeding, but verify each step"
case "${VERSION_ID:-}" in
  22.04|24.04|24.10|25.04|25.10|26.04) ok "Ubuntu $VERSION_ID" ;;
  *) warn "untested Ubuntu release '${VERSION_ID:-unknown}'" ;;
esac

# Docker CE is installed from download.docker.com, which publishes per Ubuntu
# codename. A release Docker has not built for yet would fail at apt-install
# time with a confusing 404, so check up front while we can still explain it.
if ! curl -fsI --max-time 15 "https://download.docker.com/linux/ubuntu/dists/${VERSION_CODENAME}/Release" >/dev/null 2>&1; then
  warn "Docker has no apt repository for '${VERSION_CODENAME}' yet.
       Step 7 will fail. Either wait for Docker to publish, or pin the previous
       LTS codename in the sources.list line in step 7."
fi

[ -n "$CI_KEY" ] || die "--ci-key is required. Generate one on your laptop with:
    ssh-keygen -t ed25519 -C 'github-actions@operis' -f ~/.ssh/operis_deploy -N ''
  then pass the PUBLIC half:  --ci-key \"\$(cat ~/.ssh/operis_deploy.pub)\""
case "$CI_KEY" in
  ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*\ *) : ;;
  *) die "--ci-key does not look like an SSH public key. Pass the .pub file contents, not the private key." ;;
esac

if [ -z "$SSH_PORT" ]; then
  # `|| true`: sshd may be absent (or refuse -T without a full config), and a
  # non-zero status here would abort the whole run under `set -e`.
  SSH_PORT="$( { sshd -T 2>/dev/null || true; } | awk '/^port /{print $2; exit}')"
  SSH_PORT="${SSH_PORT:-22}"
fi
ok "SSH port to keep open: $SSH_PORT"

# Port conflict check — the reverse proxy needs 80 and 443.
command -v ss >/dev/null 2>&1 || die "iproute2 is missing, so port occupancy cannot be checked.
  Install it first (apt-get install -y iproute2) — proceeding blind risks a
  reverse proxy that silently fails to bind."
for p in 80 443; do
  if ss -ltnH "sport = :$p" 2>/dev/null | grep -q .; then
    holder="$(ss -ltnpH "sport = :$p" 2>/dev/null | head -1)"
    if [ "$FORCE" -eq 1 ]; then
      warn "port $p is in use ($holder) — continuing because --force was given"
    else
      die "port $p is already in use:
    $holder
  A reverse proxy for Operis cannot bind it. Either stop/reconfigure that
  service, or put Operis BEHIND the existing one instead of running this
  script at all — that is what README.md describes."
    fi
  fi
done
ok "ports 80 and 443 are free"

if [ "$APPLY" -eq 0 ]; then
  printf '\n%sDRY RUN%s — nothing will be changed. Re-run with --apply to execute.\n' "$YLW" "$OFF"
fi

# ------------------------------------------------------------------------------
step "1/11  Base packages"
# ------------------------------------------------------------------------------
run apt-get update -qq
run env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  ca-certificates curl gnupg rsync ufw fail2ban unattended-upgrades \
  apt-listchanges jq git

# ------------------------------------------------------------------------------
step "2/11  Deploy user: $DEPLOY_USER"
# ------------------------------------------------------------------------------
if id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  skip "user $DEPLOY_USER already exists"
else
  run adduser --disabled-password --gecos "Operis deploy" "$DEPLOY_USER"
  [ "$APPLY" -eq 1 ] && ok "created $DEPLOY_USER (no password — key auth only)"
fi

HOME_DIR="/home/$DEPLOY_USER"
run install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"

AK="$HOME_DIR/.ssh/authorized_keys"
if [ -f "$AK" ] && grep -qF "$CI_KEY" "$AK" 2>/dev/null; then
  skip "CI key already authorized"
else
  if [ "$APPLY" -eq 1 ]; then
    touch "$AK"
    printf '%s\n' "$CI_KEY" >> "$AK"
    chown "$DEPLOY_USER:$DEPLOY_USER" "$AK"
    chmod 600 "$AK"
    ok "authorized CI key ($(printf '%s' "$CI_KEY" | ssh-keygen -lf /dev/stdin 2>/dev/null | awk '{print $2}'))"
  else
    printf '  %s[dry-run]%s append CI key to %s\n' "$YLW" "$OFF" "$AK"
  fi
fi

# ------------------------------------------------------------------------------
step "3/11  SSH hardening (drop-in, validated, reload-only)"
# ------------------------------------------------------------------------------
# Root login stays key-only rather than fully disabled: locking root out of a
# single-admin VPS before the deploy user is proven is how people lose servers.
# Tighten to `no` yourself once you have confirmed you can log in as $DEPLOY_USER.
write_file /etc/ssh/sshd_config.d/99-operis.conf 644 <<EOF
# Managed by deploy/01-bootstrap-server.sh — edit here, not in sshd_config.
Port $SSH_PORT
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF

if [ "$APPLY" -eq 1 ]; then
  if sshd -t; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd
    ok "sshd config valid, reloaded (existing sessions untouched)"
  else
    rm -f /etc/ssh/sshd_config.d/99-operis.conf
    die "sshd -t rejected the new config; it was removed and nothing was reloaded."
  fi
  warn "Before closing this session, open a SECOND terminal and verify:
       ssh -p $SSH_PORT $DEPLOY_USER@<server-ip> 'echo ok'"
fi

# ------------------------------------------------------------------------------
step "4/11  Firewall (ufw)"
# ------------------------------------------------------------------------------
run ufw --force default deny incoming
run ufw --force default allow outgoing
run ufw allow "$SSH_PORT"/tcp comment 'ssh'
run ufw allow 80/tcp   comment 'http (acme + redirect)'
run ufw allow 443/tcp  comment 'https'
run ufw --force enable
warn "Docker publishes ports by writing its own iptables rules, which BYPASS ufw.
       The production compose file publishes NO host ports at all: the app is
       reached over a shared Docker network by the gateway, and Postgres,
       Redis and Meilisearch only by the app."

# ------------------------------------------------------------------------------
step "5/11  fail2ban (SSH brute-force protection)"
# ------------------------------------------------------------------------------
write_file /etc/fail2ban/jail.d/operis.local 644 <<EOF
[sshd]
enabled  = true
port     = $SSH_PORT
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
run systemctl enable --now fail2ban

# ------------------------------------------------------------------------------
step "6/11  Automatic security updates"
# ------------------------------------------------------------------------------
write_file /etc/apt/apt.conf.d/20auto-upgrades 644 <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

# Security pocket only, and no unattended reboots: a reboot mid-deploy or during
# business hours is worse than a scheduled one you control.
write_file /etc/apt/apt.conf.d/52unattended-upgrades-operis 644 <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
EOF
warn "Automatic-Reboot is false. Check /var/run/reboot-required monthly and
       reboot during a window you choose."

# ------------------------------------------------------------------------------
step "7/11  Docker CE (official repository)"
# ------------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  skip "docker + compose plugin already installed ($(docker --version 2>/dev/null))"
else
  run install -m 0755 -d /etc/apt/keyrings
  if [ "$APPLY" -eq 1 ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
      "$(dpkg --print-architecture)" "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    ok "installed $(docker --version)"
  else
    printf '  %s[dry-run]%s add docker apt repo + install docker-ce, compose & buildx plugins\n' "$YLW" "$OFF"
  fi
fi

# docker group membership == root-equivalent access. That is the accepted
# tradeoff for a CI deploy account; it is why $DEPLOY_USER has no sudo rights.
if id -nG "$DEPLOY_USER" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
  skip "$DEPLOY_USER already in docker group"
else
  run usermod -aG docker "$DEPLOY_USER"
  warn "$DEPLOY_USER added to the docker group — that is effectively root on this
       host. Keep the account key-only and give it no sudo rights."
fi

# ------------------------------------------------------------------------------
step "8/11  Docker daemon: log rotation + live-restore"
# ------------------------------------------------------------------------------
# Without this, container stdout grows unbounded until the disk fills. It is the
# single most common way a small VPS dies.
write_file /etc/docker/daemon.json 644 <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true,
  "default-address-pools": [ { "base": "172.30.0.0/16", "size": 24 } ]
}
EOF
run systemctl enable docker
run systemctl restart docker

# ------------------------------------------------------------------------------
step "9/11  Swap + kernel tuning"
# ------------------------------------------------------------------------------
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
ok "detected ${MEM_MB} MB RAM"
if [ "$MEM_MB" -lt 4000 ]; then
  warn "Under 4 GB. Postgres + Redis + Meilisearch + Next.js will be tight.
       Trim the stack (drop Meilisearch) or resize the VPS to 8 GB."
fi
if [ "$MAKE_SWAP" -eq 1 ]; then
  if swapon --show 2>/dev/null | grep -q .; then
    skip "swap already active"
  elif [ "$MEM_MB" -lt 8000 ]; then
    if [ "$APPLY" -eq 1 ]; then
      fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
      chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
      grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
      ok "created 4G swapfile"
    else
      printf '  %s[dry-run]%s create 4G /swapfile and add to /etc/fstab\n' "$YLW" "$OFF"
    fi
  else
    skip "8 GB+ RAM — swapfile not needed"
  fi
fi

# vm.overcommit_memory=1 is Redis's documented requirement (background saves
# fail under the default heuristic). somaxconn raises the accept backlog.
write_file /etc/sysctl.d/99-operis.conf 644 <<'EOF'
vm.overcommit_memory = 1
vm.swappiness = 10
net.core.somaxconn = 1024
fs.file-max = 200000
EOF
run sysctl --system

# ------------------------------------------------------------------------------
step "10/11  Application directory: $APP_DIR"
# ------------------------------------------------------------------------------
run install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
run install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR/backups"
run install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR/logs"
ok "layout: $APP_DIR/{.env,docker-compose.yml,redis.conf,backups/,logs/}"

# ------------------------------------------------------------------------------
step "11/11  Nightly database backup timer"
# ------------------------------------------------------------------------------
write_file /etc/systemd/system/operis-backup.service 644 <<EOF
[Unit]
Description=Operis Postgres backup
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=$DEPLOY_USER
WorkingDirectory=$APP_DIR
ExecStart=/bin/bash $APP_DIR/backup.sh
EOF

write_file /etc/systemd/system/operis-backup.timer 644 <<'EOF'
[Unit]
Description=Nightly Operis Postgres backup

[Timer]
OnCalendar=*-*-* 03:17:00
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
EOF
run systemctl daemon-reload
run systemctl enable --now operis-backup.timer

# ------------------------------------------------------------------------------
printf '\n%s==============================================================================%s\n' "$GRN" "$OFF"
if [ "$APPLY" -eq 1 ]; then
  printf '%sBOOTSTRAP COMPLETE%s\n' "$GRN" "$OFF"
  cat <<EOF

Verify before you disconnect (from a SECOND terminal):
  ssh -p $SSH_PORT $DEPLOY_USER@<server-ip> 'docker ps && echo OK'

Next:
  1. Point DNS: A record for your domain -> this server's IPv4.
  2. Create the secrets file on the server:
       sudo -u $DEPLOY_USER nano $APP_DIR/.env
       sudo -u $DEPLOY_USER chmod 600 $APP_DIR/.env
     Use deploy/env.production.example as the template. Generate every secret
     with the openssl commands written next to it — do not invent them by hand.
  3. Log the server into GHCR once (read-only token):
       sudo -u $DEPLOY_USER docker login ghcr.io -u <github-user> --password-stdin
  4. Add the GitHub secrets listed in deploy/README.md.
  5. Run the workflow: Actions -> "Deploy to production" -> Run workflow.
EOF
else
  printf '%sDRY RUN FINISHED — nothing was changed.%s\n' "$YLW" "$OFF"
  printf 'Re-run with --apply once the plan above looks right.\n'
fi
printf '%s==============================================================================%s\n' "$GRN" "$OFF"
