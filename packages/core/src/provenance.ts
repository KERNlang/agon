// ── Provenance / transparency reports — KERN-sourced ─────────────────
// Source of truth:
//   kern/models/provenance.kern → generated/models/provenance.ts  (schema)
//   kern/blocks/provenance.kern → generated/blocks/provenance.ts  (logic)
export {
  buildForgeProvenance,
  renderProvenanceMarkdown,
  renderProvenanceJson,
  sha256OfFile,
  writeProvenanceReport,
} from './generated/blocks/provenance.js';
export type {
  ProvenanceLedger,
  ProvenanceContribution,
} from './generated/models/provenance.js';
