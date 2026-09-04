import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root=resolve(import.meta.dirname,'../..');
const output=join(root,'docs/specs/evidence/modular-agon-platform-matrix.json');
const candidates=[
  { major:22, executable:process.env.AGON_NODE22 || '/private/tmp/agon-node-matrix/node-v22.23.2-darwin-arm64/bin/node', archive:'/private/tmp/node-v22.23.2-darwin-arm64.tar.gz', expected:'61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6' },
  { major:24, executable:process.env.AGON_NODE24 || '/private/tmp/agon-node-matrix/node-v24.20.0-darwin-arm64/bin/node', archive:'/private/tmp/node-v24.20.0-darwin-arm64.tar.gz', expected:'40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8' },
  { major:26, executable:process.execPath },
];
const tests=['packages/mod-kernel/src/release-setup.test.ts','tests/unit/modular-selected-lock-integrity.test.ts','tests/unit/modular-first-party-lock-validation.test.ts','tests/unit/modular-installer.test.ts','tests/unit/modular-candidate-process.test.ts','tests/unit/modular-production-surface-bootstrap.test.ts'];
const cells=[];
for(const candidate of candidates){
  if(!existsSync(candidate.executable)){ cells.push({os:'darwin',arch:'arm64',nodeMajor:candidate.major,status:'externally-blocked',reason:'verified Node executable unavailable',expectedCommand:`AGON_NODE${candidate.major}=/path/to/node npm run test:modular-platform-matrix`}); continue; }
  const archiveHash=candidate.archive&&existsSync(candidate.archive)?createHash('sha256').update(readFileSync(candidate.archive)).digest('hex'):null;
  if(candidate.expected&&archiveHash!==candidate.expected) throw new Error(`Node ${candidate.major} archive checksum mismatch`);
  const version=spawnSync(candidate.executable,['--version'],{encoding:'utf8'}).stdout.trim();
  if(Number(version.replace(/^v/,'').split('.')[0])!==candidate.major) throw new Error(`Node major mismatch for ${candidate.executable}`);
  const env={...process.env,PATH:`${dirname(candidate.executable)}:${process.env.PATH??''}`,AGON_HOME:join('/private/tmp',`agon-s9-platform-node${candidate.major}`)};
  const unit=spawnSync(candidate.executable,[join(root,'node_modules/vitest/vitest.mjs'),'run',...tests],{cwd:root,encoding:'utf8',timeout:180000,env});
  const cli=spawnSync(candidate.executable,[join(root,'packages/cli/dist/index.js'),'--version'],{cwd:root,encoding:'utf8',timeout:30000,env:{...env,AGON_MOD_SAFE_MODE:'1'}});
  const passed=unit.status===0&&cli.status===0&&cli.stdout.includes('1.0.0');
  cells.push({os:'darwin',arch:'arm64',nodeMajor:candidate.major,nodeVersion:version,status:passed?'passed':'failed',native:true,archiveSha256:archiveHash,
    checks:{unit:{status:unit.status,stdoutTail:unit.stdout.slice(-1200),stderrTail:unit.stderr.slice(-1200)},cli:{status:cli.status,stdout:cli.stdout.trim(),stderr:cli.stderr.trim()}}});
}
for(const [os,arch] of [['darwin','x64'],['linux','arm64'],['linux','x64']]) for(const major of [22,24,26]) cells.push({os,arch,nodeMajor:major,status:'externally-blocked',native:false,reason:'native runner unavailable in this environment',expectedCommand:'npm run test:modular-platform-matrix'});
const localFailed=cells.some(cell=>cell.os==='darwin'&&cell.arch==='arm64'&&cell.status==='failed');
const result={schemaVersion:1,slice:'S9',passed:!localFailed,nativeHost:{os:process.platform,arch:process.arch,node:process.version},cells,
  summary:{passed:cells.filter(x=>x.status==='passed').length,externallyBlocked:cells.filter(x=>x.status==='externally-blocked').length,failed:cells.filter(x=>x.status==='failed').length}};
if(!process.argv.includes('--no-write'))writeFileSync(output,`${JSON.stringify(result,null,2)}\n`); console.log(JSON.stringify(result.summary,null,2)); if(localFailed)process.exitCode=1;
