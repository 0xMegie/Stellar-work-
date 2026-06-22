export type JobStatus =
  | "Open"
  | "InProgress"
  | "SubmittedForReview"
  | "Completed"
  | "Cancelled"
  | "Disputed";

export interface Job {
  client: string;
  freelancer: string | null;
  amount: string;
  /** SHA-256 hex digest of the job description text (IPFS multihash digest, backward-compatible). */
  description_hash: string;
  status: JobStatus;
  created_at: string;
  deadline: string;
  token: string;
  revision_count: number;
}

export interface DisputeEvidence {
  evidence_hash: string;
  raised_at: string;
  reason_preview: string;
}

export type AdminOperationTag =
  | "UpdateFeeBps"
  | "TransferAdmin"
  | "SetDescPayloadMax"
  | "SetMaxActiveJobsPerClient"
  | "AddAllowedToken"
  | "RemoveAllowedToken"
  | "WithdrawFees"
  | "UpdateTimelockDelay"
  | "SetStorageDepositRate"
  | "SetTtlBumpFee";

export interface TimelockedOperation {
  proposer: string;
  operation: { tag: AdminOperationTag; value: unknown };
  proposed_at: string;
  earliest_execution: string;
  executed: boolean;
  cancelled: boolean;
}

export interface ProposalEntry {
  id: number;
  op: TimelockedOperation;
}
