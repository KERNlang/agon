import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root=resolve(import.meta.dirname,'../..');
const output=join(root,'docs/specs/evidence/modular-agon-platform-matrix.json');
const startedAt=new Date().toISOString();
// This flag records the runner operator's attestation, not hardware detection.
const nativeRunner=process.argv.includes('--native-runner');
// Invalidate old evidence before validation or child processes can fail.
if(!process.argv.includes('--no-write'))writeFileSync(output,`${JSON.stringify({schemaVersion:1,slice:'S9',passed:false,status:'incomplete',startedAt,cells:[],summary:{passed:0,externallyBlocked:0,failed:0}},null,2)}\n`);
const expectedVersion=JSON.parse(readFileSync(join(root,'packages/cli/package.json'),'utf8')).version;
const localTarget={os:process.platform,arch:process.arch};
const targets=[['darwin','arm64'],['darwin','x64'],['linux','arm64'],['linux','x64']];
if(!targets.some(([os,arch])=>os===localTarget.os&&arch===localTarget.arch)) throw new Error('Unsupported native qualification host');
const cachedNodes=[
  { major:22, executable:'/private/tmp/agon-node-matrix/node-v22.23.2-darwin-arm64/bin/node', archive:'/private/tmp/node-v22.23.2-darwin-arm64.tar.gz', expected:'61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6' },
  { major:24, executable:'/private/tmp/agon-node-matrix/node-v24.20.0-darwin-arm64/bin/node', archive:'/private/tmp/node-v24.20.0-darwin-arm64.tar.gz', expected:'40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8' },
];
const hostMajor=Number(process.version.replace(/^v/,'').split('.')[0]);
const candidates=[22,24,26].map(major=>{
  const override=process.env[`AGON_NODE${major}`];
  if(override) return {major,executable:override};
  if(major===hostMajor) return {major,executable:process.execPath};
  return (process.platform==='darwin'&&process.arch==='arm64' ? cachedNodes.find(node=>node.major===major) : undefined)
    ?? {major,executable:''};
});
const tests=['packages/mod-kernel/src/release-setup.test.ts','tests/unit/modular-selected-lock-integrity.test.ts','tests/unit/modular-first-party-lock-validation.test.ts','tests/unit/modular-installer.test.ts','tests/unit/modular-candidate-process.test.ts','tests/unit/modular-production-surface-bootstrap.test.ts'];
const cells=[];
for(const candidate of candidates){
  if(!existsSync(candidate.executable)){ cells.push({...localTarget,nodeMajor:candidate.major,status:'externally-blocked',reason:'verified Node executable unavailable',expectedCommand:`AGON_NODE${candidate.major}=/path/to/node npm run test:modular-platform-matrix`}); continue; }
  try {
  const archiveHash=candidate.archive&&existsSync(candidate.archive)?createHash('sha256').update(readFileSync(candidate.archive)).digest('hex'):null;
  if(candidate.expected&&archiveHash!==candidate.expected) throw new Error(`Node ${candidate.major} archive checksum mismatch`);
  if(candidate.archive){
    const archived=spawnSync('tar',['-xOf',candidate.archive,`${basename(candidate.archive,'.tar.gz')}/bin/node`],{timeout:30000,maxBuffer:256*1024*1024});
    if(archived.status!==0)throw new Error(`Node ${candidate.major} archive member unreadable`);
    const binaryHash=createHash('sha256').update(readFileSync(candidate.executable)).digest('hex');
    if(binaryHash!==createHash('sha256').update(archived.stdout).digest('hex'))throw new Error(`Node ${candidate.major} executable differs from verified archive`);
  }
  const probe=spawnSync(candidate.executable,['-p','JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'],{encoding:'utf8',timeout:30000});
  if(probe.status!==0) throw new Error(`Node ${candidate.major} identity probe failed`);
  const identity=JSON.parse(probe.stdout.trim());
  const version=identity.version;
  if(Number(version.replace(/^v/,'').split('.')[0])!==candidate.major) throw new Error(`Node major mismatch for ${candidate.executable}`);
  if(identity.platform!==localTarget.os||identity.arch!==localTarget.arch){
    cells.push({...localTarget,nodeMajor:candidate.major,status:'externally-blocked',native:false,
      reason:'candidate runtime does not match the qualification host',observedRuntime:identity});
    continue;
  }
  if(realpathSync(join(dirname(candidate.executable),'node'))!==realpathSync(candidate.executable))throw new Error(`Node ${candidate.major} override does not match child PATH node`);
  const runtimeHome=mkdtempSync(join(tmpdir(),'agon-s9-platform-'));
  let cell;
  try {
  const env={...process.env,PATH:`${dirname(candidate.executable)}:${process.env.PATH??''}`,AGON_HOME:runtimeHome};
  const unit=spawnSync(candidate.executable,[join(root,'node_modules/vitest/vitest.mjs'),'run',...tests],{cwd:root,encoding:'utf8',timeout:180000,env});
  const cli=spawnSync(candidate.executable,[join(root,'packages/cli/dist/index.js'),'--version'],{cwd:root,encoding:'utf8',timeout:30000,env:{...env,AGON_MOD_SAFE_MODE:'1'}});
  const passed=unit.status===0&&cli.status===0&&cli.stdout.trim().replace(/^\[log\] /,'')===expectedVersion;
  cell={...localTarget,nodeMajor:candidate.major,nodeVersion:version,status:passed?'passed':'failed',native:nativeRunner,archiveSha256:archiveHash,
    checks:{unit:{status:unit.status,stdoutTail:unit.stdout.slice(-1200),stderrTail:unit.stderr.slice(-1200)},cli:{status:cli.status,stdout:cli.stdout.trim(),stderr:cli.stderr.trim()}}};
  } finally { rmSync(runtimeHome,{recursive:true,force:true}); }
  cells.push(cell);
  } catch(error) {
    cells.push({...localTarget,nodeMajor:candidate.major,status:'failed',native:false,reason:error instanceof Error?error.message:String(error)});
  }
}
for(const [os,arch] of targets.filter(([os,arch])=>os!==localTarget.os||arch!==localTarget.arch)) for(const major of [22,24,26]) cells.push({os,arch,nodeMajor:major,status:'externally-blocked',native:false,reason:'native runner unavailable in this environment',expectedCommand:'npm run test:modular-platform-matrix'});
const localFailed=cells.some(cell=>cell.os===localTarget.os&&cell.arch===localTarget.arch&&cell.status==='failed');
const passed=!localFailed&&cells.some(cell=>cell.status==='passed');
const result={schemaVersion:1,slice:'S9',passed,status:'completed',startedAt,runnerProvenance:nativeRunner?'caller-attested-native':'diagnostic',runtimeHost:{os:process.platform,arch:process.arch,node:process.version},cells,
  summary:{passed:cells.filter(x=>x.status==='passed').length,externallyBlocked:cells.filter(x=>x.status==='externally-blocked').length,failed:cells.filter(x=>x.status==='failed').length}};
if(!process.argv.includes('--no-write'))writeFileSync(output,`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify(process.argv.includes('--json')?result:result.summary,null,2));
if(localFailed&&!process.argv.includes('--json'))console.log(JSON.stringify(cells.filter(cell=>cell.status==='failed'),null,2));
if(!passed)process.exitCode=1;
