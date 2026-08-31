import "server-only";

import { google, gmail_v1 } from "googleapis";
import { createGmailOAuthClient } from "./oauth-client";
import { decodeGmailMessageBody } from "../../imports/email/gmail-message-decoder";

export interface FetchedGmailMessage {
  id: string;
  fromAddress: string;
  subject: string;
  body: string;
  internalDate: Date;
}

function is404(err: unknown): boolean {
  const status =
    (err as { code?: number | string })?.code ??
    (err as { response?: { status?: number } })?.response?.status;
  return status === 404 || status === "404";
}

/**
 * Thin wrapper over the Gmail API for the bank-email poller. Uses the
 * History API for incremental sync (Gmail's after:/before: search
 * operators are date-granularity, not minute-granularity, so a naive
 * date-based query would re-fetch an entire day's messages every poll
 * cycle) with a bounded messages.list fallback for a first connect or an
 * expired history cursor (Gmail retains ~30 days of history).
 */
export class GmailClient {
  private readonly gmail: gmail_v1.Gmail;

  constructor(refreshToken: string) {
    const auth = createGmailOAuthClient();
    auth.setCredentials({ refresh_token: refreshToken });
    this.gmail = google.gmail({ version: "v1", auth });
  }

  async getCurrentHistoryId(): Promise<string> {
    const res = await this.gmail.users.getProfile({ userId: "me" });
    if (!res.data.historyId) {
      throw new Error("Gmail profile did not return a historyId.");
    }
    return res.data.historyId;
  }

  /**
   * Starts (or renews) a push-notification subscription for this mailbox's
   * INBOX, publishing to the given Pub/Sub topic. Google caps this at 7
   * days regardless of how it's configured — the returned expiration must
   * be tracked and renewed before it lapses, there's no "permanent" option.
   */
  async watch(topicName: string): Promise<{ historyId: string; expiration: Date }> {
    const res = await this.gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName,
        labelIds: ["INBOX"],
        labelFilterAction: "include",
      },
    });
    if (!res.data.historyId || !res.data.expiration) {
      throw new Error("Gmail watch() did not return historyId/expiration.");
    }
    return { historyId: res.data.historyId, expiration: new Date(parseInt(res.data.expiration, 10)) };
  }

  /** Stops push notifications for this mailbox — called on disconnect. */
  async stopWatch(): Promise<void> {
    await this.gmail.users.stop({ userId: "me" });
  }

  async listNewMessageIdsSince(
    startHistoryId: string
  ): Promise<{ expired: true } | { expired: false; messageIds: string[]; newHistoryId: string }> {
    const messageIds = new Set<string>();
    let pageToken: string | undefined;
    let newHistoryId = startHistoryId;

    try {
      do {
        const res = await this.gmail.users.history.list({
          userId: "me",
          startHistoryId,
          historyTypes: ["messageAdded"],
          pageToken,
        });
        for (const record of res.data.history ?? []) {
          for (const added of record.messagesAdded ?? []) {
            if (added.message?.id) messageIds.add(added.message.id);
          }
        }
        if (res.data.historyId) newHistoryId = res.data.historyId;
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    } catch (err) {
      if (is404(err)) return { expired: true };
      throw err;
    }

    return { expired: false, messageIds: Array.from(messageIds), newHistoryId };
  }

  /** Bounded initial scan — first connect, or a stale/expired history cursor. */
  async listRecentMessageIds(withinDays: number): Promise<string[]> {
    const res = await this.gmail.users.messages.list({
      userId: "me",
      q: `newer_than:${withinDays}d`,
      maxResults: 100,
    });
    return (res.data.messages ?? [])
      .map((m) => m.id)
      .filter((id): id is string => !!id);
  }

  /**
   * Cheap header-only fetch (format: "metadata", no body) — used to check
   * the sender's domain before ever pulling a message's full content. An
   * email from a domain that isn't a recognized UAE bank must never have
   * its body fetched or stored, so this is checked first for every message.
   */
  async fetchFromHeader(messageId: string): Promise<string | null> {
    const res = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "metadata",
      metadataHeaders: ["From"],
    });
    const headers = res.data.payload?.headers ?? [];
    return headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? null;
  }

  async fetchMessage(messageId: string): Promise<FetchedGmailMessage | null> {
    const res = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const payload = res.data.payload;
    const body = decodeGmailMessageBody(payload);
    if (!body) return null;

    const headers = payload?.headers ?? [];
    const fromAddress = headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
    const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "";
    const internalDate = res.data.internalDate ? new Date(parseInt(res.data.internalDate, 10)) : new Date();

    return { id: messageId, fromAddress, subject, body, internalDate };
  }
}
