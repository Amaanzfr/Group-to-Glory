import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { scoreBracket } from "../src/lib/scoring";
import type { BracketDraft } from "../src/lib/types";

type BracketScoreRow = {
  id: number;
  picks: BracketDraft;
  submitted_at: string;
};

function loadLocalEnv() {
  if (!existsSync(".env")) return;
  const lines = readFileSync(".env", "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).replace(/^["']|["']$/g, "");
    process.env[key] ||= value;
  }
}

async function main() {
  loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("brackets")
    .select("id, picks, submitted_at")
    .order("submitted_at", { ascending: true });

  if (error) throw error;

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
    if (upsertError) throw upsertError;
  }

  console.log(`Scored ${rows.length} brackets across ${scored[0]?.completedMatches ?? 0} completed matches.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
