# Historical evidence archive

The [index](./modular-agon-archive-index.json) records historical artifacts removed
from Git tracking; retained local copies remain ignored. Original receipts remain unchanged. Their indexed raw
paths are historical references, not files required by a clean checkout.
This does not remove schemas, fixtures, generator inputs, or current acceptance
evidence. Fresh qualification must produce fresh receipts for its exact subject.

The durable local archive is `modular-agon-evidence-archive/2026-10-10-2b59937b`
beside the development checkouts, outside every Git worktree. Its manifest
records original paths, commits, byte counts and SHA-256 hashes. Copies were
compared byte-for-byte and restored into a separate directory for verification.
Never delete this archive without Raphael's explicit approval.

Retrieval has two routes:

- Local archive: read `archivePath` relative to that archive directory.
- Git history: run `git show <subjectCommit>:<originalPath>` using the index.
  A shallow clone may need that historical commit before retrieval works.
  `subjectCommit` is the frozen pre-removal snapshot, not the current HEAD.
  Each `lastPathCommit` records the artifact's last change, not a replacement
  for the archive snapshot. Do not substitute a newer commit when retrieving.

Verify retrieved bytes against `sha256` and `bytes` in the index. Historical
retrieval is optional for current builds and tests; it is not a hidden local
prerequisite for release acceptance. GitHub history remains unchanged. Only a
later, separately authorized push can change the PR's current tree.
