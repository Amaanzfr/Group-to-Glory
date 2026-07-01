import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { CompletedKnockoutResult } from "@/lib/scoring";

const validStages = new Set<CompletedKnockoutResult["stage"]>(["roundOf32", "roundOf16", "quarterfinal", "semifinal", "final"]);

function stageForMatch(matchId: string) {
  const number = Number(matchId.replace(/^m/, ""));
  if (number >= 73 && number <= 88) return "roundOf32";
  if (number >= 89 && number <= 96) return "roundOf16";
  if (number >= 97 && number <= 100) return "quarterfinal";
  if (number === 101 || number === 102) return "semifinal";
  if (number === 104) return "final";
  return "";
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const configuredSecret = process.env.ADMIN_ACTION_SECRET || process.env.CRON_SECRET;
  const providedSecret = String(formData.get("adminSecret") ?? "").trim();
  const matchId = String(formData.get("matchId") ?? "").trim().toLowerCase();
  const winnerTeamId = String(formData.get("winnerTeamId") ?? "").trim();
  const stage = stageForMatch(matchId) as CompletedKnockoutResult["stage"];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const redirect = (message: string) =>
    NextResponse.redirect(new URL(`/admin?result=${encodeURIComponent(message)}`, request.url), 303);

  if (!configuredSecret || providedSecret !== configuredSecret) return redirect("Wrong admin secret.");
  if (!url || !serviceKey) return redirect("Missing Supabase service role configuration.");
  if (!matchId || !winnerTeamId || !validStages.has(stage)) return redirect("Pick a valid knockout match and winning team.");

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await supabase.from("match_results").upsert(
    {
      match_id: matchId,
      winner_team_id: winnerTeamId,
      stage,
      status: "completed",
      completed_at: new Date().toISOString(),
    },
    { onConflict: "match_id" },
  );

  if (error) {
    return redirect(error.message.includes("match_results") ? "Run the match_results SQL first, then try again." : error.message);
  }

  return redirect(`Saved ${matchId.toUpperCase()} winner. Now hit Recalculate scores.`);
}
