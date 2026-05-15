# @agon/dedup

Brainstorm dedup sidecar — collapses near-duplicate engine drafts so you don't read the same idea three times.

## Why Python

- Semantic similarity needs sentence embeddings, not bag-of-words. TF-IDF was tried first and scored 0.06 between drafts that say the same thing in different words. Useless for this task.
- `fastembed` (ONNX-based, ~30MB) gives proper paraphrase detection at ~500ms cold start without dragging in torch.
- TS has no comparable library — `transformers.js` works but the WASM cold-start is multi-second and the model is 80MB+ on first download.

This is the boundary where Python is *actually better*, not just different.

## Install

```bash
python3 -m pip install --user -r packages/dedup/requirements.txt
# or:
npm run install:python -w packages/dedup
```

Model is downloaded once on first run (~80MB) and cached under `~/.cache/fastembed/`.

## Use

```bash
# JSONL on stdin, JSON on stdout
echo '{"id":"claude","text":"Ship A"}
{"id":"codex","text":"Pick option A"}
{"id":"gemini","text":"Hold off entirely"}' | python3 packages/dedup/sidecar.py
```

Output:

```json
{
  "groups": [
    {"members": ["claude", "codex"], "representative": "codex", "similarity": 0.7},
    {"members": ["gemini"], "representative": "gemini", "similarity": 1.0}
  ],
  "threshold": 0.65,
  "method": "minilm-cosine"
}
```

## Test

```bash
npm run test:sidecar -w packages/dedup
```

The smoke test feeds three drafts (two paraphrases + one dissent) and asserts the paraphrases group while the dissent stays alone.

## Tuning

`THRESHOLD = 0.65` in `sidecar.py`. Calibration:

| Pair                                  | MiniLM cosine |
| ------------------------------------- | ------------- |
| Identical text                        | 1.0           |
| Same idea, different wording          | 0.7 – 0.9     |
| Related topic                         | 0.4 – 0.7     |
| Unrelated                             | < 0.3         |

Lower = more aggressive merging (risk: collapsing real disagreement). Higher = more conservative (risk: missing obvious paraphrases).

## Spawn model

Per-call subprocess. Agon spawns `python3 sidecar.py` only when it has drafts to dedupe, matching how engine adapters spawn their CLIs. Cold-start is the model load (~500ms). For 6 drafts the full call lands in well under 2s — negligible against an 8-12 minute brainstorm.

## Phase 0 status

- [x] Sidecar built and smoke-tested
- [x] Workspace registered
- [ ] Wired into `runBrainstorm` so the bids table shows `(N engines agree)` — next commit
- [ ] Integration test against a real `agon brainstorm` call
- [ ] Optional: cache embeddings per session so identical drafts across re-runs reuse vectors
