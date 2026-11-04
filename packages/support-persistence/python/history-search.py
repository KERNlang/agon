#!/usr/bin/env python3
"""
History search sidecar — semantic ranking of forge run manifests by query.

Reuses the MiniLM tax already paid by sidecar.py / classifier.py — same
fastembed model, same ~30MB on disk, same ~500ms cold / ~50ms warm.

Why Python: TS has no production-grade local embedding runtime. The dedup
sidecar already proved MiniLM/cosine beats substring grep (0.06 → 0.83+ on
paraphrases). The current `agon history` lookup is exact substring on the
forgeId, so paraphrased queries ("the SaaS API thing" vs "FastAPI shim")
get nothing back. Cosine over MiniLM fixes that.

Protocol:
  stdin  — single JSON:
    {
      "query": "<search text>",
      "items": [{"id": "<runId>", "text": "<task + fitnessCmd + ...>"}, ...],
      "top_k": 10        // optional, default 10
    }
  stdout — single JSON:
    {
      "results": [{"id": "<runId>", "similarity": 0.82}, ...],
      "method":  "minilm-cosine",
      "model":   "sentence-transformers/all-MiniLM-L6-v2"
    }

Exit codes:
  0 — success
  1 — bad input (malformed JSON, missing fields, empty)
  2 — fastembed not installed (caller should fall back to chronological)
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any


MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_TOP_K = 10
MIN_SIMILARITY = 0.15  # below this, the match is effectively noise — drop it


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


def _read_input() -> dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        print("history-search: empty stdin", file=sys.stderr)
        sys.exit(1)
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as err:
        print(f"history-search: invalid JSON: {err}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(obj, dict):
        print("history-search: input must be a JSON object", file=sys.stderr)
        sys.exit(1)
    query = obj.get("query")
    items = obj.get("items")
    if not isinstance(query, str) or not query.strip():
        print("history-search: 'query' must be a non-empty string",
              file=sys.stderr)
        sys.exit(1)
    if not isinstance(items, list) or not items:
        print("history-search: 'items' must be a non-empty array",
              file=sys.stderr)
        sys.exit(1)
    normalized: list[dict[str, str]] = []
    for i, raw_item in enumerate(items):
        if (not isinstance(raw_item, dict)
                or "id" not in raw_item or "text" not in raw_item):
            print(f"history-search: item[{i}] missing 'id' or 'text'",
                  file=sys.stderr)
            sys.exit(1)
        text = str(raw_item["text"]).strip()
        if not text:
            # Skip empty-text items rather than fail — manifests without a
            # task description shouldn't poison the whole query.
            continue
        normalized.append({"id": str(raw_item["id"]), "text": text})
    if not normalized:
        print("history-search: no items with non-empty text", file=sys.stderr)
        sys.exit(1)
    top_k = obj.get("top_k", DEFAULT_TOP_K)
    if not isinstance(top_k, int) or top_k <= 0:
        top_k = DEFAULT_TOP_K
    return {"query": query.strip(), "items": normalized, "top_k": top_k}


def _rank(payload: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        from fastembed import TextEmbedding
        import numpy as np
    except ImportError:
        print("history-search: fastembed not installed — install via "
              "`pip install -r packages/dedup/requirements.txt`",
              file=sys.stderr)
        sys.exit(2)

    query: str = payload["query"]
    items: list[dict[str, str]] = payload["items"]
    top_k: int = payload["top_k"]

    embedder = TextEmbedding(MODEL, cache_dir=_cache_dir())
    texts = [query] + [item["text"] for item in items]
    embs = np.array(list(embedder.embed(texts)))

    norms = np.linalg.norm(embs, axis=1, keepdims=True)
    normed = embs / np.where(norms == 0, 1, norms)
    query_vec = normed[0]
    item_vecs = normed[1:]

    sims = item_vecs @ query_vec  # shape: (n_items,)

    scored = [
        {"id": items[i]["id"], "similarity": float(sims[i])}
        for i in range(len(items))
        if float(sims[i]) >= MIN_SIMILARITY
    ]
    scored.sort(key=lambda r: -r["similarity"])
    top = scored[:top_k]
    for r in top:
        r["similarity"] = round(r["similarity"], 3)
    return top


def main() -> None:
    payload = _read_input()
    results = _rank(payload)
    json.dump(
        {"results": results, "method": "minilm-cosine", "model": MODEL},
        sys.stdout,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
