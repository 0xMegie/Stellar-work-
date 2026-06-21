"use client";

import { getDescPayloadMax, postJob, quoteStorageDeposit } from "@/lib/contract";
import ErrorBanner from "@/components/ErrorBanner";
import { getExplorerTxUrl } from "@/lib/stellar";
import { useWallet } from "@/lib/wallet-context";
import { useEffect, useState } from "react";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default function PostJobPage() {
  const { wallet, connectWallet } = useWallet();
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [tokenAddress, setTokenAddress] = useState(
    process.env.NEXT_PUBLIC_NATIVE_TOKEN ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastAnnouncedSuccess, setLastAnnouncedSuccess] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [maxDescPayloadBytes, setMaxDescPayloadBytes] = useState(4096);
  const [storageDepositStroops, setStorageDepositStroops] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<{
    amount?: string;
    description?: string;
    deadline?: string;
    tokenAddress?: string;
  }>({});

  const parseAmountToStroops = (value: string): string | null => {
    const trimmed = value.trim();
    const amountPattern = /^\d+(\.\d+)?$/;
    if (!amountPattern.test(trimmed)) return null;
    const [, fractional = ""] = trimmed.split(".");
    if (fractional.length > 7) return null;
    const [whole = "0"] = trimmed.split(".");
    return `${whole}${fractional.padEnd(7, "0")}`;
  };

  useEffect(() => {
    if (!wallet) {
      setError(null);
      setSuccess(null);
      setTxHash(null);
    }
  }, [wallet]);

  useEffect(() => {
    void getDescPayloadMax()
      .then((maxBytes) => {
        if (maxBytes > 0) {
          setMaxDescPayloadBytes(maxBytes);
        }
      })
      .catch(() => {
        // Keep default when contract read is unavailable.
      });
  }, []);

  // Storage deposit collected on top of the escrowed amount (issue #15).
  // It scales with the job's expected lifetime, so recompute whenever the
  // deadline changes. 0 when the admin has not enabled the deposit model.
  useEffect(() => {
    const deadlineUnix = deadline
      ? Math.floor(new Date(deadline).getTime() / 1000).toString()
      : "0";
    void quoteStorageDeposit(deadlineUnix)
      .then((stroops) => setStorageDepositStroops(stroops))
      .catch(() => {
        // Keep 0 (deposit display hidden) when the read is unavailable.
      });
  }, [deadline]);

  const formatXlm = (stroops: number): string =>
    (stroops / 10_000_000).toLocaleString(undefined, { maximumFractionDigits: 7 });

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Post Job</h1>

      <form
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting) return;
          setError(null);
          setSuccess(null);
          setTxHash(null);
          setFieldErrors({});

          if (!wallet) {
            try {
              await connectWallet();
            } catch {
              setError("Failed to connect wallet. Is Freighter installed?");
            }
            return;
          }

          setSubmitting(true);
          try {
            const nextFieldErrors: {
              amount?: string;
              description?: string;
              deadline?: string;
              tokenAddress?: string;
            } = {};
            const amountStroops = parseAmountToStroops(amount);
            if (!amountStroops || BigInt(amountStroops) <= 0n) {
              nextFieldErrors.amount = "Enter a valid amount with up to 7 decimal places.";
            }
            const descriptionBytes = new TextEncoder().encode(description.trim()).length;
            if (!description.trim()) {
              nextFieldErrors.description = "Job description cannot be empty.";
            } else if (descriptionBytes > maxDescPayloadBytes) {
              nextFieldErrors.description = `Description must be at most ${maxDescPayloadBytes} bytes (currently ${descriptionBytes}).`;
            }
            if (deadline) {
              const today = new Date();
              const todayIsoDate = new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate(),
              )
                .toISOString()
                .slice(0, 10);
              if (deadline < todayIsoDate) {
                nextFieldErrors.deadline = "Deadline cannot be in the past.";
              }
            }
            if (!tokenAddress.trim()) {
              nextFieldErrors.tokenAddress = "Token address is required.";
            }
            if (Object.keys(nextFieldErrors).length > 0) {
              setFieldErrors(nextFieldErrors);
              return;
            }
            const trimmedDescription = description.trim();
            const hashHex = await sha256Hex(trimmedDescription);
            const descriptionPayloadLen = new TextEncoder().encode(trimmedDescription).length;
            const deadlineUnix = deadline
              ? Math.floor(new Date(deadline).getTime() / 1000).toString()
              : "0";

            localStorage.setItem(`job-desc:${hashHex}`, trimmedDescription);
            const result = await postJob(
              wallet,
              amountStroops!,
              hashHex,
              descriptionPayloadLen,
              deadlineUnix,
              tokenAddress.trim(),
            );
            if (result.hash) {
              setTxHash(result.hash);
            }
            const jobId = typeof result === "number" || typeof result === "string" ? result : null;
            const successMessage =
              jobId != null ? `Job #${jobId} created successfully.` : "Job submitted to contract.";
            setSuccess(successMessage);
            if (successMessage !== lastAnnouncedSuccess) {
              setLastAnnouncedSuccess(successMessage);
            }
            setAmount("");
            setDescription("");
            setDeadline("");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to post job. Please try again.");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {(fieldErrors.amount ||
          fieldErrors.description ||
          fieldErrors.deadline ||
          fieldErrors.tokenAddress) && (
          <div
            id="post-job-errors"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            <p className="font-medium">Please correct the highlighted fields:</p>
            <ul className="mt-2 list-disc pl-5">
              {fieldErrors.amount && <li>{fieldErrors.amount}</li>}
              {fieldErrors.description && <li>{fieldErrors.description}</li>}
              {fieldErrors.deadline && <li>{fieldErrors.deadline}</li>}
              {fieldErrors.tokenAddress && <li>{fieldErrors.tokenAddress}</li>}
            </ul>
          </div>
        )}

        <label className="block text-sm font-medium">
          Amount (XLM)
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            type="number"
            min="0.0000001"
            step="0.0000001"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setFieldErrors((current) => ({ ...current, amount: undefined }));
            }}
            aria-invalid={Boolean(fieldErrors.amount)}
            aria-describedby={fieldErrors.amount ? "post-job-amount-error" : "post-job-amount-helper"}
            required
          />
          <p id="post-job-amount-helper" className="mt-1 text-xs text-slate-500">
            Enter amount in XLM with up to 7 decimal places (e.g., 10.5 or 0.0000001)
          </p>
          {fieldErrors.amount && (
            <p id="post-job-amount-error" className="mt-1 text-xs text-red-600">
              {fieldErrors.amount}
            </p>
          )}
        </label>

        <label className="block text-sm font-medium">
          Job Description
          <textarea
            className="mt-1 min-h-36 w-full rounded-md border border-slate-300 px-3 py-2"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setFieldErrors((current) => ({ ...current, description: undefined }));
            }}
            aria-invalid={Boolean(fieldErrors.description)}
            aria-describedby={
              fieldErrors.description ? "post-job-description-error" : undefined
            }
            required
          />
          {fieldErrors.description && (
            <p id="post-job-description-error" className="mt-1 text-xs text-red-600">
              {fieldErrors.description}
            </p>
          )}
        </label>

        <label className="block text-sm font-medium">
          Deadline (optional)
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            type="date"
            value={deadline}
            onChange={(e) => {
              setDeadline(e.target.value);
              setFieldErrors((current) => ({ ...current, deadline: undefined }));
            }}
            aria-invalid={Boolean(fieldErrors.deadline)}
            aria-describedby={fieldErrors.deadline ? "post-job-deadline-error" : undefined}
          />
          {fieldErrors.deadline && (
            <p id="post-job-deadline-error" className="mt-1 text-xs text-red-600">
              {fieldErrors.deadline}
            </p>
          )}
        </label>

        <label className="block text-sm font-medium">
          Token Address
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            type="text"
            value={tokenAddress}
            onChange={(e) => {
              setTokenAddress(e.target.value);
              setFieldErrors((current) => ({ ...current, tokenAddress: undefined }));
            }}
            aria-invalid={Boolean(fieldErrors.tokenAddress)}
            aria-describedby={
              fieldErrors.tokenAddress ? "post-job-token-address-error" : undefined
            }
            required
          />
          {fieldErrors.tokenAddress && (
            <p id="post-job-token-address-error" className="mt-1 text-xs text-red-600">
              {fieldErrors.tokenAddress}
            </p>
          )}
        </label>

        {storageDepositStroops > 0 && (
          <div
            className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
            aria-live="polite"
          >
            <p className="font-medium">Refundable storage deposit</p>
            <p className="mt-1">
              An extra{" "}
              <span className="font-mono">{formatXlm(storageDepositStroops)} XLM</span>{" "}
              storage deposit is collected on top of the amount and refunded when
              the job completes or is cancelled (minus any TTL-bump fees).
            </p>
            {(() => {
              const stroops = parseAmountToStroops(amount);
              if (!stroops) return null;
              const total = BigInt(stroops) + BigInt(storageDepositStroops);
              return (
                <p className="mt-1">
                  Total required from wallet:{" "}
                  <span className="font-mono">
                    {formatXlm(Number(total))} XLM
                  </span>
                </p>
              );
            })()}
          </div>
        )}

        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? "Posting..." : "Post Job"}
        </button>
      </form>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {success && (
        <p role="status" aria-live="polite" aria-atomic="true" className="rounded-md bg-green-100 p-3 text-sm text-green-700">
          {success}
        </p>
      )}
      {txHash && (
        <p className="text-sm text-slate-700">
          Transaction:{" "}
          <a
            href={getExplorerTxUrl(txHash)}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            {txHash}
          </a>
        </p>
      )}
    </section>
  );
}
