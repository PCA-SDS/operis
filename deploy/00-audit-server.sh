#!/usr/bin/env bash
# ==============================================================================
# Operis — Server Audit (READ-ONLY)
# ==============================================================================
# Run this FIRST, before anything touches the server.
#
# It changes NOTHING: no packages installed, no files written outside the
# report, no services started or stopped, no `apt update`. Every command below
# is a query. Read the report, then decide.
#
# Usage (on the VPS, as root or via sudo):
#   sudo bash 00-audit-server.sh                 # print to stdout
#   sudo bash 00-audit-server.sh > audit.txt     # capture to a file
#
# Or without copying the file over, straight from your laptop:
#   ssh root@YOUR_SERVER 'bash -s' < deploy/00-audit-server.sh | tee audit.txt
#
# Secrets are never printed: SSH keys are shown as fingerprints only and
# environment files are listed by name/permission, never by content.
# ==============================================================================

set -uo pipefail

have() { command -v "$1" >/dev/null 2>&1; }
sec()  { printf '\n\n=== %s %s\n' "$1" "$(printf '=%.0s' $(seq 1 $((66 - ${#1}))))"; }
sub()  { printf '\n--- %s ---\n' "$1"; }
none() { printf '(not installed / not present)\n'; }

printf '==============================================================================\n'
printf 'OPERIS SERVER AUDIT (read-only)\n'
printf 'generated: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
printf 'run as   : %s\n' "$(id -un)"
printf '==============================================================================\n'

[ "$(id -u)" -ne 0 ] && printf '\n!! Running unprivileged — process names, firewall rules and some paths will be\n!! hidden. Re-run with sudo for the full picture.\n'

# ------------------------------------------------------------------------------
sec "1. IDENTITY & OS"
# ------------------------------------------------------------------------------
sub "release"
if [ -r /etc/os-release ]; then grep -E '^(PRETTY_NAME|VERSION_ID|ID)=' /etc/os-release; else none; fi
printf 'kernel   : %s\n' "$(uname -sr)"
printf 'arch     : %s\n' "$(uname -m)"
printf 'hostname : %s\n' "$(hostname -f 2>/dev/null || hostname)"
printf 'uptime   : %s\n' "$(uptime -p 2>/dev/null || uptime)"
printf 'timezone : %s\n' "$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo unknown)"

sub "virtualization / cloud"
have systemd-detect-virt && printf 'virt: %s\n' "$(systemd-detect-virt 2>/dev/null || echo none)"
[ -r /sys/class/dmi/id/product_name ] && printf 'product: %s\n' "$(cat /sys/class/dmi/id/product_name)"
[ -r /sys/class/dmi/id/sys_vendor ]   && printf 'vendor : %s\n' "$(cat /sys/class/dmi/id/sys_vendor)"

sub "reboot required?"
if [ -f /var/run/reboot-required ]; then
  cat /var/run/reboot-required
  [ -f /var/run/reboot-required.pkgs ] && { echo "packages:"; cat /var/run/reboot-required.pkgs; }
else
  echo "no"
fi

# ------------------------------------------------------------------------------
sec "2. RESOURCES  (Operis needs >= 4 GB RAM, 8 GB recommended; >= 40 GB disk)"
# ------------------------------------------------------------------------------
sub "cpu"
if have lscpu; then lscpu | grep -E '^(Model name|CPU\(s\)|Thread|Core|Socket|Vendor)' ; else grep -c ^processor /proc/cpuinfo; fi

sub "memory"
free -h 2>/dev/null || cat /proc/meminfo | head -5

sub "swap"
swapon --show 2>/dev/null || echo "(no swap configured)"
printf 'vm.swappiness = %s\n' "$(sysctl -n vm.swappiness 2>/dev/null || echo '?')"

sub "disk"
df -hT -x tmpfs -x devtmpfs 2>/dev/null

sub "largest consumers of /"
du -xhd1 / 2>/dev/null | sort -rh | head -12

sub "load"
cat /proc/loadavg

# ------------------------------------------------------------------------------
sec "3. NETWORK & OPEN PORTS  (deploy needs 80 + 443 free, and your SSH port)"
# ------------------------------------------------------------------------------
sub "interfaces"
ip -brief addr 2>/dev/null || ifconfig 2>/dev/null || none

sub "public IPv4 (outbound check — this is the only network call in this script)"
curl -s --max-time 5 https://api.ipify.org 2>/dev/null || echo "(no outbound HTTPS or curl missing)"
printf '\n'

sub "LISTENING SOCKETS — anything on :80 or :443 blocks the reverse proxy"
if have ss; then ss -tulpnH 2>/dev/null | sort -k5 || ss -tulpn; else netstat -tulpn 2>/dev/null || none; fi

sub "is :80 / :443 / :22 taken?"
if have ss; then
  for p in 22 80 443 3000 5432 6379 7700; do
    if ss -ltnH "sport = :$p" 2>/dev/null | grep -q .; then
      printf 'port %-5s IN USE  -> %s\n' "$p" "$(ss -ltnpH "sport = :$p" 2>/dev/null | head -1)"
    else
      printf 'port %-5s free\n' "$p"
    fi
  done
else
  printf '!! `ss` is unavailable (iproute2 not installed) — port occupancy is UNKNOWN,\n'
  printf '!! not free. Install iproute2 or check with: lsof -i -P -n | grep LISTEN\n'
fi

sub "dns resolvers"
have resolvectl && resolvectl status 2>/dev/null | grep -E 'DNS Servers|Current DNS' | head -5
[ -r /etc/resolv.conf ] && grep -E '^nameserver' /etc/resolv.conf

# ------------------------------------------------------------------------------
sec "4. FIREWALL"
# ------------------------------------------------------------------------------
sub "ufw"
if have ufw; then ufw status verbose 2>/dev/null; else none; fi

sub "nftables ruleset (summary)"
if have nft; then nft list ruleset 2>/dev/null | head -60; else none; fi

sub "iptables filter chains"
if have iptables; then iptables -S 2>/dev/null | head -40; else none; fi

sub "iptables DOCKER chains (present => docker manages its own rules)"
have iptables && iptables -S 2>/dev/null | grep -i docker | head -20

printf '\nNOTE: OVHcloud also has a network-level firewall in the control panel,\n'
printf '      independent of anything above. Check it there if ports look open\n'
printf '      here but are unreachable from outside.\n'

# ------------------------------------------------------------------------------
sec "5. SSH CONFIGURATION  (the CI pipeline connects over SSH)"
# ------------------------------------------------------------------------------
sub "effective sshd settings"
if have sshd; then
  sshd -T 2>/dev/null | grep -Ei '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|permitemptypasswords|challengeresponseauthentication|kbdinteractiveauthentication|allowusers|allowgroups|maxauthtries|x11forwarding)' | sort
else
  grep -Ev '^\s*#|^\s*$' /etc/ssh/sshd_config 2>/dev/null | head -40 || none
fi

sub "sshd drop-in config files"
ls -la /etc/ssh/sshd_config.d/ 2>/dev/null || echo "(no drop-in directory)"

sub "host key fingerprints — you will pin one of these in GitHub secrets"
for k in /etc/ssh/ssh_host_*_key.pub; do
  [ -r "$k" ] && ssh-keygen -lf "$k" 2>/dev/null
done

sub "known_hosts line for GitHub Actions (copy this into the SSH_KNOWN_HOSTS secret)"
if have ssh-keyscan; then
  ssh-keyscan -t ed25519 -p "${SSH_PORT:-22}" "$(hostname -I 2>/dev/null | awk '{print $1}')" 2>/dev/null || echo "(run ssh-keyscan from your laptop instead)"
else
  none
fi

# ------------------------------------------------------------------------------
sec "6. USERS, SUDO & AUTHORIZED KEYS  (fingerprints only — no key material)"
# ------------------------------------------------------------------------------
sub "human/service accounts (uid >= 1000, plus root)"
awk -F: '($3 >= 1000 && $3 < 65534) || $3 == 0 { printf "%-18s uid=%-6s shell=%-18s home=%s\n", $1, $3, $7, $6 }' /etc/passwd

sub "sudo group members"
getent group sudo 2>/dev/null || echo "(no sudo group)"
getent group docker 2>/dev/null || echo "(no docker group)"

sub "sudoers drop-ins"
ls -la /etc/sudoers.d/ 2>/dev/null || none

sub "authorized_keys per account (fingerprints only)"
while IFS=: read -r user _ uid _ _ home _; do
  if { [ "$uid" -ge 1000 ] && [ "$uid" -lt 65534 ]; } || [ "$uid" -eq 0 ]; then
    ak="$home/.ssh/authorized_keys"
    if [ -r "$ak" ]; then
      printf '%s:\n' "$user"
      ssh-keygen -lf "$ak" 2>/dev/null | sed 's/^/    /' || printf '    (unreadable)\n'
      printf '    perms: %s\n' "$(stat -c '%a %U:%G' "$ak" 2>/dev/null)"
    fi
  fi
done < /etc/passwd

sub "recent logins"
last -n 15 2>/dev/null | head -18 || none

sub "failed SSH auth in the last day (brute-force signal)"
journalctl -u ssh -u sshd --since "1 day ago" 2>/dev/null | grep -ci 'Failed password\|Invalid user' || echo "(journal unavailable)"

# ------------------------------------------------------------------------------
sec "7. WHAT IS ALREADY RUNNING  (do not clobber any of this)"
# ------------------------------------------------------------------------------
sub "enabled systemd services"
systemctl list-unit-files --type=service --state=enabled --no-pager 2>/dev/null | head -50 || none

sub "FAILED units"
systemctl --failed --no-pager 2>/dev/null || none

sub "web servers / databases / runtimes present"
for b in nginx apache2 httpd caddy traefik haproxy docker podman containerd \
         postgres psql mysql mariadb redis-server redis-cli node npm yarn \
         git rsync curl wget certbot fail2ban-client ufw snap; do
  if have "$b"; then
    printf '%-16s %s\n' "$b" "$(command -v "$b")"
  fi
done

sub "top processes by memory"
ps -eo pid,user,%mem,%cpu,rss,comm --sort=-rss 2>/dev/null | head -12

# ------------------------------------------------------------------------------
sec "8. DOCKER  (the deploy target)"
# ------------------------------------------------------------------------------
if have docker; then
  sub "versions"
  docker version --format 'client: {{.Client.Version}}' 2>/dev/null
  docker version --format 'server: {{.Server.Version}}' 2>/dev/null || echo "server: (daemon not reachable by this user)"
  docker compose version 2>/dev/null || echo "compose plugin: MISSING (docker-compose v1 is not enough)"

  sub "daemon config /etc/docker/daemon.json"
  [ -r /etc/docker/daemon.json ] && cat /etc/docker/daemon.json || echo "(none — log rotation is therefore OFF by default)"

  sub "containers"
  docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || echo "(cannot query)"

  sub "images"
  docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}' 2>/dev/null | head -20

  sub "volumes (DATA LIVES HERE — never prune blindly)"
  docker volume ls 2>/dev/null

  sub "networks"
  docker network ls 2>/dev/null

  sub "disk usage"
  docker system df 2>/dev/null

  sub "registry logins configured"
  for f in /root/.docker/config.json "$HOME/.docker/config.json"; do
    [ -r "$f" ] && { printf '%s -> ' "$f"; grep -o '"[a-z0-9.]*\.io"\|"https://[^"]*"' "$f" 2>/dev/null | tr '\n' ' '; printf '\n'; }
  done
else
  none
  printf 'Docker is not installed. 01-bootstrap-server.sh installs Docker CE from\n'
  printf 'the official Docker apt repository.\n'
fi

# ------------------------------------------------------------------------------
sec "9. EXISTING APP / DATA DIRECTORIES"
# ------------------------------------------------------------------------------
for d in /opt /srv /var/www /home /data; do
  printf '\n%s:\n' "$d"
  ls -la "$d" 2>/dev/null | head -15 || echo "  (missing)"
done

sub "any .env files already on the box (names + perms only, never contents)"
find /opt /srv /home /var/www -maxdepth 4 -name '.env*' -type f 2>/dev/null \
  | head -20 | while read -r f; do printf '%-60s %s\n' "$f" "$(stat -c '%a %U:%G' "$f" 2>/dev/null)"; done

sub "docker-compose files already on the box"
find /opt /srv /home /root -maxdepth 4 -name 'docker-compose*.y*ml' -o -maxdepth 4 -name 'compose.y*ml' 2>/dev/null | head -20

# ------------------------------------------------------------------------------
sec "10. SCHEDULED WORK"
# ------------------------------------------------------------------------------
sub "systemd timers"
systemctl list-timers --all --no-pager 2>/dev/null | head -20 || none

sub "root crontab"
crontab -l 2>/dev/null || echo "(empty)"

sub "/etc/cron.d"
ls -la /etc/cron.d/ 2>/dev/null || none

# ------------------------------------------------------------------------------
sec "11. PATCHING & HARDENING POSTURE"
# ------------------------------------------------------------------------------
sub "unattended-upgrades"
if [ -r /etc/apt/apt.conf.d/20auto-upgrades ]; then cat /etc/apt/apt.conf.d/20auto-upgrades; else echo "(not configured — security patches are NOT automatic)"; fi

sub "packages with pending upgrades (read-only; no apt update is run)"
if have apt; then apt list --upgradable 2>/dev/null | tail -n +2 | head -25; printf '... total: %s\n' "$(apt list --upgradable 2>/dev/null | tail -n +2 | wc -l)"; else none; fi

sub "fail2ban"
if have fail2ban-client; then fail2ban-client status 2>/dev/null || echo "(installed, not running)"; else none; fi

sub "apparmor"
have aa-status && aa-status --enabled 2>/dev/null && echo "apparmor: enabled" || echo "apparmor: not enabled/installed"

sub "journald disk usage"
journalctl --disk-usage 2>/dev/null || none

printf '\n\n==============================================================================\n'
printf 'END OF AUDIT — nothing on this server was modified.\n'
printf '==============================================================================\n'
printf '\nSend this report back before running 01-bootstrap-server.sh. The things that\n'
printf 'decide the plan:\n'
printf '  * RAM and disk (section 2)\n'
printf '  * whether :80/:443 are already taken (section 3)\n'
printf '  * whether Docker is present and what it is already running (section 8)\n'
printf '  * whether anything of value already lives in /opt or /var/www (section 9)\n'
