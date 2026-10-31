import contextlib
import io
import os
import tempfile
import tomllib
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from synthapps_gamepilot import recognize, window
from synthapps_gamepilot.imaging import Frame
from synthapps_gamepilot.profile import from_dict
from synthapps_gamepilot.recognize import identify, profile_text
from synthapps_gamepilot.window import Rect, WindowInfo, candidate_windows

from .helpers import FakeClient, response, tool_use

GAME = WindowInfo(101, "Stardew Valley", "Stardew Valley.exe", Rect(0, 0, 1280, 720), 4242)
BROWSER = WindowInfo(102, "Stardew Valley wiki - Google Chrome", "chrome.exe", Rect(0, 0, 1600, 900), 11)
TERMINAL = WindowInfo(103, "Windows PowerShell", "WindowsTerminal.exe", Rect(0, 0, 900, 500), 12)
STEAM = WindowInfo(104, "Steam", "steamwebhelper.exe", Rect(0, 0, 1200, 800), 13)
TINY = WindowInfo(105, "Volume", "SndVol.exe", Rect(0, 0, 200, 120), 14)
EMU = WindowInfo("0x3a00007", "RetroArch Snes9x 1.62", "retroarch", Rect(0, 0, 1024, 896), 15)
FRAME = Frame(4, 3, bytes(36))


def answer(**over):
    data = {
        "game_window": 0, "game": "Stardew Valley", "confidence": "high", "emulator": "",
        "title_contains": "Stardew", "device": "gamepad", "pacing": "waits", "pause_input": "",
        "bindings": {"Use Tool": "X", "check / talk": "A", "menu": "B", "move_up": "LS_UP", "fly": "JETPACK"},
        "notes": "Farming game; days pass in real time while outside menus.",
        "goal": "Clear the starting farm plot.", "reasoning": "Title screen logo.",
    }
    data.update(over)
    return data


class CandidateTest(unittest.TestCase):
    def test_filters_non_games(self):
        mine = WindowInfo(106, "gamepilot", "py.exe", Rect(0, 0, 800, 600), os.getpid())
        got = candidate_windows([GAME, BROWSER, TERMINAL, STEAM, TINY, EMU, mine])
        self.assertEqual(got, [GAME, EMU])


class IdentifyTest(unittest.TestCase):
    def test_request_and_validation(self):
        client = FakeClient([response([tool_use("t1", answer(), name="identify_game")])])
        r = identify(client, [GAME, EMU], [FRAME, None], goal_hint="get rich", log=lambda m: None)
        req = client.requests[0]
        self.assertEqual(req["tool_choice"], {"type": "auto"})
        self.assertEqual(req["extra_body"]["fallbacks"], "default")
        kinds = [b["type"] for b in req["messages"][0]["content"]]
        self.assertEqual(kinds, ["text", "image", "text", "text"])
        self.assertIn("could not be photographed", req["messages"][0]["content"][2]["text"])
        self.assertIn("get rich", req["messages"][0]["content"][-1]["text"])
        self.assertIn("KEY_SPACE", req["system"][0]["text"])

        self.assertEqual(r.window, GAME)
        self.assertEqual(r.title_contains, "Stardew")
        self.assertEqual(r.bindings, {"use_tool": "X", "check_talk": "A", "menu": "B", "move_up": "LS_UP"})
        self.assertEqual(len(r.dropped), 1)
        self.assertIn("JETPACK", r.dropped[0])

    def test_no_game(self):
        client = FakeClient([response([tool_use("t1", answer(game_window=-1), name="identify_game")])])
        self.assertIsNone(identify(client, [GAME], [FRAME], log=lambda m: None))

    def test_bad_title_part_falls_back_to_full_title(self):
        client = FakeClient([response([tool_use("t1", answer(title_contains="Stardew Valley 2"),
                                                name="identify_game")])])
        r = identify(client, [GAME], [FRAME], log=lambda m: None)
        self.assertEqual(r.title_contains, "Stardew Valley")
        self.assertTrue(any("title_contains" in d for d in r.dropped))

    def test_nudge_then_answer(self):
        client = FakeClient([
            response([SimpleNamespace(type="text", text="Window 0 looks like a game.")], stop="end_turn"),
            response([tool_use("t2", answer(), name="identify_game")]),
        ])
        r = identify(client, [GAME], [FRAME], log=lambda m: None)
        self.assertEqual(r.game, "Stardew Valley")
        self.assertIn("identify_game", client.requests[1]["messages"][-1]["content"][-1]["text"])

    def test_refusal(self):
        client = FakeClient([response([], stop="refusal")])
        with self.assertRaises(recognize.RecognitionError):
            identify(client, [GAME], [FRAME], log=lambda m: None)


class ProfileTextTest(unittest.TestCase):
    def recognition(self, **over):
        client = FakeClient([response([tool_use("t", answer(**over), name="identify_game")])])
        return identify(client, [GAME, EMU], [FRAME, FRAME], log=lambda m: None)

    def test_written_file_loads(self):
        r = self.recognition(notes='Say "hi"\nthen \\ go', game='Ünïcode Quest: Part "2"')
        text = profile_text(r)
        p = from_dict(tomllib.loads(text))
        self.assertEqual(p.name, r.game)
        self.assertEqual(p.game.title_contains, "Stardew")
        self.assertEqual(p.agent.notes, r.notes)
        self.assertEqual(p.pacing.pause_input, "")
        self.assertIn("controls menu", text)

    def test_realtime_with_pause_and_retroarch(self):
        r = self.recognition(pacing="realtime", pause_input="start", device="kbm")
        p = from_dict(tomllib.loads(profile_text(r)))
        self.assertEqual((p.pacing.mode, p.pacing.pause_input, p.input.device), ("realtime", "START", "kbm"))
        r2 = self.recognition(game_window=1, emulator="RetroArch (SNES)", title_contains="Snes9x",
                              pacing="realtime", pause_input="START")
        p2 = from_dict(tomllib.loads(profile_text(r2, retroarch=True)))
        self.assertEqual((p2.pacing.mode, p2.pacing.pause_input, p2.input.device), ("retroarch", "", "gamepad"))
        self.assertIn("RetroArch (SNES)", p2.agent.notes)


class SetupCommandTest(unittest.TestCase):
    def test_setup_end_to_end(self):
        from synthapps_gamepilot import __main__ as cli

        tmp = Path(tempfile.mkdtemp())
        (tmp / "stardew-valley.toml").write_text("existing", encoding="utf-8")  # must not be overwritten
        activated = []

        class FakeTracker(window.WindowTracker):
            def __init__(self, info):
                self.info = info

            def activate(self):
                activated.append(self.info.title)
                return True

        class FakeCapture:
            def __init__(self, tracker):
                self.window = tracker

            def grab(self):
                return FRAME

            def close(self):
                pass

        client = FakeClient([response([tool_use("t", answer(), name="identify_game")])])
        out = io.StringIO()
        cwd = os.getcwd()
        os.chdir(tmp)
        try:
            with mock.patch.object(window, "list_windows", return_value=[TERMINAL, GAME, BROWSER]), \
                    mock.patch.object(window, "tracker_for", side_effect=FakeTracker), \
                    mock.patch("synthapps_gamepilot.capture.ScreenCapture", FakeCapture), \
                    mock.patch("synthapps_gamepilot.claude.make_client", return_value=client), \
                    mock.patch.object(cli, "detect_anti_cheat", return_value={}), \
                    mock.patch("synthapps_gamepilot.recognize.time.sleep"), \
                    contextlib.redirect_stdout(out):
                code = cli.main(["setup"])
        finally:
            os.chdir(cwd)
        self.assertEqual(code, 0, out.getvalue())
        self.assertEqual((tmp / "stardew-valley.toml").read_text(), "existing")
        written = tmp / "stardew-valley-2.toml"
        self.assertTrue(written.exists())
        self.assertTrue((tmp / "stardew-valley-2.png").exists())
        profile = from_dict(tomllib.loads(written.read_text(encoding="utf-8")))
        self.assertEqual(profile.name, "Stardew Valley")
        self.assertEqual(activated, ["Stardew Valley", "Stardew Valley"])  # photographed, then left in front
        self.assertIn("left out", out.getvalue())
        self.assertIn("play stardew-valley-2.toml", out.getvalue())


if __name__ == "__main__":
    unittest.main()


class PreferGameTest(unittest.TestCase):
    def test_browser_tab_loses_to_the_game(self):
        from synthapps_gamepilot.window import prefer_game

        self.assertEqual(prefer_game([(1, "chrome.exe"), (2, "Stardew Valley.exe")]), 2)
        self.assertEqual(prefer_game([(1, "firefox"), (2, "WindowsTerminal.exe")]), 1)  # no better choice
        self.assertEqual(prefer_game([(5, "")]), 5)

    def test_xdotool_lookup_skips_the_browser(self):
        from synthapps_gamepilot.window import XdotoolWindow

        answers = {
            ("xdotool", "search", "--onlyvisible", "--name", "Stardew"): "11\n22\n",
            ("xdotool", "getwindowpid", "11"): "",
            ("xdotool", "getwindowpid", "22"): "",
            ("xdotool", "getwindowname", "22"): "Stardew Valley",
        }
        with mock.patch.object(XdotoolWindow, "_process_of", lambda self, wid: {"11": "chrome"}.get(wid, "")):
            w = XdotoolWindow("Stardew", run=lambda args: answers[tuple(args)])
        self.assertEqual((w.wid, w.found_title), ("22", "Stardew Valley"))
