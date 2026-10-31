import socket
import tempfile
import threading
import unittest
import zlib
from pathlib import Path

from synthapps_gamepilot.imaging import Frame, encode_for_model, encode_png, fit
from synthapps_gamepilot.profile import ProfileError, from_dict, load
from synthapps_gamepilot.retroarch import RetroArch, RetroArchError
from synthapps_gamepilot.safety import Budget, KillSwitch, detect_anti_cheat

PROFILES = Path(__file__).resolve().parent.parent / "profiles"


class FakeRetroArchServer:
    def __init__(self, state="PLAYING"):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.port = self.sock.getsockname()[1]
        self.state = state
        self.received = []
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        while True:
            try:
                data, addr = self.sock.recvfrom(1024)
            except OSError:
                return
            cmd = data.decode()
            self.received.append(cmd)
            if cmd == "GET_STATUS":
                self.sock.sendto(f"GET_STATUS {self.state} snes,Test Game,crc32=1".encode(), addr)
            elif cmd == "PAUSE_TOGGLE":
                self.state = "PLAYING" if self.state == "PAUSED" else "PAUSED"
            elif cmd.startswith("READ_CORE_MEMORY 7e0dbe"):
                self.sock.sendto(b"READ_CORE_MEMORY 7e0dbe 03 0a", addr)
            elif cmd.startswith("READ_CORE_MEMORY"):
                self.sock.sendto(b"READ_CORE_MEMORY 0 -1 no memory map", addr)

    def close(self):
        self.sock.close()


class RetroArchTest(unittest.TestCase):
    def test_commands(self):
        server = FakeRetroArchServer()
        ra = RetroArch(port=server.port, timeout=1)
        try:
            st = ra.status()
            self.assertEqual((st.state, st.system, st.game), ("PLAYING", "snes", "Test Game"))
            ra.set_paused(True)
            ra.set_paused(True)  # already paused: no second toggle
            self.assertEqual(server.received.count("PAUSE_TOGGLE"), 1)
            self.assertEqual(ra.read_memory(0x7E0DBE, 2), b"\x03\x0a")
            with self.assertRaises(RetroArchError):
                ra.read_memory(0, 1)
        finally:
            ra.close()
            server.close()

    def test_no_answer_is_explained(self):
        free = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        free.bind(("127.0.0.1", 0))
        port = free.getsockname()[1]
        free.close()
        ra = RetroArch(port=port, timeout=0.2)
        self.addCleanup(ra.close)
        with self.assertRaises(RetroArchError) as ctx:
            ra.status()
        self.assertIn("Network Commands", str(ctx.exception))

    def test_windows_port_unreachable_is_explained(self):
        # Windows reports an unanswered UDP request to a closed port as a connection reset.
        ra = RetroArch(port=9, timeout=0.2)
        real = ra.sock
        self.addCleanup(real.close)

        class ResetSocket:
            def __getattr__(self, name):
                return getattr(real, name)

            def recvfrom(self, n):
                raise ConnectionResetError(10054, "An existing connection was forcibly closed")

        ra.sock = ResetSocket()
        with self.assertRaises(RetroArchError) as ctx:
            ra.status()
        self.assertIn("Network Commands", str(ctx.exception))


class ProfileTest(unittest.TestCase):
    def test_examples_load(self):
        files = sorted(PROFILES.glob("*.toml"))
        self.assertGreaterEqual(len(files), 3)
        for f in files:
            with self.subTest(f=f.name):
                load(f)

    def test_errors(self):
        bad = [
            {},
            {"name": "x", "colour": 1},
            {"name": "x", "input": {"device": "wheel"}},
            {"name": "x", "input": {"tickhz": 5}},
            {"name": "x", "pacing": {"mode": "retroarch", "pause_input": "START"}},
            {"name": "x", "bindings": {"jump": "Q_BUTTON"}},
            {"name": "x", "agent": {"effort": "turbo"}},
            {"name": "x", "game": {"fps": 1000}},
        ]
        for data in bad:
            with self.subTest(data=data), self.assertRaises(ProfileError):
                from_dict(data)


class SafetyTest(unittest.TestCase):
    def test_anti_cheat_detection(self):
        found = detect_anti_cheat(["explorer.exe", "EasyAntiCheat_EOS.exe", "vgc.exe", "steam.exe"])
        self.assertEqual(set(found), {"EasyAntiCheat_EOS.exe", "vgc.exe"})
        self.assertEqual(detect_anti_cheat(["retroarch", "python3"]), {})

    def test_kill_switch_file(self):
        stop = Path(tempfile.mkdtemp()) / "STOP"
        k = KillSwitch(stop, _key_state=lambda vk: 0)
        self.assertEqual(k.check(), "")
        stop.write_text("")
        self.assertIn("stop file", k.check())
        stop.unlink()
        self.assertIn("stop file", k.check())  # stays tripped

    def test_kill_switch_key(self):
        k = KillSwitch(Path(tempfile.mkdtemp()) / "STOP", _key_state=lambda vk: 0x8000 if vk == 0x13 else 0)
        self.assertIn("Pause/Break", k.check())

    def test_budget(self):
        t = {"now": 0.0}
        b = Budget(max_turns=10, max_seconds=60, max_cost_usd=1.0, clock=lambda: t["now"], started=0.0)
        b.add_usage(100_000, 10_000)
        self.assertAlmostEqual(b.cost_usd, 0.6)
        self.assertEqual(b.exhausted(), "")
        b.add_usage(100_000, 0)
        self.assertIn("spending", b.exhausted())
        t["now"] = 61
        self.assertIn("time", Budget(clock=lambda: t["now"], started=0.0, max_seconds=60).exhausted())


class ImagingTest(unittest.TestCase):
    def test_png_is_valid(self):
        f = Frame(3, 2, bytes(range(18)))
        data = encode_png(f)
        self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))
        idat = data[data.index(b"IDAT") + 4:data.index(b"IEND") - 8]
        self.assertEqual(zlib.decompress(idat), b"\x00" + bytes(range(9)) + b"\x00" + bytes(range(9, 18)))

    def test_fit(self):
        self.assertEqual(fit(1920, 1080, 1024), (1024, 576))
        self.assertEqual(fit(320, 240, 1024), (320, 240))

    def test_encode_for_model(self):
        media, data = encode_for_model(Frame(64, 32, bytes(64 * 32 * 3)), max_edge=32)
        self.assertIn(media, ("image/png", "image/jpeg"))
        self.assertTrue(data)


if __name__ == "__main__":
    unittest.main()
