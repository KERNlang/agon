"""Run agon-engines' model probe with Agon-owned parser compatibility fixes.

This file ships with @kernlang/agon. Keeping the compatibility layer here is
important: root-level patch-package patches are available in this monorepo,
but are not installed when a user installs the published CLI package.
"""

from __future__ import annotations

import importlib.util
import os
import re
import sys


_CLAUDE_BRAND_RE = re.compile(
    r"\b(Opus|Sonnet|Haiku|Fable|Mythos)\s+(\d+(?:\.\d+)?)"
)


def parse_claude_picker(stripped: str) -> dict:
    """Parse Claude's selector while preserving a selected duplicate alias.

    Claude may list two versions with the same command-line alias, such as
    ``opus``. If the selected legacy version is the second row, dropping the
    duplicate also drops the only current marker.
    """
    text = re.sub(r"\s+", " ", stripped)
    head = text.rfind("Select model")
    if head >= 0:
        text = text[head:]
    foot = re.search(r"(● High effort|Use /fast|Enter to confirm)", text)
    if foot:
        text = text[: foot.start()]

    models: list[dict] = []
    seen: set[str] = set()
    current_name: str | None = None
    for part in re.split(r"(?=\b\d+\.\s)", text):
        entry = re.match(r"\s*\d+\.\s+(.*)", part)
        if not entry:
            continue
        body = entry.group(1)
        brand_match = _CLAUDE_BRAND_RE.search(body)
        if not brand_match:
            continue
        brand, version = brand_match.group(1), brand_match.group(2)
        is_current = "✔" in body
        is_1m = bool(re.search(r"1M", body))
        sonnet_1m = is_1m and brand.lower() == "sonnet"
        name = f"{brand} {version}" + (" (1M context)" if sonnet_1m else "")
        model_id = brand.lower() + ("[1m]" if sonnet_1m else "")

        if model_id in seen:
            if is_current:
                for existing in models:
                    if existing["id"] == model_id:
                        existing.update({"name": name, "current": True})
                        current_name = name
                        break
            continue

        seen.add(model_id)
        if is_current:
            current_name = name
        models.append({"id": model_id, "name": name, "current": is_current})

    return {"models": models, "current": current_name}


def load_vendor_probe(path: str):
    package_root = os.path.dirname(os.path.dirname(os.path.dirname(path)))
    if package_root not in sys.path:
        sys.path.insert(0, package_root)
    spec = importlib.util.spec_from_file_location("agon_vendor_model_probe", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load model probe: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print('{"error":"usage: agon-model-probe-wrapper <vendor-probe> <binary> [slash]"}')
        return 0
    probe = load_vendor_probe(os.path.abspath(argv[0]))
    probe.PARSERS["claude"] = parse_claude_picker
    return probe.main(argv[1:])


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
