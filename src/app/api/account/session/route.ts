import { NextResponse } from "next/server";
import { getTrustedAccountHeaderNames, getTrustedAccountSession } from "@/lib/account-auth";
import { getServerStateStoreStatus } from "@/lib/server-state-store";

export async function POST(request: Request) {
  const session = getTrustedAccountSession(request);
  const status = await getServerStateStoreStatus();
  const authRequired = process.env.HOME_STACK_ACCOUNT_AUTH_REQUIRED === "true";

  if (!session) {
    return NextResponse.json(
      {
        ok: !authRequired,
        authenticated: false,
        profile: null,
        context: {
          required: authRequired,
          source: "missing",
          trustedHeaders: getTrustedAccountHeaderNames(),
        },
        status,
        error: authRequired ? "Trusted account identity headers are required for production account sessions." : undefined,
      },
      { status: authRequired ? 401 : 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    authenticated: true,
    profile: session.profile,
    context: session.context,
    status,
  });
}
