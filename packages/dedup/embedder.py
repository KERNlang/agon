#!/usr/bin/env python3
"""
Embedding sidecar — raw sentence embeddings for the RAG retriever.

Same model + runtime as sidecar.py (MiniLM via fastembed/ONNX, ~30MB,
fully offline after the first model download), but instead of clustering
it returns the raw vectors so the TS side can build a persistent
cosine-similarity index.

Protocol:
  stdin  — JSONL, one per line: {"id": "<chunkId>", "text": "<chunk text>"}
  stdout — single JSON:
    {
      "model": "sentence-transformers/all-MiniLM-L6-v2",
      "dims": 384,
      "vectors": [{"id": "<chunkId>", "vector": [..384 floats..]}, ...]
    }
  Vector order matches input order. Vectors are L2-normalized so cosine
  similarity reduces to a dot product on the consumer side.

Exit codes:
  0  — success
  1  — bad input (malformed JSON, no items)
  2  — fastembed not installed (caller should fall back / surface a hint)
"""

from __future__ import annotations

import json
import os
import sys


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


def _read_input() -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for line_num, raw_line in enumerate(sys.stdin, 1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as err:
            print(f"embedder-sidecar: line {line_num} is not valid JSON: {err}",
                  file=sys.stderr)
            sys.exit(1)
        if not isinstance(obj, dict) or "id" not in obj or "text" not in obj:
            print(f"embedder-sidecar: line {line_num} missing 'id' or 'text'",
                  file=sys.stderr)
            sys.exit(1)
        items.append({"id": str(obj["id"]), "text": str(obj["text"])})
    return items


def main() -> int:
    items = _read_input()
    if not items:
        print("embedder-sidecar: no input items", file=sys.stderr)
        return 1

    try:
        import numpy as np
        from fastembed import TextEmbedding
    except ImportError:
        print("embedder-sidecar: fastembed not installed — install via "
              "`pip install fastembed numpy` (see requirements.txt)",
              file=sys.stderr)
        return 2

    embedder = TextEmbedding(MODEL, cache_dir=_cache_dir())
    texts = [item["text"] for item in items]
    embs = np.array(list(embedder.embed(texts)), dtype=np.float32)

    # L2-normalize so the consumer can use a plain dot product as cosine.
    norms = np.linalg.norm(embs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    embs = embs / norms

    vectors = [
        {"id": item["id"], "vector": [round(float(x), 7) for x in emb]}
        for item, emb in zip(items, embs)
    ]
    print(json.dumps({"model": MODEL, "dims": int(embs.shape[1]), "vectors": vectors}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
