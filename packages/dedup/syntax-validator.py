#!/usr/bin/env python3
"""
Syntax validator sidecar — parses files via tree-sitter and reports errors.

Why Python: tree-sitter has mature grammar packages on PyPI with prebuilt
wheels (tree-sitter-python, tree-sitter-typescript, tree-sitter-javascript).
TypeScript has its own tree-sitter bindings via node-tree-sitter, but they
require native module compilation at install time and add a heavyweight
dependency to @agon/core for a workflow that runs after patch-apply (not
per keystroke).

The current forge `validate` mode in packages/forge/src/generated/stages.ts
only inspects engine stdout (regex match for "validated"/"looks good"/etc.).
Nothing actually parses the resulting code. Tree-sitter fills that gap.

Protocol:
  stdin  — single JSON:
    {
      "files": [
        {"path": "src/foo.ts", "content": "...", "language": "typescript"},
        ...
      ]
    }
  stdout — single JSON:
    {
      "results": [
        {
          "path": "src/foo.ts",
          "valid": true,
          "language": "typescript",
          "errors": []
        },
        {
          "path": "src/bad.ts",
          "valid": false,
          "language": "typescript",
          "errors": [
            {"row": 12, "column": 4, "message": "MISSING ;"}
          ]
        }
      ],
      "method": "tree-sitter",
      "supported_languages": ["typescript", "tsx", "javascript", ...]
    }

Languages: typescript, tsx, javascript, jsx, python, json
  (additional names accepted: ts, ty, py — normalized internally)

Exit codes:
  0 — success
  1 — bad input
  2 — tree-sitter or a grammar package not installed
  3 — at least one file's language is unsupported (still produces output;
      caller can decide what to do with unsupported)
"""

from __future__ import annotations

import json
import sys
from typing import Any


LANGUAGE_ALIASES: dict[str, str] = {
    "ts": "typescript",
    "typescript": "typescript",
    "tsx": "tsx",
    "js": "javascript",
    "javascript": "javascript",
    "jsx": "jsx",
    "py": "python",
    "python": "python",
    "json": "json",
}


def _read_input() -> list[dict[str, str]]:
    raw = sys.stdin.read().strip()
    if not raw:
        print("syntax-validator: empty stdin", file=sys.stderr)
        sys.exit(1)
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as err:
        print(f"syntax-validator: invalid JSON: {err}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(obj, dict) or "files" not in obj:
        print("syntax-validator: input must be {'files': [...]}",
              file=sys.stderr)
        sys.exit(1)
    files = obj["files"]
    if not isinstance(files, list) or not files:
        print("syntax-validator: 'files' must be a non-empty array",
              file=sys.stderr)
        sys.exit(1)
    normalized: list[dict[str, str]] = []
    for i, raw_item in enumerate(files):
        if not isinstance(raw_item, dict):
            print(f"syntax-validator: files[{i}] must be an object",
                  file=sys.stderr)
            sys.exit(1)
        for key in ("path", "content", "language"):
            if key not in raw_item:
                print(f"syntax-validator: files[{i}] missing '{key}'",
                      file=sys.stderr)
                sys.exit(1)
        normalized.append({
            "path": str(raw_item["path"]),
            "content": str(raw_item["content"]),
            "language": str(raw_item["language"]).lower().strip(),
        })
    return normalized


def _load_parsers() -> dict[str, Any]:
    """Lazy-load tree-sitter grammars. Returns dict of language → Parser."""
    try:
        from tree_sitter import Language, Parser
    except ImportError:
        print("syntax-validator: tree-sitter not installed — install via "
              "`pip install -r packages/dedup/requirements.txt`",
              file=sys.stderr)
        sys.exit(2)

    parsers: dict[str, Any] = {}

    def _try(name: str, loader) -> None:
        try:
            lang = Language(loader())
        except Exception as err:  # noqa: BLE001  — grammar import is fragile
            print(f"syntax-validator: failed to load grammar {name}: {err}",
                  file=sys.stderr)
            return
        parsers[name] = Parser(lang)

    try:
        import tree_sitter_python as tspy
        _try("python", lambda: tspy.language())
    except ImportError:
        pass

    try:
        import tree_sitter_typescript as tsts
        _try("typescript", lambda: tsts.language_typescript())
        _try("tsx", lambda: tsts.language_tsx())
    except ImportError:
        pass

    try:
        import tree_sitter_javascript as tsjs
        _try("javascript", lambda: tsjs.language())
        # JS and JSX share a grammar in tree-sitter-javascript.
        _try("jsx", lambda: tsjs.language())
    except ImportError:
        pass

    try:
        import tree_sitter_json as tsjson
        _try("json", lambda: tsjson.language())
    except ImportError:
        pass

    if not parsers:
        print("syntax-validator: no grammar packages installed — install via "
              "`pip install -r packages/dedup/requirements.txt`",
              file=sys.stderr)
        sys.exit(2)

    return parsers


def _collect_errors(node, errors: list[dict[str, Any]], cap: int = 10) -> None:
    """Walk the AST, collect ERROR/MISSING nodes up to `cap`."""
    if len(errors) >= cap:
        return
    if node.is_error or node.is_missing:
        msg = "MISSING " + node.type if node.is_missing else "ERROR"
        errors.append({
            "row": node.start_point[0],
            "column": node.start_point[1],
            "message": msg,
        })
        if len(errors) >= cap:
            return
    for child in node.children:
        _collect_errors(child, errors, cap)
        if len(errors) >= cap:
            return


def _validate(
    files: list[dict[str, str]],
    parsers: dict[str, Any],
) -> tuple[list[dict[str, Any]], bool]:
    """Returns (results, any_unsupported). Unsupported files get
    valid=true with a 'language_unsupported' marker so the caller can
    choose to skip them or treat as failure."""
    results: list[dict[str, Any]] = []
    any_unsupported = False
    for f in files:
        lang_raw = f["language"]
        lang = LANGUAGE_ALIASES.get(lang_raw)
        if lang is None or lang not in parsers:
            any_unsupported = True
            results.append({
                "path": f["path"],
                "valid": True,  # cannot prove invalid without a parser
                "language": lang_raw,
                "errors": [],
                "language_unsupported": True,
            })
            continue
        parser = parsers[lang]
        try:
            tree = parser.parse(bytes(f["content"], "utf-8"))
        except Exception as err:  # noqa: BLE001
            results.append({
                "path": f["path"],
                "valid": False,
                "language": lang,
                "errors": [{
                    "row": 0,
                    "column": 0,
                    "message": f"parser-threw: {err}",
                }],
            })
            continue
        errors: list[dict[str, Any]] = []
        if tree.root_node.has_error:
            _collect_errors(tree.root_node, errors)
        results.append({
            "path": f["path"],
            "valid": not errors,
            "language": lang,
            "errors": errors,
        })
    return results, any_unsupported


def main() -> None:
    files = _read_input()
    parsers = _load_parsers()
    results, any_unsupported = _validate(files, parsers)
    json.dump(
        {
            "results": results,
            "method": "tree-sitter",
            "supported_languages": sorted(parsers.keys()),
        },
        sys.stdout,
    )
    sys.stdout.write("\n")
    if any_unsupported:
        sys.exit(3)


if __name__ == "__main__":
    main()
