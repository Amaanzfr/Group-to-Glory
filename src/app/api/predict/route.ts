import { NextResponse } from "next/server";
import OpenAI from "openai";
import { predictMatch } from "@/lib/prediction-model";
import { squadCandidatesForTeam } from "@/lib/squad-candidates";
import { teams } from "@/lib/tournament-data";
import type { Player, Team } from "@/lib/types";

type BdlTeam = {
  id: number;
  name: string;
  abbreviation?: string;
};

type BdlPlayer = {
  id: number;
  name: string;
  short_name?: string;
  position?: string;
};

type AiCandidate = {
  name: string;
  expectedMinutes?: number;
  attackingRole?: number;
};

const bdlKey = () => process.env.SPORTS_API_KEY_A || process.env.BALLDONTLIE_FIFA_API_KEY;

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const positionMap = (position?: string): Player["position"] => {
  const value = (position ?? "").toUpperCase();
  if (value.startsWith("G")) return "GK";
  if (value.startsWith("D")) return "DEF";
  if (value.startsWith("M")) return "MID";
  return "FWD";
};

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

async function bdlFetch<T>(path: string): Promise<T | null> {
  const key = bdlKey();
  if (!key) return null;

  const response = await fetch(`https://api.balldontlie.io/fifa/worldcup/v1/${path}`, {
    headers: { Authorization: key },
    cache: "no-store",
  });

  if (!response.ok) return null;
  return (await response.json()) as T;
}

async function fetchBdlPlayers(team: Team) {
  const teamsResponse = await bdlFetch<{ data: BdlTeam[] }>("teams?seasons[]=2026");
  const bdlTeam = teamsResponse?.data.find((candidate) => normalize(candidate.name) === normalize(team.name));
  if (!bdlTeam) {
    return { players: [], note: "BALLDONTLIE team lookup succeeded, but this team name was not matched." };
  }

  const playersResponse = await bdlFetch<{ data: BdlPlayer[] }>(`players?seasons[]=2026&team_ids[]=${bdlTeam.id}&per_page=100`);
  if (!playersResponse?.data?.length) {
    return {
      players: [],
      note: "BALLDONTLIE roster/player endpoint is unavailable for this key tier, so no player scorer list was generated.",
    };
  }

  const players = playersResponse.data.map((player, index): Player => {
    const position = positionMap(player.position);
    const attackingBoost = position === "FWD" ? 82 : position === "MID" ? 68 : position === "DEF" ? 42 : 8;
    return {
      id: `bdl-${player.id}`,
      name: player.short_name || player.name,
      position,
      nationalGoals: position === "FWD" ? 10 : position === "MID" ? 5 : 1,
      expectedMinutes: Math.max(52, 88 - index * 2),
      clubForm: attackingBoost,
      starterScore: Math.max(48, 86 - index),
    };
  });

  return { players, note: `Generated with BALLDONTLIE 2026 roster data for ${team.name}.` };
}

async function fetchOpenAiCandidates(team: Team): Promise<{ players: Player[]; note: string }> {
  if (!openai) return { players: [], note: "OpenAI fallback is unavailable because OPENAI_API_KEY is not configured." };
  const allowed = squadCandidatesForTeam(team);
  if (!allowed.length) {
    return {
      players: [],
      note: `No squad candidate list is loaded for ${team.name}. Paste/import that roster and OpenAI will rank only those names.`,
    };
  }

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "Rank likely attacking/scoring candidates for a World Cup national team using only the provided allowed names. Prioritize national-team scoring role, penalty/set-piece role, expected minutes, and clutch scoring profile. Club form is a small secondary factor. Do not invent, rename, add, or substitute players. Return JSON only.",
      },
      {
        role: "user",
        content: `Team: ${team.name}. Allowed candidates: ${allowed.map((player) => `${player.name} (${player.position})`).join(", ")}. Return the 6 most likely scorers as {"players":[{"name":"exact allowed name","expectedMinutes":75,"attackingRole":85}]}. Names must exactly match the allowed list.`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "scorer_candidates",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            players: {
              type: "array",
              maxItems: 6,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  expectedMinutes: { type: "number" },
                  attackingRole: { type: "number" },
                },
                required: ["name", "expectedMinutes", "attackingRole"],
              },
            },
          },
          required: ["players"],
        },
      },
    },
  });

  const parsed = JSON.parse(response.output_text) as { players: AiCandidate[] };
  const byName = new Map(allowed.map((player) => [normalize(player.name), player]));
  const players = parsed.players
    .map((candidate, index): Player | null => {
      const allowedPlayer = byName.get(normalize(candidate.name));
      if (!allowedPlayer) return null;
      return {
        ...allowedPlayer,
        expectedMinutes: Math.max(35, Math.min(90, Math.round(candidate.expectedMinutes ?? allowedPlayer.expectedMinutes))),
        clubForm: Math.max(45, Math.min(95, Math.round(candidate.attackingRole ?? allowedPlayer.clubForm))),
        starterScore: Math.max(45, Math.min(92, allowedPlayer.starterScore - index * 2)),
      };
    })
    .filter((player): player is Player => Boolean(player));

  return {
    players,
    note: `OpenAI ranked ${team.name} scorers from the loaded squad-candidate list only.`,
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as { homeTeamId?: string; awayTeamId?: string; knockout?: boolean };
  const home = teams.find((team) => team.id === body.homeTeamId);
  const away = teams.find((team) => team.id === body.awayTeamId);

  if (!home || !away) {
    return NextResponse.json({ error: "Unknown team selection." }, { status: 400 });
  }

  let sourceNote = "Generated from local team-strength model.";
  let rosterStatus = "Live roster provider was not used.";
  let homePlayers: Player[] = [];
  let awayPlayers: Player[] = [];

  if (bdlKey()) {
    const [homeRoster, awayRoster] = await Promise.all([fetchBdlPlayers(home), fetchBdlPlayers(away)]);
    homePlayers = homeRoster.players;
    awayPlayers = awayRoster.players;
    sourceNote = "Generated after checking BALLDONTLIE live World Cup provider.";
    rosterStatus = [homeRoster.note, awayRoster.note].filter(Boolean).join(" ");
  }

  if ((!homePlayers.length || !awayPlayers.length) && openai) {
    const [homeAi, awayAi] = await Promise.all([
      homePlayers.length ? Promise.resolve({ players: homePlayers, note: "" }) : fetchOpenAiCandidates(home),
      awayPlayers.length ? Promise.resolve({ players: awayPlayers, note: "" }) : fetchOpenAiCandidates(away),
    ]);
    homePlayers = homeAi.players;
    awayPlayers = awayAi.players;
    sourceNote = "Generated with live provider check plus OpenAI attacking-candidate fallback.";
    rosterStatus = [rosterStatus, homeAi.note, awayAi.note].filter(Boolean).join(" ");
  }

  const prediction = predictMatch(
    { ...home, players: homePlayers },
    { ...away, players: awayPlayers },
    body.knockout,
  );

  return NextResponse.json({
    ...prediction,
    generatedAt: new Date().toISOString(),
    sourceNote,
    rosterStatus,
  });
}
