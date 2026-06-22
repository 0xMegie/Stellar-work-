import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PostJobPage from "@/app/post-job/page";

const mockPostJob = vi.fn();
const mockGetDescPayloadMax = vi.fn();

vi.mock("@/lib/contract", () => ({
  postJob: (...args: unknown[]) => mockPostJob(...args),
  getDescPayloadMax: (...args: unknown[]) => mockGetDescPayloadMax(...args),
  quoteStorageDeposit: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/wallet-context", () => ({
  useWallet: () => ({
    wallet: "GWALLET000000000000000000000000000000000000000000000000000",
    connectWallet: vi.fn(),
  }),
}));

vi.mock("@/lib/stellar", () => ({
  getExplorerTxUrl: (hash: string) => `https://example.test/tx/${hash}`,
}));

describe("Post-job page: form fields presence (#306)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDescPayloadMax.mockResolvedValue(4096);
  });

  it("renders the page heading", () => {
    render(<PostJobPage />);
    expect(screen.getByRole("heading", { name: /post job/i })).toBeInTheDocument();
  });

  it("renders the Amount (XLM) input field", () => {
    render(<PostJobPage />);
    expect(screen.getByLabelText(/Amount \(XLM\)/i)).toBeInTheDocument();
  });

  it("renders the Job Description textarea", () => {
    render(<PostJobPage />);
    expect(screen.getByLabelText(/Job Description/i)).toBeInTheDocument();
  });

  it("renders the Token Address input field", () => {
    render(<PostJobPage />);
    expect(screen.getByLabelText(/Token Address/i)).toBeInTheDocument();
  });

  it("renders the submit button and it is initially enabled", () => {
    render(<PostJobPage />);
    const btn = screen.getByRole("button", { name: /post job/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("renders the Deadline (optional) date field", () => {
    render(<PostJobPage />);
    expect(screen.getByLabelText(/Deadline/i)).toBeInTheDocument();
  });
});
