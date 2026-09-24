import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location("runner", Path(__file__).with_name("pressure_modular.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_short_run_root_leaves_room_for_unix_socket_fixtures(self):
        root = runner.new_run_directory()
        try:
            socket = root / "runtime/tmp/agon-daemon-survival-XXXXXX/daemon/agond.sock"
            self.assertLess(len(str(socket).encode()), 104)
        finally:
            root.rmdir()

    def test_environment_does_not_inherit_credentials_or_personal_home(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = runner.isolated_environment(Path(tmp), {"PATH": os.environ["PATH"], "HOME": "/personal", "OPENAI_API_KEY": "secret", "AGON_HOME": "/personal/agon"})
            self.assertNotIn("OPENAI_API_KEY", env)
            self.assertEqual(env["HOME"], str(Path(tmp) / "home"))
            self.assertTrue(env["AGON_HOME"].startswith(tmp))
            self.assertNotEqual(env["npm_config_userconfig"], env["npm_config_globalconfig"])

    def test_failure_is_retained_and_cannot_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = runner.run_step("failure", [sys.executable, "-c", "print('witness'); raise SystemExit(7)"], root, os.environ.copy(), root, 5)
            self.assertFalse(result["passed"])
            self.assertEqual(result["exitCode"], 7)
            self.assertIn("witness", (root / result["log"]).read_text())
            self.assertEqual(result["logSha256"], runner.digest(root / result["log"]))

    def test_timeout_is_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = runner.run_step("hang", [sys.executable, "-c", "import time; time.sleep(30)"], root, os.environ.copy(), root, .1)
            self.assertFalse(result["passed"])
            self.assertTrue(result["timedOut"])

    def test_spawn_failure_is_a_receipt_not_an_exception(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = runner.run_step("missing", ["/nonexistent/pressure-executable"], root, os.environ.copy(), root, 1)
            self.assertFalse(result["passed"])
            self.assertIsNotNone(result["error"])

    def test_empty_partial_or_failed_runs_cannot_pass(self):
        self.assertFalse(runner.complete_pass([], 1))
        self.assertFalse(runner.complete_pass([{"passed": True}], 2))
        self.assertFalse(runner.complete_pass([{"passed": False}], 1))
        self.assertTrue(runner.complete_pass([{"passed": True}], 1))

    def test_background_descendant_is_killed_after_parent_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            marker = root / "orphan-wrote"
            child = f"import time; from pathlib import Path; time.sleep(.4); Path({str(marker)!r}).touch()"
            parent = f"import subprocess,sys; subprocess.Popen([sys.executable,'-c',{child!r}])"
            result = runner.run_step("descendant", [sys.executable, "-c", parent], root, os.environ.copy(), root, 3)
            self.assertTrue(result["passed"])
            time.sleep(.6)
            self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
