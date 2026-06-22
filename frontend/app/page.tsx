"use client";

import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import InfoTooltip from "@/components/InfoTooltip";
import NoResultsState from "@/components/NoResultsState";
import JobCardSkeleton from "@/components/JobCardSkeleton";
import SectionCard from "@/components/SectionCard";
import { acceptJob, getJob, getJobCount } from "@/lib/contract";
import { formatDeadline, toXlm } from "@/lib/format";
import {
  clearRecentSearches,
  loadRecentSearches,
  saveRecentSearches,
  updateRecentSearches,
} from "@/lib/recent-searches";
import { getExplorerTxUrl } from "@/lib/stellar";
import { getRecentJobIds, getJobWindowBounds } from "@/lib/recent-ids";
import { resolveDescription, safeLocalStorageGet } from "@/lib/storage";
import type { Job } from "@/lib/types";
import { useWallet } from "@/lib/wallet-context";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

const BOOKMARK_STORAGE_KEY = "stellarwork:bookmarked-jobs";
const VIEW_MODE_STORAGE_KEY = "stellarwork:jobs-view-mode";

type JobsViewMode = "grid" | "list";

function readViewMode(): JobsViewMode {
  if (typeof window === "undefined") return "grid";
  const stored = sessionStorage.getItem(VIEW_MODE_STORAGE_KEY);
  return stored === "list" ? "list" : "grid";
}

export default function HomePage() {
  const { wallet } = useWallet();
  const [jobs, setJobs] = useState<Array<{ id: number; job: Job }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [latestTxHash, setLatestTxHash] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalJobs, setTotalJobs] = useState(0);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [showBookmarkedOnly, setShowBookmarkedOnly] = useState(false);
  const [bookmarkedIds, setBookmarkedIds] = useState<number[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[] | null>(null);
  const [resultsAnnouncement, setResultsAnnouncement] = useState("");
  const [lastAnnouncedSignature, setLastAnnouncedSignature] = useState("");
  const [newJobIds, setNewJobIds] = useState<Set<number>>(() => new Set());
  const seenJobIdsRef = useRef<Set<number>>(new Set());
  const isInitialLoadRef = useRef(true);
  const [viewMode, setViewMode] = useState<JobsViewMode>("grid");
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const resolvingHashesRef = useRef<Set<string>>(new Set());
  const pinataGateway = process.env.NEXT_PUBLIC_PINATA_GATEWAY;

  useEffect(() => {
    setViewMode(readViewMode());
  }, []);

  useEffect(() => {
    if (viewMode === "grid") {
      sessionStorage.removeItem(VIEW_MODE_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalJobs / pageSize)),
    [pageSize, totalJobs],
  );

  useEffect(() => {
    try {
      const stored = localStorage.getItem(BOOKMARK_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as unknown;
      if (!Array.isArray(parsed)) return;
      const validIds = parsed
        .map((entry) => Number(entry))
        .filter((value) => Number.isInteger(value) && value > 0);
      setBookmarkedIds(validIds);
    } catch {
      // Ignore malformed local storage data and use empty bookmarks.
    }
  }, []);

  useEffect(() => {
    if (bookmarkedIds.length === 0) {
      localStorage.removeItem(BOOKMARK_STORAGE_KEY);
      return;
    }
    localStorage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(bookmarkedIds));
  }, [bookmarkedIds]);

  useEffect(() => {
    setRecentSearches(loadRecentSearches());
  }, []);

  useEffect(() => {
    if (recentSearches === null) return;
    saveRecentSearches(recentSearches);
  }, [recentSearches]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const count = await getJobCount();
      setTotalJobs(count);

      if (count === 0) {
        setJobs([]);
        setLoading(false);
        return;
      }

      const maxPages = Math.max(1, Math.ceil(count / pageSize));
      const safePage = Math.min(Math.max(1, page), maxPages);
      if (safePage !== page) {
        setPage(safePage);
      }

      const bounds = getJobWindowBounds(count, safePage, pageSize);
      if (!bounds) {
        setJobs([]);
        setLoading(false);
        return;
      }

      const idsToFetch = getRecentJobIds(bounds.startId, bounds.endId, sortOrder);

      const results = await Promise.all(
        idsToFetch.map(async (id) => {
          try {
            const job = await getJob(id);
            return job ? { id: Number(id), job } : null;
          } catch {
            return null;
          }
        }),
      );

      const fetched = results.filter(
        (item): item is { id: number; job: Job } =>
          item !== null && item.job.status === "Open",
      );

      const incomingIds = fetched.map(({ id }) => id);
      if (!isInitialLoadRef.current) {
        const addedIds = incomingIds.filter((id) => !seenJobIdsRef.current.has(id));
        if (addedIds.length > 0) {
          setNewJobIds((prev) => {
            const next = new Set(prev);
            for (const id of addedIds) {
              next.add(id);
            }
            return next;
          });
        }
      }
      seenJobIdsRef.current = new Set(incomingIds);
      isInitialLoadRef.current = false;

      setJobs(fetched);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch jobs.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sortOrder]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Resolve descriptions for the current page of jobs.
  // Uses localStorage first (instant), then IPFS gateway when configured.
  useEffect(() => {
    const hashes = [...new Set(jobs.map(({ job }) => job.description_hash))];
    let mounted = true;
    for (const hash of hashes) {
      if (resolvingHashesRef.current.has(hash)) continue;
      resolvingHashesRef.current.add(hash);
      void resolveDescription(hash, pinataGateway).then((text) => {
        if (mounted && text !== null) {
          setDescriptions((prev) => ({ ...prev, [hash]: text }));
        }
      });
    }
    return () => {
      mounted = false;
    };
  }, [jobs, pinataGateway]);

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();

  const visibleJobs = useMemo(() => {
    const bookmarkedJobs = showBookmarkedOnly
      ? jobs.filter(({ id }) => bookmarkedIds.includes(id))
      : jobs;

    if (!normalizedSearchTerm) {
      return bookmarkedJobs;
    }

    return bookmarkedJobs.filter(({ id, job }) => {
      const description = (
        descriptions[job.description_hash] ??
        safeLocalStorageGet(`job-desc:${job.description_hash}`) ??
        "Description unavailable (posted from another device)"
      ).toLowerCase();
      const amount = toXlm(job.amount).toLowerCase();
      const freelancer = job.freelancer?.toLowerCase() ?? "";
      return [
        String(id),
        job.description_hash.toLowerCase(),
        description,
        amount,
        job.client.toLowerCase(),
        freelancer,
      ].some((value) => value.includes(normalizedSearchTerm));
    });
  }, [bookmarkedIds, descriptions, jobs, normalizedSearchTerm, showBookmarkedOnly]);

  useEffect(() => {
    if (loading) return;
    const currentSignature = `${showBookmarkedOnly}:${normalizedSearchTerm}:${visibleJobs.map(({ id }) => id).join(",")}`;
    if (currentSignature === lastAnnouncedSignature) return;
    setResultsAnnouncement(
      `${visibleJobs.length} ${visibleJobs.length === 1 ? "result" : "results"} shown`,
    );
    setLastAnnouncedSignature(currentSignature);
  }, [lastAnnouncedSignature, loading, normalizedSearchTerm, showBookmarkedOnly, visibleJobs]);

  function getDescription(hash: string): string {
    if (descriptions[hash]) return descriptions[hash];
    // Synchronous localStorage fallback (covers the poster's own device instantly
    // and existing jobs that pre-date the IPFS integration).
    return safeLocalStorageGet(`job-desc:${hash}`) ?? "Description unavailable (posted from another device)";
  }

  function markJobViewed(id: number) {
    setNewJobIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = searchTerm.trim();
    if (!term) return;
    setRecentSearches((current) => updateRecentSearches(current ?? [], term));
    setPage(1);
  };

  const handleRecentSearchSelect = (term: string) => {
    setSearchTerm(term);
    setRecentSearches((current) => updateRecentSearches(current ?? [], term));
    setPage(1);
  };

  const handleClearSearch = () => {
    setSearchTerm("");
    setPage(1);
  };

  const handleClearSearchHistory = () => {
    setRecentSearches([]);
    clearRecentSearches();
  };

  const visibleNewJobCount = useMemo(
    () => visibleJobs.filter(({ id }) => newJobIds.has(id)).length,
    [newJobIds, visibleJobs],
  );

  return (
    <section className="space-y-6">
      {/* Hero Section */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-slate-900 md:text-3xl">
              Find Your Next Opportunity
            </h1>
            <p className="mt-2 text-sm text-slate-600 md:text-base">
              Browse open jobs or post your own project on the decentralized Stellar marketplace.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/post-job"
              className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors text-center"
            >
              Post a Job
            </Link>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors text-center"
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Browse Jobs"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-900">Open Jobs</h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <ErrorBanner
          message={error}
          onDismiss={() => setError(null)}
          onRetry={() => void refresh()}
        />
      )}

      {loading && jobs.length === 0 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Loading jobs...</p>
          <div
            className={viewMode === "list" ? "flex flex-col gap-4" : "grid gap-4 md:grid-cols-2"}
            aria-label="Loading open jobs"
          >
            {Array.from({ length: 6 }).map((_, index) => (
              <JobCardSkeleton key={index} compact={viewMode === "list"} />
            ))}
          </div>
        </div>
      )}

      {loading && jobs.length > 0 && (
        <p role="status" aria-live="polite" className="text-xs text-slate-400">
          Refreshing jobs…
        </p>
      )}

      {!loading && visibleNewJobCount > 0 && (
        <p role="status" className="text-xs font-medium text-emerald-700">
          {visibleNewJobCount} new job{visibleNewJobCount === 1 ? "" : "s"} since last refresh
        </p>
      )}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {resultsAnnouncement}
      </p>

      {latestTxHash && (
        <p className="text-sm text-slate-600">
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

      {!loading && visibleJobs.length === 0 && !error && (
        showBookmarkedOnly && jobs.length > 0 && !normalizedSearchTerm ? (
          <NoResultsState
            title="No favorites found"
            description="No bookmarked jobs match the current feed. Turn off favorites only to see everything again."
            actionLabel="Show all jobs"
            onAction={() => setShowBookmarkedOnly(false)}
          />
        ) : (
          <EmptyState
            title={
              normalizedSearchTerm
                ? "No jobs match your search"
                : showBookmarkedOnly
                  ? "No favorites found"
                  : "No open jobs found"
            }
            description={
              normalizedSearchTerm
                ? "Try a different keyword or clear your search history."
                : showBookmarkedOnly
                  ? "Bookmark jobs to quickly find them here."
                  : "New jobs will appear here as clients post them."
            }
          />
        )
      )}

      <SectionCard
        title="Jobs Display"
        description="Default sort is newest first."
      >
        <form onSubmit={handleSearchSubmit} className="space-y-3 rounded-md border border-slate-200 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="flex-1 text-sm text-slate-600">
              <span className="block font-medium text-slate-700">Search jobs</span>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  setPage(1);
                }}
                placeholder="Search by ID, description, wallet, or amount"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!searchTerm.trim()}
              >
                Search
              </button>
              <button
                type="button"
                onClick={handleClearSearch}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!searchTerm}
              >
                Clear
              </button>
            </div>
          </div>
          {(recentSearches?.length ?? 0) > 0 && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Recent searches
                </p>
                <button
                  type="button"
                  onClick={handleClearSearchHistory}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Clear history
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(recentSearches ?? []).map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => handleRecentSearchSelect(term)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      searchTerm.trim().toLowerCase() === term.toLowerCase()
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>

        <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">
            Sort and filter job results
          </legend>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <div className="inline-flex items-center gap-2">
              <label htmlFor="jobs-sort-order">Sort:</label>
              <InfoTooltip
                label="Sort and filter jobs help"
                content="Newest first surfaces recent jobs at the top. Favorites only filters to bookmarked jobs in this browser."
              />
            </div>
            <select
              id="jobs-sort-order"
              value={sortOrder}
              onChange={(event) => {
                setSortOrder(event.target.value as "newest" | "oldest");
                setPage(1);
              }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
              disabled={loading}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showBookmarkedOnly}
                onChange={(event) => {
                  setShowBookmarkedOnly(event.target.checked);
                  setPage(1);
                }}
                className="h-4 w-4 rounded border-slate-300"
              />
              Favorites only
            </label>
          </div>
          <div
            className="flex flex-wrap items-center gap-2 text-sm text-slate-600"
            role="group"
            aria-label="Jobs layout"
          >
            <span className="font-medium text-slate-700">Layout:</span>
            <button
              type="button"
              className={`rounded-md border px-3 py-1 font-medium ${
                viewMode === "grid"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              aria-pressed={viewMode === "grid"}
              onClick={() => setViewMode("grid")}
            >
              Grid
            </button>
            <button
              type="button"
              className={`rounded-md border px-3 py-1 font-medium ${
                viewMode === "list"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
            >
              List
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-1 font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => {
                // Clear localStorage preferences
                localStorage.removeItem(BOOKMARK_STORAGE_KEY);
                // Clear sessionStorage preferences
                sessionStorage.removeItem(VIEW_MODE_STORAGE_KEY);
                // Reset state to defaults immediately
                setBookmarkedIds([]);
                setViewMode("grid");
                setShowBookmarkedOnly(false);
                setSearchTerm("");
                setSortOrder("newest");
                setPage(1);
              }}
            >
              Reset Preferences
            </button>
          </div>
        </fieldset>
      </SectionCard>

      <ul
        className={
          viewMode === "grid"
            ? "grid list-none gap-4 md:grid-cols-2"
            : "flex list-none flex-col gap-4"
        }
        aria-label="Open jobs"
      >
        {visibleJobs.map(({ id, job }) => {
          const deadline = formatDeadline(job.deadline);

          return (
            <li key={id}>
              <article
                className={`interactive-card h-full p-4 ${
                  viewMode === "list"
                    ? "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
                    : ""
                }`}
              >
                <div className={viewMode === "list" ? "min-w-0 flex-1" : undefined}>
                  <Link href={`/job/${id}`} className="block" onClick={() => markJobViewed(id)}>
                    <h2 className="flex items-center gap-2 text-lg font-medium hover:underline">
                      Job #{id}
                      {newJobIds.has(id) && (
                        <span
                          aria-hidden="true"
                          className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
                        >
                          New
                        </span>
                      )}
                    </h2>
                  </Link>
                  <p className="mt-2 flex min-w-0 items-baseline gap-1 text-sm font-bold text-slate-700">
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap tabular-nums">
                      {toXlm(job.amount)}
                    </span>
                    <span className="shrink-0">XLM</span>
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-700">
                    {getDescription(job.description_hash)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Hash: {job.description_hash.slice(0, 12)}...
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {deadline
                      ? `Deadline: ${deadline.isPast ? "Past due" : deadline.relative} • ${deadline.exact}`
                      : "Deadline: No deadline"}
                  </p>
                </div>
                <div
                  className={`flex flex-wrap items-center gap-2 ${
                    viewMode === "list" ? "sm:shrink-0 sm:flex-col sm:items-stretch" : "mt-4"
                  }`}
                >
                  <Link
                    href={`/job/${id}`}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => markJobViewed(id)}
                  >
                    View Details
                  </Link>
                  <button
                    type="button"
                    className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                      !wallet || actionLoading === id
                        ? "cursor-not-allowed bg-slate-100 text-slate-400"
                        : "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"
                    }`}
                    title={!wallet ? "Connect your wallet to accept jobs." : undefined}
                    onClick={async () => {
                      setError(null);
                      if (!wallet) {
                        return;
                      }
                      setActionLoading(id);
                      try {
                        const result = await acceptJob(wallet, String(id));
                        if (result.hash) {
                          setLatestTxHash(result.hash);
                        }
                        await refresh();
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Failed to accept job. Check your balance or contract state.",
                        );
                      } finally {
                        setActionLoading(null);
                      }
                    }}
                    disabled={!wallet || actionLoading !== null}
                    aria-busy={actionLoading === id}
                  >
                    {actionLoading === id ? "Processing..." : "Accept Job"}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setBookmarkedIds((prev) =>
                        prev.includes(id)
                          ? prev.filter((value) => value !== id)
                          : [...prev, id],
                      );
                    }}
                    aria-pressed={bookmarkedIds.includes(id)}
                  >
                    {bookmarkedIds.includes(id) ? "Bookmarked" : "Bookmark"}
                  </button>
                </div>
                {!wallet && (
                  <p className="mt-2 text-xs text-amber-700">
                    Connect your wallet to enable job actions.
                  </p>
                )}
              </article>
            </li>
          );
        })}
      </ul>

      {totalJobs > 0 && (
        <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <fieldset className="flex items-center gap-2 text-sm text-slate-600">
            <legend className="sr-only">Pagination settings</legend>
            <label htmlFor="jobs-page-size">Page size:</label>
            <select
              id="jobs-page-size"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
              disabled={loading}
            >
              {[5, 10, 20].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </fieldset>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={loading || page <= 1}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Previous
            </button>
            <span className="text-sm text-slate-600">
              Page {Math.min(page, totalPages)} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={loading || page >= totalPages}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
