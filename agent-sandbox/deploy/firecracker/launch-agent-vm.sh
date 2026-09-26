#!/usr/bin/env bash
# Prepare, start and stop one jailed Firecracker microVM for one agent.
#
#   launch-agent-vm.sh prepare <agent_id> <uid>   # build the jail directory
#   launch-agent-vm.sh start   <agent_id> <uid>   # boot the VM (gateway must already listen)
#   launch-agent-vm.sh stop    <agent_id>         # kill everything in the VM's cgroup
#
# Order of operations for a world:
#   1. prepare every agent
#   2. start the host gateway (python -m synthapps_zenzeiworld.server gateway.json ...)
#      so each <jail>/v.sock_5000 exists before its VM boots
#   3. start every agent
#
# UNTESTED in this repository (the build machine has no /dev/kvm).
# Check the jailer flags against your Firecracker release before first use.
set -euo pipefail

FC_BIN=${FC_BIN:-/usr/local/bin/firecracker}
JAILER_BIN=${JAILER_BIN:-/usr/local/bin/jailer}
ASSETS=${ASSETS:-/srv/zw/assets}          # vmlinux, rootfs.ext4, vm-config.json
CHROOT_BASE=${CHROOT_BASE:-/srv/jailer}
EMPTY_NETNS=${EMPTY_NETNS:-zw-empty}      # a network namespace with nothing in it

usage() { sed -n '2,6p' "$0" >&2; exit 64; }

[[ $# -ge 2 ]] || usage
cmd=$1 id=$2
[[ $id =~ ^[a-z0-9][a-z0-9_-]{0,31}$ ]] || { echo "bad agent id: $id" >&2; exit 64; }
jail="$CHROOT_BASE/$(basename "$FC_BIN")/$id/root"

case "$cmd" in
  prepare)
    [[ $# -eq 3 ]] || usage
    uid=$3
    # Every VM gets its own uid, so one compromised VMM cannot touch another's files.
    [[ $uid =~ ^[0-9]+$ && $uid -ge 10000 ]] || { echo "uid must be >= 10000" >&2; exit 64; }

    # The Firecracker process itself runs in an empty network namespace:
    # even a compromised VMM has no interface to send packets from.
    if ! ip netns list | grep -qx "$EMPTY_NETNS\( .*\)\?"; then
      ip netns add "$EMPTY_NETNS"
    fi

    install -d -m 0750 -o "$uid" -g "$uid" "$jail"
    for f in vmlinux rootfs.ext4 vm-config.json; do
      # Copy, not hard-link: chown on a hard link would change the shared original.
      install -m 0400 -o "$uid" -g "$uid" "$ASSETS/$f" "$jail/$f"
    done
    echo "prepared $jail"
    ;;

  start)
    [[ $# -eq 3 ]] || usage
    uid=$3
    [[ -S "$jail/v.sock_5000" ]] || { echo "gateway socket missing: start the gateway first" >&2; exit 1; }
    "$JAILER_BIN" \
      --id "$id" \
      --exec-file "$FC_BIN" \
      --uid "$uid" --gid "$uid" \
      --chroot-base-dir "$CHROOT_BASE" \
      --netns "/var/run/netns/$EMPTY_NETNS" \
      --new-pid-ns \
      --cgroup-version 2 \
      --cgroup "cpu.max=50000 100000" \
      --cgroup "memory.max=640M" \
      --cgroup "pids.max=64" \
      --resource-limit "no-file=64" \
      --daemonize \
      -- \
      --config-file vm-config.json \
      --no-api
    echo "started $id"
    ;;

  stop)
    # cgroup v2 "kill" ends every process in the VM's cgroup at once (Linux 5.14+).
    cg="/sys/fs/cgroup/$(basename "$FC_BIN")/$id"
    if [[ -e "$cg/cgroup.kill" ]]; then
      echo 1 > "$cg/cgroup.kill"
      echo "stopped $id"
    else
      echo "no cgroup for $id (already stopped?)" >&2
    fi
    ;;

  *) usage ;;
esac
