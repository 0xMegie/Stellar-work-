# TTL Read Bump Implementation Plan

Issue: #3 — read-only contract functions can allow persistent Soroban storage entries to expire.

## Intended contract changes

The fix should make every public read path refresh persistent storage TTL for entries it touches. The important changes are:

- `get_job` should load the job, call `bump_job_ttl(&e, job_id, &job)`, then return it.
- `get_jobs_batch` should bump each returned job once.
- `get_jobs_by_status` and count helpers should bump each `DataKey::Job(id)` entry discovered during iteration.
- `get_fees` / `get_token_fees` should call `bump_token_fees_ttl` when the `DataKey::TokenFees(token)` key exists.
- TTL bumps should preserve existing active-vs-archival behavior through `bump_job_ttl`.
- Any new helper should check `persistent().has(&key)` before `extend_ttl` on keys that may not exist.

## Gas impact

Expected impact is approximately one additional `extend_ttl` host function call per job key touched by a read. For single-job reads, this is expected to be negligible, roughly ~5,000 gas per call based on the issue report. Paginated reads scale linearly with returned/scanned jobs, so client-facing pagination limits should remain bounded.

## Testing notes

Add tests that:

1. Create one or more jobs.
2. Advance simulated ledgers close to the active job TTL threshold.
3. Call read-only functions such as `get_job`, `get_jobs_batch`, `get_jobs_by_status`, and count methods.
4. Advance simulated ledgers again.
5. Confirm the job data remains available.

The Soroban test harness may not automatically archive expired persistent entries, so tests should use available ledger/TTL inspection utilities where possible and document any limitations.
