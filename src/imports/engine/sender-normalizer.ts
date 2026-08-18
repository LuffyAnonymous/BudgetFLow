import { AccountType } from "@prisma/client";

/**
 * Resolves a raw SMS sender string into the institution it represents.
 *
 * Unlike the old single-bank version of this module, an unrecognized sender
 * is never dropped — it resolves to AccountType.OTHER_BANK with a
 * best-effort display name derived from the sender string itself. The
 * caller (import.service.ts) is responsible for creating/reusing an Account
 * row keyed by that display name via accountService.ensureAccountForInstitution.
 */
export interface ResolvedInstitution {
  accountType: AccountType;
  displayName: string;
}

interface InstitutionEntry {
  /** Canonical (normalized) sender-ID substrings that identify this institution. */
  senderMatches: string[];
  accountType: AccountType;
  displayName: string;
}

const INSTITUTIONS: InstitutionEntry[] = [
  { senderMatches: ["ENBD", "EMIRATESNBD"], accountType: AccountType.EMIRATES_NBD, displayName: "Emirates NBD" },
  { senderMatches: ["ADCB"], accountType: AccountType.ADCB, displayName: "ADCB" },
  { senderMatches: ["FAB", "FGB"], accountType: AccountType.FAB, displayName: "First Abu Dhabi Bank" },
  { senderMatches: ["MASHREQ"], accountType: AccountType.MASHREQ, displayName: "Mashreq" },
  { senderMatches: ["RAKBANK", "RAKBNK"], accountType: AccountType.RAKBANK, displayName: "RAKBANK" },
  { senderMatches: ["DIB", "DIBUAE"], accountType: AccountType.DIB, displayName: "Dubai Islamic Bank" },
  { senderMatches: ["CBD", "CBDUAE"], accountType: AccountType.CBD, displayName: "Commercial Bank of Dubai" },
  { senderMatches: ["ADIB"], accountType: AccountType.ADIB, displayName: "Abu Dhabi Islamic Bank" },
  { senderMatches: ["HSBC", "HSBCUAE"], accountType: AccountType.HSBC_UAE, displayName: "HSBC UAE" },
  { senderMatches: ["SIB", "SIBUAE"], accountType: AccountType.SIB, displayName: "Sharjah Islamic Bank" },
  { senderMatches: ["WIO", "WIOBANK"], accountType: AccountType.WIO, displayName: "Wio Bank" },
  { senderMatches: ["LIV", "LIVBANK"], accountType: AccountType.LIV, displayName: "Liv" },
  { senderMatches: ["TABBY"], accountType: AccountType.TABBY, displayName: "Tabby" },
  { senderMatches: ["TAMARA"], accountType: AccountType.TAMARA, displayName: "Tamara" },
  { senderMatches: ["BOTIM"], accountType: AccountType.BOTIM, displayName: "Botim" },
];

/** Normalizes a raw sender string for matching: uppercase, strip whitespace/hyphens. */
function canonicalize(rawSender: string): string {
  return rawSender.trim().toUpperCase().replace(/[\s-]/g, "");
}

/** Best-effort human-readable name for an institution we don't explicitly recognize. */
function deriveDisplayName(rawSender: string): string {
  const trimmed = rawSender.trim();
  if (!trimmed) return "Unknown Sender";
  // "SOMEBANK" -> "Somebank"; "Some Bank" is left as-is (already readable).
  if (/^[A-Z0-9\s-]+$/.test(trimmed)) {
    return trimmed
      .split(/\s+/)
      .map((word) => (word.length > 1 ? word[0] + word.slice(1).toLowerCase() : word))
      .join(" ");
  }
  return trimmed;
}

/**
 * Resolves the institution behind a raw SMS sender string.
 * Always returns a result — an unrecognized sender resolves to OTHER_BANK
 * with a derived display name, never null. Matching is a substring check
 * on both sides so aliases like "EMIRATESNBD" and prefixed/suffixed sender
 * IDs (carrier-mangled sender strings are common) still resolve correctly.
 */
export function resolveInstitution(rawSender: string): ResolvedInstitution {
  const canonical = canonicalize(rawSender);

  for (const entry of INSTITUTIONS) {
    const matched = entry.senderMatches.some((candidate) => {
      const canonicalCandidate = canonicalize(candidate);
      return canonical.includes(canonicalCandidate) || canonicalCandidate.includes(canonical);
    });
    if (matched) {
      return { accountType: entry.accountType, displayName: entry.displayName };
    }
  }

  return { accountType: AccountType.OTHER_BANK, displayName: deriveDisplayName(rawSender) };
}
