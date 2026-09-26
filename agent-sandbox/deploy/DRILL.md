# Kill-switch drill record

## Drill 1: software path, local harness (2026-09-26)

**Scope.** Only the software part of the kill switch. Each round runs the real
gateway, the real kill-switch button, and one real guest-runner process per
agent (the same `guest.py` that goes into the VM image). They talk over local
Unix sockets, and a local scripted "model" plays ordinary turns. After every
agent has played at least 3 turns, the drill presses the button over HTTP on
127.0.0.1.

**Not in scope.** Firecracker VMs, the enclave hosts, the cgroup kill in
`launch-agent-vm.sh stop`, and power-off. The build environment has no
`/dev/kvm`, so none of these could run. They need their own drill on the real
enclave (see "Still to drill" below).

**Environment.** A 4-CPU Linux virtual machine, Python 3.11.15, no network
use. Command:

```bash
python -m synthapps_zenzeiworld.drill --agents 4  --rounds 10
python -m synthapps_zenzeiworld.drill --agents 16 --rounds 5
```

### Results

All times are milliseconds from the moment the button was pressed.

| Measure | 4 agents, 10 rounds: median / max | 16 agents, 5 rounds: median / max |
|---|---|---|
| World halted | 1.02 / 1.23 | 1.05 / 1.16 |
| Every agent connection cut | 1.12 / 5.99 | 11.15 / 22.99 |
| Button page answered | 6.51 / 10.15 | 28.20 / 36.73 |
| Every agent process exited | 12.71 / 14.91 | 32.79 / 36.81 |

In every one of the 15 rounds:

- every agent connection was cut (120 of 120 across both runs)
- no action was accepted after the stop (0 in every round)
- reconnecting to any agent socket was refused
- the audit hash chain verified intact

### What the drill found, and what changed

1. **Agents lingered for about 200 ms after being cut off.** Between turns the
   guest runner slept for 0.2 s and only noticed the closed connection on its
   next check. **Fix:** while idle, the runner now waits on the socket itself,
   so a hang-up wakes it at once. Exit time fell from about 200 ms to about
   13 ms with 4 agents.
2. **Cutting 16 connections took about 34 ms.** Each cut wakes that agent's
   server thread, and the woken threads compete with the containment thread
   for Python's interpreter lock. **Fix:** containment now cuts every agent
   connection first, and only then closes the listening sockets. Median fell
   to about 11 ms. Cutting time still grows with the number of agents (about
   0.7 ms per agent here), which is acceptable at this scale. Re-measure before
   running hundreds of agents per gateway.

### Other kill paths, checked by tests rather than timed

| Path | Result | Test |
|---|---|---|
| CLI `control ... stop` against the running gateway process | Process halts, runs the stop command, writes the halt to the audit log, exits with code 2 | `GatewayProcessTests` |
| `SIGTERM` to the gateway process | Same containment as the button | `GatewayProcessTests` |
| Watchdog halt (corrupted world state) | Same containment, without anyone pressing anything | `test_watchdog_halt_also_cuts_agents_off` |
| Wrong token, unknown operator, foreign `Host` header | Refused, nothing stopped | `ButtonTests` |

## Still to drill (on the real enclave)

Record the same table for each, on the hosts built from `deploy/`:

1. Button press → every Firecracker process gone (the `on_halt_commands`
   running `launch-agent-vm.sh stop <id>`).
2. Gateway process killed outright (`SIGKILL`, so no containment code runs) →
   every guest runner exits on its own, and every VM stops.
3. Power-off of a VM host → the gateway notices, and the audit log shows it.
4. Time for an on-call operator to get from an alert to the button (the human
   part is usually the slowest).

Repeat monthly and after every change to the gateway, the guest image or the
launch script.
