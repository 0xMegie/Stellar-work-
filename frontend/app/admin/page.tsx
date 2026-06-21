"use client";

import {
  cancelOperation,
  executeOperation,
  getFees,
  getJob,
  getJobCount,
  getNativeToken,
  getOperation,
  getProposalsCount,
  getTimelockDelay,
  proposeOperation,
  withdrawFees,
} from "@/lib/contract";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import StatusPill from "@/components/StatusPill";
import SectionCard from "@/components/SectionCard";
import { formatDeadline, toXlm } from "@/lib/format";
import { useWallet } from "@/lib/wallet-context";
import type { AdminOperationTag, Job, JobStatus, ProposalEntry } from "@/lib/types";
import { useEffect, useState, useCallback } from "react";

const STATUS_LABELS: Record<JobStatus, string> = {
  Open: "Open",
  InProgress: "In Progress",
  SubmittedForReview: "Submitted for Review",
  Completed: "Completed",
  Cancelled: "Cancelled",
  Disputed: "Disputed",
};

const OPERATION_LABELS: Record<AdminOperationTag, string> = {
  UpdateFeeBps: "Update Fee (bps)",
  TransferAdmin: "Transfer Admin",
  SetDescPayloadMax: "Set Description Payload Max",
  SetMaxActiveJobsPerClient: "Set Max Active Jobs Per Client",
  AddAllowedToken: "Add Allowed Token",
  RemoveAllowedToken: "Remove Allowed Token",
  WithdrawFees: "Withdraw Fees",
  UpdateTimelockDelay: "Update Timelock Delay",
  SetStorageDepositRate: "Set Storage Deposit Rate (stroops)",
  SetTtlBumpFee: "Set TTL Bump Fee (stroops)",
};

const OPERATION_TAGS = Object.keys(OPERATION_LABELS) as AdminOperationTag[];

function secondsToReadable(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function proposalStatus(op: ProposalEntry["op"]): "pending" | "ready" | "executed" | "cancelled" | "expired" {
  if (op.executed) return "executed";
  if (op.cancelled) return "cancelled";
  const now = Math.floor(Date.now() / 1000);
  const expiry = Number(op.proposed_at) + 2_592_000;
  if (now > expiry) return "expired";
  if (now >= Number(op.earliest_execution)) return "ready";
  return "pending";
}

const STATUS_PILL_CLASSES: Record<ReturnType<typeof proposalStatus>, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  ready: "bg-green-100 text-green-800",
  executed: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-100 text-red-700",
  expired: "bg-orange-100 text-orange-700",
};

type ActiveTab = "overview" | "governance";

export default function AdminPage() {
  const { wallet, connectWallet } = useWallet();

  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [fees, setFees] = useState<number>(0);
  const [nativeToken, setNativeToken] = useState<string>("");
  const [jobs, setJobs] = useState<Array<{ id: number; job: Job }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Governance state
  const [timelockDelay, setTimelockDelay] = useState<number>(3600);
  const [proposals, setProposals] = useState<ProposalEntry[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [proposalSuccess, setProposalSuccess] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<AdminOperationTag>("UpdateFeeBps");
  const [operationValue, setOperationValue] = useState("");
  const [submittingProposal, setSubmittingProposal] = useState(false);
  const [executingId, setExecutingId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const fetchAdminData = useCallback(async (walletAddress: string) => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const token = await getNativeToken();
      setNativeToken(token);

      const accrued = await getFees(token);
      setFees(accrued);

      const count = await getJobCount();
      const fetched: Array<{ id: number; job: Job }> = [];
      for (let id = 1; id <= count; id += 1) {
        const job = await getJob(String(id));
        if (job) fetched.push({ id, job });
      }
      setJobs(fetched);

      const envAdmin = process.env.NEXT_PUBLIC_ADMIN_ADDRESS;
      if (envAdmin) {
        setIsAdmin(walletAddress === envAdmin);
      } else {
        setIsAdmin(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load admin data.");
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProposals = useCallback(async () => {
    setProposalsLoading(true);
    setProposalError(null);
    try {
      const [count, delay] = await Promise.all([
        getProposalsCount(),
        getTimelockDelay(),
      ]);
      setTimelockDelay(delay);
      const entries: ProposalEntry[] = [];
      for (let id = 1; id <= count; id++) {
        const op = await getOperation(String(id));
        if (op) entries.push({ id, op });
      }
      setProposals(entries);
    } catch (e) {
      setProposalError(e instanceof Error ? e.message : "Failed to load proposals.");
    } finally {
      setProposalsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (wallet) {
      fetchAdminData(wallet);
    } else {
      setLoading(false);
      setIsAdmin(null);
      setFees(0);
      setJobs([]);
      setError(null);
      setSuccessMessage(null);
    }
  }, [wallet, fetchAdminData]);

  useEffect(() => {
    if (wallet && activeTab === "governance" && isAdmin) {
      void fetchProposals();
    }
  }, [wallet, activeTab, isAdmin, fetchProposals]);

  const handleWithdraw = async () => {
    if (!nativeToken) return;
    setWithdrawing(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await withdrawFees(nativeToken);
      setSuccessMessage(`Successfully withdrew ${toXlm(fees)} XLM in fees.`);
      setFees(0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Withdraw failed.";
      if (msg.includes("Unauthorized") || msg.includes("#2")) {
        setIsAdmin(false);
        setError("Unauthorized: your wallet is not the contract admin.");
      } else {
        setError(msg);
      }
    } finally {
      setWithdrawing(false);
    }
  };

  const handlePropose = async () => {
    if (!wallet) return;
    setSubmittingProposal(true);
    setProposalError(null);
    setProposalSuccess(null);
    try {
      const opId = await proposeOperation(wallet, selectedTag, operationValue);
      setProposalSuccess(
        `Proposal #${opId} submitted. It can be executed after ${secondsToReadable(timelockDelay)}.`,
      );
      setOperationValue("");
      await fetchProposals();
    } catch (e) {
      setProposalError(e instanceof Error ? e.message : "Failed to submit proposal.");
    } finally {
      setSubmittingProposal(false);
    }
  };

  const handleExecute = async (id: number) => {
    setExecutingId(id);
    setProposalError(null);
    setProposalSuccess(null);
    try {
      await executeOperation(String(id));
      setProposalSuccess(`Proposal #${id} executed successfully.`);
      await fetchProposals();
    } catch (e) {
      setProposalError(e instanceof Error ? e.message : `Failed to execute proposal #${id}.`);
    } finally {
      setExecutingId(null);
    }
  };

  const handleCancel = async (id: number) => {
    if (!wallet) return;
    setCancellingId(id);
    setProposalError(null);
    setProposalSuccess(null);
    try {
      await cancelOperation(wallet, String(id));
      setProposalSuccess(`Proposal #${id} cancelled.`);
      await fetchProposals();
    } catch (e) {
      setProposalError(e instanceof Error ? e.message : `Failed to cancel proposal #${id}.`);
    } finally {
      setCancellingId(null);
    }
  };

  if (!wallet) {
    return (
      <section className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold">Admin Panel</h1>
        <SectionCard className="p-8 text-center">
          <p className="text-slate-600">Connect your wallet to access admin controls.</p>
          <button
            className="mt-4 rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white"
            onClick={async () => {
              try { await connectWallet(); } catch { /* cancelled */ }
            }}
          >
            Connect Wallet
          </button>
        </SectionCard>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold">Admin Panel</h1>
        <p className="text-sm text-slate-600">Loading admin data...</p>
      </section>
    );
  }

  if (isAdmin === false) {
    return (
      <section className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold">Admin Panel</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-medium text-red-800">Unauthorized</p>
          <p className="mt-1 text-sm text-red-600">
            Your wallet ({wallet.slice(0, 6)}...{wallet.slice(-4)}) is not the
            contract admin.
          </p>
        </div>
      </section>
    );
  }

  const statusCounts = jobs.reduce<Record<string, number>>((acc, { job }) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {});

  const pendingProposals = proposals.filter(
    (p) => !p.op.executed && !p.op.cancelled,
  );

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Admin Panel</h1>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {(["overview", "governance"] as ActiveTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              "px-4 py-2 text-sm font-medium capitalize",
              activeTab === tab
                ? "border-b-2 border-slate-900 text-slate-900"
                : "text-slate-500 hover:text-slate-700",
            ].join(" ")}
          >
            {tab}
            {tab === "governance" && pendingProposals.length > 0 && (
              <span className="ml-2 rounded-full bg-yellow-100 px-1.5 py-0.5 text-xs font-semibold text-yellow-800">
                {pendingProposals.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Overview tab ──────────────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <>
          {error && (
            <ErrorBanner
              message={error}
              onDismiss={() => setError(null)}
              onRetry={() => void fetchAdminData(wallet)}
            />
          )}
          {successMessage && (
            <p className="rounded-md bg-green-100 p-3 text-sm text-green-700">
              {successMessage}
            </p>
          )}

          <SectionCard title="Platform Fees">
            <p className="mt-2 flex min-w-0 items-baseline gap-2 text-3xl font-bold">
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap tabular-nums">
                {toXlm(fees)}
              </span>
              <span className="shrink-0 text-base font-semibold">XLM</span>
            </p>
            <p className="text-sm text-slate-500">Accrued platform fees (2.5%)</p>
            <p className="mt-1 text-xs text-slate-400">
              To withdraw via governance, use the Governance tab to propose a
              WithdrawFees operation.
            </p>
            <button
              disabled={withdrawing || fees <= 0}
              className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleWithdraw}
            >
              {withdrawing ? "Withdrawing..." : "Withdraw Fees (direct)"}
            </button>
          </SectionCard>

          <SectionCard title="Job Overview">
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
              <div className="rounded-md border border-slate-200 p-3 text-center">
                <p className="text-2xl font-bold">{jobs.length}</p>
                <p className="text-xs text-slate-500">Total</p>
              </div>
              {(Object.keys(STATUS_LABELS) as JobStatus[]).map((status) => (
                <div
                  key={status}
                  className="rounded-md border border-slate-200 p-3 text-center"
                >
                  <p className="text-2xl font-bold">{statusCounts[status] || 0}</p>
                  <p className="text-xs text-slate-500">{STATUS_LABELS[status]}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="All Jobs">
            {jobs.length === 0 ? (
              <EmptyState
                title="No jobs yet"
                description="Jobs posted to the contract will appear here."
              />
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">
                    All jobs with status, participants, amount, and deadline
                  </caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th scope="col" className="pb-2 pr-4">ID</th>
                      <th scope="col" className="pb-2 pr-4">Status</th>
                      <th scope="col" className="pb-2 pr-4">Client</th>
                      <th scope="col" className="pb-2 pr-4">Freelancer</th>
                      <th scope="col" className="pb-2 pr-4 text-right">Amount</th>
                      <th scope="col" className="pb-2 pr-4">Deadline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map(({ id, job }) => (
                      <tr key={id} className="border-b border-slate-100">
                        <th scope="row" className="py-2 pr-4 font-medium">#{id}</th>
                        <td className="py-2 pr-4">
                          <StatusPill status={job.status} />
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {job.client.slice(0, 8)}...
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {job.freelancer ? `${job.freelancer.slice(0, 8)}...` : "-"}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          <span className="inline-flex min-w-0 items-baseline justify-end gap-1">
                            <span className="min-w-0 max-w-[10rem] overflow-hidden text-ellipsis whitespace-nowrap tabular-nums">
                              {toXlm(job.amount)}
                            </span>
                            <span className="shrink-0">XLM</span>
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-xs">
                          {(() => {
                            const deadline = formatDeadline(job.deadline);
                            if (!deadline) return "None";
                            return `${deadline.isPast ? "Past due" : deadline.relative} • ${deadline.exact}`;
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* ── Governance tab ────────────────────────────────────────────────────── */}
      {activeTab === "governance" && (
        <>
          {proposalError && (
            <ErrorBanner
              message={proposalError}
              onDismiss={() => setProposalError(null)}
              onRetry={fetchProposals}
            />
          )}
          {proposalSuccess && (
            <p className="rounded-md bg-green-100 p-3 text-sm text-green-700">
              {proposalSuccess}
            </p>
          )}

          <SectionCard title="Timelock Settings">
            <div className="mt-2 flex items-center gap-6">
              <div>
                <p className="text-xs text-slate-500">Current delay</p>
                <p className="text-xl font-bold" aria-label="Current timelock delay">
                  {secondsToReadable(timelockDelay)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Proposal expiry</p>
                <p className="text-xl font-bold">30 days</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Pending proposals</p>
                <p className="text-xl font-bold">{pendingProposals.length}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              To change the delay, propose an <code>UpdateTimelockDelay</code>{" "}
              operation below. The new delay must be ≥ 3 600 s (1 h).
            </p>
          </SectionCard>

          {/* New proposal form */}
          <SectionCard title="New Proposal">
            <div className="mt-3 space-y-4">
              <div>
                <label
                  htmlFor="op-type"
                  className="block text-xs font-medium text-slate-600"
                >
                  Operation type
                </label>
                <select
                  id="op-type"
                  value={selectedTag}
                  onChange={(e) => {
                    setSelectedTag(e.target.value as AdminOperationTag);
                    setOperationValue("");
                  }}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  {OPERATION_TAGS.map((tag) => (
                    <option key={tag} value={tag}>
                      {OPERATION_LABELS[tag]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="op-value"
                  className="block text-xs font-medium text-slate-600"
                >
                  {selectedTag === "UpdateFeeBps" && "New fee in basis points (0–10 000)"}
                  {selectedTag === "TransferAdmin" && "New admin address (G…)"}
                  {selectedTag === "SetDescPayloadMax" && "Max bytes (32–65 536)"}
                  {selectedTag === "SetMaxActiveJobsPerClient" && "Limit (0 = unlimited)"}
                  {selectedTag === "AddAllowedToken" && "Token contract address (C…)"}
                  {selectedTag === "RemoveAllowedToken" && "Token contract address (C…)"}
                  {selectedTag === "WithdrawFees" && "Token contract address (C…)"}
                  {selectedTag === "UpdateTimelockDelay" && "New delay in seconds (≥ 3 600)"}
                  {selectedTag === "SetStorageDepositRate" && "Per-job storage deposit in stroops (0 disables)"}
                  {selectedTag === "SetTtlBumpFee" && "TTL-bump fee per transition in stroops (0 disables)"}
                </label>
                <input
                  id="op-value"
                  type="text"
                  value={operationValue}
                  onChange={(e) => setOperationValue(e.target.value)}
                  placeholder={
                    selectedTag === "UpdateFeeBps" ? "250"
                    : selectedTag === "UpdateTimelockDelay" ? "7200"
                    : selectedTag === "TransferAdmin" ? "G..."
                    : selectedTag === "SetStorageDepositRate" ? "100000"
                    : selectedTag === "SetTtlBumpFee" ? "10000"
                    : "C..."
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>

              <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
                After submitting, this operation will be locked for{" "}
                <strong>{secondsToReadable(timelockDelay)}</strong> before it can
                be executed. Proposals expire after 30 days.
              </div>

              <button
                disabled={submittingProposal || !operationValue.trim()}
                onClick={handlePropose}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submittingProposal ? "Submitting..." : "Submit Proposal"}
              </button>
            </div>
          </SectionCard>

          {/* Proposals list */}
          <SectionCard title="All Proposals">
            {proposalsLoading ? (
              <p className="mt-2 text-sm text-slate-500">Loading proposals...</p>
            ) : proposals.length === 0 ? (
              <EmptyState
                title="No proposals yet"
                description="Submitted governance proposals will appear here."
              />
            ) : (
              <div className="mt-3 space-y-3">
                {proposals
                  .slice()
                  .reverse()
                  .map(({ id, op }) => {
                    const status = proposalStatus(op);
                    const earliest = new Date(
                      Number(op.earliest_execution) * 1000,
                    ).toLocaleString();
                    const tagLabel =
                      OPERATION_LABELS[
                        (op.operation?.tag ?? "UpdateFeeBps") as AdminOperationTag
                      ] ?? op.operation?.tag;

                    return (
                      <div
                        key={id}
                        className="rounded-md border border-slate-200 p-4"
                        data-testid={`proposal-${id}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">
                                #{id} — {tagLabel}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL_CLASSES[status]}`}
                              >
                                {status}
                              </span>
                            </div>
                            <p className="mt-1 truncate font-mono text-xs text-slate-500">
                              Proposer: {op.proposer.slice(0, 12)}…
                            </p>
                            <p className="text-xs text-slate-500">
                              Executable after: {earliest}
                            </p>
                          </div>

                          {status !== "executed" && status !== "cancelled" && status !== "expired" && (
                            <div className="flex shrink-0 gap-2">
                              {status === "ready" && (
                                <button
                                  disabled={executingId === id}
                                  onClick={() => void handleExecute(id)}
                                  className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                                >
                                  {executingId === id ? "Executing…" : "Execute"}
                                </button>
                              )}
                              <button
                                disabled={cancellingId === id}
                                onClick={() => void handleCancel(id)}
                                className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                              >
                                {cancellingId === id ? "Cancelling…" : "Cancel"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </section>
  );
}
