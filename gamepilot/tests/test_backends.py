import ctypes
import unittest

from synthapps_gamepilot.backends import uinput, win_sendinput
from synthapps_gamepilot.backends.base import InputState, MultiBackend
from synthapps_gamepilot.backends.record import RecordingBackend
from synthapps_gamepilot.backends.vigem import ViGEmGamepad
from synthapps_gamepilot.controls import Kind, resolve

from .helpers import FakeUInput, fake_evdev, fake_vgamepad


def st(*names, axes=(0.0,) * 6, dx=0, dy=0):
    return InputState(frozenset(resolve(n) for n in names), axes, dx, dy)


class DiffTest(unittest.TestCase):
    def test_only_changes_are_sent(self):
        b = RecordingBackend()
        for _ in range(10):
            b.apply(st("A"))
        b.apply(st())
        self.assertEqual([(k, v) for _, k, v in b.events], [("down", "A"), ("up", "A")])

    def test_multi_backend_routes_by_kind(self):
        pad = RecordingBackend(kinds=frozenset({Kind.PAD_BUTTON}))
        kbm = RecordingBackend(kinds=frozenset({Kind.KEY, Kind.MOUSE_BUTTON}))
        both = MultiBackend(pad, kbm)
        both.apply(st("A", "KEY_W", dx=5))
        both.close()
        self.assertEqual(pad.presses("A"), 1)
        self.assertEqual(pad.presses("KEY_W"), 0)
        self.assertEqual(kbm.presses("KEY_W"), 1)
        self.assertEqual(kbm.mouse_total(), (5, 0))
        self.assertEqual(pad.held_now() | kbm.held_now(), set())


class UInputTest(unittest.TestCase):
    def setUp(self):
        FakeUInput.instances.clear()

    def test_gamepad_looks_like_xpad(self):
        pad = uinput.UInputGamepad(module=fake_evdev())
        dev = FakeUInput.instances[0]
        self.assertEqual((dev.kwargs["vendor"], dev.kwargs["product"]), (0x045E, 0x028E))
        abs_codes = [code for code, _ in dev.kwargs["events"][uinput.EV_ABS]]
        self.assertIn(uinput.ABS_HAT0X, abs_codes)
        self.assertIn(0x130, dev.kwargs["events"][uinput.EV_KEY])

        pad.apply(st("A", "DPAD_LEFT", axes=(1.0, 1.0, 0.0, -0.5, 1.0, 0.0)))
        w = dev.writes
        self.assertIn((uinput.EV_KEY, 0x130, 1), w)
        self.assertIn((uinput.EV_ABS, uinput.ABS_HAT0X, -1), w)
        self.assertIn((uinput.EV_ABS, uinput.ABS_X, 32767), w)
        self.assertIn((uinput.EV_ABS, uinput.ABS_Y, -32767), w)  # up is negative in evdev
        self.assertIn((uinput.EV_ABS, uinput.ABS_RY, 16384), w)
        self.assertIn((uinput.EV_ABS, uinput.ABS_Z, 255), w)
        self.assertEqual(dev.syns, 1)
        pad.close()
        self.assertIn((uinput.EV_KEY, 0x130, 0), dev.writes)
        self.assertIn((uinput.EV_ABS, uinput.ABS_HAT0X, 0), dev.writes)
        self.assertTrue(dev.closed)

    def test_keyboard_mouse(self):
        kbm = uinput.UInputKeyboardMouse(module=fake_evdev())
        dev = FakeUInput.instances[0]
        kbm.apply(st("KEY_UP", "MOUSE_LEFT", dx=12, dy=-3))
        self.assertIn((uinput.EV_KEY, 103, 1), dev.writes)
        self.assertIn((uinput.EV_KEY, 0x110, 1), dev.writes)
        self.assertIn((uinput.EV_REL, uinput.REL_X, 12), dev.writes)
        self.assertIn((uinput.EV_REL, uinput.REL_Y, -3), dev.writes)

    def test_permission_error_is_explained(self):
        class Denied(FakeUInput):
            def __init__(self, **kw):
                raise PermissionError("denied")

        mod = fake_evdev()
        mod.UInput = Denied
        with self.assertRaises(Exception) as ctx:
            uinput.UInputGamepad(module=mod)
        self.assertIn("modprobe uinput", str(ctx.exception))


class ViGEmTest(unittest.TestCase):
    def test_buttons_axes_update(self):
        vg = fake_vgamepad()
        pad = ViGEmGamepad(module=vg)
        pad.apply(st("Y", axes=(0.5, -1.0, 0.0, 0.0, 0.0, 0.25)))
        calls = [name for name, _ in pad._pad.calls]
        self.assertEqual(calls[0], "press_button")
        self.assertIn(("left_joystick_float", {"x_value_float": 0.5, "y_value_float": -1.0}), pad._pad.calls)
        self.assertIn(("right_trigger_float", {"value_float": 0.25}), pad._pad.calls)
        self.assertEqual(calls[-1], "update")
        device = pad._pad
        pad.close()
        names = [n for n, _ in device.calls]
        self.assertIn("release_button", names)
        self.assertIn("reset", names)


class SendInputTest(unittest.TestCase):
    def test_struct_layout_matches_windows_x64(self):
        if ctypes.sizeof(ctypes.c_void_p) == 8:
            self.assertEqual(ctypes.sizeof(win_sendinput.INPUT), 40)
        else:
            self.assertEqual(ctypes.sizeof(win_sendinput.INPUT), 28)

    def test_events(self):
        sent = []

        def fake_send(n, array, size):
            sent.extend(array[i] for i in range(n))
            return n

        b = win_sendinput.SendInputKeyboardMouse(send=fake_send)
        b.apply(st("KEY_W", "KEY_UP", "MOUSE_RIGHT", dx=7, dy=-2))
        b.apply(st())
        kb = [(i.ki.wScan, i.ki.dwFlags) for i in sent if i.type == win_sendinput.INPUT_KEYBOARD]
        self.assertIn((0x11, 0x0008), kb)  # W down, scan code
        self.assertIn((0x48, 0x0009), kb)  # Up down, scan code + extended
        self.assertIn((0x48, 0x000B), kb)  # Up up
        mouse = [(i.mi.dx, i.mi.dy, i.mi.dwFlags) for i in sent if i.type == win_sendinput.INPUT_MOUSE]
        self.assertIn((7, -2, 0x0001), mouse)
        self.assertIn((0, 0, 0x0008), mouse)
        self.assertIn((0, 0, 0x0010), mouse)

    def test_blocked_input_raises(self):
        b = win_sendinput.SendInputKeyboardMouse(send=lambda n, a, s: 0)
        with self.assertRaises(OSError):
            b.apply(st("KEY_A"))


if __name__ == "__main__":
    unittest.main()
