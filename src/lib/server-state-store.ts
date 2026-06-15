import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConditionAuditLogEntry, ServerSyncPayload } from "./post-mvp";

export type ServerStateStoreKind = "file-json";

export type ServerStateStoreStatus = {
  kind: ServerStateStoreKind;
  configuredBy: "default" | "env";
  storeDir: string;
  writable: boolean;
  schemaVersion: ServerSyncPayload["schemaVersion"];
  supports: {
    accountState: true;
    auditEvents: true;
    replaceableRepository: true;
  };
  checkedAt: string;
};

export type StoredServerState = {
  accountId: string;
  savedAt: string;
  payload: ServerSyncPayload;
};

export type StoredAccountSummary = {
  accountId: string;
  authMode: ServerSyncPayload["account"]["authMode"];
  emailHash?: string;
  provider?: ServerSyncPayload["account"]["provider"];
  displayName?: string;
  verified?: boolean;
  createdAt?: string;
  lastSavedAt: string;
  schemaVersion: ServerSyncPayload["schemaVersion"];
  inventoryCount: number;
  queueCount: number;
  conditionalAuditCount: number;
  notificationDraftCount: number;
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

export async function getServerStateStoreStatus(checkedAt = new Date().toISOString()): Promise<ServerStateStoreStatus> {
  const storeDir = getServerStateStoreDir();
  const probePath = join(storeDir, ".healthcheck");
  let writable = false;

  try {
    await mkdir(storeDir, { recursive: true });
    await writeFile(probePath, checkedAt, "utf8");
    await rm(probePath, { force: true });
    writable = true;
  } catch {
    writable = false;
  }

  return {
    kind: "file-json",
    configuredBy: process.env.HOME_STACK_STATE_STORE_DIR ? "env" : "default",
    storeDir,
    writable,
    schemaVersion: "post-mvp-sync-v1",
    supports: {
      accountState: true,
      auditEvents: true,
      replaceableRepository: true,
    },
    checkedAt,
  };
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
  await upsertAccountSummary(stored);
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
  await removeAccountSummary(normalized);
  return { accountId: normalized, deleted: true };
}

export async function listServerAccounts(): Promise<StoredAccountSummary[]> {
  try {
    const text = await readFile(getAccountIndexPath(), "utf8");
    const accounts = JSON.parse(text) as StoredAccountSummary[];
    return accounts.sort((a, b) => b.lastSavedAt.localeCompare(a.lastSavedAt) || a.accountId.localeCompare(b.accountId));
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
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

function getAccountIndexPath() {
  return join(getServerStateStoreDir(), "accounts.index.json");
}

async function upsertAccountSummary(stored: StoredServerState) {
  const existing = await listServerAccounts();
  const summary = buildAccountSummary(stored);
  const next = [summary, ...existing.filter((account) => account.accountId !== summary.accountId)].sort(
    (a, b) => b.lastSavedAt.localeCompare(a.lastSavedAt) || a.accountId.localeCompare(b.accountId),
  );

  await writeFile(getAccountIndexPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function removeAccountSummary(accountId: string) {
  const existing = await listServerAccounts();
  const next = existing.filter((account) => account.accountId !== normalizeAccountId(accountId));
  await mkdir(getServerStateStoreDir(), { recursive: true });
  await writeFile(getAccountIndexPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function buildAccountSummary(stored: StoredServerState): StoredAccountSummary {
  return {
    accountId: stored.accountId,
    authMode: stored.payload.account.authMode,
    emailHash: stored.payload.account.emailHash,
    provider: stored.payload.account.provider,
    displayName: stored.payload.account.displayName,
    verified: stored.payload.account.verified,
    createdAt: stored.payload.account.createdAt,
    lastSavedAt: stored.savedAt,
    schemaVersion: stored.payload.schemaVersion,
    inventoryCount: stored.payload.summary.inventoryCount,
    queueCount: stored.payload.summary.queueCount,
    conditionalAuditCount: stored.payload.summary.conditionalAuditCount,
    notificationDraftCount: stored.payload.summary.notificationDraftCount,
  };
}

function isMissingFile(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
