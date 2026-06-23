"use client";

import {
  approveWork,
  cancelJob,
  getJob,
  getJobCount,
  getCompletedJobsCount,
  submitWork,
  enforceDeadline,
} from "@/lib/contract";
import CancelJobConfirmModal from "@/components/CancelJobConfirmModal";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import InfoTooltip from "@/components/InfoTooltip";
import JobCardSkeleton from "@/components/JobCardSkeleton";
import NoResultsState from "@/components/NoResultsState";
import SectionCard from "@/components/SectionCard";
import StatusPill from "@/components/StatusPill";
import { useToast } from "@/components/ToastProvider";
import { formatDeadline, toXlm } from "@/lib/format";
import { useWallet } from "@/lib/wallet-context";
import type { Job, JobStatus } from "@/lib/types";
import { resolveJobDescriptions } from "@/lib/resolver";
import { useEffect, useState, useCallback, useRef, type KeyboardEvent } from "react";

const STATUS_OPTIONS: JobStatus[] = [
  "Open",
  "InProgress",
  "SubmittedForReview",
  "Completed",
  "Cancelled",
];

const STATUS_LABELS: Record<JobStatus, string> = {
  Open: "Open",
  InProgress: "In Progress",
  SubmittedForReview: "Submitted for Review",
  Completed: "Completed",
  Cancelled: "Cancelled",
  Disputed: "Disputed",
};

export default function DashboardPage() {
  const { wallet, connectWallet } = useWallet();
  const { showSuccess, showError } = useToast();
  const [allJobs, setAllJobs] = useState<Array<{ id: number; job: Job }>>([]);
  const [statusFilter, setStatusFilter] = useState<JobStatus | "All">("All");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [pendingCancelJobId, setPendingCancelJobId] = useState<number | null>(null);
  const [completedJobsCount, setCompletedJobsCount] = useState<number | null>(null);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const pinataGateway = process.env.NEXT_PUBLIC_PINATA_GATEWAY;
  const filterOptions: Array<JobStatus | "All"> = ["All", ...STATUS_OPTIONS];
  const filterButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const fetchJobs = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    setError(null);
    try {
      const count = await getJobCount();
      const fetched: Array<{ id: number; job: Job }> = [];
      for (let id = 1; id <= count; id += 1) {
        const job = await getJob(String(id));
        if (job && (job.client === wallet || job.freelancer === wallet)) {
          fetched.push({ id, job });
        }
      }
      setAllJobs(fetched);
      try {
        const completed = await getCompletedJobsCount();
        setCompletedJobsCount(completed);
      } catch {
        setCompletedJobsCount(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch jobs.");
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    if (wallet) {
      fetchJobs();
    } else {
      setAllJobs([]);
      setCompletedJobsCount(null);
      setLoading(false);
      setError(null);
    }
  }, [wallet, fetchJobs]);

  // Resolve descriptions for all loaded jobs whenever the job list changes.
  useEffect(() => {
    if (allJobs.length === 0) return;
    const hashes = allJobs.map(({ job }) => job.description_hash);
    let mounted = true;
    void resolveJobDescriptions(hashes, pinataGateway).then((resolved) => {
      if (!mounted) return;
      const next: Record<string, string> = {};
      for (const [hash, result] of resolved) {
        next[hash] = result.text;
      }
      setDescriptions(next);
    });
    return () => { mounted = false; };
  }, [allJobs, pinataGateway]);

  const handleAction = async (
    fn: () => Promise<unknown>,
    jobId: number,
    successMessage = "Action completed successfully.",
  ) => {
    setActionLoading(jobId);
    setError(null);
    try {
      await fn();
      await fetchJobs();
      setError(null);
      showSuccess(successMessage);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Action failed.";
      setError(message);
      showError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmCancel = async () => {
    if (!wallet || pendingCancelJobId === null) {
      return;
    }
    const jobId = pendingCancelJobId;
    await handleAction(
      () => cancelJob(wallet, String(jobId)),
      jobId,
      "Job cancelled and funds refunded.",
    );
    setPendingCancelJobId(null);
  };

  const postedJobs = allJobs.filter((j) => j.job.client === wallet);
  const acceptedJobs = allJobs.filter((j) => j.job.freelancer === wallet);

  const filterJobs = (jobs: Array<{ id: number; job: Job }>) => {
    if (statusFilter === "All") return jobs;
    return jobs.filter((j) => j.job.status === statusFilter);
  };

  const filteredPosted = filterJobs(postedJobs);
  const filteredAccepted = filterJobs(acceptedJobs);

  const handleFilterKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex =
      (index + delta + filterOptions.length) % filterOptions.length;
    const nextFilter = filterOptions[nextIndex];
    setStatusFilter(nextFilter);
    filterButtonRefs.current[nextIndex]?.focus();
  };

  if (!wallet) {
    return (
      <section className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <SectionCard className="p-8 text-center">
          <p className="text-slate-600">Connect your wallet to view your jobs.</p>
          <button
            className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
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

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 sm:max-w-md">
        <div className="interactive-card p-4">
          <p className="text-2xl font-bold tabular-nums">
            {completedJobsCount ?? "—"}
          </p>
          <p className="text-xs text-slate-500">Completed jobs (contract)</p>
        </div>
        <div className="interactive-card p-4">
          <p className="text-2xl font-bold tabular-nums">{allJobs.length}</p>
          <p className="text-xs text-slate-500">Your jobs on record</p>
        </div>
      </div>

      <div
        className="flex flex-wrap gap-2"
        role="toolbar"
        aria-label="Filter jobs by status"
      >
        <div className="mr-1 flex items-center gap-2 text-sm text-slate-600">
          <span>Filter:</span>
          <InfoTooltip
            label="Filter jobs by status help"
            content="Use the status chips to narrow your job history. Arrow keys move between filters."
          />
        </div>
        {filterOptions.map((s, index) => (
          <button
            key={s}
            ref={(element) => {
              filterButtonRefs.current[index] = element;
            }}
            className={`rounded-full px-3 py-1 text-sm ${statusFilter === s ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
            onClick={() => setStatusFilter(s)}
            onKeyDown={(event) => handleFilterKeyDown(event, index)}
            aria-pressed={statusFilter === s}
            aria-label={`${s === "All" ? "All statuses" : STATUS_LABELS[s]} filter, ${
              statusFilter === s ? "selected" : "not selected"
            }`}
          >
            {s === "All" ? "All" : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {error && (
        <ErrorBanner
          message={error}
          onDismiss={() => setError(null)}
          onRetry={() => void fetchJobs()}
        />
      )}
      {loading && (
        <div className="grid gap-4 md:grid-cols-2" aria-label="Loading jobs">
          {Array.from({ length: 4 }).map((_, index) => (
            <JobCardSkeleton key={index} />
          ))}
        </div>
      )}

      {!loading && (
        <>
          <JobSection
            title="Posted Jobs"
            subtitle="Jobs you created as a client"
            allJobs={postedJobs}
            jobs={filteredPosted}
            filterActive={statusFilter !== "All"}
            wallet={wallet}
            role="client"
            actionLoading={actionLoading}
            descriptions={descriptions}
            onAction={handleAction}
            onRequestCancel={setPendingCancelJobId}
            onClearFilter={() => setStatusFilter("All")}
          />
          <JobSection
            title="Accepted Jobs"
            subtitle="Jobs you accepted as a freelancer"
            allJobs={acceptedJobs}
            jobs={filteredAccepted}
            filterActive={statusFilter !== "All"}
            wallet={wallet}
            role="freelancer"
            actionLoading={actionLoading}
            descriptions={descriptions}
            onAction={handleAction}
            onRequestCancel={setPendingCancelJobId}
            onClearFilter={() => setStatusFilter("All")}
          />
        </>
      )}

      {pendingCancelJobId !== null && (
        <CancelJobConfirmModal
          jobId={String(pendingCancelJobId)}
          loading={actionLoading === pendingCancelJobId}
          onClose={() => setPendingCancelJobId(null)}
          onConfirm={() => {
            void handleConfirmCancel();
          }}
        />
      )}
    </section>
  );
}

function JobSection({
  title,
  subtitle,
  allJobs,
  jobs,
  filterActive,
  wallet,
  role,
  actionLoading,
  descriptions,
  onAction,
  onRequestCancel,
  onClearFilter,
}: {
  title: string;
  subtitle: string;
  allJobs: Array<{ id: number; job: Job }>;
  jobs: Array<{ id: number; job: Job }>;
  filterActive: boolean;
  wallet: string;
  role: "client" | "freelancer";
  actionLoading: number | null;
  descriptions: Record<string, string>;
  onAction: (fn: () => Promise<unknown>, jobId: number) => Promise<void>;
  onRequestCancel: (jobId: number) => void;
  onClearFilter: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mb-3 text-sm text-slate-500">{subtitle}</p>
      {jobs.length === 0 ? (
        filterActive && allJobs.length > 0 ? (
          <NoResultsState
            title="No jobs match this filter"
            description="Try a different status or clear the filter to show every job in this section."
            actionLabel="Clear filter"
            onAction={onClearFilter}
          />
        ) : (
          <EmptyState
            title="No jobs yet"
            description="No jobs match this filter yet."
          />
        )
      ) : (
        <ul className="grid list-none gap-4 sm:grid-cols-2" aria-label={title}>
          {jobs.map(({ id, job }) => (
            <li key={id}>
              <JobCard
                id={id}
                job={job}
                wallet={wallet}
                role={role}
                isLoading={actionLoading === id}
                description={descriptions[job.description_hash]}
                onAction={onAction}
                onRequestCancel={onRequestCancel}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JobCard({
  id,
  job,
  wallet,
  role,
  isLoading,
  description,
  onAction,
  onRequestCancel,
}: {
  id: number;
  job: Job;
  wallet: string;
  role: "client" | "freelancer";
  isLoading: boolean;
  description?: string;
  onAction: (fn: () => Promise<unknown>, jobId: number) => Promise<void>;
  onRequestCancel: (jobId: number) => void;
}) {
  const actions = getActions(id, job, wallet, role);

  return (
    <article className="interactive-card h-full p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium">Job #{id}</h3>
        <StatusPill status={job.status} />
      </div>
      <div className="mt-2 space-y-1 text-sm text-slate-600">
        <p className="flex min-w-0 items-baseline gap-1">
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap tabular-nums">
            {toXlm(job.amount)}
          </span>
          <span className="shrink-0">XLM</span>
        </p>
        {description !== undefined ? (
          <p className="line-clamp-2 text-slate-700">{description}</p>
        ) : (
          <p className="italic text-slate-400">Loading description…</p>
        )}
        <p>
          {(() => {
            const deadline = formatDeadline(job.deadline);
            if (!deadline) return "Deadline: No deadline";
            return `Deadline: ${deadline.isPast ? "Past due" : deadline.relative} • ${deadline.exact}`;
          })()}
        </p>
        {role === "client" && job.freelancer && (
          <p className="truncate">Freelancer: {job.freelancer}</p>
        )}
        {role === "freelancer" && (
          <p className="truncate">Client: {job.client}</p>
        )}
      </div>
      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              disabled={isLoading}
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none sm:max-w-44"
              onClick={() => {
                if (action.label === "Cancel Job") {
                  onRequestCancel(id);
                  return;
                }
                void onAction(() => action.fn(), id);
              }}
              title={action.label}
              aria-haspopup={action.label === "Cancel Job" ? "dialog" : undefined}
            >
              <span className="block truncate">{isLoading ? "..." : action.label}</span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function getActions(
  id: number,
  job: Job,
  wallet: string,
  role: "client" | "freelancer",
): Array<{ label: string; fn: () => Promise<unknown> }> {
  const actions: Array<{ label: string; fn: () => Promise<unknown> }> = [];
  const jobId = String(id);

  if (role === "client") {
    if (job.status === "Open") {
      actions.push({ label: "Cancel Job", fn: () => cancelJob(wallet, jobId) });
    }
    if (job.status === "SubmittedForReview") {
      actions.push({ label: "Approve Work", fn: () => approveWork(wallet, jobId) });
    }
    if (job.status === "InProgress" && job.deadline !== "0") {
      actions.push({ label: "Enforce Deadline", fn: () => enforceDeadline(wallet, jobId) });
    }
  }

  if (role === "freelancer") {
    if (job.status === "InProgress") {
      actions.push({ label: "Submit Work", fn: () => submitWork(wallet, jobId) });
    }
  }

  return actions;
}
