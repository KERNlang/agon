// Facade over the KERN-generated synthesis planner. Edit the source at
// packages/forge/src/kern/synth-plan.kern, then `npm run kern:compile`.
export { planSynthesis } from '../generated/synth-plan.js';
export type { SynthCandidate, SynthPlanOpts, SynthPlan } from '../generated/synth-plan.js';
