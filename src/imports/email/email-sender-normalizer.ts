import { AccountType } from "@prisma/client";

/**
 * Resolves a raw email "From" address into the institution it represents.
 * Mirrors src/imports/engine/sender-normalizer.ts, matching on domain
 * suffix instead of an SMS sender-ID substring. An unrecognized domain is
 * never dropped — it resolves to AccountType.OTHER_BANK with a best-effort
 * display name, same always-resolves contract as the SMS resolver.
 *
 * The Emirates NBD entry's displayName ("Emirates NBD") must stay
 * identical to the SMS sender-normalizer's, so the shared fingerprint-based
 * dedup can catch the same transaction arriving via both channels.
 */
export interface ResolvedEmailInstitution {
  accountType: AccountType;
  /** Stable parser-registry key, e.g. "ENBD" */
  institutionCode: string;
  displayName: string;
}

interface EmailInstitutionEntry {
  /** Domain suffixes that identify this institution, e.g. "emiratesnbd.com" */
  domains: string[];
  accountType: AccountType;
  institutionCode: string;
  displayName: string;
}

const EMAIL_INSTITUTIONS: EmailInstitutionEntry[] = [
  { domains: ["emiratesnbd.com"], accountType: AccountType.EMIRATES_NBD, institutionCode: "ENBD", displayName: "Emirates NBD" },
  { domains: ["mashreqbank.com", "mashreq.com"], accountType: AccountType.MASHREQ, institutionCode: "MASHREQ", displayName: "Mashreq" },
];

function extractDomain(fromAddress: string): string {
  const atIndex = fromAddress.lastIndexOf("@");
  if (atIndex === -1) return fromAddress.trim().toLowerCase();
  return fromAddress.slice(atIndex + 1).trim().toLowerCase();
}

/** Best-effort human-readable name for a domain we don't explicitly recognize. */
function deriveDisplayName(domain: string): string {
  const label = domain.split(".")[0] || domain;
  if (!label) return "Unknown Sender";
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

/**
 * Strict allowlist check — true only for a domain explicitly registered in
 * EMAIL_INSTITUTIONS (unlike resolveEmailInstitution, which always resolves
 * with an OTHER_BANK fallback). Used to gate which emails ever get their
 * full body fetched/processed at all — an email from a domain that isn't a
 * known UAE bank must never be pulled or stored, not even as a "failed"
 * import record.
 */
export function isRecognizedBankDomain(fromAddress: string): boolean {
  const domain = extractDomain(fromAddress);
  return EMAIL_INSTITUTIONS.some((entry) =>
    entry.domains.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`))
  );
}

/** Every registered bank domain, flattened — for building a Gmail search query. */
export function getRecognizedBankDomains(): string[] {
  return EMAIL_INSTITUTIONS.flatMap((entry) => entry.domains);
}

export function resolveEmailInstitution(fromAddress: string): ResolvedEmailInstitution {
  const domain = extractDomain(fromAddress);

  for (const entry of EMAIL_INSTITUTIONS) {
    const matched = entry.domains.some(
      (candidate) => domain === candidate || domain.endsWith(`.${candidate}`)
    );
    if (matched) {
      return { accountType: entry.accountType, institutionCode: entry.institutionCode, displayName: entry.displayName };
    }
  }

  return { accountType: AccountType.OTHER_BANK, institutionCode: `UNKNOWN_${domain}`, displayName: deriveDisplayName(domain) };
}
