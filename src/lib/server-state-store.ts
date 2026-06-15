import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres, { type Sql } from "postgres";
import type { NotificationDispatchResult, NotificationDispatchSummary, NotificationJob, NotificationJobSummary } from "./notification-jobs";
import type { ConditionAuditLogEntry, ServerSyncPayload } from "./post-mvp";

export type ServerStateStoreKind = "file-json" | "postgres";

export type ServerStateStoreStatus = {
  kind: ServerStateStoreKind;
  configuredBy: "default" | "env";
  storeDir?: string;
  databaseUrlConfigured?: boolean;
  tablePrefix?: string;
  writable: boolean;
  schemaVersion: ServerSyncPayload["schemaVersion"];
  supports: {
    accountState: true;
    auditEvents: true;
    notificationEvents: true;
    replaceableRepository: true;
  };
  error?: string;
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

export type StoredNotificationEvent =
  | {
      id: string;
      accountId: string;
      eventType: "notification-prepared";
      appendedAt: string;
      jobs: NotificationJob[];
      summary: NotificationJobSummary;
    }
  | {
      id: string;
      accountId: string;
      eventType: "notification-dispatched";
      appendedAt: string;
      dryRun: boolean;
      results: NotificationDispatchResult[];
      summary: NotificationDispatchSummary;
    };

type NotificationEventInput =
  | {
      accountId: string;
      eventType: "notification-prepared";
      appendedAt: string;
      jobs: NotificationJob[];
      summary: NotificationJobSummary;
    }
  | {
      accountId: string;
      eventType: "notification-dispatched";
      appendedAt: string;
      dryRun: boolean;
      results: NotificationDispatchResult[];
      summary: NotificationDispatchSummary;
    };

const DEFAULT_STORE_DIR = ".server-state";
const DEFAULT_TABLE_PREFIX = "home_stack";

type ServerStateRepository = {
  status(checkedAt?: string): Promise<ServerStateStoreStatus>;
  saveState(payload: ServerSyncPayload, savedAt?: string): Promise<StoredServerState>;
  loadState(accountId: string): Promise<StoredServerState | null>;
  resetState(accountId: string): Promise<{ accountId: string; deleted: true }>;
  listAccounts(): Promise<StoredAccountSummary[]>;
  appendAuditEvents(input: {
    accountId: string;
    events: ConditionAuditLogEntry[];
    eventType?: StoredAuditEvent["eventType"];
    appendedAt?: string;
  }): Promise<StoredAuditEvent[]>;
  listAuditEvents(accountId: string): Promise<StoredAuditEvent[]>;
  appendNotificationEvent(event: NotificationEventInput): Promise<StoredNotificationEvent>;
  listNotificationEvents(accountId: string): Promise<StoredNotificationEvent[]>;
};

let postgresClient: Sql | null = null;
let postgresClientUrl: string | null = null;
const readyPostgresSchemas = new Set<string>();

export function getServerStateStoreDir() {
  return process.env.HOME_STACK_STATE_STORE_DIR || join(process.cwd(), DEFAULT_STORE_DIR);
}

export async function getServerStateStoreStatus(checkedAt = new Date().toISOString()): Promise<ServerStateStoreStatus> {
  return getServerStateRepository().status(checkedAt);
}

export function normalizeAccountId(accountId: string) {
  const normalized = accountId
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 80);
  return normalized || "demo-account";
}

export async function saveServerState(payload: ServerSyncPayload, savedAt = new Date().toISOString()): Promise<StoredServerState> {
  return getServerStateRepository().saveState(payload, savedAt);
}

export async function loadServerState(accountId: string): Promise<StoredServerState | null> {
  return getServerStateRepository().loadState(accountId);
}

export async function resetServerState(accountId: string) {
  return getServerStateRepository().resetState(accountId);
}

export async function listServerAccounts(): Promise<StoredAccountSummary[]> {
  return getServerStateRepository().listAccounts();
}

export async function appendAuditEvents(input: {
  accountId: string;
  events: ConditionAuditLogEntry[];
  eventType?: StoredAuditEvent["eventType"];
  appendedAt?: string;
}): Promise<StoredAuditEvent[]> {
  return getServerStateRepository().appendAuditEvents(input);
}

export async function listAuditEvents(accountId: string): Promise<StoredAuditEvent[]> {
  return getServerStateRepository().listAuditEvents(accountId);
}

export async function appendNotificationEvent(event: NotificationEventInput) {
  return getServerStateRepository().appendNotificationEvent(event);
}

export async function listNotificationEvents(accountId: string): Promise<StoredNotificationEvent[]> {
  return getServerStateRepository().listNotificationEvents(accountId);
}

function getServerStateRepository(): ServerStateRepository {
  return getServerStateStoreKind() === "postgres" ? new PostgresStateRepository() : new FileJsonStateRepository();
}

function getServerStateStoreKind(): ServerStateStoreKind {
  return process.env.HOME_STACK_STATE_STORE_KIND === "postgres" ? "postgres" : "file-json";
}

function getPostgresUrl() {
  return process.env.HOME_STACK_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
}

function getPostgresTablePrefix() {
  const prefix = (process.env.HOME_STACK_STATE_TABLE_PREFIX || DEFAULT_TABLE_PREFIX).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 48);
  return prefix || DEFAULT_TABLE_PREFIX;
}

function getBaseStatus(kind: ServerStateStoreKind, checkedAt: string): Omit<ServerStateStoreStatus, "writable"> {
  return {
    kind,
    configuredBy:
      process.env.HOME_STACK_STATE_STORE_KIND ||
      process.env.HOME_STACK_STATE_STORE_DIR ||
      process.env.HOME_STACK_POSTGRES_URL ||
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL
        ? "env"
        : "default",
    schemaVersion: "post-mvp-sync-v1",
    supports: {
      accountState: true,
      auditEvents: true,
      notificationEvents: true,
      replaceableRepository: true,
    },
    checkedAt,
  };
}

class FileJsonStateRepository implements ServerStateRepository {
  async status(checkedAt = new Date().toISOString()): Promise<ServerStateStoreStatus> {
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
      ...getBaseStatus("file-json", checkedAt),
      configuredBy: process.env.HOME_STACK_STATE_STORE_DIR ? "env" : "default",
      storeDir,
      writable,
    };
  }

  async saveState(payload: ServerSyncPayload, savedAt = new Date().toISOString()): Promise<StoredServerState> {
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
    await this.upsertAccountSummary(stored);
    return stored;
  }

  async loadState(accountId: string): Promise<StoredServerState | null> {
    try {
      const text = await readFile(getStatePath(normalizeAccountId(accountId)), "utf8");
      return JSON.parse(text) as StoredServerState;
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async resetState(accountId: string) {
    const normalized = normalizeAccountId(accountId);
    await rm(getStatePath(normalized), { force: true });
    await rm(getAuditPath(normalized), { force: true });
    await rm(getNotificationPath(normalized), { force: true });
    await this.removeAccountSummary(normalized);
    return { accountId: normalized, deleted: true as const };
  }

  async listAccounts(): Promise<StoredAccountSummary[]> {
    try {
      const text = await readFile(getAccountIndexPath(), "utf8");
      const accounts = JSON.parse(text) as StoredAccountSummary[];
      return sortAccountSummaries(accounts);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  async appendAuditEvents({
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
    const existing = await this.listAuditEvents(normalized);
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

  async listAuditEvents(accountId: string): Promise<StoredAuditEvent[]> {
    try {
      const text = await readFile(getAuditPath(normalizeAccountId(accountId)), "utf8");
      return JSON.parse(text) as StoredAuditEvent[];
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  async appendNotificationEvent(event: NotificationEventInput) {
    const normalized = normalizeAccountId(event.accountId);
    const existing = await this.listNotificationEvents(normalized);
    const stored = {
      ...event,
      id: `${normalized}-${event.eventType}-${event.appendedAt}`,
      accountId: normalized,
    } as StoredNotificationEvent;

    await mkdir(getServerStateStoreDir(), { recursive: true });
    await writeFile(getNotificationPath(normalized), `${JSON.stringify([stored, ...existing].slice(0, 100), null, 2)}\n`, "utf8");
    return stored;
  }

  async listNotificationEvents(accountId: string): Promise<StoredNotificationEvent[]> {
    try {
      const text = await readFile(getNotificationPath(normalizeAccountId(accountId)), "utf8");
      return JSON.parse(text) as StoredNotificationEvent[];
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  private async upsertAccountSummary(stored: StoredServerState) {
    const existing = await this.listAccounts();
    const summary = buildAccountSummary(stored);
    const next = sortAccountSummaries([summary, ...existing.filter((account) => account.accountId !== summary.accountId)]);

    await writeFile(getAccountIndexPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }

  private async removeAccountSummary(accountId: string) {
    const existing = await this.listAccounts();
    const next = existing.filter((account) => account.accountId !== normalizeAccountId(accountId));
    await mkdir(getServerStateStoreDir(), { recursive: true });
    await writeFile(getAccountIndexPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }
}

class PostgresStateRepository implements ServerStateRepository {
  private readonly databaseUrl = getPostgresUrl();
  private readonly tablePrefix = getPostgresTablePrefix();
  private readonly stateTable = `${this.tablePrefix}_account_states`;
  private readonly auditTable = `${this.tablePrefix}_audit_events`;
  private readonly notificationTable = `${this.tablePrefix}_notification_events`;

  async status(checkedAt = new Date().toISOString()): Promise<ServerStateStoreStatus> {
    const base = {
      ...getBaseStatus("postgres", checkedAt),
      databaseUrlConfigured: Boolean(this.databaseUrl),
      tablePrefix: this.tablePrefix,
    };

    if (!this.databaseUrl) {
      return { ...base, writable: false, error: "HOME_STACK_POSTGRES_URL, POSTGRES_URL, or DATABASE_URL is required." };
    }

    try {
      await this.ensureSchema();
      await this.sql()`select 1`;
      return { ...base, writable: true };
    } catch (error) {
      return { ...base, writable: false, error: error instanceof Error ? error.message : "Postgres healthcheck failed." };
    }
  }

  async saveState(payload: ServerSyncPayload, savedAt = new Date().toISOString()): Promise<StoredServerState> {
    await this.ensureSchema();
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

    await this.sql()`
      insert into ${this.identifier(this.stateTable)} (account_id, saved_at, payload)
      values (${stored.accountId}, ${stored.savedAt}, ${this.sql().json(stored.payload)})
      on conflict (account_id)
      do update set saved_at = excluded.saved_at, payload = excluded.payload
    `;
    return stored;
  }

  async loadState(accountId: string): Promise<StoredServerState | null> {
    await this.ensureSchema();
    const rows = await this.sql()<PostgresStateRow[]>`
      select account_id, saved_at, payload
      from ${this.identifier(this.stateTable)}
      where account_id = ${normalizeAccountId(accountId)}
      limit 1
    `;
    const row = rows[0];
    return row ? stateRowToStoredState(row) : null;
  }

  async resetState(accountId: string) {
    await this.ensureSchema();
    const normalized = normalizeAccountId(accountId);
    await this.sql().begin(async (sql) => {
      await sql`delete from ${sql(this.stateTable)} where account_id = ${normalized}`;
      await sql`delete from ${sql(this.auditTable)} where account_id = ${normalized}`;
      await sql`delete from ${sql(this.notificationTable)} where account_id = ${normalized}`;
    });
    return { accountId: normalized, deleted: true as const };
  }

  async listAccounts(): Promise<StoredAccountSummary[]> {
    await this.ensureSchema();
    const rows = await this.sql()<PostgresStateRow[]>`
      select account_id, saved_at, payload
      from ${this.identifier(this.stateTable)}
      order by saved_at desc, account_id asc
    `;
    return sortAccountSummaries(rows.map(stateRowToStoredState).map(buildAccountSummary));
  }

  async appendAuditEvents({
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
    await this.ensureSchema();
    const normalized = normalizeAccountId(accountId);
    const nextEvents = events.map((event) => ({
      ...event,
      accountId: normalized,
      eventType,
      appendedAt,
    }));

    await this.sql().begin(async (sql) => {
      for (const event of nextEvents) {
        await sql`
          insert into ${sql(this.auditTable)} (account_id, event_type, appended_at, event)
          values (${normalized}, ${eventType}, ${appendedAt}, ${sql.json(event)})
        `;
      }
    });
    return nextEvents;
  }

  async listAuditEvents(accountId: string): Promise<StoredAuditEvent[]> {
    await this.ensureSchema();
    const rows = await this.sql()<PostgresJsonEventRow[]>`
      select event
      from ${this.identifier(this.auditTable)}
      where account_id = ${normalizeAccountId(accountId)}
      order by id asc
    `;
    return rows.map((row) => parseJsonObject(row.event) as StoredAuditEvent);
  }

  async appendNotificationEvent(event: NotificationEventInput) {
    await this.ensureSchema();
    const normalized = normalizeAccountId(event.accountId);
    const stored = {
      ...event,
      id: `${normalized}-${event.eventType}-${event.appendedAt}`,
      accountId: normalized,
    } as StoredNotificationEvent;

    await this.sql()`
      insert into ${this.identifier(this.notificationTable)} (id, account_id, event_type, appended_at, event)
      values (${stored.id}, ${normalized}, ${stored.eventType}, ${stored.appendedAt}, ${this.sql().json(stored)})
      on conflict (id) do update set event = excluded.event
    `;
    return stored;
  }

  async listNotificationEvents(accountId: string): Promise<StoredNotificationEvent[]> {
    await this.ensureSchema();
    const rows = await this.sql()<PostgresJsonEventRow[]>`
      select event
      from ${this.identifier(this.notificationTable)}
      where account_id = ${normalizeAccountId(accountId)}
      order by appended_at desc, id desc
      limit 100
    `;
    return rows.map((row) => parseJsonObject(row.event) as StoredNotificationEvent);
  }

  private sql() {
    if (!this.databaseUrl)
      throw new Error("HOME_STACK_POSTGRES_URL, POSTGRES_URL, or DATABASE_URL is required for postgres state storage.");
    if (!postgresClient || postgresClientUrl !== this.databaseUrl) {
      postgresClient = postgres(this.databaseUrl, { max: 3 });
      postgresClientUrl = this.databaseUrl;
    }
    return postgresClient;
  }

  private identifier(name: string) {
    return this.sql()(name);
  }

  private async ensureSchema() {
    const schemaKey = `${this.databaseUrl}:${this.tablePrefix}`;
    if (readyPostgresSchemas.has(schemaKey)) return;
    const sql = this.sql();
    await sql`
      create table if not exists ${sql(this.stateTable)} (
        account_id text primary key,
        saved_at text not null,
        payload jsonb not null
      )
    `;
    await sql`
      create table if not exists ${sql(this.auditTable)} (
        id bigserial primary key,
        account_id text not null,
        event_type text not null,
        appended_at text not null,
        event jsonb not null
      )
    `;
    await sql`
      create index if not exists ${sql(`${this.auditTable}_account_idx`)}
      on ${sql(this.auditTable)} (account_id, id)
    `;
    await sql`
      create table if not exists ${sql(this.notificationTable)} (
        id text primary key,
        account_id text not null,
        event_type text not null,
        appended_at text not null,
        event jsonb not null
      )
    `;
    await sql`
      create index if not exists ${sql(`${this.notificationTable}_account_idx`)}
      on ${sql(this.notificationTable)} (account_id, appended_at desc)
    `;
    readyPostgresSchemas.add(schemaKey);
  }
}

type PostgresStateRow = {
  account_id: string;
  saved_at: string;
  payload: unknown;
};

type PostgresJsonEventRow = {
  event: unknown;
};

function stateRowToStoredState(row: PostgresStateRow): StoredServerState {
  const payload = parseJsonObject(row.payload) as ServerSyncPayload;
  const accountId = normalizeAccountId(row.account_id);
  return {
    accountId,
    savedAt: row.saved_at,
    payload: {
      ...payload,
      account: {
        ...payload.account,
        accountId,
      },
    },
  };
}

function parseJsonObject(value: unknown) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function sortAccountSummaries(accounts: StoredAccountSummary[]) {
  return accounts.sort((a, b) => b.lastSavedAt.localeCompare(a.lastSavedAt) || a.accountId.localeCompare(b.accountId));
}

function getStatePath(accountId: string) {
  return join(getServerStateStoreDir(), `${normalizeAccountId(accountId)}.json`);
}

function getAuditPath(accountId: string) {
  return join(getServerStateStoreDir(), `${normalizeAccountId(accountId)}.audit.json`);
}

function getNotificationPath(accountId: string) {
  return join(getServerStateStoreDir(), `${normalizeAccountId(accountId)}.notifications.json`);
}

function getAccountIndexPath() {
  return join(getServerStateStoreDir(), "accounts.index.json");
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
