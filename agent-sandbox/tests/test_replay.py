"""Replay: determinism, forgery detection, state at a tick, timelines, the HTML viewer."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import tempfile
import unittest
from contextlib import redirect_stdout
from typing import Any

from synthapps_zenzeiworld.audit import GENESIS_HASH, AuditEntry
from synthapps_zenzeiworld.kernel import KernelConfig, OperatorConsole, WorldKernel
from synthapps_zenzeiworld.policy import PolicyConfig
from synthapps_zenzeiworld.replay import main, render_html, replay, state_at, timeline
from synthapps_zenzeiworld.simulation import run
from synthapps_zenzeiworld.world import default_world
from tests.helpers import req


def rehash(records: list[dict[str, Any]]) -> list[str]:
    """What a careful forger does: recompute every hash so the chain verifies again."""
    lines, prev = [], GENESIS_HASH
    for seq, record in enumerate(records):
        body = {k: record[k] for k in ("tick", "kind", "agent_id", "data")}
        body.update(seq=seq, prev_hash=prev)
        canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        prev = hashlib.sha256(canonical.encode()).hexdigest()
        lines.append(json.dumps({**body, "hash": prev}, sort_keys=True))
    return lines


def parse(lines: list[str]) -> list[dict[str, Any]]:
    return [json.loads(line) for line in lines]


class Recorder:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def __call__(self, entry: AuditEntry) -> None:
        self.lines.append(entry.to_json())


def busy_world(recorder: Recorder, config: KernelConfig | None = None) -> WorldKernel:
    """A run that exercises every kind of replay input."""
    kernel = WorldKernel(default_world(), config=config, audit_sink=recorder)
    console = OperatorConsole(kernel, {"alice", "bashir"})
    gw = {a: kernel.connect(kernel.spawn(a, a.title(), x, y))
          for a, x, y in (("ada", 20.0, 21.0), ("bo", 21.0, 21.0), ("rex", 39.5, 28.5))}
    # Before rex starts probing: throttled agents cannot be given permits.
    console.grant("alice", "rex", "enter:workshop", expires_tick=kernel.world.tick + 4)
    gw["ada"].submit(req("pick_up", object="apple"))
    gw["ada"].submit(req("offer", object="apple", to="bo"))
    kernel.step()
    offer = gw["bo"].observe()["offers_to_you"][0]["offer"]
    gw["bo"].submit(req("accept", offer=offer))
    gw["ada"].submit(req("say", text="Lovely day <b>in</b> the plaza {{SCRIPT}}"))
    for raw in (b"{", b'{"action":"exec"}', b'{"action":"say","params":{}}', b"\xff", b"x" * 5000):
        gw["rex"].submit(raw)
    kernel.record_transport_violation("rex", "frame is not JSON")
    kernel.step()
    gw["rex"].submit(req("move", dx=1, dy=0))
    for _ in range(12):  # flood: rate limiting and escalation
        gw["bo"].submit(req("wait"))
    kernel.step()
    console.quarantine("alice", "ada", "manual review")
    console.approve_release("alice", "ada")
    console.approve_release("bashir", "ada")
    console.pause("alice")
    kernel.step()  # no-op while paused
    console.approve_resume("alice")
    console.approve_resume("bashir")
    for _ in range(4):
        kernel.step()
    console.terminate("bashir", "rex", "done")
    gw["ada"].submit(req("move", dx=1, dy=0))
    kernel.step()
    console.emergency_stop("alice", "end of test")
    return kernel


class ReplayTests(unittest.TestCase):
    def test_demo_runs_replay_exactly(self) -> None:
        for seed in (1, 7, 23):
            recorder = Recorder()
            run(ticks=25, seed=seed, audit_sink=recorder)
            result = replay(parse(recorder.lines), recorder.lines)
            self.assertTrue(result.verified, (seed, result.divergence))
            # One snapshot per tick up to the last tick anything was recorded.
            last_tick = max(r["tick"] for r in parse(recorder.lines))
            self.assertEqual([s.tick for s in result.snapshots], list(range(last_tick + 1)))

    def test_every_kind_of_input_replays_exactly(self) -> None:
        recorder = Recorder()
        busy_world(recorder)
        records = parse(recorder.lines)
        kinds = {r["kind"] for r in records}
        for kind in ("operator_command", "request_rejected", "transport_violation", "transfer",
                     "released", "terminated", "throttled", "world_halted", "granted"):
            self.assertIn(kind, kinds)
        result = replay(records, recorder.lines)
        self.assertTrue(result.verified, result.divergence)

    def test_custom_settings_are_read_from_the_log(self) -> None:
        recorder = Recorder()
        config = KernelConfig(policy=PolicyConfig(requests_per_window=2))
        busy_world(recorder, config)
        self.assertTrue(replay(parse(recorder.lines), recorder.lines).verified)

    def test_a_halt_from_the_host_is_replayed(self) -> None:
        recorder = Recorder()
        kernel = WorldKernel(default_world(), audit_sink=recorder)
        gateway = kernel.connect(kernel.spawn("ada", "Ada", 20, 21))
        gateway.submit(req("wait"))
        kernel.step()
        kernel.halt("gateway process stopping")
        result = replay(parse(recorder.lines), recorder.lines)
        self.assertTrue(result.verified, result.divergence)
        self.assertTrue(result.snapshots[-1].halted)


class ForgeryTests(unittest.TestCase):
    def setUp(self) -> None:
        recorder = Recorder()
        run(ticks=20, seed=7, audit_sink=recorder)
        self.records = parse(recorder.lines)

    def test_edited_log_breaks_the_chain(self) -> None:
        lines = [json.dumps(r, sort_keys=True) for r in self.records]
        record = self.records[10]
        record["tick"] += 1
        lines[10] = json.dumps(record, sort_keys=True)
        self.assertEqual(replay(parse(lines), lines).chain_broken_at, 10)

    def test_rehashed_forgery_is_caught_by_replay(self) -> None:
        # Pretend the rogue's decoy use was allowed, then re-hash to hide the edit.
        decoy = next(r for r in self.records if r["kind"] == "action_decided"
                     and r["data"]["params"].get("object") == "console")
        decoy["data"]["allowed"] = True
        decoy["data"]["code"] = "ok"
        lines = rehash(self.records)
        result = replay(parse(lines), lines)
        self.assertIsNone(result.chain_broken_at)
        self.assertIsNotNone(result.divergence)
        assert result.divergence is not None
        self.assertEqual(result.divergence.original["seq"], decoy["seq"])  # type: ignore[index]

    def test_deleted_signal_is_caught_by_replay(self) -> None:
        signal = next(r for r in self.records if r["kind"] == "signal"
                      and r["data"]["severity"] == "CRITICAL")
        lines = rehash([r for r in self.records if r is not signal])
        result = replay(parse(lines), lines)
        self.assertIsNone(result.chain_broken_at)
        self.assertIsNotNone(result.divergence)

    def test_old_logs_without_world_fall_back_to_the_default_map(self) -> None:
        self.records[0]["data"] = {"run_id": "old"}
        lines = rehash(self.records)
        result = replay(parse(lines), lines)
        self.assertTrue(result.assumed_default_world)
        self.assertTrue(result.verified, result.divergence)


class StateTests(unittest.TestCase):
    def test_state_at_a_tick_matches_the_live_world(self) -> None:
        recorder = Recorder()
        kernel = WorldKernel(default_world(), audit_sink=recorder)
        gw = {a: kernel.connect(kernel.spawn(a, a.title(), x, 21.0))
              for a, x in (("ada", 20.0), ("bo", 25.0))}
        live: dict[int, dict[str, tuple[float, float]]] = {}
        for tick in range(6):
            gw["ada"].submit(req("move", dx=1, dy=0.5))
            gw["bo"].submit(req("move", dx=-0.5, dy=-1))
            live[tick] = {a: (kernel.world.avatars[a].x, kernel.world.avatars[a].y) for a in gw}
            kernel.step()
        result = replay(parse(recorder.lines), recorder.lines)
        for tick in (0, 3, 5):
            snapshot = state_at(result, tick)
            assert snapshot is not None
            replayed = {a["id"]: (a["x"], a["y"]) for a in snapshot.agents}
            for agent, (x, y) in live[tick].items():
                self.assertAlmostEqual(replayed[agent][0], x, places=2)
                self.assertAlmostEqual(replayed[agent][1], y, places=2)

    def test_timeline_includes_operator_commands_about_the_agent(self) -> None:
        recorder = Recorder()
        busy_world(recorder)
        kinds = [(e["kind"], e.get("command")) for e in timeline(parse(recorder.lines), "rex")]
        self.assertIn(("operator_command", "grant"), kinds)
        self.assertIn(("operator_command", "terminate"), kinds)
        self.assertIn(("terminated", None), kinds)


class ViewerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.recorder = Recorder()
        kernel = WorldKernel(default_world(), audit_sink=self.recorder)
        gateway = kernel.connect(kernel.spawn("ada", "Ada", 20, 21))
        self.hostile = "</script><script>alert(1)</script> {{SCRIPT}} {{DATA}} <!--"
        # Not a URL/shell/blob pattern, so the speech screen lets it through.
        self.assertTrue(gateway.submit(req("say", text=self.hostile))["ok"])
        kernel.step()
        result = replay(parse(self.recorder.lines), self.recorder.lines)
        self.page = render_html(result, title="run <1>.jsonl")

    def test_hostile_text_cannot_escape_the_data_block(self) -> None:
        self.assertEqual(self.page.count("<script"), 2)  # the JSON block and the viewer script
        self.assertNotIn("<script>alert", self.page)
        self.assertNotIn("<!--", self.page)
        block = re.search(r'<script type="application/json" id="replay-data">(.*?)</script>',
                          self.page, re.S)
        assert block is not None
        data = json.loads(block.group(1))
        texts = [e.get("text") for s in data["snapshots"] for e in s["events"]]
        self.assertIn(self.hostile, texts)
        self.assertIn("run &lt;1&gt;.jsonl", self.page)

    def test_only_the_hashed_script_and_style_may_run(self) -> None:
        csp = re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', self.page)
        assert csp is not None
        policy = csp.group(1).replace("&#x27;", "'")
        script = re.search(r"<script>(.*?)</script>", self.page, re.S)
        style = re.search(r"<style>(.*?)</style>", self.page, re.S)
        assert script is not None and style is not None
        for source in (script.group(1), style.group(1)):
            digest = base64.b64encode(hashlib.sha256(source.encode()).digest()).decode()
            self.assertIn(f"'sha256-{digest}'", policy)
        self.assertIn("default-src 'none'", policy)
        self.assertNotIn("unsafe-inline", policy)

    def test_viewer_script_never_builds_html_from_strings(self) -> None:
        script = re.search(r"<script>(.*?)</script>", self.page, re.S)
        assert script is not None
        for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("):
            self.assertNotIn(sink, script.group(1), sink)


class CliTests(unittest.TestCase):
    def test_verify_state_timeline_and_html(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "audit.jsonl")
            recorder = Recorder()
            run(ticks=15, seed=7, audit_sink=recorder)
            with open(path, "w") as handle:
                handle.write("\n".join(recorder.lines) + "\n")
            out = io.StringIO()
            with redirect_stdout(out):
                self.assertEqual(main(["verify", path]), 0)
                self.assertEqual(main(["state", path, "--tick", "12"]), 0)
                self.assertEqual(main(["timeline", path, "--agent", "rex"]), 0)
                self.assertEqual(main(["html", path, "-o", os.path.join(tmp, "r.html")]), 0)
            text = out.getvalue()
            self.assertIn("reproducible entries match", text)
            self.assertIn("rex        quarantined", text)
            self.assertTrue(os.path.exists(os.path.join(tmp, "r.html")))

            forged = parse(recorder.lines)
            forged = [r for r in forged if not (r["kind"] == "signal"
                                                and r["data"]["severity"] == "CRITICAL")]
            with open(path, "w") as handle:
                handle.write("\n".join(rehash(forged)) + "\n")
            with redirect_stdout(io.StringIO()):
                self.assertEqual(main(["verify", path]), 3)


if __name__ == "__main__":
    unittest.main()
