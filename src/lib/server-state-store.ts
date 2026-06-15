import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConditionAuditLogEntry, ServerSyncPayload } from "./post-mvp";

export type StoredServerState = {
  accountId: string;
  savedAt: string;
  payload: ServerSyncPayload;
};

export type StoredAuditEvent = ConditionAuditLogEntry & {
  accountId: string;
  eventType: "condition-price-ranked" | "condition-price-clicked" | "condition-price-exported";
  appendedAt: string;
};

const DEFAULT_STORE_DIR = ".server-state";

export function getServerStateStoreDir() {
  return process.env.HOME_STACK_STATE_STORE_DIR || join(process.cwd(), DEFAULT_STORE_DIR);
}

export function normalizeAccountId(accountId: string) {
  const normalized = accountId
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 80);
  return normalized || "demo-account";
}

export async function saveServerState(payload: ServerSyncPayload, savedAt = new Date().toISOString()): Promise<StoredServerState> {
  const accountId = normalizeAccountId(payload.account.accountId);
  const stored: StoredServerState = {
    accountId,
    savedAt,
    payload: {
      ...payload,
      account: {
        ...payload.account,
        accountId,
      },
    },
  };

  await mkdir(getServerStateStoreDir(), { recursive: true });
  await writeFile(getStatePath(accountId), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  return stored;
}

export async function loadServerState(accountId: string): Promise<StoredServerState | null> {
  try {
    const text = await readFile(getStatePath(normalizeAccountId(accountId)), "utf8");
    return JSON.parse(text) as StoredServerState;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function resetServerState(accountId: string) {
  const normalized = normalizeAccountId(accountId);
  await rm(getStatePath(normalized), { force: true });
  await rm(getAuditPath(normalized), { force: true });
  return { accountId: normalized, deleted: true };
}

export async function appendAuditEvents({
  accountId,
  events,
  eventType = "condition-price-exported",
  appendedAt = new Date().toISOString(),
}: {
  accountId: string;
  events: ConditionAuditLogEntry[];
  eventType?: StoredAuditEvent["eventType"];
  appendedAt?: string;
}): Promise<StoredAuditEvent[]> {
  const normalized = normalizeAccountId(accountId);
  const existing = await listAuditEvents(normalized);
  const nextEvents = events.map((event) => ({
    ...event,
    accountId: normalized,
    eventType,
    appendedAt,
  }));

  await mkdir(getServerStateStoreDir(), { recursive: true });
  await writeFile(getAuditPath(normalized), `${JSON.stringify([...existing, ...nextEvents], null, 2)}\n`, "utf8");
  return nextEvents;
}

export async function listAuditEvents(accountId: string): Promise<StoredAuditEvent[]> {
  try {
    const text = await readFile(getAuditPath(normalizeAccountId(accountId)), "utf8");
    return JSON.parse(text) as StoredAuditEvent[];
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

function getStatePath(accountId: string) {
  return join(getServerStateStoreDir(), `${normalizeAccountId(accountId)}.json`);
}

function getAuditPath(accountId: string) {
  return join(getServerStateStoreDir(), `${normalizeAccountId(accountId)}.audit.json`);
}

function isMissingFile(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
