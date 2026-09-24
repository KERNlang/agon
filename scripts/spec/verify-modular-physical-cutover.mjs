import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const map=JSON.parse(readFileSync(resolve(root,'docs/specs/evidence/modular-agon-package-map.json'),'utf8'));
const mods=map.packages.filter((entry)=>entry.class==='user-toggleable-mod-package').map((entry)=>entry.id);
const rows=mods.map((id)=>{const short=id.replace('@kernlang/agon-mod-','');const dir=resolve(root,'packages','mod-'+short);const implementation=resolve(dir,'src/implementation.ts');const index=readFileSync(resolve(dir,'src/index.ts'),'utf8');return {id,physical:existsSync(implementation)&&index.includes("IMPLEMENTATION_KIND = 'physical'"),compatibility:index.includes('firstPartyCompatibility')||index.includes('FirstPartyCompatibilityRuntime')};});
const physical=rows.filter((row)=>row.physical&&!row.compatibility);const remaining=rows.filter((row)=>!physical.includes(row));
const receipt={schemaVersion:2,gate:'first-party-physical-package-coverage',scope:'implementation-presence-only',
  warning:'This gate does not prove legacy owner removal or generated-surface authority; verify-modular-kill-list.mjs owns that acceptance truth.',
  passed:physical.length===36,counts:{target:36,physical:physical.length,remaining:remaining.length},physical:physical.map(({id})=>id),remaining};
if(!process.argv.includes('--no-write'))writeFileSync(resolve(root,'docs/specs/evidence/modular-agon-physical-cutover.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));if(!receipt.passed)process.exitCode=1;
