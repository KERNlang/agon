#!/usr/bin/env python3
"""Offline, committed-source regression runner. No active Agon invocation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import tempfile
import time


def digest(path):
    with open(path, "rb") as stream:
        return "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()


def new_run_directory():
    # macOS's default TMPDIR is long enough to overflow daemon AF_UNIX paths
    # once runtime/test-fixture suffixes are appended. Keep the owned root short.
    return Path(tempfile.mkdtemp(prefix="agon-pressure-", dir="/tmp"))


def isolated_environment(root, inherited):
    # Deliberate allowlist: no provider credentials, user npmrc or Agon overrides.
    env = {key: inherited[key] for key in ("PATH", "SystemRoot") if key in inherited}
    locations = {"HOME": "home", "AGON_HOME": "agon", "XDG_CONFIG_HOME": "config",
                 "XDG_CACHE_HOME": "cache", "XDG_DATA_HOME": "data", "XDG_STATE_HOME": "state",
                 "TMPDIR": "tmp", "npm_config_cache": "npm-cache", "npm_config_prefix": "prefix",
                 "npm_config_logs_dir": "npm-logs"}
    for key, suffix in locations.items():
        path = root / suffix
        path.mkdir(parents=True, exist_ok=True)
        env[key] = str(path)
    npmrc = root / "empty.npmrc"
    npmrc.touch()
    global_npmrc = root / "empty-global.npmrc"
    global_npmrc.touch()
    env.update(npm_config_userconfig=str(npmrc), npm_config_globalconfig=str(global_npmrc),
               npm_config_ignore_scripts="true", npm_config_offline="true",
               npm_config_audit="false", npm_config_fund="false", CI="true",
               NODE_OPTIONS="--max-old-space-size=8192", LANG="en_US.UTF-8", TZ="UTC",
               GIT_CONFIG_NOSYSTEM="1", GIT_TERMINAL_PROMPT="0")
    env["AGON_S9_NPM_CACHE"] = env["npm_config_cache"]
    env["AGON_QUALIFICATION_NPM_CACHE"] = env["npm_config_cache"]
    return env


def kill_group(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def run_step(name, command, cwd, env, output, timeout):
    log = output / (name + ".log")
    started = time.monotonic()
    result = {"id": name, "command": command, "exitCode": None, "timedOut": False,
              "error": None, "passed": False, "log": log.name}
    print(f"START {name}", flush=True)
    with log.open("wb") as stream:
        try:
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=stream,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            try:
                result["exitCode"] = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                result["timedOut"] = True
                kill_group(process)
                result["exitCode"] = process.returncode
            except BaseException:
                kill_group(process)
                raise
            finally:
                # Reap descendants even if their direct parent exited successfully.
                kill_group(process)
        except OSError as error:
            result["error"] = str(error)
            stream.write(str(error).encode())
    result.update(seconds=round(time.monotonic() - started, 3), logSha256=digest(log))
    result["passed"] = result["exitCode"] == 0 and not result["timedOut"] and result["error"] is None
    print(f"{'PASS' if result['passed'] else 'FAIL'} {name} ({result['seconds']}s)", flush=True)
    return result


def complete_pass(steps, expected):
    return expected > 0 and len(steps) == expected and all(step["passed"] for step in steps)


def write_receipt(output, receipt):
    pending = output / "receipt.pending.json"
    pending.write_text(json.dumps(receipt, indent=2) + "\n")
    pending.replace(output / "receipt.json")


def plan(checkout, repeats, seed, full):
    commands = [("install-offline", ["npm", "ci", "--ignore-scripts", "--offline"]),
                ("build", ["npm", "run", "build:cli:workspaces"])]
    commands.append(("real-process-death", ["node", str(Path(__file__).with_name("pressure-process-death.mjs")), str(checkout)]))
    scripts = ["spec:modular-generated:self-test", "spec:modular-generated:check",
               "spec:modular-first-party:check", "test:modular-disable-matrix",
               "test:modular-foundation-mutation", "test:representative-workflows"]
    commands += [(name.replace(":", "-"), ["npm", "run", name]) for name in scripts]
    # The historical oracle is an artifact integrity check, NOT fresh execution.
    raw = json.loads((checkout / "docs/specs/evidence/modular-agon-legacy-oracle/representative-workflows.raw.json").read_text())
    workflow_files = sorted({"tests/" + suite["name"].split("/tests/", 1)[1] for suite in raw["testResults"]})
    for file in workflow_files:
        if ".." in Path(file).parts or not (checkout / file).is_file():
            raise ValueError(f"Invalid historical workflow path: {file}")
    modular_files = sorted(str(path.relative_to(checkout)) for path in (checkout / "tests/unit").glob("modular-*.test.ts"))
    if not modular_files or not workflow_files:
        raise ValueError("Empty pressure-test inventory")
    for repeat in range(repeats):
        for kind, files in [("modular", modular_files), ("fresh-workflows", workflow_files)]:
            commands.append((f"{kind}-seed-{seed + repeat}", ["node", "node_modules/vitest/vitest.mjs", "run", *files,
                "--sequence.shuffle", f"--sequence.seed={seed + repeat}"]))
    if full:
        for name in ["typecheck", "lint", "guard:reexports", "test:ts", "test:modular-release",
                     "test:modular-supply-chain", "spec:modular-slice8:e2e"]:
            commands.append((name.replace(":", "-"), ["npm", "run", name]))
        for name in ["test:modular-npx", "test:modular-state-migrations", "test:modular-physical-cutover",
                     *[f"perf:modular-slice{suffix}" for suffix in ["1a", "2", "3", "4", "5", "6", "7", "8"]]]:
            commands.append((name.replace(":", "-"), ["npm", "run", name, "--", "--no-write"]))
    return commands


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--cache", type=Path, required=True, help="Offline npm cache; copied, never used in place")
    parser.add_argument("--profile", choices=["pressure", "full"], default="full")
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--seed", type=int, default=1701)
    parser.add_argument("--timeout", type=int, default=1800, help="Maximum seconds per gate")
    args = parser.parse_args()
    if args.repeat < 1 or args.timeout < 1 or not (args.cache / "_cacache").is_dir():
        parser.error("Positive repeat/timeout and a populated npm cache are required")
    output = new_run_directory()
    print(f"Evidence and isolated checkout: {output}", flush=True)
    env = isolated_environment(output / "runtime", os.environ)
    receipt = {"schemaVersion": 1, "passed": False, "status": "running", "steps": [],
               "runnerSha256": digest(Path(__file__)), "platform": platform.platform(),
               "processDeathHarnessSha256": digest(Path(__file__).with_name("pressure-process-death.mjs")),
               "profile": args.profile, "repeat": args.repeat, "seed": args.seed,
               "scope": "Fresh offline fixture regression; not live-provider or complete release certification",
               "notVerified": ["live provider authentication and model quality", "other native OS/CPU/Node combinations",
                               "registry publication/signing", "independent model review", "absence of all possible bugs"]}
    write_receipt(output, receipt)
    try:
        repo = args.repo.resolve()
        def git(*arguments):
            return subprocess.check_output(["git", "-C", str(repo), *arguments], env=env, timeout=30).decode().strip()
        commit = git("rev-parse", "HEAD")
        receipt["subject"] = {"commit": commit, "tree": git("rev-parse", "HEAD^{tree}"),
                              "workingChangesExcluded": bool(git("status", "--porcelain"))}
        # Copy only npm content-addressed data, not npmrc, credentials, or logs.
        shutil.copytree(args.cache / "_cacache", Path(env["npm_config_cache"]) / "_cacache")
        checkout = output / "checkout"
        checkout.mkdir()
        archive = output / "subject.tar"
        subprocess.run(["git", "-C", str(repo), "archive", "--format=tar", f"--output={archive}", commit], env=env, check=True, timeout=60)
        subprocess.run(["tar", "-xf", str(archive), "-C", str(checkout)], env=env, check=True, timeout=60)
        receipt["archiveSha256"] = digest(archive)
        # Local Git metadata is needed by existing drift/boundary tests.
        for arguments in [["init", "--quiet"], ["add", "--all", "--force"],
                          ["-c", "user.name=Pressure Fixture", "-c", "user.email=fixture@invalid", "commit", "--quiet", "-m", "pressure fixture"]]:
            subprocess.run(["git", *arguments], cwd=checkout, env=env, check=True, timeout=60, stdout=subprocess.DEVNULL)
        commands = plan(checkout, args.repeat, args.seed, args.profile == "full")
        receipt["plan"] = [{"id": name, "command": command} for name, command in commands]
        write_receipt(output, receipt)
        for name, command in commands:
            result = run_step(name, command, checkout, env, output, args.timeout)
            receipt["steps"].append(result)
            write_receipt(output, receipt)
            if not result["passed"]:
                break
        receipt["passed"] = complete_pass(receipt["steps"], len(commands))
        receipt["status"] = "passed" if receipt["passed"] else "failed"
    except KeyboardInterrupt:
        receipt["status"] = "interrupted"
    except Exception as error:
        receipt.update(status="failed", error=str(error))
    finally:
        write_receipt(output, receipt)
        print(f"{receipt['status'].upper()}: {output / 'receipt.json'}", flush=True)
    return 0 if receipt["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
