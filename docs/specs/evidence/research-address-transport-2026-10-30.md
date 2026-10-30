# Research address and transport qualification

Status: clean build, runtime, performance and load qualification passed. Not full modular release acceptance.

Runtime subject: `dd90b9cfece7acfbe4df558908a77563423f1e8f`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Request: https://github.com/KERNlang/agon/pull/343#issuecomment-6454481414.

## Changed behavior

The existing Research address filter rejects reserved/local ranges and checks
embedded IPv4 in mapped, well-known NAT64 and 6to4 addresses. Public translated
addresses and the two public IPv4 protocol-anycast exceptions remain allowed.
Documentation ranges use the same filter. IP literals skip DNS, not validation.

Actual HTTP testing exposed two inherited transport failures: native Node26 fetch
and the installed Undici Agent used incompatible dispatch contracts; the pinned
lookup returned a scalar when Node requested an array. Research now uses fetch
and Agent from the same existing dependency and respects lookup's `all` option.
No dependency/version/lockfile change.

## Evidence

Archive ID: `modular-agon-remediation`. Raw logs remain outside shipping packages.
Each named run has `.receipt.json` and `.log` artifacts. Hashes below are SHA256
of the logs. The archive is retained; this index does not replace raw evidence.

| Run | Result | Log SHA256 |
| --- | --- | --- |
| research-address-red-20261030 | Expected classifier failures before repair | 05bda0dfccd826fbc00aa5e57f87621e92d4ceed1b54d7306680fd2e3f0af649 |
| research-documentation-ranges-red-20261030 | Eight expected failures | 02a69f8e3ec87d0a67b70e254a058061fb810441fe9892a81efde0bed12e80fd |
| research-literal-red-20261030 | Five expected failures | 42dac982d81aad9c09d04a1a2b5de10c3abab475b3b2a75ef7ce241f660846ed |
| research-pinned-transport-diagnostic-20261030 | Reproduced dispatcher mismatch | c9718fa6f3da4457e4f18a798595d03e0d2323748d74b97f529fbc2b3e370a1b |
| research-pinned-lookup-contract-red-20261030 | Reproduced lookup contract failure | c5098edf71414b5210193b33817f846641c88d9eb07f8f01dee38d4c92365560 |
| research-pinned-lookup-contract-green-20261030 | 102 tests and package types passed | f7ab301728d419693b87574a09d5431f23f142a5755eba94bc7e99091e2b4b10 |
| research-address-full-build-20261030 | Build, metadata, types, lint, re-export guard passed | cd6750dbfe4b7a2e1fc43c156b879b5c2184b80908481c240d5e148998b1d4f1 |
| research-address-full-runtime-20261030 | 12,159 tests, 7 skips; 129 installed checks passed | 1a34c30fd08760043cb0d33e772ca7c9ecc13c95e06f905c1f35735f576c99eb |
| research-address-clean-build-20261030 | Exact clean commit, locked offline install, build/types/lint/guard passed | 2e81fff8f3bf1934b22579639ed0656e522b4a8016cf623adec07223b4323613 |
| research-address-clean-runtime-20261030 | Exact clean commit; release, supply-chain, full tests, installed checks and diagnostics passed; zero providers | 2fbf97fb6e5a1503df4dfce2d71f2ab90c3cf9a5f4d4f46ecb7d02b2b200567a |
| research-address-clean-perf-load-20261030 | Eight performance suites and two sustained load phases passed; zero providers | e5be254155d56cf3c2585d7ddf2f6e9f11adf25acf679cd33c3e3bcd3e55e3b0 |

The local HTTP fixture uses the real fetch, Agent and connector. It checks the
pinned public address before mapping that address to loopback, then observes two
HTTP requests for source reading and citation verification. This is not public
network or TLS evidence. Fixture provider launches: zero.

## Independent review

Isolated Agon Codex input SHA256:
`46a0e752b92db71e3dfe10fd26b6c0f99942064c9a40518abfd88423cd6ac13c`.
Review log SHA256:
`3379b914817f718b9abd083168b301add4f475317f423774bafea48e86b9d1dc`.
The review predates fixes; it is not an approval of the final diff.

- Mock leakage: refuted by installed Vitest source plus explicit isolation tests
  in normal order and two shuffled orders.
- Missing documentation ranges: confirmed and fixed; failing-before tests retained.
- IPv6 literals: native lookup returned ENOTFOUND for bracketed hosts; fixed.
- Missing transport evidence: confirmed; real local HTTP test added, exposing the
  two transport defects fixed above.
- DNS cancellation: confirmed and retained as a separate follow-up. An aborted
  pending lookup can delay completion and permit later drafting. This PR does not
  claim to fix it or qualify all Research lifecycle behavior.

## Reproduction and limits

On the exact runtime subject, use locked `npm ci --ignore-scripts --no-audit`,
then `npm run build`, `npm run typecheck`, `npm run lint`,
`npm run guard:reexports`, `npm run test:modular-release`,
`npm run test:modular-supply-chain`, `npm test`, and
`node scripts/spec/verify-modular-npx.mjs --no-write` in isolated homes/caches with
providers blocked. Tests need loopback sockets. No global installation is needed.

Measured platform: macOS arm64, Node26.12.1. Other native platforms and Node
versions are not qualified by these runs. Performance and load commands:
`npm run perf:modular-release` and `npm run test:modular-load`.
Full original modular acceptance remains separate.

Protocol sources: [IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry/),
[IANA IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry/),
[RFC6052](https://www.rfc-editor.org/rfc/rfc6052.html#section-3.1),
[RFC3056](https://www.rfc-editor.org/rfc/rfc3056.html#section-2).

