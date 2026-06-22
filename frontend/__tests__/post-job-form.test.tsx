import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PostJobPage from "@/app/post-job/page";

const mockPostJob = vi.fn();
const mockGetDescPayloadMax = vi.fn();

vi.mock("@/lib/contract", () => ({
  getDescPayloadMax: (...args: unknown[]) => mockGetDescPayloadMax(...args),
  postJob: (...args: unknown[]) => mockPostJob(...args),
  quoteStorageDeposit: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/wallet-context", () => ({
  useWallet: () => ({
    wallet: "GCLIENT",
    connectWallet: vi.fn(),
  }),
}));

vi.mock("@/lib/stellar", () => ({
  getExplorerTxUrl: (hash: string) => `https://stellar.expert/tx/${hash}`,
}));

describe("Post job form validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetDescPayloadMax.mockResolvedValue(4096);
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
      },
    });
  });

  it("blocks submit when required fields are missing", async () => {
    render(<PostJobPage />);

    fireEvent.submit(screen.getByRole("button", { name: "Post Job" }).closest("form")!);

    expect(await screen.findAllByText("Job description cannot be empty.")).toHaveLength(2);
    expect(screen.getAllByText("Token address is required.")).toHaveLength(2);
    expect(mockPostJob).not.toHaveBeenCalled();
  });

  it("shows a validation message for invalid amount", async () => {
    render(<PostJobPage />);

    fireEvent.change(screen.getByRole("spinbutton", { name: /Amount/ }), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Job Description/ }), {
      target: { value: "Build escrow UI" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Token Address/ }), {
      target: { value: "GNATIVE" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Post Job" }).closest("form")!);

    expect(
      await screen.findAllByText("Enter a valid amount with up to 7 decimal places."),
    ).toHaveLength(2);
    expect(mockPostJob).not.toHaveBeenCalled();
  });

  it("calls create handler with expected payload for a valid submission", async () => {
    mockPostJob.mockResolvedValue(7);
    render(<PostJobPage />);

    fireEvent.change(screen.getByRole("spinbutton", { name: /Amount/ }), {
      target: { value: "1.25" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Job Description/ }), {
      target: { value: "  Build escrow UI  " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Token Address/ }), {
      target: { value: "  GNATIVE  " },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Post Job" }).closest("form")!);

    await waitFor(() => expect(mockPostJob).toHaveBeenCalledTimes(1));
    expect(mockPostJob).toHaveBeenCalledWith(
      "GCLIENT",
      "12500000",
      "0000000000000000000000000000000000000000000000000000000000000000",
      15,
      "0",
      "GNATIVE",
    );
  });
});
