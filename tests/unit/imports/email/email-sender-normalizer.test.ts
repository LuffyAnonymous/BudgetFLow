import { describe, it, expect } from "vitest";
import { resolveEmailInstitution } from "../../../../src/imports/email/email-sender-normalizer";
import { AccountType } from "@prisma/client";

describe("resolveEmailInstitution", () => {
  it("resolves Emirates NBD from its sending domain", () => {
    const result = resolveEmailInstitution("OnlineBanking@emiratesnbd.com");
    expect(result.accountType).toBe(AccountType.EMIRATES_NBD);
    expect(result.institutionCode).toBe("ENBD");
    expect(result.displayName).toBe("Emirates NBD");
  });

  it("matches a subdomain of the registered domain", () => {
    const result = resolveEmailInstitution("alerts@notifications.emiratesnbd.com");
    expect(result.accountType).toBe(AccountType.EMIRATES_NBD);
  });

  it("resolves Mashreq from its sending domain", () => {
    const result = resolveEmailInstitution("no-reply@mashreqbank.com");
    expect(result.accountType).toBe(AccountType.MASHREQ);
    expect(result.institutionCode).toBe("MASHREQ");
  });

  it("never returns null — unrecognized domains fall back to OTHER_BANK", () => {
    const result = resolveEmailInstitution("statements@somerandombank.com");
    expect(result.accountType).toBe(AccountType.OTHER_BANK);
    expect(result.institutionCode).toBe("UNKNOWN_somerandombank.com");
    expect(result.displayName).toBe("Somerandombank");
  });

  it("does not false-match a domain that merely contains the registered domain as a substring", () => {
    // "notemiratesnbd.com" contains "emiratesnbd.com" as a raw substring but
    // is not a subdomain of it — must not match.
    const result = resolveEmailInstitution("phish@notemiratesnbd.com");
    expect(result.accountType).toBe(AccountType.OTHER_BANK);
  });
});
