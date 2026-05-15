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


SUPPORTED_LANGUAGES: frozenset[str] = frozenset({
    "typescript", "tsx", "javascript", "jsx", "python", "json",
})


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
            # Reject non-string values explicitly. `str(None)` is "None",
            # which silently lies about the input — surface the bug here.
            if not isinstance(raw_item[key], str):
                print(f"syntax-validator: files[{i}].{key} must be a string "
                      f"(got {type(raw_item[key]).__name__})",
                      file=sys.stderr)
                sys.exit(1)
        normalized.append({
            "path": raw_item["path"],
            "content": raw_item["content"],
            "language": raw_item["language"].lower().strip(),
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

    # Each grammar package is OPTIONAL — if one isn't installed, the
    # validator just refuses to parse files of that language (the bridge
    # then flags them grammar_unavailable). Log the absence to stderr so
    # `agon doctor` and curious users can see which grammars are missing
    # rather than silently degrading.
    def _log_missing_grammar(name: str, err: ImportError) -> None:
        print(
            f"syntax-validator: grammar package not installed: {name} ({err})",
            file=sys.stderr,
        )

    try:
        import tree_sitter_python as tspy
        _try("python", lambda: tspy.language())
    except ImportError as err:
        _log_missing_grammar("tree_sitter_python", err)

    try:
        import tree_sitter_typescript as tsts
        _try("typescript", lambda: tsts.language_typescript())
        _try("tsx", lambda: tsts.language_tsx())
    except ImportError as err:
        _log_missing_grammar("tree_sitter_typescript", err)

    try:
        import tree_sitter_javascript as tsjs
        _try("javascript", lambda: tsjs.language())
        # JS and JSX share a grammar in tree-sitter-javascript.
        _try("jsx", lambda: tsjs.language())
    except ImportError as err:
        _log_missing_grammar("tree_sitter_javascript", err)

    try:
        import tree_sitter_json as tsjson
        _try("json", lambda: tsjson.language())
    except ImportError as err:
        _log_missing_grammar("tree_sitter_json", err)

    if not parsers:
        print("syntax-validator: no grammar packages installed — install via "
              "`pip install -r packages/dedup/requirements.txt`",
              file=sys.stderr)
        sys.exit(2)

    return parsers


def _collect_errors(root, cap: int = 10) -> list[dict[str, Any]]:
    """Iteratively walk the AST collecting ERROR/MISSING nodes up to `cap`.
    Iterative form prevents RecursionError on deeply-nested invalid input
    (e.g. heavily-nested JSON, long arithmetic chains, large method chains)."""
    errors: list[dict[str, Any]] = []
    stack: list[Any] = [root]
    while stack and len(errors) < cap:
        node = stack.pop()
        if node.is_error or node.is_missing:
            msg = "MISSING " + node.type if node.is_missing else "ERROR"
            errors.append({
                "row": node.start_point[0],
                "column": node.start_point[1],
                "message": msg,
            })
            if len(errors) >= cap:
                break
        # Reverse so the depth-first order matches the source order.
        for child in reversed(node.children):
            stack.append(child)
    return errors


def _python_indentation_check(content: str) -> list[dict[str, Any]]:
    """Tree-sitter's Python grammar is forgiving on indentation — it will
    accept malformed indentation that the CPython parser rejects (e.g.
    `def f():\nreturn 1`). Supplement tree-sitter with `compile(...)` for
    Python files so indentation errors are caught."""
    try:
        compile(content, "<input>", "exec")
        return []
    except SyntaxError as err:
        return [{
            "row": (err.lineno or 1) - 1,
            "column": (err.offset or 1) - 1,
            "message": f"PYTHON {err.msg or 'syntax error'}".strip(),
        }]
    except (ValueError, TypeError) as err:
        # ValueError: null bytes in source; TypeError: non-str source.
        return [{
            "row": 0,
            "column": 0,
            "message": f"PYTHON {type(err).__name__}: {err}",
        }]


def _validate(
    files: list[dict[str, str]],
    parsers: dict[str, Any],
) -> tuple[list[dict[str, Any]], bool]:
    """Returns (results, any_unsupported). Files whose language we don't
    know at all get valid=true with `language_unsupported: true` so the
    caller can skip them. Files whose language IS known but whose grammar
    failed to load get valid=false with `grammar_unavailable: true` so the
    caller doesn't mistake a degraded sidecar for clean code."""
    results: list[dict[str, Any]] = []
    any_unsupported = False
    for f in files:
        lang_raw = f["language"]
        lang = LANGUAGE_ALIASES.get(lang_raw)
        if lang is None or lang not in SUPPORTED_LANGUAGES:
            any_unsupported = True
            results.append({
                "path": f["path"],
                "valid": True,  # cannot prove invalid without a parser
                "language": lang_raw,
                "errors": [],
                "language_unsupported": True,
            })
            continue
        parser = parsers.get(lang)
        if parser is None:
            # Known language, but the grammar package isn't installed in
            # this environment. Surface it as a per-file failure rather
            # than letting it pass — silent pass-through is the bug
            # codex flagged at 0.86 confidence.
            results.append({
                "path": f["path"],
                "valid": False,
                "language": lang,
                "errors": [{
                    "row": 0,
                    "column": 0,
                    "message": f"grammar-unavailable: install tree-sitter-{lang}",
                }],
                "grammar_unavailable": True,
            })
            continue
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
                    "message": f"parser-threw: {type(err).__name__}",
                }],
            })
            continue
        errors: list[dict[str, Any]] = []
        if tree.root_node.has_error:
            errors = _collect_errors(tree.root_node)
        # Python: tree-sitter accepts malformed indentation that the real
        # parser rejects. Run CPython's parser as a second pass; merge.
        if lang == "python" and not errors:
            errors = _python_indentation_check(f["content"])
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
