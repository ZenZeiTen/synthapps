import dataclasses
import unittest

from agentworld.audit import AuditLog


class AuditLogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.exported: list[str] = []
        self.log = AuditLog(sink=lambda entry: self.exported.append(entry.to_json()))
        for i in range(5):
            self.log.append(tick=i, kind="event", agent_id="ada", data={"n": i})

    def test_intact_log_verifies(self) -> None:
        self.assertIsNone(self.log.verify())
        self.assertIsNone(AuditLog.verify_jsonl(self.exported))

    def test_edited_entry_is_detected(self) -> None:
        entries = self.log._entries
        entries[2] = dataclasses.replace(entries[2], data={"n": 99})
        self.assertEqual(self.log.verify(), 2)

    def test_deleted_entry_is_detected(self) -> None:
        del self.log._entries[1]
        self.assertEqual(self.log.verify(), 1)

    def test_exported_copy_detects_edits_and_reordering(self) -> None:
        edited = list(self.exported)
        edited[3] = edited[3].replace('"n": 3', '"n": 4')
        self.assertEqual(AuditLog.verify_jsonl(edited), 3)
        swapped = list(self.exported)
        swapped[1], swapped[2] = swapped[2], swapped[1]
        self.assertEqual(AuditLog.verify_jsonl(swapped), 1)

    def test_incremental_verification_still_catches_old_tampering_on_full_check(self) -> None:
        self.assertIsNone(self.log.verify(incremental=True))
        entries = self.log._entries
        entries[0] = dataclasses.replace(entries[0], kind="forged")
        self.assertEqual(self.log.verify(), 0)


if __name__ == "__main__":
    unittest.main()
