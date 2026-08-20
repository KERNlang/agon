#!/usr/bin/env python3
"""Minimal PTY driver for the REPL perf probes.

Node has no built-in pty and this repo deliberately carries no native
dependency (node-pty), so the probe borrows Python's stdlib `pty` to run a
command on a real terminal with a fixed window size.

Usage:
    pty-drive.py <cols> <rows> -- <cmd> [args...]

Control script is read as JSON lines on stdin:
    {"send": "abc"}        write literal text to the pty
    {"sendHex": "1b5b41"}  write raw bytes (escape sequences)
    {"sleep": 250}         wait N ms
    {"exit": true}         stop draining, SIGINT the child, wait, exit

Child output is drained continuously (so the child never blocks on a full pty
buffer) and discarded; the probe reads its measurements from files instead.
"""

import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import fcntl
import time


def main() -> int:
    args = sys.argv[1:]
    if len(args) < 4 or "--" not in args:
        print(__doc__, file=sys.stderr)
        return 2
    split = args.index("--")
    cols, rows = int(args[0]), int(args[1])
    command = args[split + 1:]

    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(command[0], command)
        os._exit(127)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    log_path = os.environ.get("PTY_LOG")
    log = open(log_path, "wb") if log_path else None

    def drain(deadline: float) -> None:
        while time.monotonic() < deadline:
            ready, _, _ = select.select([fd], [], [], max(0.0, deadline - time.monotonic()))
            if not ready:
                return
            try:
                chunk = os.read(fd, 65536)
                if not chunk:
                    return
                if log:
                    log.write(chunk)
                    log.flush()
            except OSError:
                return

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        step = json.loads(line)
        if step.get("exit"):
            break
        if "sleep" in step:
            drain(time.monotonic() + step["sleep"] / 1000.0)
            continue
        if "send" in step:
            os.write(fd, step["send"].encode("utf-8"))
        elif "sendHex" in step:
            os.write(fd, bytes.fromhex(step["sendHex"]))
        drain(time.monotonic() + step.get("settle", 0) / 1000.0)

    try:
        os.kill(pid, signal.SIGINT)
        drain(time.monotonic() + 0.3)
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
    try:
        os.waitpid(pid, 0)
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
