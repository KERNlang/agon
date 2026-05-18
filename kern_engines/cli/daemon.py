"""Stdio JSON-line daemon wrapping one PtyTuiSession.

Usage from another process:

    proc = subprocess.Popen(
        [sys.executable, "-m", "kern_engines.cli.daemon", "claude"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
    )
    proc.stdin.write(json.dumps({"id": 1, "type": "ask", "prompt": "hello"}).encode() + b"\\n")
    proc.stdin.flush()
    reply = json.loads(proc.stdout.readline())
    # → {"id": 1, "type": "reply", "ok": true, "text": "..."}

Protocol (NDJSON, one message per line, both directions):

- request  ``{"id": <int>, "type": "ask", "prompt": <str>, "timeout"?: <float>}``
- request  ``{"id": <int>, "type": "ask_stream", "prompt": <str>, "timeout"?: <float>}``
- request  ``{"id": <int>, "type": "close"}``
- response ``{"id": <int>, "type": "chunk",  "delta": <str>}``  (streaming only, zero or more before reply)
- response ``{"id": <int>, "type": "reply", "ok": true,  "text": <str>}``
- response ``{"id": <int>, "type": "reply", "ok": false, "error": <str>, "kind": "timeout"|"error"}``
- notify   ``{"type": "ready", "engine": <str>}``  (sent once at startup)

The daemon keeps the underlying session alive across calls so the
multi-second startup amortises.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .configs import get as get_config
from .pty_session import PtySessionError, PtySessionTimeout, PtyTuiSession


def _write(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _err(msg: str) -> None:
    sys.stderr.write(f"[kern-engines-daemon] {msg}\n")
    sys.stderr.flush()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python3 -m kern_engines.cli.daemon",
        description="Stdio JSON-line wrapper for a pty-driven CLI engine.",
    )
    parser.add_argument("engine", help="engine id from configs.REGISTRY")
    parser.add_argument(
        "--cols", type=int, default=None,
        help="override engine's default cols",
    )
    parser.add_argument(
        "--rows", type=int, default=None,
        help="override engine's default rows",
    )
    parser.add_argument(
        "--mode", choices=("exec", "agent"), default="exec",
        help="dispatch mode — agent enables tools + bypassed permissions",
    )
    args = parser.parse_args(argv)

    try:
        cfg = get_config(args.engine)
    except KeyError as e:
        _err(str(e))
        return 2

    if args.cols or args.rows:
        from dataclasses import replace
        cfg = replace(
            cfg,
            cols=args.cols or cfg.cols,
            rows=args.rows or cfg.rows,
        )

    try:
        session = PtyTuiSession(cfg, mode=args.mode)
    except PtySessionError as e:
        _err(f"failed to spawn {args.engine}: {e}")
        return 3

    _write({"type": "ready", "engine": cfg.id})

    try:
        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError as e:
                _err(f"bad json: {e}")
                continue

            req_id = msg.get("id")
            mtype = msg.get("type")

            if mtype == "ask":
                prompt = msg.get("prompt", "")
                timeout = float(msg.get("timeout", 60.0))
                try:
                    text = session.ask(prompt, timeout=timeout)
                    _write({"id": req_id, "type": "reply", "ok": True, "text": text})
                except PtySessionTimeout as e:
                    _write({
                        "id": req_id, "type": "reply", "ok": False,
                        "kind": "timeout", "error": str(e),
                    })
                except PtySessionError as e:
                    _write({
                        "id": req_id, "type": "reply", "ok": False,
                        "kind": "error", "error": str(e),
                    })
                    break
            elif mtype == "ask_stream":
                prompt = msg.get("prompt", "")
                timeout = float(msg.get("timeout", 60.0))
                try:
                    gen = session.ask_stream(prompt, timeout=timeout)
                    final_text = ""
                    while True:
                        try:
                            delta = next(gen)
                        except StopIteration as si:
                            final_text = si.value or ""
                            break
                        _write({"id": req_id, "type": "chunk", "delta": delta})
                    _write({
                        "id": req_id, "type": "reply", "ok": True,
                        "text": final_text,
                    })
                except PtySessionTimeout as e:
                    _write({
                        "id": req_id, "type": "reply", "ok": False,
                        "kind": "timeout", "error": str(e),
                    })
                except PtySessionError as e:
                    _write({
                        "id": req_id, "type": "reply", "ok": False,
                        "kind": "error", "error": str(e),
                    })
                    break
            elif mtype == "close":
                _write({"id": req_id, "type": "reply", "ok": True, "text": ""})
                break
            else:
                _write({
                    "id": req_id, "type": "reply", "ok": False,
                    "kind": "error", "error": f"unknown type {mtype!r}",
                })
    finally:
        session.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
