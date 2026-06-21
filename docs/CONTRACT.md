# Escrow Contract Reference

Location: `contracts/escrow/src/lib.rs`

## Implemented (Starter Kit)

- `post_job(amount, desc_hash, deadline)`
- `accept_job(job_id)`
- `submit_work(job_id)`
- `approve_work(job_id)`
- `cancel_job(job_id)`
- `get_job(job_id)`
- `get_job_count()`

## Implemented (Contributor Scope)

- `raise_dispute(job_id, evidence_hash, reason_preview)` — raises a dispute with optional evidence
- `resolve_dispute(job_id, resolution)` — resolves a disputed job with basis-point split
- `get_dispute_evidence(job_id)` — retrieves evidence for a disputed job

## Storage Cost Management (issue #15)

To keep the contract economically sustainable, jobs can carry a **refundable
storage deposit** that covers their Soroban storage rent instead of the contract
owner footing the bill.

**The model is opt-in and disabled by default** (rate `0`), so the contract
behaves exactly as before until an admin enables it via the timelock.

- **Deposit sizing:** the deposit is **proportional to the job's expected
  lifetime**. The `Job` entry is fixed-size, so the configured rate represents
  the storage cost of one entry for a single ~30-day period; the deposit is then
  `rate × periods`, where `periods` is the number of ~30-day periods until the
  job's `deadline` (minimum 1, capped at `MAX_STORAGE_PERIODS`). A job with no
  deadline is billed one base period.
- **Collection:** when the rate is non-zero, `post_job` pulls
  `amount + storage_deposit` from the client. The deposit is held separately and
  recorded **per job** (`JobStorageDeposit(job_id)`), **per user**
  (`UserStorageDeposit(address)`), and in a running `TotalStorageDeposits` total.
- **TTL-bump fee:** each non-terminal state transition (`accept_job`,
  `submit_work`, `reject_work`, `extend_job_ttl`) deducts a small,
  **non-refundable** TTL-bump fee from the job's deposit (capped at the remaining
  deposit) and moves it into the withdrawable token-fee pool.
- **Refund:** when a job reaches a terminal state (`approve_work`, `cancel_job`,
  `enforce_deadline`, `mutual_cancel`, `resolve_dispute`) the **remaining
  deposit is refunded to the original payer** (the client).
- **Configuration via timelock:** the two rates are set through the existing
  timelock governance — `AdminOperation::SetStorageDepositRate(i128)` and
  `AdminOperation::SetTtlBumpFee(i128)` — bounded by `MAX_STORAGE_DEPOSIT_RATE`
  and `MAX_TTL_BUMP_FEE`.

### Views

- `quote_storage_deposit(deadline) -> i128` — actual deposit a new job with that
  deadline would require now (rate × lifetime periods). Pass `0` for no deadline.
- `get_storage_deposit_rate() -> i128` / `get_ttl_bump_fee() -> i128` — current rates.
- `get_job_storage_deposit(job_id) -> i128` — remaining deposit for a job.
- `get_user_storage_deposits(user) -> i128` — total deposits a user has locked.
- `get_total_storage_deposits() -> i128` — total deposits held across all jobs.

### Events

- `storage_deposit_collected(job_id, client, amount)` on `post_job`.
- `storage_fee_charged(job_id, fee)` on each TTL-bump fee deduction.
- `storage_deposit_refunded(job_id, payer, amount)` on terminal refund.

## Data Model

### `Job` struct

| Field | Type | Description |
|-------|------|-------------|
| `client` | `Address` | The account that created and funded the job. |
| `freelancer` | `Option<Address>` | The account assigned to the job (`None` until accepted). |
| `amount` | `i128` | Total payment held in escrow (in the token's smallest unit). |
| `description_hash` | `BytesN<32>` | SHA-256 hash of the job description (all-zero hash is rejected). |
| `status` | `JobStatus` | Current lifecycle state of the job. |
| `created_at` | `u64` | **Unix epoch seconds** — set by `e.ledger().timestamp()` at `post_job` time. Read-only after creation. Example: `1710000000` (≈ 2024-03-10 UTC). |
| `deadline` | `u64` | **Unix epoch seconds** — the latest time the job is active. Use `0` for no deadline. Example: `1712592000` (≈ 2024-04-09 UTC, 30 days after the example `created_at`). |
| `token` | `Address` | The whitelisted token contract used for payment. |
| `revision_count` | `u32` | Number of times the client has rejected submitted work (max 3). |

> **Note on `created_at` vs `deadline`:** Both fields use the same unit — Unix epoch **seconds** from the Soroban ledger clock (`e.ledger().timestamp()`). They are never wall-clock timestamps supplied by the caller. `created_at` is always immutable. `deadline == 0` means no expiry enforced.

- `JobStatus`: `Open`, `InProgress`, `SubmittedForReview`, `Completed`, `Cancelled`, `Disputed`

### `DisputeEvidence` struct

| Field | Type | Description |
|-------|------|-------------|
| `evidence_hash` | `BytesN<32>` | SHA-256 hash of the off-chain evidence payload. Zero hash means no evidence provided. |
| `raised_at` | `u64` | Unix timestamp when the dispute was raised (set by `e.ledger().timestamp()`). |
| `reason_preview` | `BytesN<64>` | Short on-chain reason snippet (up to 64 bytes) for indexer display without off-chain resolution. |

### `DisputeResolution` struct

| Field | Type | Description |
|-------|------|-------------|
| `client_bps` | `u32` | Basis-points share for the client (0–10,000). 10,000 = full refund, 0 = full payout to freelancer. |

## Error Codes

- `1` JobNotFound
- `2` Unauthorized
- `3` InvalidStatus
- `4` InsufficientFunds
- `5` JobAlreadyAccepted
- `6` DeadlinePassed
- `7` DeadlineNotExpired
- `8` TokenNotAllowed
- `9` FeeTooHigh
- `10` AlreadyInitialized
- `11` InvalidAmount
- `12` InvalidDescriptionHash
- `13` UnauthorizedAdmin
- `14` InvalidDeadline
- `15` ActiveJobLimitExceeded
- `16` RevisionLimitReached
- `17` DescriptionPayloadTooLarge
