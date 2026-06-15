import { normalizeAccountId } from "./server-state-store";

export type AccountAccessContext = {
  accountId?: string;
  required: boolean;
  source: "trusted-header" | "missing";
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
  const rawAccountId = request.headers.get(getTrustedAccountHeaderName()) ?? "";
  const accountId = rawAccountId.trim() ? normalizeAccountId(rawAccountId) : undefined;

  return {
    accountId,
    required: process.env.HOME_STACK_ACCOUNT_AUTH_REQUIRED === "true",
    source: accountId ? "trusted-header" : "missing",
  };
}

export function getTrustedAccountHeaderName() {
  const configured = process.env.HOME_STACK_TRUSTED_ACCOUNT_HEADER?.trim().toLowerCase();
  return configured || DEFAULT_ACCOUNT_HEADER;
}
