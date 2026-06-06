import { NextResponse } from "next/server";
import { sportsProviderStatus } from "@/lib/server-config";
import { dataUpdatedIso } from "@/lib/tournament-data";

export async function POST(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;
  const providedSecret = request.headers.get("x-cron-secret");

  if (configuredSecret && providedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    message: "Refresh hook received. Sports provider keys were detected without exposing their values.",
    providers: sportsProviderStatus(),
    previousSnapshot: dataUpdatedIso,
    refreshedAt: new Date().toISOString(),
  });
}
