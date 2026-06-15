export type AccountAuthMode = "demo" | "email-link" | "oauth";

export type AccountProfile = {
  accountId: string;
  authMode: AccountAuthMode;
  emailHash?: string;
  provider?: "email" | "google" | "github" | "apple";
  displayName?: string;
  createdAt: string;
  verified: boolean;
};

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function buildAccountProfile({
  email,
  provider = "email",
  displayName,
  createdAt = new Date().toISOString(),
}: {
  email?: string;
  provider?: AccountProfile["provider"];
  displayName?: string;
  createdAt?: string;
}): AccountProfile {
  const normalizedEmail = email ? normalizeEmail(email) : "";
  const emailHash = normalizedEmail ? hashText(normalizedEmail) : undefined;
  const authMode: AccountAuthMode = normalizedEmail ? (provider === "email" ? "email-link" : "oauth") : "demo";

  return {
    accountId: emailHash ? `acct-${emailHash}` : "demo-account",
    authMode,
    emailHash,
    provider: normalizedEmail ? provider : undefined,
    displayName: displayName?.trim() || undefined,
    createdAt,
    verified: false,
  };
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
