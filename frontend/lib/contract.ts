"use client";

import { callContract, nativeToScVal, xdr } from "@/lib/stellar";
import type { AdminOperationTag, DisputeEvidence, Job, TimelockedOperation } from "@/lib/types";

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) {
    throw new Error("Invalid hex input.");
  }
  if (!/^[0-9a-fA-F]*$/.test(normalized)) {
    throw new Error("Invalid hex input.");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
}

export function requireContractId(): string {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
  if (!contractId) {
    throw new Error("NEXT_PUBLIC_CONTRACT_ID is not configured.");
  }
  return contractId;
}

/**
 * Post a new job.
 *
 * Note (issue #15): when the admin has enabled the storage-deposit model, the
 * contract also pulls a refundable storage deposit from the client on top of
 * `amount`. The connected wallet must therefore hold `amount + storageDeposit`.
 * Use {@link quoteStorageDeposit} to show the deposit before submitting; it is
 * refunded (minus any consumed TTL-bump fees) when the job reaches a terminal
 * state. The deposit is calculated on-chain, so no extra argument is required.
 */
export async function postJob(
  client: string,
  amount: string,
  descHashHex: string,
  descriptionPayloadLen: number,
  deadline: string,
  tokenAddress: string,
) {
  return callContract(requireContractId(), "post_job", [
    nativeToScVal(client, { type: "address" }),
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(hexToBytes(descHashHex), { type: "bytes" }),
    nativeToScVal(descriptionPayloadLen, { type: "u32" }),
    nativeToScVal(deadline, { type: "u64" }),
    nativeToScVal(tokenAddress, { type: "address" }),
  ]);
}

export async function getCompletedJobsCount(): Promise<number> {
  const response = await callContract(
    requireContractId(),
    "get_completed_jobs_count",
    [],
    { readOnly: true },
  );
  return Number(response.data ?? 0);
}

export async function getDescPayloadMax(): Promise<number> {
  const response = await callContract(
    requireContractId(),
    "get_desc_payload_max",
    [],
    { readOnly: true },
  );
  return Number(response.data ?? 0);
}

export async function acceptJob(freelancer: string, jobId: string) {
  return callContract(requireContractId(), "accept_job", [
    nativeToScVal(freelancer, { type: "address" }),
    nativeToScVal(jobId, { type: "u64" }),
  ]);
}

export async function submitWork(freelancer: string, jobId: string) {
  return callContract(requireContractId(), "submit_work", [
    nativeToScVal(freelancer, { type: "address" }),
    nativeToScVal(jobId, { type: "u64" }),
  ]);
}

export async function approveWork(client: string, jobId: string) {
  return callContract(requireContractId(), "approve_work", [
    nativeToScVal(client, { type: "address" }),
    nativeToScVal(jobId, { type: "u64" }),
  ]);
}

export async function cancelJob(client: string, jobId: string) {
  return callContract(requireContractId(), "cancel_job", [
    nativeToScVal(client, { type: "address" }),
    nativeToScVal(jobId, { type: "u64" }),
  ]);
}

export async function enforceDeadline(client: string, jobId: string) {
  return callContract(requireContractId(), "enforce_deadline", [
    nativeToScVal(client, { type: "address" }),
    nativeToScVal(jobId, { type: "u64" }),
  ]);
}

export async function extendJobTtl(caller: string, jobId: string) {
  return callContract(requireContractId(), "extend_job_ttl", [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(jobId, { type: "u64" }),
  ]);
}

export async function raiseDispute(
  caller: string,
  jobId: string,
  evidenceHash?: string,
  reasonPreview?: string,
) {
  const args = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(jobId, { type: "u64" }),
  ];

  if (evidenceHash) {
    args.push(nativeToScVal(hexToBytes(evidenceHash), { type: "bytes" }));
  } else {
    args.push(nativeToScVal(null, { type: "option" }));
  }

  if (reasonPreview) {
    const previewBytes = new TextEncoder().encode(reasonPreview.padEnd(64, "\0").slice(0, 64));
    args.push(nativeToScVal(previewBytes, { type: "bytes" }));
  } else {
    args.push(nativeToScVal(null, { type: "option" }));
  }

  return callContract(requireContractId(), "raise_dispute", args);
}

export async function resolveDispute(jobId: string, winner: string) {
  return callContract(requireContractId(), "resolve_dispute", [
    nativeToScVal(jobId, { type: "u64" }),
    nativeToScVal(winner, { type: "address" }),
  ]);
}

export async function withdrawFees(tokenAddress: string) {
  return callContract(requireContractId(), "withdraw_fees", [
    nativeToScVal(tokenAddress, { type: "address" }),
  ]);
}

export async function getFees(tokenAddress: string): Promise<number> {
  const response = await callContract(
    requireContractId(),
    "get_fees",
    [nativeToScVal(tokenAddress, { type: "address" })],
    { readOnly: true },
  );
  return Number(response.data ?? 0);
}

export async function addAllowedToken(tokenAddress: string) {
  return callContract(requireContractId(), "add_allowed_token", [
    nativeToScVal(tokenAddress, { type: "address" }),
  ]);
}

export async function removeAllowedToken(tokenAddress: string) {
  return callContract(requireContractId(), "remove_allowed_token", [
    nativeToScVal(tokenAddress, { type: "address" }),
  ]);
}

export async function isTokenAllowed(tokenAddress: string): Promise<boolean> {
  const response = await callContract(
    requireContractId(),
    "is_token_allowed",
    [nativeToScVal(tokenAddress, { type: "address" })],
    { readOnly: true },
  );
  return Boolean(response.data ?? false);
}

export async function getNativeToken(): Promise<string> {
  const response = await callContract(
    requireContractId(),
    "get_native_token",
    [],
    { readOnly: true },
  );
  return String(response.data ?? "");
}

export async function getJob(jobId: string): Promise<Job | null> {
  const response = await callContract(
    requireContractId(),
    "get_job",
    [nativeToScVal(jobId, { type: "u64" })],
    { readOnly: true },
  );
  return (response.data as Job) ?? null;
}

export async function getDisputeEvidence(
  jobId: string,
): Promise<DisputeEvidence | null> {
  const response = await callContract(
    requireContractId(),
    "get_dispute_evidence",
    [nativeToScVal(jobId, { type: "u64" })],
    { readOnly: true },
  );
  return (response.data as DisputeEvidence) ?? null;
}

export async function getJobCount(): Promise<number> {
  const response = await callContract(
    requireContractId(),
    "get_job_count",
    [],
    {
      readOnly: true,
    },
  );
  return Number(response.data ?? 0);
}

// ── Storage cost management (issue #15) ────────────────────────────────────────

/** Per-job storage deposit rate in stroops. 0 means deposits are disabled. */
export async function getStorageDepositRate(): Promise<number> {
  const response = await callContract(
    requireContractId(),
    "get_storage_deposit_rate",
    [],
    { readOnly: true },
  );
  return Number(response.data ?? 0);
}

/**
 * Storage deposit (in stroops) a new job with the given `deadline` would
 * require now. The deposit scales with the job's expected lifetime, so pass the
 * job's deadline (Unix seconds, or "0" for no deadline) to get the real figure.
 */
export async function quoteStorageDeposit(deadline: string): Promise<number> {
  const response = await callContract(
    requireContractId(),
    "quote_storage_deposit",
    [nativeToScVal(deadline, { type: "u64" })],
    { readOnly: true },
  );
  return Number(response.data ?? 0);
}

/** Total refundable storage deposits (stroops) a user has locked across jobs. */
export async function getUserStorageDeposits(userAddress: string): Promise<number> {
  const response = await callContract(
    requireContractId(),
    "get_user_storage_deposits",
    [nativeToScVal(userAddress, { type: "address" })],
    { readOnly: true },
  );
  return Number(response.data ?? 0);
}

/** Non-refundable TTL-bump fee (stroops) deducted per state transition. */
export async function getTtlBumpFee(): Promise<number> {
  const response = await callContract(
    requireContractId(),
    "get_ttl_bump_fee",
    [],
    { readOnly: true },
  );
  return Number(response.data ?? 0);
}

/** Total refundable storage deposits (stroops) currently held by the contract. */
export async function getTotalStorageDeposits(): Promise<number> {
  const response = await callContract(
    requireContractId(),
    "get_total_storage_deposits",
    [],
    { readOnly: true },
  );
  return Number(response.data ?? 0);
}

/** Remaining refundable storage deposit (stroops) held for a specific job. */
export async function getJobStorageDeposit(jobId: string): Promise<number> {
  const response = await callContract(
    requireContractId(),
    "get_job_storage_deposit",
    [nativeToScVal(jobId, { type: "u64" })],
    { readOnly: true },
  );
  return Number(response.data ?? 0);
}

// ── Timelocked governance ─────────────────────────────────────────────────────

function encodeAdminOperation(tag: AdminOperationTag, value: unknown): xdr.ScVal {
  let encodedValue: xdr.ScVal;
  switch (tag) {
    case "UpdateFeeBps":
      encodedValue = nativeToScVal(BigInt(value as string | number), { type: "i128" });
      break;
    case "TransferAdmin":
    case "AddAllowedToken":
    case "RemoveAllowedToken":
    case "WithdrawFees":
      encodedValue = nativeToScVal(value as string, { type: "address" });
      break;
    case "SetDescPayloadMax":
    case "SetMaxActiveJobsPerClient":
      encodedValue = nativeToScVal(Number(value), { type: "u32" });
      break;
    case "UpdateTimelockDelay":
      encodedValue = nativeToScVal(BigInt(value as string | number), { type: "u64" });
      break;
    case "SetStorageDepositRate":
    case "SetTtlBumpFee":
      encodedValue = nativeToScVal(BigInt(value as string | number), { type: "i128" });
      break;
    default:
      throw new Error(`Unknown AdminOperation tag: ${tag}`);
  }
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol(tag),
      val: encodedValue,
    }),
  ]);
}

export async function proposeOperation(
  caller: string,
  tag: AdminOperationTag,
  value: unknown,
): Promise<number> {
  const operation = encodeAdminOperation(tag, value);
  const response = await callContract(requireContractId(), "propose_operation", [
    nativeToScVal(caller, { type: "address" }),
    operation,
  ]);
  return Number(response.data ?? 0);
}

export async function executeOperation(opId: string) {
  return callContract(requireContractId(), "execute_operation", [
    nativeToScVal(opId, { type: "u64" }),
  ]);
}

export async function cancelOperation(caller: string, opId: string) {
  return callContract(requireContractId(), "cancel_operation", [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(opId, { type: "u64" }),
  ]);
}

export async function getOperation(opId: string): Promise<TimelockedOperation | null> {
  const response = await callContract(
    requireContractId(),
    "get_operation",
    [nativeToScVal(opId, { type: "u64" })],
    { readOnly: true },
  );
  return (response.data as TimelockedOperation) ?? null;
}

export async function getTimelockDelay(): Promise<number> {
  const response = await callContract(
    requireContractId(),
    "get_timelock_delay",
    [],
    { readOnly: true },
  );
  return Number(response.data ?? 3600);
}

export async function getProposalsCount(): Promise<number> {
  const response = await callContract(
    requireContractId(),
    "get_proposals_count",
    [],
    { readOnly: true },
  );
  return Number(response.data ?? 0);
}

// ── Circuit breaker: pause / unpause ───────────────────────────────────────────

export async function pauseContract(caller: string) {
  return callContract(requireContractId(), "pause", [
    nativeToScVal(caller, { type: "address" }),
  ]);
}

export async function unpauseContract(caller: string) {
  return callContract(requireContractId(), "unpause", [
    nativeToScVal(caller, { type: "address" }),
  ]);
}

export async function getContractState(): Promise<string> {
  const response = await callContract(
    requireContractId(),
    "get_contract_state",
    [],
    { readOnly: true },
  );
  return String(response.data ?? "Active");
}
