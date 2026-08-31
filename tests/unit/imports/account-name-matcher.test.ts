import { describe, it, expect } from "vitest";
import { matchAccountByDescription } from "../../../src/imports/engine/account-name-matcher";

describe("matchAccountByDescription", () => {
  const accounts = [
    { id: "acc-1", name: "Emirates NBD" },
    { id: "acc-2", name: "Mashreq" },
    { id: "acc-3", name: "Cash" },
  ];

  it("returns null for a null description", () => {
    expect(matchAccountByDescription(accounts, null)).toBeNull();
  });

  it("returns null when no account name appears in the description", () => {
    expect(matchAccountByDescription(accounts, "Transfer to Some Other Bank")).toBeNull();
  });

  it("matches a substring, case-insensitively", () => {
    expect(matchAccountByDescription(accounts, "MASHREQBANK PSC SWIFT / Routing Code: BOMLAEAD")?.id).toBe("acc-2");
  });

  it("matches the account name however it appears in the message", () => {
    expect(matchAccountByDescription(accounts, "transfer to emirates nbd savings")?.id).toBe("acc-1");
  });

  it("returns the first matching account when multiple candidates could match", () => {
    const overlapping = [
      { id: "a", name: "Bank" },
      { id: "b", name: "Bank" },
    ];
    expect(matchAccountByDescription(overlapping, "Transfer to Bank")?.id).toBe("a");
  });
});
