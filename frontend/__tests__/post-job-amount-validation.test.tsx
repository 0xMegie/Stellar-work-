import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PostJobPage from "@/app/post-job/page";

const mockPostJob = vi.fn();
const mockGetDescPayloadMax = vi.fn();
const mockUseWallet = vi.fn();

vi.mock("@/lib/contract", () => ({
  postJob: (...args: unknown[]) => mockPostJob(...args),
  getDescPayloadMax: (...args: unknown[]) => mockGetDescPayloadMax(...args),
  quoteStorageDeposit: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/wallet-context", () => ({
  useWallet: () => mockUseWallet(),
}));

vi.mock("@/lib/stellar", () => ({
  getExplorerTxUrl: (hash: string) => `https://example.test/tx/${hash}`,
}));

const TOKEN_ADDRESS = "GTOKEN000000000000000000000000000000000000000000000000000";

function fillRequiredFields({
  amount,
  description = "Build a landing page",
}: {
  amount: string;
  description?: string;
}) {
  fireEvent.change(screen.getByLabelText(/Amount \(XLM\)/), {
    target: { value: amount },
  });
  fireEvent.change(screen.getByLabelText(/Job Description/), {
    target: { value: description },
  });
  fireEvent.change(screen.getByLabelText(/Token Address/), {
    target: { value: TOKEN_ADDRESS },
  });
}

describe("Post job amount input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetDescPayloadMax.mockResolvedValue(4096);
    mockPostJob.mockResolvedValue({ hash: "TX_OK", status: "SUCCESS" });
    mockUseWallet.mockReturnValue({
      wallet: "GWALLET000000000000000000000000000000000000000000000000000",
      connectWallet: vi.fn(),
    });
  });

  it("blocks non-numeric amount input by enforcing a numeric field", () => {
    render(<PostJobPage />);

    const amountInput = screen.getByLabelText(/Amount \(XLM\)/) as HTMLInputElement;

    // The amount field is a number input so the browser/jsdom rejects
    // non-numeric strings; the underlying value remains empty.
    fireEvent.change(amountInput, { target: { value: "abc" } });

    expect(amountInput).toHaveAttribute("type", "number");
    expect(amountInput.value).toBe("");
  });

  it("shows an error and does not submit when amount is zero", async () => {
    render(<PostJobPage />);

    fillRequiredFields({ amount: "0" });
    fireEvent.submit(screen.getByRole("button", { name: /Post Job/ }).closest("form")!);

    await waitFor(() => {
      expect(
        screen.getAllByText(/Enter a valid amount with up to 7 decimal places\./)
          .length,
      ).toBeGreaterThan(0);
    });

    expect(screen.getByLabelText(/Amount \(XLM\)/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(mockPostJob).not.toHaveBeenCalled();
  });

  it("submits successfully when a positive amount is provided", async () => {
    render(<PostJobPage />);

    fillRequiredFields({ amount: "1.5" });
    fireEvent.submit(screen.getByRole("button", { name: /Post Job/ }).closest("form")!);

    await waitFor(() => {
      expect(mockPostJob).toHaveBeenCalledTimes(1);
    });

    // Amount is converted to stroops (1.5 XLM -> "15000000")
    expect(mockPostJob.mock.calls[0][1]).toBe("15000000");

    // Amount field has no validation error after a successful submit
    expect(
      screen.queryAllByText(/Enter a valid amount with up to 7 decimal places\./),
    ).toHaveLength(0);
  });

  it("rejects amounts with more than seven decimal places", async () => {
    render(<PostJobPage />);

    fillRequiredFields({ amount: "0.12345678" });
    fireEvent.submit(screen.getByRole("button", { name: /Post Job/ }).closest("form")!);

    await waitFor(() => {
      expect(
        screen.getAllByText(/Enter a valid amount with up to 7 decimal places\./)
          .length,
      ).toBeGreaterThan(0);
    });

    expect(mockPostJob).not.toHaveBeenCalled();
  });
});
