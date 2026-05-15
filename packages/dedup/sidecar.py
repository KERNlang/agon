#!/usr/bin/env python3
"""
Brainstorm dedup sidecar — clusters near-duplicate engine drafts.

Uses sentence embeddings (MiniLM via fastembed/ONNX, ~30MB) so paraphrases
group together. TF-IDF was tried first and scored 0.06 between drafts that
say the same thing in different words — useless for this task.

Protocol:
  stdin  — JSONL, one per line: {"id": "<engineId>", "text": "<draft>"}
  stdout — single JSON:
    {
      "groups": [
        {"members": ["claude", "codex"], "representative": "claude",
         "similarity": 0.83},
        ...
      ],
      "threshold": 0.65,
      "method": "minilm-cosine"
    }

Two engines are in the same group iff cosine similarity of their MiniLM
embeddings >= threshold. Representative = engine with the longest text in
the group (most detail). Singleton groups are emitted too.

Exit codes:
  0  — success
  1  — bad input (malformed JSON, no items)
  2  — fastembed not installed (caller should fall back to no-dedup)
"""

from __future__ import annotations

import json
import sys
from typing import Any


THRESHOLD = 0.65
MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def _read_input() -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for line_num, raw_line in enumerate(sys.stdin, 1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as err:
            print(f"dedup-sidecar: line {line_num} is not valid JSON: {err}",
                  file=sys.stderr)
            sys.exit(1)
        if not isinstance(obj, dict) or "id" not in obj or "text" not in obj:
            print(f"dedup-sidecar: line {line_num} missing 'id' or 'text'",
                  file=sys.stderr)
            sys.exit(1)
        items.append({"id": str(obj["id"]), "text": str(obj["text"])})
    return items


def _cluster(items: list[dict[str, str]]) -> list[dict[str, Any]]:
    if len(items) == 1:
        return [{
            "members": [items[0]["id"]],
            "representative": items[0]["id"],
            "similarity": 1.0,
        }]

    try:
        from fastembed import TextEmbedding
        import numpy as np
    except ImportError:
        print("dedup-sidecar: fastembed not installed — install via "
              "`pip install -r packages/dedup/requirements.txt`",
              file=sys.stderr)
        sys.exit(2)

    embedder = TextEmbedding(MODEL)
    texts = [item["text"] for item in items]
    embs = np.array(list(embedder.embed(texts)))

    norms = np.linalg.norm(embs, axis=1, keepdims=True)
    normed = embs / np.where(norms == 0, 1, norms)
    sim = normed @ normed.T

    n = len(items)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    for i in range(n):
        for j in range(i + 1, n):
            if sim[i][j] >= THRESHOLD:
                union(i, j)

    clusters: dict[int, list[int]] = {}
    for i in range(n):
        clusters.setdefault(find(i), []).append(i)

    groups = []
    for indices in clusters.values():
        members_items = [items[i] for i in indices]
        rep = max(members_items, key=lambda x: len(x["text"]))
        if len(indices) > 1:
            pair_sims = [float(sim[i][j])
                         for i in indices for j in indices if i < j]
            avg_sim = sum(pair_sims) / len(pair_sims)
        else:
            avg_sim = 1.0
        groups.append({
            "members": [item["id"] for item in members_items],
            "representative": rep["id"],
            "similarity": round(avg_sim, 3),
        })

    groups.sort(key=lambda g: (-len(g["members"]), g["representative"]))
    return groups


def main() -> None:
    items = _read_input()
    if not items:
        print("dedup-sidecar: no items on stdin", file=sys.stderr)
        sys.exit(1)
    groups = _cluster(items)
    json.dump(
        {"groups": groups, "threshold": THRESHOLD, "method": "minilm-cosine"},
        sys.stdout,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
