"use client";

import CancelJobConfirmModal from "@/components/CancelJobConfirmModal";
import InfoTooltip from "@/components/InfoTooltip";
import LoadingState from "@/components/LoadingState";
import { useToast } from "@/components/ToastProvider";
import StatusPill from "@/components/StatusPill";
import { acceptJob, approveWork, cancelJob, getJob, submitWork } from "@/lib/contract";
import { formatDeadline, toXlm } from "@/lib/format";
import { getExplorerTxUrl } from "@/lib/stellar";
import { resolveDescription } from "@/lib/storage";
import type { Job } from "@/lib/types";
import { useWallet } from "@/lib/wallet-context";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { wallet } = useWallet();
  const { showSuccess, showError } = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [latestTxHash, setLatestTxHash] = useState<string | null>(null);
  const [invalidId, setInvalidId] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinataGateway = process.env.NEXT_PUBLIC_PINATA_GATEWAY;

  const numericId = Number(id);
  const isIdValid = !isNaN(numericId) && numericId > 0 && Number.isInteger(numericId);

  async function load() {
    if (!isIdValid) {
      setInvalidId(true);
      setFetching(false);
      return;
    }
    setFetching(true);
    setError(null);
    try {
      const data = await getJob(id);
      setJob(data);
      if (!data) {
        setError("Job not found.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load job.");
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Resolve description independently so the job card shows immediately while
  // IPFS fetching (if needed) completes in the background.
  useEffect(() => {
    if (!job) {
      setDescription(null);
      return;
    }
    let cancelled = false;
    void resolveDescription(job.description_hash, pinataGateway).then((text) => {
      if (!cancelled) {
        setDescription(text ?? 'Description unavailable (posted from another device)');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [job, pinataGateway]);

  useEffect(() => {
    if (!wallet) {
      setError(null);
      setLatestTxHash(null);
      setShowCancelConfirm(false);
    }
  }, [wallet]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const isClient = wallet && job && wallet === job.client;
  const isFreelancer = wallet && job && wallet === job.freelancer;
  const canAccept = Boolean(job && job.status === "Open");
  const canSubmit = Boolean(isFreelancer && job?.status === "InProgress");
  const canApprove = Boolean(isClient && job?.status === "SubmittedForReview");
  const canCancel = Boolean(isClient && job?.status === "Open");
  const hasPrimaryActions = canAccept || canSubmit || canApprove || canCancel;

  async function handleAction(
    action: () => Promise<{ hash?: string }>,
    successMessage = "Action completed successfully.",
  ) {
    if (loading) return;
    setError(null);
    if (!wallet) {
      showError("Connect your wallet to run this action.");
      return;
    }

    setLoading(true);

    try {
      const result = await action();
      if (result.hash) {
        setLatestTxHash(result.hash);
      }
      await load();
      showSuccess(successMessage);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Transaction failed.";
      setError(message);
      showError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmCancel() {
    if (!wallet) {
      showError("Connect your wallet to run this action.");
      return;
    }
    await handleAction(() => cancelJob(wallet, id), "Job cancelled and funds refunded.");
    setShowCancelConfirm(false);
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      setCopied(true);
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      console.error("Failed to copy!", err);
    }
  }

  if (invalidId) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Invalid Job ID</h1>
        <p className="text-sm text-red-700" role="alert">
          Invalid job ID. Please check the URL and try again.
        </p>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          Back to Home
        </Link>
      </section>
    );
  }

  if (fetching) {
    return (
      <div className="py-16">
        <LoadingState
          text="Loading job details..."
          className="mx-auto flex w-fit items-center gap-2 text-sm text-slate-700"
        />
      </div>
    );
  }

  if (!job) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Job #{id}</h1>
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
          <p className="text-slate-700">{error ?? "Job not found."}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {error && error !== "Job not found." && (
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700"
              >
                Retry
              </button>
            )}
            <Link href="/" className="rounded-md border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50">
              Back to Home
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6 pb-6 sm:pb-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          Back
        </Link>
        <h1 className="text-2xl font-semibold">Job #{id}</h1>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {latestTxHash && (
        <p className="text-sm text-slate-700">
          Last transaction:{" "}
          <a
            href={getExplorerTxUrl(latestTxHash)}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            {latestTxHash}
          </a>
        </p>
      )}

      <article className="space-y-2 rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <p>
          <strong>Status:</strong> <StatusPill status={job.status} />
        </p>
        <p>
          <strong>Client:</strong> {job.client}
        </p>
        <p>
          <strong>Freelancer:</strong> {job.freelancer ?? "Not assigned"}
        </p>
        <p>
          <strong>Amount:</strong> {toXlm(job.amount)} XLM
        </p>
        <p>
          <strong>Description:</strong>{" "}
          {description !== null ? description : <em className="text-slate-400">Loading description…</em>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-2">
            <strong className="inline-flex items-center gap-2">
              Description hash
              <InfoTooltip
                label="Description hash help"
                content="This hash identifies the stored job description and is useful when comparing records across devices."
              />
              :
            </strong>
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
              {job.description_hash}
            </code>
          </p>
          <button
            onClick={() => void copyToClipboard(job.description_hash)}
            className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 active:bg-slate-200"
            title="Copy hash to clipboard"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p>
          <strong>Deadline:</strong>{" "}
          {(() => {
            const deadline = formatDeadline(job.deadline);
            if (!deadline) return "No deadline";
            return `${deadline.isPast ? "Past due" : deadline.relative} • ${deadline.exact}`;
          })()}
        </p>

        {!wallet && (
          <p className="text-xs text-amber-700">
            Connect your wallet to enable contract actions.
          </p>
        )}
      </article>

      {hasPrimaryActions && (
        <>
          {/* Spacer to prevent content from being hidden behind sticky footer on mobile */}
          <div className="h-20 sm:hidden" aria-hidden="true" />
          
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-6px_24px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:static sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none sm:backdrop-blur-none">
            <div className="mx-auto flex w-full max-w-4xl flex-wrap gap-2 sm:justify-end">
              {canAccept && (
                <button
                  className="min-w-0 flex-1 rounded-md border border-blue-600 bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500 sm:flex-none sm:max-w-48 sm:py-2"
                  onClick={() => {
                    if (!wallet) {
                      return;
                    }
                    void handleAction(() => acceptJob(wallet, id));
                  }}
                  disabled={!wallet || loading}
                  title={!wallet ? "Connect your wallet to accept this job." : undefined}
                  aria-busy={loading}
                >
                  <span className="block truncate">{loading ? "Processing..." : "Accept Job"}</span>
                </button>
              )}

              {canSubmit && (
                <button
                  className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 sm:flex-none sm:max-w-48 sm:py-2"
                  onClick={() => handleAction(() => submitWork(wallet!, id))}
                  disabled={loading}
                  aria-busy={loading}
                >
                  <span className="block truncate">{loading ? "Processing..." : "Submit Work"}</span>
                </button>
              )}

              {canApprove && (
                <button
                  className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 sm:flex-none sm:max-w-48 sm:py-2"
                  onClick={() => handleAction(() => approveWork(wallet!, id))}
                  disabled={loading}
                  aria-busy={loading}
                >
                  <span className="block truncate">{loading ? "Processing..." : "Approve Work"}</span>
                </button>
              )}

              {canCancel && (
                <button
                  className="min-w-0 flex-1 rounded-md border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 sm:flex-none sm:max-w-48 sm:py-2"
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={loading}
                  aria-haspopup="dialog"
                >
                  <span className="block truncate">Cancel Job</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {showCancelConfirm && (
        <CancelJobConfirmModal
          jobId={id}
          loading={loading}
          onClose={() => setShowCancelConfirm(false)}
          onConfirm={() => {
            void handleConfirmCancel();
          }}
        />
      )}
    </section>
  );
}
