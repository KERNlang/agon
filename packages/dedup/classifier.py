#!/usr/bin/env python3
"""
Task classifier sidecar — zero-shot classification via fastembed.

Fed when the regex classifier in `task-classifier.kern` falls through to
'other'. Embeds the input text, embeds each candidate label's description,
returns the label with highest cosine similarity.

Protocol:
  stdin  — single JSON line: {"text": "<task description>"}
  stdout — single JSON: {"class": "<TaskClass>",
                          "confidence": 0.74,
                          "scores": {"feature": 0.74, "bugfix": 0.31, ...}}

Returns 'other' if no class scores above MIN_CONFIDENCE.

Exit codes:
  0  — success
  1  — bad input
  2  — fastembed not installed
"""

from __future__ import annotations

import json
import os
import sys


MIN_CONFIDENCE = 0.10
MARGIN = 0.05  # top class must beat #2 by this much to commit; otherwise 'other'
MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def _cache_dir() -> str:
    """Persistent model cache. fastembed's default is a tmpdir that the OS
    prunes between runs — a half-pruned snapshot then fails with NO_SUCHFILE
    on every call. Pin the cache under ~/.agon (or FASTEMBED_CACHE_PATH)."""
    explicit = os.environ.get("FASTEMBED_CACHE_PATH", "").strip()
    if explicit:
        return explicit
    agon_home = os.environ.get("AGON_HOME", "").strip() or os.path.join(
        os.path.expanduser("~"), ".agon")
    path = os.path.join(agon_home, "cache", "fastembed")
    os.makedirs(path, exist_ok=True)
    return path

# Few-shot examples per label. We embed concrete task phrasings rather than
# abstract definitions because all-MiniLM scores concrete-vs-concrete cosine
# much higher than concrete-vs-abstract. Empirically this lifts true-positive
# rates on Agon's actual prompt distribution from ~30% to ~85%.
LABELS: dict[str, str] = {
    "docs":      ("Update the README. Document the API surface. Add comments "
                  "explaining the algorithm. Write a changelog entry. "
                  "Rationale for the migration. Update the docs."),
    "test":      ("Add a unit test. Cover the edge case with assertions. "
                  "Write integration tests for the auth flow. Increase test "
                  "coverage. Add fixtures. Snapshot test."),
    "bugfix":    ("Fix the off-by-one error. Why is the cache evicting? "
                  "Resolve the crash on startup. Patch the regression. "
                  "Off-by-one. Race condition. Memory leak. Stuck process. "
                  "Broken behavior. Unexpected output."),
    "refactor":  ("Rename across the codebase. Extract the helper. Simplify "
                  "this method. Reorganize the file structure. Clean up dead "
                  "code. Move modules. Restructure without changing behavior."),
    "algorithm": ("Implement Glicko-2 ratings. Compute the rolling median. "
                  "Optimize the sort. Score the engines. Calculate confidence "
                  "intervals. Compute distances. Numerical computation. "
                  "Data structure. Sorting algorithm."),
    "feature":   ("Add support for streaming. Build a streaming JSON parser. "
                  "Create a new dashboard. Implement a new API endpoint. "
                  "Build a CLI command. Add a new capability. Ship a new "
                  "feature. Extend the engine adapter."),
}


def _read_input() -> str:
    raw = sys.stdin.read().strip()
    if not raw:
        print("classifier-sidecar: empty stdin", file=sys.stderr)
        sys.exit(1)
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as err:
        print(f"classifier-sidecar: invalid JSON: {err}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(obj, dict) or "text" not in obj:
        print("classifier-sidecar: missing 'text' field", file=sys.stderr)
        sys.exit(1)
    text = str(obj["text"]).strip()
    if not text:
        print("classifier-sidecar: 'text' is empty", file=sys.stderr)
        sys.exit(1)
    return text


def _classify(text: str) -> dict:
    try:
        from fastembed import TextEmbedding
        import numpy as np
    except ImportError:
        print("classifier-sidecar: fastembed not installed — install via "
              "`pip install -r packages/dedup/requirements.txt`",
              file=sys.stderr)
        sys.exit(2)

    embedder = TextEmbedding(MODEL, cache_dir=_cache_dir())
    label_keys = list(LABELS.keys())
    label_descriptions = [LABELS[k] for k in label_keys]
    all_texts = [text] + label_descriptions
    embs = np.array(list(embedder.embed(all_texts)))

    norms = np.linalg.norm(embs, axis=1, keepdims=True)
    normed = embs / np.where(norms == 0, 1, norms)
    text_vec = normed[0]
    label_vecs = normed[1:]
    sims = label_vecs @ text_vec

    scores = {label_keys[i]: round(float(sims[i]), 3)
              for i in range(len(label_keys))}
    sorted_indices = sorted(range(len(sims)), key=lambda i: -sims[i])
    best_idx = sorted_indices[0]
    second_idx = sorted_indices[1]
    best_label = label_keys[best_idx]
    best_score = float(sims[best_idx])
    margin = best_score - float(sims[second_idx])

    if best_score < MIN_CONFIDENCE or margin < MARGIN:
        chosen = "other"
    else:
        chosen = best_label

    return {
        "class": chosen,
        "confidence": round(best_score, 3),
        "margin": round(margin, 3),
        "scores": scores,
    }


def main() -> None:
    text = _read_input()
    result = _classify(text)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
