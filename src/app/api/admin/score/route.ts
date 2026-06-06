import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;
  const providedSecret = request.headers.get("x-cron-secret");

  if (configuredSecret && providedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    message: "Scoring recalculation hook received. Leaderboard scoring tables are ready to wire to Supabase.",
    scoredAt: new Date().toISOString(),
  });
}
