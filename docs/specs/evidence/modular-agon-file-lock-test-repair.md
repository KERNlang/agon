# File-lock freshness test repair

The Brainstorm extraction full-suite run passed 6,032 tests and failed the
existing freshness test at `waited >= 250`: observed elapsed time was 236 ms.
The holder-age assertion had already passed. Failed log SHA-256:
`1861fc137a60842207df9d8bbd81175a761b84b49dfbc78b8580f4b1d79748d6`.

The test stamped the holder before writing the file, then started its elapsed
measurement afterward. Source inspection confirms those are different origins;
the holder can expire before the second measurement reaches the threshold.
Scheduling/setup delay is a plausible explanation of this failure, not evidence
of a Brainstorm regression or proof that all lock concurrency is correct.

The replacement controls `Date` and advances it at `Atomics.wait` boundaries.
It exercises the real filesystem and lock function, requires the contender to
wait beyond `staleMs`, and inspects the newly published timestamp. No threshold
was loosened. An in-memory TypeScript mutation removes `freshenPayload()`; the
same freshness predicate accepts the real function and rejects the mutant.
No production source is modified to run this negative control. Other real
cross-process lock tests remain intact.

Targeted deterministic test passed. This is evidence for the freshness oracle,
not complete concurrency, recovery, or native-platform qualification.

The full repository rerun passed 6,033 tests with five existing skips. Log
SHA-256: `14974322ef355e2014f81b59338d50471a53086b0ab0a5c8b1a64f0bc505112b`.
