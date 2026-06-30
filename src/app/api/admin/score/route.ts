import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { scoreBracket } from "@/lib/scoring";
import type { BracketDraft } from "@/lib/types";

type BracketScoreRow = {
  id: number;
  picks: BracketDraft;
  submitted_at: string;
};

export async function POST(request: Request) {
  const formData = request.headers.get("content-type")?.includes("form")
    ? await request.formData()
    : null;
  const configuredSecret = process.env.ADMIN_ACTION_SECRET || process.env.CRON_SECRET;
  const providedSecret = request.headers.get("x-cron-secret");
  const providedFormSecret = formData ? String(formData.get("adminSecret") ?? "").trim() : "";

  if (configuredSecret && providedSecret !== configuredSecret && providedFormSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase service role configuration." }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("brackets")
    .select("id, picks, submitted_at")
    .order("submitted_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const scored = ((data ?? []) as BracketScoreRow[])
    .map((row) => ({
      bracket_id: row.id,
      ...scoreBracket(row.picks),
      submittedAt: row.submitted_at,
    }))
    .sort((a, b) => b.points - a.points || new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  const rows = scored.map((row, index) => ({
    bracket_id: row.bracket_id,
    points: row.points,
    rank: index + 1,
    updated_at: row.updatedAt,
  }));

  if (rows.length) {
    const { error: upsertError } = await supabase.from("leaderboard_scores").upsert(rows, { onConflict: "bracket_id" });
    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    message: `Scored ${rows.length} brackets.`,
    completedMatches: scored[0]?.completedMatches ?? 0,
    possiblePoints: scored[0]?.possiblePoints ?? 0,
    scoredAt: new Date().toISOString(),
  });
}
