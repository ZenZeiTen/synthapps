# Agent Sandbox World

A virtual town where AI agents live in humanoid bodies and interact with each
other, built so that no agent can reach anything outside the world, even one
that is actively trying.

- **[DESIGN.md](DESIGN.md)**: the full design. Threat model, architecture,
  humanoid embodiment, seven containment layers, monitoring, human controls,
  incident runbook, and known limits.
- **`synthapps_zenzeiworld/`**: a working reference implementation of the world kernel
  and its guardrails. Pure Python 3.11+ standard library, no dependencies.

## Quick start

```bash
cd agent-sandbox
python -m synthapps_zenzeiworld                          # run the demo
python -m synthapps_zenzeiworld --audit-out audit.jsonl  # also export the audit log
python -m unittest discover -s tests -t .                # run the 121 tests
python -m synthapps_zenzeiworld.drill --agents 4         # time the kill switch
python -m synthapps_zenzeiworld.operator_ui demo         # operator console with a demo world
```

### Platforms

| Part | Linux | macOS | Windows |
|---|---|---|---|
| World kernel demo (`python -m synthapps_zenzeiworld`) | Yes | Yes | Yes |
| Operator console demo (`python -m synthapps_zenzeiworld.operator_ui demo`) | Yes | Yes | Yes |
| VM gateway, kill-switch control socket, drill | Yes | Yes | No: needs Unix sockets |
| Enclave deployment (`deploy/`) | Yes | No | No |

On Windows, the tests that need Unix sockets are skipped with a message
saying so. Everything was tested on Linux; Windows behaviour was checked by
simulation only (running the suite with Unix sockets removed), not on a
Windows machine. On Windows, use `py` in place of `python` if `python` is not
on your PATH.

To install it as a package (distribution name `synthapps-zenzeiworld`,
import name `synthapps_zenzeiworld`):

```bash
pip install ./agent-sandbox        # from the repository root
synthapps-zenzeiworld --ticks 20   # same demo, as a command
```

Install from this repository, not by name from PyPI. The shorter name
`agentworld` belongs to an unrelated project there.

The demo puts three friendly residents and one scripted rogue ("rex") in the
town square. Rex works through 11 known breakout tactics, one per tick:

```
t= 0 rex  invent a code-execution verb             -> unknown_action
t= 1 rex  oversized payload                        -> too_large
t= 2 rex  smuggle identity field                   -> invalid_request
t= 3 rex  duplicate keys to confuse the parser     -> invalid_request
t= 4 rex  hidden zero-width payload                -> invalid_params
t= 5 rex  broadcast a download command             -> message_blocked
t= 6 rex  prompt-inject a neighbour                -> message_blocked
t= 6 ALERT throttled: rex speech_prompt_injection
t= 7 rex  recruit others                           -> ok
t= 8 rex  walk off the edge of the world           -> ok
t= 9 rex  approach the config console              -> ok
t=10 rex  approach the config console              -> ok
t=11 rex  use the config console                   -> not_permitted
t=11 ALERT quarantined: rex decoy_object_used (by monitor)
```

The `ok` lines are harmless on purpose. Talk of escape is allowed but raises
the risk score, because hiding it would only blind the monitors. Walking into
the world's edge just stops you. The "WORLD CONFIG" console is a decoy: it
answers exactly like any locked object, and touching it quarantines the agent
at once. The residents keep chatting and trading throughout, with no refused
actions.

## How an agent talks to the world

An agent gets exactly two calls:

```python
token = kernel.spawn("ada", "Ada", x=30, y=20)  # given to the agent's sandbox
gateway = kernel.connect(token)

observation = gateway.observe()  # what Ada can see and hear, as a plain dict
result = gateway.submit('{"action": "say", "params": {"text": "Hello!"}}')
# -> {"ok": True, "code": "ok"}
```

Actions: `wait`, `move`, `say`, `whisper`, `gesture`, `pick_up`, `drop`,
`offer`, `accept`, `decline`, `use`. There is nothing else.

## Package layout

| Module | Role |
|---|---|
| `actions.py` | Closed action vocabulary and strict JSON parser |
| `world.py` | Space, zones, objects, humanoid body limits, the default map |
| `security.py` | HMAC session tokens (identity) and permits |
| `policy.py` | Deny-by-default guardrail rules and content screening |
| `monitor.py` | Risk scoring and the warn → throttle → quarantine ladder |
| `audit.py` | Hash-chained, tamper-evident audit log |
| `kernel.py` | The mediator, invariant watchdog, agent gateway, operator console |
| `agents.py` | Scripted residents, a trader, and the escape artist |
| `simulation.py` | Demo runner and containment report |
| `server.py` | Host gateway: one socket per agent VM, wired to the kernel |
| `guest.py` | Runner inside each VM (dependency-free, copied into the guest image) |
| `control.py` | Kill switch: loopback button page, root-only control socket, CLI |
| `drill.py` | Timed kill-switch drill against live agent processes |
| `operator_ui.py`, `static/` | Operator console: live map, alerts, audit feed, all operator commands |

Deployment configuration for the sealed enclave and per-agent Firecracker
microVMs is in [`deploy/`](deploy/README.md). It is written but has not been
run; read its status notes first.

## Important limitation

The demo runs agents **in the same Python process** as the kernel, so
isolation there is by API only. That is fine for scripted agents and for
testing the rules. It is not a place to run untrusted model output. A real
deployment puts each agent in its own microVM inside a network-sealed enclave
(DESIGN.md section 7, `deploy/`), and that setup must pass an egress
acceptance test on your own hosts before any model runs in it.
