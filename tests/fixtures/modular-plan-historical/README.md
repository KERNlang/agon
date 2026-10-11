# Historical headless Plan records

Synthetic records captured from the compiled public Plan factory at commit
`ca3b88d85e73fea8ab619e9c4cfcfad31d224e69`. No personal history or provider ran.
The factory produced an awaiting-approval proposal, its cancellation, and an
auto-approved proposal which said running without dispatching execution.

Tracked files match the raw capture bytes, including the final newline.
Originals and their SHA-256 manifest remain in the durable external
evidence directory `modular-agon-remediation/plan-headless-corpus-ca3b88d8`.
The source capture receipt is `plan-headless-historical-capture.receipt.json`,
log SHA-256 `1d5d58e8f43f9a1bb154f5203364dc74433cac6b045ef86cc103be5fc8501f78`.

These fixtures prove historical inspection compatibility. They are not valid
execution records: they have no aggregate cost fields or step context. Do not
normalize them into new records or add results to make execution tests pass.
