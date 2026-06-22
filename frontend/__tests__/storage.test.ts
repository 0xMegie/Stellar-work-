import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheDescription,
  resolveDescription,
  safeLocalStorageGet,
  safeLocalStorageSet,
  uploadToIpfs,
} from "@/lib/storage";

// ── localStorage helpers ──────────────────────────────────────────────────────

describe("safeLocalStorageGet", () => {
  beforeEach(() => localStorage.clear());

  it("returns null for a missing key", () => {
    expect(safeLocalStorageGet("missing")).toBeNull();
  });

  it("returns the stored value for an existing key", () => {
    localStorage.setItem("k", "v");
    expect(safeLocalStorageGet("k")).toBe("v");
  });

  it("returns null and does not throw when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => safeLocalStorageGet("k")).not.toThrow();
    expect(safeLocalStorageGet("k")).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("safeLocalStorageSet", () => {
  beforeEach(() => localStorage.clear());

  it("writes a value that can be read back", () => {
    safeLocalStorageSet("greet", "hello");
    expect(localStorage.getItem("greet")).toBe("hello");
  });

  it("does not throw when localStorage.setItem throws (Safari private mode)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => safeLocalStorageSet("k", "v")).not.toThrow();
    vi.restoreAllMocks();
  });
});

// ── IPFS upload ───────────────────────────────────────────────────────────────

describe("uploadToIpfs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the Pinata Files API with correct auth header and returns CID", async () => {
    const mockCid = "bafkreiabc123";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { cid: mockCid } }),
    }));

    const cid = await uploadToIpfs("Hello World", { pinataJwt: "test-jwt" });

    expect(cid).toBe(mockCid);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://uploads.pinata.cloud/v3/files");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-jwt");
    expect(init.method).toBe("POST");
    vi.unstubAllGlobals();
  });

  it("throws when Pinata returns a non-OK status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Unauthorized",
    }));

    await expect(uploadToIpfs("text", { pinataJwt: "bad-jwt" })).rejects.toThrow(
      "IPFS upload failed (401)",
    );
    vi.unstubAllGlobals();
  });

  it("throws when the response contains no CID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    }));

    await expect(uploadToIpfs("text", { pinataJwt: "jwt" })).rejects.toThrow(
      "no CID was returned",
    );
    vi.unstubAllGlobals();
  });
});

// ── resolveDescription ────────────────────────────────────────────────────────

describe("resolveDescription", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns the cached text from localStorage without any fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("job-desc:abc123", "Cached description");

    const result = await resolveDescription("abc123");

    expect(result).toBe("Cached description");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("returns null without fetching when localStorage misses and no gateway is set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveDescription("unknown-hash");

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("returns null when localStorage misses and CID is not stored, even with a gateway", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveDescription("no-cid-hash", "mygateway.mypinata.cloud");

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("fetches from gateway when text is missing but CID is in localStorage", async () => {
    localStorage.setItem("job-ipfs-cid:abc123", "bafkreiabc");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "Description from IPFS",
    }));

    const result = await resolveDescription("abc123", "mygw.mypinata.cloud");

    expect(result).toBe("Description from IPFS");
    vi.unstubAllGlobals();
  });

  it("caches the IPFS text in localStorage after a successful gateway fetch", async () => {
    localStorage.setItem("job-ipfs-cid:abc123", "bafkreiabc");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "Fetched text",
    }));

    await resolveDescription("abc123", "mygw.mypinata.cloud");

    expect(localStorage.getItem("job-desc:abc123")).toBe("Fetched text");
    vi.unstubAllGlobals();
  });

  it("returns null when all gateways fail", async () => {
    localStorage.setItem("job-ipfs-cid:abc123", "bafkreiabc");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const result = await resolveDescription("abc123", "mygw.mypinata.cloud");

    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });

  it("returns null when all gateways return non-OK responses", async () => {
    localStorage.setItem("job-ipfs-cid:abc123", "bafkreiabc");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const result = await resolveDescription("abc123", "mygw.mypinata.cloud");

    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });
});

// ── cacheDescription ──────────────────────────────────────────────────────────

describe("cacheDescription", () => {
  beforeEach(() => localStorage.clear());

  it("stores text and CID under the expected keys", () => {
    cacheDescription("deadbeef", "Hello IPFS", "bafkreixyz");

    expect(localStorage.getItem("job-desc:deadbeef")).toBe("Hello IPFS");
    expect(localStorage.getItem("job-ipfs-cid:deadbeef")).toBe("bafkreixyz");
  });

  it("omits the CID key when an empty string is passed (no IPFS configured)", () => {
    cacheDescription("deadbeef", "Hello", "");

    expect(localStorage.getItem("job-desc:deadbeef")).toBe("Hello");
    // empty string is still stored (falsy but harmless — lookup will skip empty CIDs)
    expect(localStorage.getItem("job-ipfs-cid:deadbeef")).toBe("");
  });
});
