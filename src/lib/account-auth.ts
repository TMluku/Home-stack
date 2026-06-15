import type { AccountProfile } from "./account-profile";
import { buildAccountProfile } from "./account-profile";
import { normalizeAccountId } from "./server-state-store";

export type AccountAccessContext = {
  accountId?: string;
  required: boolean;
  source: "trusted-header" | "trusted-identity" | "missing";
};

export type TrustedAccountSession = {
  profile: AccountProfile;
  context: AccountAccessContext & {
    trustedHeaders: {
      accountId: string;
      email: string;
      subject: string;
      provider: string;
      displayName: string;
      emailVerified: string;
    };
  };
};

export type AccountAccessResult =
  | {
      ok: true;
      accountId: string;
      context: AccountAccessContext;
    }
  | {
      ok: false;
      status: 401 | 403;
      error: string;
      context: AccountAccessContext;
    };

const DEFAULT_ACCOUNT_HEADER = "x-home-stack-account-id";
const DEFAULT_EMAIL_HEADER = "x-home-stack-user-email";
const DEFAULT_SUBJECT_HEADER = "x-home-stack-user-sub";
const DEFAULT_PROVIDER_HEADER = "x-home-stack-auth-provider";
const DEFAULT_DISPLAY_NAME_HEADER = "x-home-stack-display-name";
const DEFAULT_EMAIL_VERIFIED_HEADER = "x-home-stack-email-verified";

export function resolveAccountAccess(request: Request, requestedAccountId: string): AccountAccessResult {
  const context = getAccountAccessContext(request);
  const normalizedRequest = normalizeAccountId(requestedAccountId);

  if (context.required && !context.accountId) {
    return {
      ok: false,
      status: 401,
      error: `${getTrustedAccountHeaderName()} header is required for account-scoped API access.`,
      context,
    };
  }

  if (context.accountId && context.accountId !== normalizedRequest) {
    return {
      ok: false,
      status: 403,
      error: "Authenticated account does not match requested accountId.",
      context,
    };
  }

  return {
    ok: true,
    accountId: context.accountId ?? normalizedRequest,
    context,
  };
}

export function getAccountAccessContext(request: Request): AccountAccessContext {
  const session = getTrustedAccountSession(request);

  return {
    accountId: session?.profile.accountId,
    required: process.env.HOME_STACK_ACCOUNT_AUTH_REQUIRED === "true",
    source: session?.context.source ?? "missing",
  };
}

export function getTrustedAccountSession(request: Request, createdAt = new Date().toISOString()): TrustedAccountSession | null {
  const trustedHeaders = getTrustedAccountHeaderNames();
  const rawAccountId = request.headers.get(trustedHeaders.accountId)?.trim() ?? "";
  const rawEmail = request.headers.get(trustedHeaders.email)?.trim() ?? "";
  const rawSubject = request.headers.get(trustedHeaders.subject)?.trim() ?? "";
  const rawProvider = request.headers.get(trustedHeaders.provider)?.trim() ?? "";
  const rawDisplayName = request.headers.get(trustedHeaders.displayName)?.trim() ?? "";
  const rawEmailVerified = request.headers.get(trustedHeaders.emailVerified)?.trim() ?? "";
  const provider = parseTrustedProvider(rawProvider);
  const verified = parseTrustedBoolean(rawEmailVerified);

  if (rawEmail) {
    const profile = buildAccountProfile({
      email: rawEmail,
      provider,
      displayName: rawDisplayName,
      createdAt,
      verified,
    });

    return {
      profile,
      context: {
        accountId: profile.accountId,
        required: process.env.HOME_STACK_ACCOUNT_AUTH_REQUIRED === "true",
        source: "trusted-identity",
        trustedHeaders,
      },
    };
  }

  if (rawSubject) {
    const accountId = normalizeAccountId(`acct-${provider}-${rawSubject}`);
    const profile: AccountProfile = {
      accountId,
      authMode: provider === "email" ? "email-link" : "oauth",
      provider,
      displayName: rawDisplayName || undefined,
      createdAt,
      verified,
    };

    return {
      profile,
      context: {
        accountId,
        required: process.env.HOME_STACK_ACCOUNT_AUTH_REQUIRED === "true",
        source: "trusted-identity",
        trustedHeaders,
      },
    };
  }

  if (rawAccountId) {
    const accountId = normalizeAccountId(rawAccountId);
    const profile: AccountProfile = {
      accountId,
      authMode: provider === "email" ? "email-link" : "oauth",
      provider,
      displayName: rawDisplayName || undefined,
      createdAt,
      verified,
    };

    return {
      profile,
      context: {
        accountId,
        required: process.env.HOME_STACK_ACCOUNT_AUTH_REQUIRED === "true",
        source: "trusted-header",
        trustedHeaders,
      },
    };
  }

  return null;
}

export function getTrustedAccountHeaderName() {
  const configured = process.env.HOME_STACK_TRUSTED_ACCOUNT_HEADER?.trim().toLowerCase();
  return configured || DEFAULT_ACCOUNT_HEADER;
}

export function getTrustedAccountHeaderNames() {
  return {
    accountId: getTrustedAccountHeaderName(),
    email: getConfiguredHeaderName("HOME_STACK_TRUSTED_EMAIL_HEADER", DEFAULT_EMAIL_HEADER),
    subject: getConfiguredHeaderName("HOME_STACK_TRUSTED_SUBJECT_HEADER", DEFAULT_SUBJECT_HEADER),
    provider: getConfiguredHeaderName("HOME_STACK_TRUSTED_PROVIDER_HEADER", DEFAULT_PROVIDER_HEADER),
    displayName: getConfiguredHeaderName("HOME_STACK_TRUSTED_DISPLAY_NAME_HEADER", DEFAULT_DISPLAY_NAME_HEADER),
    emailVerified: getConfiguredHeaderName("HOME_STACK_TRUSTED_EMAIL_VERIFIED_HEADER", DEFAULT_EMAIL_VERIFIED_HEADER),
  };
}

function getConfiguredHeaderName(envKey: string, fallback: string) {
  const configured = process.env[envKey]?.trim().toLowerCase();
  return configured || fallback;
}

function parseTrustedProvider(value: string): NonNullable<AccountProfile["provider"]> {
  return value === "google" || value === "github" || value === "apple" || value === "email" ? value : "email";
}

function parseTrustedBoolean(value: string) {
  return value === "true" || value === "1" || value.toLowerCase() === "yes";
}
