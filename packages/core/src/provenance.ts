// Barrel for provenance: the report builder in ./blocks/ and its model in
// ./models/.
// Source of truth:
//   kern/models/provenance.kern → generated/models/provenance.ts  (schema)
//   kern/blocks/provenance.kern → generated/blocks/provenance.ts  (logic)
export {
  buildForgeProvenance,
  renderProvenanceMarkdown,
  renderProvenanceJson,
  sha256OfFile,
  writeProvenanceReport,
} from './blocks/provenance.js';
export type {
  ProvenanceLedger,
  ProvenanceContribution,
} from './models/provenance.js';
