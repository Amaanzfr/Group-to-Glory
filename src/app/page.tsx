"use client";

import { toPng } from "html-to-image";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { canBuildBracket, draftChampion, emptyDraft, firstRoundMatches, groupIds, groupTeams } from "@/lib/bracket-engine";
import { predictMatch, modelChampion } from "@/lib/prediction-model";
import { squadCandidatesForTeamId } from "@/lib/squad-candidates";
import { groupScoreDetails, knockoutScoreDetails, mergeCompletedResults, scoreBracket, type CompletedKnockoutResult } from "@/lib/scoring";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { amaanWinnerId, dataUpdatedIso, deadlineIso, fixtures, leaderboard, teams } from "@/lib/tournament-data";
import type { BracketDraft, GroupId, LeaderboardEntry, Prediction, Team } from "@/lib/types";

const tabs = [
  { id: "bracket", label: "Bracket Pool", icon: Trophy },
  { id: "groups", label: "Group Stage", icon: CalendarDays },
  { id: "knockouts", label: "Knockouts", icon: ShieldCheck },
  { id: "leaderboard", label: "Leaderboard", icon: Users },
] as const;

type TabId = (typeof tabs)[number]["id"];
type ViewableLeaderboardEntry = LeaderboardEntry & {
  picks?: BracketDraft | null;
  submittedAt?: string;
};
type LeaderboardRow = {
  id?: number;
  display_name: string;
  champion_pick: string;
  picks?: BracketDraft | null;
  submitted_at: string;
  private_pool_code?: string | null;
  leaderboard_scores?: { points: number; rank: number | null } | Array<{ points: number; rank: number | null }> | null;
};
type MatchResultRow = {
  match_id: string;
  winner_team_id: string;
  stage: CompletedKnockoutResult["stage"];
};

const teamById = new Map(teams.map((team) => [team.id, team]));
const draftStorageKey = "group-to-glory-draft-v2";
const privatePoolStorageKey = "group-to-glory-private-pool-v1";
const adminEmail = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "amaanalizafar@gmail.com").toLowerCase();
const privatePoolPassword = (process.env.NEXT_PUBLIC_PRIVATE_POOL_CODE || "az").trim().toLowerCase();
const knockoutFeeders: Record<string, string[]> = {
  m89: ["m74", "m77"],
  m90: ["m73", "m75"],
  m91: ["m76", "m78"],
  m92: ["m79", "m80"],
  m93: ["m83", "m84"],
  m94: ["m81", "m82"],
  m95: ["m86", "m88"],
  m96: ["m85", "m87"],
  m97: ["m89", "m90"],
  m98: ["m93", "m94"],
  m99: ["m91", "m92"],
  m100: ["m95", "m96"],
  m101: ["m97", "m98"],
  m102: ["m99", "m100"],
  m104: ["m101", "m102"],
};
const knockoutOrder = [
  "m73",
  "m74",
  "m75",
  "m76",
  "m77",
  "m78",
  "m79",
  "m80",
  "m81",
  "m82",
  "m83",
  "m84",
  "m85",
  "m86",
  "m87",
  "m88",
  "m89",
  "m90",
  "m91",
  "m92",
  "m93",
  "m94",
  "m95",
  "m96",
  "m97",
  "m98",
  "m99",
  "m100",
  "m101",
  "m102",
  "m104",
];

function normalizePoolCode(value: string) {
  return value.trim().toLowerCase();
}

function firstRoundTeamIds(draft: BracketDraft) {
  return Object.fromEntries(
    firstRoundMatches(draft, teams).map((match) => [
      match.id,
      [match.home?.id, match.away?.id].filter((id): id is string => Boolean(id)),
    ]),
  ) as Record<string, string[]>;
}

function validTeamIdsForMatch(matchId: string, picks: Record<string, string>, firstRoundIds: Record<string, string[]>) {
  const directTeams = firstRoundIds[matchId];
  if (directTeams) return directTeams;
  return (knockoutFeeders[matchId] ?? []).map((feederId) => picks[feederId]).filter(Boolean);
}

function normalizedKnockoutDraft(draft: BracketDraft) {
  const firstRoundIds = firstRoundTeamIds(draft);
  const knockoutPicks: Record<string, string> = {};

  for (const matchId of knockoutOrder) {
    const pick = draft.knockoutPicks[matchId];
    if (!pick) continue;
    const validTeamIds = validTeamIdsForMatch(matchId, knockoutPicks, firstRoundIds);
    if (validTeamIds.includes(pick)) {
      knockoutPicks[matchId] = pick;
    }
  }

  const finalistIds = ["m101", "m102"].map((matchId) => knockoutPicks[matchId]).filter(Boolean);
  const finalScorerValid =
    !draft.finalScorer ||
    finalistIds.some((teamId) => squadCandidatesForTeamId(teamId).some((player) => player.id === draft.finalScorer));

  return {
    ...draft,
    knockoutPicks,
    finalScorer: finalScorerValid ? draft.finalScorer : undefined,
  };
}

function formatDeadline(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function supabaseSetupMessage() {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (key?.startsWith("sb_secret_")) {
    return "Replace NEXT_PUBLIC_SUPABASE_ANON_KEY with Supabase's public anon/publishable key. Secret keys cannot be used in the browser.";
  }
  return "Google login needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.";
}

function teamText(team?: Team) {
  if (!team) return "TBD";
  if (team.flag.startsWith("asset:")) return team.name;
  return `${team.flag.startsWith("code:") ? team.flag.replace("code:", "") : team.flag} ${team.name}`;
}

function TeamFlag({ team, className = "" }: { team?: Team; className?: string }) {
  if (!team) return null;
  if (team.flag.startsWith("asset:")) {
    return (
      <span
        role="img"
        aria-label={`${team.name} flag`}
        className={`flag-img ${className}`.trim()}
        style={{ backgroundImage: `url(${team.flag.replace("asset:", "")})` }}
      />
    );
  }
  if (team.flag.startsWith("code:")) {
    return <span className={`flag-code ${className}`.trim()}>{team.flag.replace("code:", "")}</span>;
  }
  return <span className={`flag ${className}`.trim()}>{team.flag}</span>;
}

function displayChampionPick(championPick: string | null, picks: unknown) {
  if (picks && typeof picks === "object" && "knockoutPicks" in picks) {
    const savedChampion = normalizedKnockoutDraft(picks as BracketDraft).knockoutPicks?.m104;
    return savedChampion ? teamById.get(savedChampion)?.name ?? savedChampion : "Incomplete";
  }
  const teamId = championPick || "";
  return teamById.get(teamId)?.name ?? teamId;
}

function mapRowsToEntries(rows: LeaderboardRow[], canOpenBrackets: boolean) {
  return rows
    .map((row, index) => {
    const maybePicks = "picks" in row && row.picks ? normalizedKnockoutDraft(row.picks as BracketDraft) : null;
    const score = Array.isArray(row.leaderboard_scores) ? row.leaderboard_scores[0] : row.leaderboard_scores;
    return {
      rank: score?.rank ?? index + 1,
      displayName: row.display_name,
      points: score?.points ?? 0,
      championPick: displayChampionPick(row.champion_pick, maybePicks),
      picks: canOpenBrackets ? maybePicks : null,
      submittedAt: row.submitted_at,
    };
  })
    .sort((a, b) => b.points - a.points || a.rank - b.rank);
}

function championTeamFromPick(championPick: string) {
  return teams.find((team) => team.id === championPick || team.name === championPick);
}

function pct(value: number) {
  return `${value}%`;
}

function TeamLabel({ team }: { team?: Team }) {
  if (!team) return <span className="text-stone-400">TBD</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <TeamFlag team={team} />
      <span className="min-w-0 break-words">{team.name}</span>
    </span>
  );
}

function SelectTeam({
  value,
  teams: options,
  onChange,
  placeholder = "Select team",
  disabled = false,
}: {
  value?: string;
  teams: Team[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="relative block">
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-10 w-full appearance-none rounded-md border border-stone-300 bg-white px-3 pr-9 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
      >
        <option value="">{placeholder}</option>
        {options.map((team) => (
          <option key={team.id} value={team.id}>
            {teamText(team)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-stone-500" />
    </label>
  );
}

function PredictionPanel({ home, away, knockout = false }: { home: Team; away: Team; knockout?: boolean }) {
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeTeamId: home.id, awayTeamId: away.id, knockout }),
      });
      if (!response.ok) throw new Error("Prediction generation failed.");
      setPrediction((await response.json()) as Prediction);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Prediction generation failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Model estimate</p>
          <h3 className="mt-1 text-xl font-bold">
            <TeamLabel team={home} /> <span className="text-stone-400">vs</span> <TeamLabel team={away} />
          </h3>
          <p className="mt-2 text-sm text-stone-600">
            {prediction ? `Projected score: ${prediction.projectedScore[0]}-${prediction.projectedScore[1]} · Confidence ${prediction.confidence}` : "Select the fixture, then generate a fresh prediction from the configured data providers."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Predictions are estimates, not certainties.</div>
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-800 px-3 text-sm font-black text-white disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Generating" : "Generate"}
          </button>
        </div>
      </div>

      {error ? <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">{error}</p> : null}

      {!prediction ? (
        <div className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm font-bold">No generated prediction yet.</p>
          <p className="mt-1 text-sm text-stone-600">This avoids stale hardcoded answers. Press Generate to check providers and build the match view.</p>
        </div>
      ) : null}

      {prediction ? (
        <>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Metric label={`${home.name} win`} value={pct(prediction.homeWin)} />
        <Metric label="Draw after 90" value={pct(prediction.draw)} />
        <Metric label={`${away.name} win`} value={pct(prediction.awayWin)} />
      </div>

      {knockout && prediction.homeAdvance && prediction.awayAdvance ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Metric label={`${home.name} advance`} value={pct(prediction.homeAdvance)} strong />
          <Metric label={`${away.name} advance`} value={pct(prediction.awayAdvance)} strong />
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <ScorerList title={`${home.name} likely scorers`} scorers={prediction.homeScorers} />
        <ScorerList title={`${away.name} likely scorers`} scorers={prediction.awayScorers} />
      </div>

      <div className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">
        <p className="font-bold text-stone-900">{prediction.sourceNote}</p>
        <p className="mt-1">{prediction.rosterStatus}</p>
        {prediction.generatedAt ? <p className="mt-1">Generated {new Date(prediction.generatedAt).toLocaleString()}.</p> : null}
      </div>

      <details className="mt-5 rounded-md border border-stone-200 bg-stone-50 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-stone-800">Detailed stats and model drivers</summary>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Metric label="Clean sheet chance" value={`${prediction.cleanSheets[0]}% / ${prediction.cleanSheets[1]}%`} />
          <Metric label="Corners" value={`${prediction.corners[0]} / ${prediction.corners[1]}`} />
          <Metric label="Shots" value={`${prediction.shots[0]} / ${prediction.shots[1]}`} />
          <Metric label="Shots on target" value={`${prediction.shotsOnTarget[0]} / ${prediction.shotsOnTarget[1]}`} />
          <Metric label="Keeper saves" value={`${prediction.saves[0]} / ${prediction.saves[1]}`} />
          <Metric label="Cards" value={`${prediction.cards[0]} / ${prediction.cards[1]}`} />
          <Metric label="Fouls" value={`${prediction.fouls[0]} / ${prediction.fouls[1]}`} />
        </div>
        <div className="mt-4 space-y-2 text-sm text-stone-700">
          {prediction.drivers.map((driver) => (
            <p key={driver}>{driver}</p>
          ))}
        </div>
      </details>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${strong ? "border-emerald-200 bg-emerald-50" : "border-stone-200 bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-stone-950">{value}</p>
    </div>
  );
}

function ScorerList({ title, scorers }: { title: string; scorers: ReturnType<typeof predictMatch>["homeScorers"] }) {
  return (
    <div className="rounded-md border border-stone-200 p-3">
      <p className="text-sm font-bold">{title}</p>
      {!scorers.length ? (
        <p className="mt-3 text-sm text-stone-600">Live roster data was not available for this key tier. No fake scorer names were generated.</p>
      ) : null}
      <div className="mt-3 space-y-2">
        {scorers.map((scorer, index) => (
          <div key={scorer.playerId} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {index + 1}. {scorer.name} <span className="text-stone-500">({scorer.position})</span>
            </span>
            <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-900">{scorer.probability}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Header({ activeTab, setActiveTab }: { activeTab: TabId; setActiveTab: (tab: TabId) => void }) {
  const champion = teamById.get(amaanWinnerId) ?? modelChampion(teams);
  return (
    <header className="border-b border-stone-200 bg-white/85 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="stadium-hero p-4 sm:p-5">
          <div className="stadium-hero-content flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-md bg-emerald-800 text-white">
                <Trophy className="h-5 w-5" />
              </div>
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-stone-500">
                  <Sparkles className="h-3.5 w-3.5" />
                  World game bracket lab
                </div>
                <h1 className="mt-2 text-3xl font-black tracking-normal sm:text-4xl">Group to Glory</h1>
                <p className="mt-1 text-sm text-stone-600">World Cup predictions, bracket pool, and match analytics.</p>
              </div>
            </div>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <Badge label="Amaan's AI winner" value={teamText(champion)} />
            <Badge label="Bracket deadline" value={formatDeadline(deadlineIso)} />
            <Badge label="Data updated" value={new Date(dataUpdatedIso).toLocaleString()} />
          </div>
        </div>
        </div>
        <nav className="mt-5 flex gap-2 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-bold transition ${
                  active ? "border-emerald-800 bg-emerald-800 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-emerald-600"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-0.5 font-bold text-stone-900">{value}</p>
    </div>
  );
}

function BracketPool({ onSubmitted }: { onSubmitted: (entry: LeaderboardEntry) => void }) {
  const [draft, setDraft] = useState<BracketDraft>(() => {
    if (typeof window === "undefined") return emptyDraft();
    const saved = window.localStorage.getItem(draftStorageKey);
    return saved ? normalizedKnockoutDraft(JSON.parse(saved) as BracketDraft) : emptyDraft();
  });
  const [finalScoreText, setFinalScoreText] = useState(() => (draft.finalScore ? draft.finalScore.join("-") : ""));
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [correctionMode, setCorrectionMode] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [userLabel, setUserLabel] = useState("");
  const [submitStatus, setSubmitStatus] = useState("");
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  const [authNote, setAuthNote] = useState(() =>
    createSupabaseBrowserClient()
      ? "Login required for official submit and PNG download."
      : supabaseSetupMessage(),
  );
  const bracketRef = useRef<HTMLDivElement>(null);
  const championId = draftChampion(draft);
  const champion = championId ? teamById.get(championId) : undefined;
  const r32 = firstRoundMatches(draft, teams);
  const finalistIds = ["m101", "m102"].map((matchId) => draft.knockoutPicks[matchId]).filter(Boolean);
  const finalistScorers = finalistIds.flatMap((teamId) => squadCandidatesForTeamId(teamId));
  const isAdmin = userLabel.toLowerCase() === adminEmail;
  const locked = submitted && !correctionMode;
  const googleAuthUrl =
    typeof window !== "undefined" && process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/authorize?${new URLSearchParams({
          provider: "google",
          redirect_to: `${window.location.origin}/`,
        }).toString()}`
      : "";

  useEffect(() => {
    window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    const updateDeadlineState = () => setDeadlinePassed(Date.now() > new Date(deadlineIso).getTime());
    updateDeadlineState();
    const timer = window.setInterval(updateDeadlineState, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      return;
    }
    const syncAuthFromUrl = async () => {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        window.history.replaceState({}, document.title, window.location.pathname);
        if (error) {
          setSubmitStatus(error.message);
        }
      }

      const { data } = await supabase.auth.getUser();
      setSignedIn(Boolean(data.user));
      const label = data.user?.email ?? data.user?.user_metadata?.full_name ?? "";
      setUserLabel(label);
      setAuthNote(data.user ? `Signed in as ${label}. Official submission is available.` : "Login required for official submit and PNG download.");
      if (data.user) {
        const { data: existingBracket } = await supabase
          .from("brackets")
          .select("picks")
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (existingBracket?.picks) {
          const savedDraft = normalizedKnockoutDraft(existingBracket.picks as BracketDraft);
          setDraft(savedDraft);
          setFinalScoreText(savedDraft.finalScore ? savedDraft.finalScore.join("-") : "");
          setSubmitted(true);
          setSubmitStatus(`Official bracket locked as ${label}.`);
        } else {
          setSubmitStatus(`Google sign-in complete as ${label}. You can submit your official bracket now.`);
        }
      }
    };

    syncAuthFromUrl();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user));
      const label = session?.user?.email ?? session?.user?.user_metadata?.full_name ?? "";
      setUserLabel(label);
      setAuthNote(session?.user ? `Signed in as ${label}. Official submission is available.` : "Login required for official submit and PNG download.");
    });
    return () => subscription.unsubscribe();
  }, []);

  const setGroupPick = (group: GroupId, slot: "first" | "second" | "third" | "fourth", teamId: string) => {
    if (locked) return;
    setFinalScoreText("");
    setDraft((current) => {
      const nextGroupPicks = {
        ...current.groupPicks,
        [group]: { ...current.groupPicks[group], [slot]: teamId },
      };
      const currentThirds = new Set(
        groupIds
          .map((groupId) => nextGroupPicks[groupId].third)
          .filter((id): id is string => Boolean(id)),
      );

      return {
        ...current,
        groupPicks: nextGroupPicks,
        thirdPlaceAdvancers: current.thirdPlaceAdvancers.filter((id) => currentThirds.has(id)),
        knockoutPicks: {},
        finalScorer: undefined,
        finalScore: undefined,
      };
    });
  };

  const toggleThird = (teamId: string) => {
    if (locked) return;
    setDraft((current) => {
      const exists = current.thirdPlaceAdvancers.includes(teamId);
      const next = exists ? current.thirdPlaceAdvancers.filter((id) => id !== teamId) : [...current.thirdPlaceAdvancers, teamId].slice(0, 8);
      return { ...current, thirdPlaceAdvancers: next };
    });
  };

  const pickWinner = (matchId: string, teamId: string) => {
    if (locked) return;
    setDraft((current) =>
      normalizedKnockoutDraft({
        ...current,
        knockoutPicks: { ...current.knockoutPicks, [matchId]: teamId },
      }),
    );
  };

  const fillModelPicks = () => {
    if (locked) return;
    if (!window.confirm("This will replace your current draft bracket with model picks.")) return;
    setFinalScoreText("");
    const groupPicks = emptyDraft().groupPicks;
    for (const group of groupIds) {
      const ranked = groupTeams(group, teams).sort((a, b) => b.elo + b.form - (a.elo + a.form));
      groupPicks[group] = { group, first: ranked[0].id, second: ranked[1].id, third: ranked[2].id, fourth: ranked[3].id };
    }
    const thirds = groupIds
      .map((group) => groupPicks[group].third)
      .filter(Boolean)
      .slice(0, 8) as string[];
    const nextDraft = { ...draft, groupPicks, thirdPlaceAdvancers: thirds };
    const nextR32 = firstRoundMatches(nextDraft, teams);
    const knockoutPicks = Object.fromEntries(
      nextR32.map((match) => {
        const home = match.home;
        const away = match.away;
        if (!home || !away) return [match.id, home?.id ?? away?.id ?? ""];
        const prediction = predictMatch(home, away, true);
        return [match.id, prediction.homeAdvance && prediction.homeAdvance >= 50 ? home.id : away.id];
      }),
    );
    setDraft({ ...nextDraft, knockoutPicks });
  };

  const submit = async () => {
    setSubmitStatus("");
    if (submitting || submitted) return;
    if (deadlinePassed) {
      setSubmitStatus(`Bracket submissions closed on ${formatDeadline(deadlineIso)}.`);
      return;
    }
    if (!canBuildBracket(draft)) {
      setSubmitStatus("Finish group standings and select exactly 8 third-place advancers.");
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setAuthNote(supabaseSetupMessage());
      return;
    }
    if (!draftChampion(draft)) {
      setSubmitStatus("Pick the Match 104 winner before submitting.");
      return;
    }
    if (!draft.finalScorer) {
      setSubmitStatus("Choose a final goalscorer tie-breaker before submitting.");
      return;
    }
    if (!draft.finalScore) {
      setSubmitStatus("Enter a predicted final score like 2-1 before submitting.");
      return;
    }
    setSubmitting(true);
    setSubmitStatus("Submitting your final bracket...");
    try {
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!data.user) {
        setSubmitStatus("Opening Google sign-in. Come back here after it finishes and hit submit once more.");
        setSubmitting(false);
        await signIn();
        return;
      }
      const draftToSubmit = normalizedKnockoutDraft(draft);
      const displayName = data.user.user_metadata?.full_name || data.user.email?.split("@")[0] || "Player";
      const championPick = draftChampion(draftToSubmit) ?? "";
      const { error } = await supabase.from("brackets").insert({
        user_id: data.user.id,
        display_name: displayName,
        picks: draftToSubmit,
        champion_pick: championPick,
        final_goalscorer_pick: draftToSubmit.finalScorer,
        final_score: draftToSubmit.finalScore?.join("-") ?? null,
      });
      if (error) {
        if (error.message.toLowerCase().includes("duplicate")) {
          setSubmitted(true);
          setSubmitStatus("You already submitted an official bracket. Your bracket is locked.");
          onSubmitted({
            rank: 1,
            displayName,
            points: 0,
            championPick: teamById.get(championPick)?.name ?? championPick,
          });
        } else {
          setSubmitStatus(error.message);
        }
        return;
      }
      setSubmitted(true);
      setSubmitStatus("Official bracket submitted. You are locked in.");
      onSubmitted({
        rank: 1,
        displayName,
        points: 0,
        championPick: teamById.get(championPick)?.name ?? championPick,
      });
    } catch (caught) {
      setSubmitStatus(caught instanceof Error ? caught.message : "Something went wrong submitting. Try again once.");
    } finally {
      setSubmitting(false);
    }
  };

  const signIn = async () => {
    if (!googleAuthUrl) {
      setAuthNote(supabaseSetupMessage());
      return;
    }
    setSubmitStatus("Opening Google sign-in...");
    window.location.assign(googleAuthUrl);
    window.setTimeout(() => {
      setSubmitStatus("If Google did not open, use the manual sign-in link below.");
    }, 900);
  };

  const download = async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setAuthNote(supabaseSetupMessage());
      return;
    }
    if (!bracketRef.current) return;
    const dataUrl = await toPng(bracketRef.current, { cacheBust: true, pixelRatio: 2 });
    const link = document.createElement("a");
    link.download = "group-to-glory-bracket.png";
    link.href = dataUrl;
    link.click();
  };

  const signOut = async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    setSignedIn(false);
    setUserLabel("");
    setCorrectionMode(false);
    setSubmitted(false);
    setSubmitStatus("Signed out.");
    setAuthNote("Login required for official submit and PNG download.");
  };

  const saveCorrection = async () => {
    setSubmitStatus("");
    if (!isAdmin) {
      setSubmitStatus("Only the admin account can override a submitted bracket.");
      return;
    }
    if (!canBuildBracket(draft) || !draftChampion(draft) || !draft.finalScorer || !draft.finalScore) {
      setSubmitStatus("Finish the corrected bracket, final scorer, and final score before saving.");
      return;
    }
    if (!window.confirm("This will overwrite your saved official bracket only. Continue?")) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setAuthNote(supabaseSetupMessage());
      return;
    }
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      await signIn();
      return;
    }
    const draftToSave = normalizedKnockoutDraft(draft);
    const championPick = draftChampion(draftToSave) ?? "";
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("brackets")
        .update({
          picks: draftToSave,
          champion_pick: championPick,
          final_goalscorer_pick: draftToSave.finalScorer,
          final_score: draftToSave.finalScore?.join("-") ?? null,
        })
        .eq("user_id", data.user.id);

      if (error) {
        setSubmitStatus(`${error.message}. If this mentions policy/RLS, run the admin correction SQL I gave you.`);
        return;
      }
      window.localStorage.setItem(draftStorageKey, JSON.stringify(draftToSave));
      setCorrectionMode(false);
      setSubmitted(true);
      setSubmitStatus("Your official bracket was corrected and locked.");
      onSubmitted({
        rank: 1,
        displayName: data.user.user_metadata?.full_name || data.user.email?.split("@")[0] || "Player",
        points: 0,
        championPick: teamById.get(championPick)?.name ?? championPick,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="grid gap-5">
      <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Public bracket pool</p>
            <h2 className="mt-1 text-2xl font-black">Build one official bracket</h2>
            <p className="mt-2 max-w-3xl text-sm text-stone-600">
              Pick group standings, choose the eight third-place advancers, complete the knockout path, then submit once. Official bracket submissions are final. Open until {formatDeadline(deadlineIso)}.
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <button onClick={fillModelPicks} disabled={locked} className="inline-flex h-10 max-w-full items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-bold disabled:cursor-not-allowed">
              <RefreshCw className="h-4 w-4" />
              Fill with model picks
            </button>
            <button onClick={signIn} className="inline-flex h-10 max-w-full min-w-0 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-bold">
              <Users className="h-4 w-4 shrink-0" />
              <span className="truncate">{signedIn ? `Signed in${userLabel ? `: ${userLabel.split("@")[0]}` : ""}` : "Continue with Google"}</span>
            </button>
            {signedIn ? (
              <button onClick={signOut} className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-bold">
                Sign out
              </button>
            ) : null}
            <button onClick={download} className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-bold">
              <Download className="h-4 w-4" />
              Download PNG
            </button>
            <button onClick={submit} disabled={submitted || submitting || deadlinePassed} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-800 px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300">
              {submitted ? <Check className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {submitted ? "Bracket locked" : submitting ? "Submitting..." : deadlinePassed ? "Submissions closed" : "Submit official bracket"}
            </button>
            {submitted && isAdmin ? (
              <button
                type="button"
                onClick={() => {
                  setCorrectionMode((current) => !current);
                  setSubmitStatus(correctionMode ? "Correction mode cancelled. Bracket locked." : "Admin correction mode on. Edit your bracket, then save correction at the bottom.");
                }}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-amber-300 bg-white px-3 text-sm font-bold"
              >
                {correctionMode ? "Cancel correction" : "Admin correction"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-black">How to submit</p>
          <ol className="mt-2 grid gap-1 text-sm font-semibold text-stone-700 sm:grid-cols-2">
            <li>1. Pick all four teams in every group.</li>
            <li>2. Choose exactly 8 third-place teams to advance.</li>
            <li>3. Pick every knockout winner through the final.</li>
            <li>4. Choose one final goalscorer tie-breaker.</li>
            <li>5. Enter the final score, like 2-1.</li>
            <li>6. Sign in with Google, then hit Submit.</li>
          </ol>
          <p className="mt-2 text-xs font-bold text-stone-500">On phones, the easiest submit button is at the bottom next to the final score. Once submitted, your bracket is locked.</p>
        </div>
        <p className="mt-3 text-xs font-semibold text-stone-500">{authNote}</p>
        {submitStatus ? (
          <div className="mt-2 rounded-md bg-stone-100 px-3 py-2 text-sm font-bold text-stone-700">
            <p>{submitStatus}</p>
            {googleAuthUrl && !signedIn ? (
              <a href={googleAuthUrl} className="mt-2 inline-flex h-9 items-center rounded-md bg-emerald-400 px-3 text-sm font-black text-emerald-950">
                Open Google sign-in manually
              </a>
            ) : null}
          </div>
        ) : null}
        {submitted && locked ? <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-900">This official bracket is locked.</p> : null}
        {correctionMode ? <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm font-black text-amber-900">Admin correction mode is active. This only affects your saved bracket.</p> : null}
      </div>

      <div ref={bracketRef} className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-3">
          <div>
            <p className="text-sm font-bold text-stone-500">Amaan&apos;s AI winner</p>
            <h3 className="text-xl font-black">
              <TeamLabel team={teamById.get(amaanWinnerId) ?? modelChampion(teams)} />
            </h3>
          </div>
          <p className="rounded-md bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-700">Third-place teams placed using FIFA&apos;s official allocation framework.</p>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <h4 className="text-lg font-black">Group picks</h4>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {groupIds.map((group) => {
                const options = groupTeams(group, teams);
                const pick = draft.groupPicks[group];
                const used = new Set([pick.first, pick.second, pick.third, pick.fourth].filter(Boolean));
                return (
                  <div key={group} className="rounded-md border border-stone-200 p-3">
                    <p className="mb-3 font-black">Group {group}</p>
                    {(["first", "second", "third", "fourth"] as const).map((slot, index) => (
                      <div key={slot} className="mb-2 grid grid-cols-[72px_1fr] items-center gap-2">
                        <span className="text-sm font-bold text-stone-500">{index + 1}</span>
                        <SelectTeam value={pick[slot]} teams={options.filter((team) => team.id === pick[slot] || !used.has(team.id))} onChange={(teamId) => setGroupPick(group, slot, teamId)} disabled={locked} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="text-lg font-black">Third-place advancers</h4>
            <p className="mt-1 text-sm text-stone-600">Select 8 of your twelve third-place teams.</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {groupIds.map((group) => {
                const third = draft.groupPicks[group].third ? teamById.get(draft.groupPicks[group].third) : undefined;
                const selected = third ? draft.thirdPlaceAdvancers.includes(third.id) : false;
                return (
                  <button
                    key={group}
                    type="button"
                    disabled={!third || locked}
                    onClick={() => third && toggleThird(third.id)}
                    className={`flex min-h-12 w-full flex-col items-start justify-center rounded-md border px-3 py-2 text-left text-xs font-bold ${
                      selected ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-stone-200 bg-white text-stone-700"
                    } disabled:opacity-50`}
                  >
                    <span className="text-[10px] uppercase tracking-wide text-stone-500">Group {group}</span>
                    <span className="mt-1"><TeamLabel team={third} /></span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-sm font-bold">{draft.thirdPlaceAdvancers.length}/8 selected</p>
          </div>
        </div>

        <div className="mt-6">
          <h4 className="text-lg font-black">Round of 32</h4>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {r32.map((match) => (
              <div key={match.id} className="rounded-md border border-stone-200 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-stone-500">{match.label}</p>
                <p className="mt-1 text-[11px] font-bold text-stone-500">{match.date} · {match.venue}</p>
                <div className="mt-3 space-y-2">
                  {[match.home, match.away].map((team) => (
                    <button
                      key={team?.id ?? Math.random()}
                      type="button"
                      disabled={!team || locked}
                      onClick={() => team && pickWinner(match.id, team.id)}
                      className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm font-bold ${
                        team && draft.knockoutPicks[match.id] === team.id ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-stone-200 bg-white"
                      } disabled:opacity-50`}
                    >
                      <TeamLabel team={team} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {draft.thirdPlaceAdvancers.length === 8 ? <BracketGraphic draft={draft} matches={r32} pickWinner={pickWinner} locked={locked} /> : null}

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <Metric label="Your champion" value={champion ? teamText(champion) : "Pick final winner"} strong />
          <label className="rounded-md border border-stone-200 p-3">
            <span className="text-xs font-bold uppercase tracking-wide text-stone-500">Final goalscorer tie-breaker</span>
            <select
              value={draft.finalScorer ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, finalScorer: event.target.value }))}
              disabled={!finalistScorers.length || locked}
              className="mt-2 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
            >
              <option value="">{finalistScorers.length ? "Choose final scorer" : "Pick finalists first"}</option>
              {finalistScorers.map((player) => (
                <option key={player.id} value={player.id}>{player.name}</option>
              ))}
            </select>
          </label>
          <label className="rounded-md border border-stone-200 p-3">
            <span className="text-xs font-bold uppercase tracking-wide text-stone-500">Predicted final score</span>
            <input
              value={finalScoreText}
              disabled={locked}
              className="mt-2 h-10 w-full rounded-md border border-stone-300 px-3 text-sm"
              placeholder="Example: 2-1"
              onChange={(event) => {
                const nextValue = event.target.value;
                setFinalScoreText(nextValue);
                const [home, away] = nextValue.split("-").map((value) => Number(value.trim()));
                setDraft((current) => ({ ...current, finalScore: Number.isFinite(home) && Number.isFinite(away) ? [home, away] : undefined }));
              }}
            />
          </label>
          <div className="rounded-md border border-stone-200 p-3">
            <span className="text-xs font-bold uppercase tracking-wide text-stone-500">Lock bracket</span>
            <button
              type="button"
              onClick={correctionMode ? saveCorrection : submit}
              disabled={(submitted && !correctionMode) || submitting || (!correctionMode && deadlinePassed)}
              className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-400 px-3 text-sm font-black text-emerald-950 disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {submitted ? <Check className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {correctionMode ? "Save correction" : submitted ? "Locked" : submitting ? "Submitting..." : deadlinePassed ? "Closed" : signedIn ? "Submit final bracket" : "Continue with Google"}
            </button>
            {submitStatus ? <p className="mt-3 rounded-md bg-stone-100 px-3 py-2 text-sm font-bold text-stone-700">{submitStatus}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function BracketGraphic({
  draft,
  matches,
  pickWinner,
  locked = false,
}: {
  draft: BracketDraft;
  matches: ReturnType<typeof firstRoundMatches>;
  pickWinner: (matchId: string, teamId: string) => void;
  locked?: boolean;
}) {
  const [mobileRoundIndex, setMobileRoundIndex] = useState(0);
  const teamFromPick = (matchId: string) => teamById.get(draft.knockoutPicks[matchId]);
  const presentTeams = (home?: Team, away?: Team) => [home, away].filter((team): team is Team => Boolean(team));
  const advancedMatches = [
    {
      label: "Round of 32",
      matches,
    },
    {
      label: "Round of 16",
      matches: [
        { id: "m89", label: "Match 89", date: "Sat 4 Jul", venue: "Philadelphia Stadium", home: teamFromPick("m74"), away: teamFromPick("m77") },
        { id: "m90", label: "Match 90", date: "Sat 4 Jul", venue: "Houston Stadium", home: teamFromPick("m73"), away: teamFromPick("m75") },
        { id: "m91", label: "Match 91", date: "Sun 5 Jul", venue: "New York New Jersey Stadium", home: teamFromPick("m76"), away: teamFromPick("m78") },
        { id: "m92", label: "Match 92", date: "Sun 5 Jul", venue: "Mexico City Stadium", home: teamFromPick("m79"), away: teamFromPick("m80") },
        { id: "m93", label: "Match 93", date: "Mon 6 Jul", venue: "Dallas Stadium", home: teamFromPick("m83"), away: teamFromPick("m84") },
        { id: "m94", label: "Match 94", date: "Mon 6 Jul", venue: "Seattle Stadium", home: teamFromPick("m81"), away: teamFromPick("m82") },
        { id: "m95", label: "Match 95", date: "Tue 7 Jul", venue: "Atlanta Stadium", home: teamFromPick("m86"), away: teamFromPick("m88") },
        { id: "m96", label: "Match 96", date: "Tue 7 Jul", venue: "BC Place Vancouver", home: teamFromPick("m85"), away: teamFromPick("m87") },
      ],
    },
    {
      label: "Quarterfinals",
      matches: [
        { id: "m97", label: "Match 97", date: "Thu 9 Jul", venue: "Boston Stadium", home: teamFromPick("m89"), away: teamFromPick("m90") },
        { id: "m98", label: "Match 98", date: "Fri 10 Jul", venue: "Los Angeles Stadium", home: teamFromPick("m93"), away: teamFromPick("m94") },
        { id: "m99", label: "Match 99", date: "Sat 11 Jul", venue: "Miami Stadium", home: teamFromPick("m91"), away: teamFromPick("m92") },
        { id: "m100", label: "Match 100", date: "Sat 11 Jul", venue: "Kansas City Stadium", home: teamFromPick("m95"), away: teamFromPick("m96") },
      ],
    },
    {
      label: "Semifinals",
      matches: [
        { id: "m101", label: "Match 101", date: "Tue 14 Jul", venue: "Dallas Stadium", home: teamFromPick("m97"), away: teamFromPick("m98") },
        { id: "m102", label: "Match 102", date: "Wed 15 Jul", venue: "Atlanta Stadium", home: teamFromPick("m99"), away: teamFromPick("m100") },
      ],
    },
    {
      label: "Final",
      matches: [
        { id: "m104", label: "Match 104", date: "Sun 19 Jul", venue: "New York New Jersey Stadium", home: teamFromPick("m101"), away: teamFromPick("m102") },
      ],
    },
  ];
  const mobileRound = advancedMatches[mobileRoundIndex] ?? advancedMatches[0];

  return (
    <div className="mt-8 rounded-lg border border-stone-200 bg-stone-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-emerald-800">Bracket view</p>
          <h4 className="mt-1 text-xl font-black">Knockout path</h4>
        </div>
        <p className="rounded-md bg-stone-100 px-3 py-2 text-xs font-bold text-stone-500">Pick winners from left to right</p>
      </div>
      <div className="mt-5">
        <div className="mobile-bracket md:hidden">
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={mobileRoundIndex === 0}
              onClick={() => setMobileRoundIndex((index) => Math.max(0, index - 1))}
              className="h-9 rounded-md border border-stone-300 bg-white px-3 text-xs font-black disabled:opacity-35"
            >
              Prev
            </button>
            <div className="text-center">
              <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">Round {mobileRoundIndex + 1} of {advancedMatches.length}</p>
              <p className="text-sm font-black">{mobileRound.label}</p>
            </div>
            <button
              type="button"
              disabled={mobileRoundIndex === advancedMatches.length - 1}
              onClick={() => setMobileRoundIndex((index) => Math.min(advancedMatches.length - 1, index + 1))}
              className="h-9 rounded-md border border-stone-300 bg-white px-3 text-xs font-black disabled:opacity-35"
            >
              Next
            </button>
          </div>
          <div className="mb-3 grid grid-cols-5 gap-1">
            {advancedMatches.map((column, index) => (
              <button
                key={column.label}
                type="button"
                onClick={() => setMobileRoundIndex(index)}
                className={`h-2 rounded-full ${index === mobileRoundIndex ? "bg-emerald-400" : "bg-stone-100"}`}
                aria-label={`Show ${column.label}`}
              />
            ))}
          </div>
          <div className="mobile-round-column">
            {mobileRound.matches.map((match) => (
              <div key={match.id} className="bracket-match mobile-bracket-match relative rounded-md border border-stone-200 bg-white p-2">
                <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-stone-500">{match.label}</p>
                <p className="mb-2 text-[10px] font-bold text-stone-500">{match.date} · {match.venue}</p>
                {presentTeams(match.home, match.away).length ? (
                  presentTeams(match.home, match.away).map((team) => (
                    <button
                      key={team.id}
                      type="button"
                      disabled={locked}
                      onClick={() => pickWinner(match.id, team.id)}
                      className={`mb-1 flex h-10 w-full min-w-0 items-center justify-between rounded-sm border px-2 text-left text-xs font-black ${
                        draft.knockoutPicks[match.id] === team.id ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-stone-200 bg-stone-50"
                      }`}
                    >
                      <TeamLabel team={team} />
                    </button>
                  ))
                ) : (
                  <p className="rounded-sm border border-stone-200 bg-stone-50 px-2 py-2 text-xs font-bold text-stone-500">Waiting on feeder matches</p>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="bracket-scroll hidden pb-3 md:block">
          <div className="bracket-track">
            {advancedMatches.map((column) => (
              <div key={column.label} className="bracket-column">
                <p className="mb-3 text-center text-xs font-black uppercase tracking-wide text-stone-500">{column.label}</p>
                <div className="flex h-full flex-col justify-around gap-3">
                  {column.matches.map((match) => (
                    <div key={match.id} className="bracket-match relative rounded-md border border-stone-200 bg-white p-2">
                      <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-stone-500">{match.label}</p>
                      <p className="mb-2 text-[10px] font-bold text-stone-500">{match.date} · {match.venue}</p>
                      {presentTeams(match.home, match.away).length ? (
                        presentTeams(match.home, match.away).map((team) => (
                          <button
                          key={team.id}
                          type="button"
                          disabled={locked}
                          onClick={() => pickWinner(match.id, team.id)}
                            className={`mb-1 flex h-9 w-full items-center justify-between rounded-sm border px-2 text-left text-xs font-black ${
                              draft.knockoutPicks[match.id] === team.id ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-stone-200 bg-stone-50"
                            }`}
                          >
                            <TeamLabel team={team} />
                          </button>
                        ))
                      ) : (
                        <p className="rounded-sm border border-stone-200 bg-stone-50 px-2 py-2 text-xs font-bold text-stone-500">Waiting on feeder matches</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupStage() {
  const [group, setGroup] = useState<GroupId>("A");
  const [view, setView] = useState<"group" | "date">("group");
  const visibleFixtures = fixtures.filter((fixture) => (view === "group" ? fixture.group === group : true));
  const [fixtureId, setFixtureId] = useState(visibleFixtures[0]?.id ?? fixtures[0].id);
  const fixture = fixtures.find((item) => item.id === fixtureId) ?? visibleFixtures[0];
  const home = teamById.get(fixture.homeTeamId)!;
  const away = teamById.get(fixture.awayTeamId)!;

  return (
    <section className="grid gap-5">
      <ControlPanel
        title="Group Stage predictor"
        copy="Select any group-stage match. Completed matches can be marked with actual results once the data refresh is connected."
      >
        <button onClick={() => setView("group")} className={`rounded-md px-3 py-2 text-sm font-bold ${view === "group" ? "bg-emerald-800 text-white" : "bg-white"}`}>By group</button>
        <button onClick={() => setView("date")} className={`rounded-md px-3 py-2 text-sm font-bold ${view === "date" ? "bg-emerald-800 text-white" : "bg-white"}`}>By date</button>
        {view === "group" ? (
          <select value={group} onChange={(event) => setGroup(event.target.value as GroupId)} className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm">
            {groupIds.map((id) => (
              <option key={id} value={id}>Group {id}</option>
            ))}
          </select>
        ) : null}
        <select value={fixtureId} onChange={(event) => setFixtureId(event.target.value)} className="h-10 w-full min-w-0 rounded-md border border-stone-300 bg-white px-3 text-sm sm:min-w-64">
          {visibleFixtures.map((item) => {
            const a = teamById.get(item.homeTeamId)!;
            const b = teamById.get(item.awayTeamId)!;
            return (
              <option key={item.id} value={item.id}>
                {new Date(item.date).toLocaleDateString()} · Group {item.group} · {a.name} vs {b.name} · {item.venue}
              </option>
            );
          })}
        </select>
      </ControlPanel>
      <PredictionPanel key={`${home.id}-${away.id}-group`} home={home} away={away} />
      <ModelPerformance />
    </section>
  );
}

function Knockouts() {
  const [homeId, setHomeId] = useState("argentina");
  const [awayId, setAwayId] = useState("france");
  const home = teamById.get(homeId)!;
  const away = teamById.get(awayId)!;
  return (
    <section className="grid gap-5">
      <ControlPanel title="Knockout predictor" copy="Build a hypothetical knockout matchup. The model shows 90-minute probabilities and who is more likely to advance.">
        <SelectTeam value={homeId} teams={teams.filter((team) => team.id !== awayId)} onChange={setHomeId} />
        <SelectTeam value={awayId} teams={teams.filter((team) => team.id !== homeId)} onChange={setAwayId} />
      </ControlPanel>
      <PredictionPanel key={`${home.id}-${away.id}-knockout`} home={home} away={away} knockout />
    </section>
  );
}

function ControlPanel({ title, copy, children }: { title: string; copy: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">{title}</p>
          <p className="mt-1 max-w-3xl text-sm text-stone-600">{copy}</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">{children}</div>
      </div>
    </div>
  );
}

function ModelPerformance() {
  return (
    <details className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-black">Model performance</summary>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Metric label="Outcome accuracy" value="Pending" />
        <Metric label="Avg score error" value="Pending" />
        <Metric label="Clean sheet calls" value="Pending" />
        <Metric label="Scorer hit rate" value="Pending" />
      </div>
    </details>
  );
}

function Leaderboard({ localEntry }: { localEntry: LeaderboardEntry | null }) {
  const [remoteEntries, setRemoteEntries] = useState<ViewableLeaderboardEntry[] | null>(null);
  const [privateEntries, setPrivateEntries] = useState<ViewableLeaderboardEntry[] | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<ViewableLeaderboardEntry | null>(null);
  const [matchResults, setMatchResults] = useState<CompletedKnockoutResult[]>([]);
  const [viewerCanOpenBrackets, setViewerCanOpenBrackets] = useState(false);
  const [personalDisplayName, setPersonalDisplayName] = useState("");
  const [personalChampionPick] = useState(() => {
    if (typeof window === "undefined") return "";
    const saved = window.localStorage.getItem(draftStorageKey);
    const savedDraft = saved ? (JSON.parse(saved) as BracketDraft) : null;
    const savedChampion = savedDraft ? draftChampion(savedDraft) : undefined;
    return savedChampion ? teamById.get(savedChampion)?.name ?? savedChampion : "";
  });
  const [status, setStatus] = useState("");
  const [privateCodeInput, setPrivateCodeInput] = useState("");
  const [privatePoolCode, setPrivatePoolCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(privatePoolStorageKey) || "";
  });
  const [privateStatus, setPrivateStatus] = useState("");
  const [joiningPrivatePool, setJoiningPrivatePool] = useState(false);
  const baseEntries = remoteEntries ?? leaderboard;
  const entries = localEntry ? [localEntry, ...baseEntries.filter((entry) => entry.displayName !== localEntry.displayName)] : baseEntries;
  const visibleEntries =
    personalDisplayName && personalChampionPick
      ? entries.map((entry) =>
          entry.displayName === personalDisplayName
            ? {
                ...entry,
                championPick: personalChampionPick,
              }
            : entry,
        )
      : entries;

  const loadPrivatePool = useCallback(async (code: string, canOpenBrackets = viewerCanOpenBrackets) => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const result = canOpenBrackets
      ? await supabase
          .from("brackets")
          .select("id, display_name, champion_pick, picks, submitted_at, private_pool_code, leaderboard_scores(points, rank)")
          .eq("private_pool_code", code)
          .order("submitted_at", { ascending: true })
      : await supabase
          .from("brackets")
          .select("id, display_name, champion_pick, submitted_at, private_pool_code, leaderboard_scores(points, rank)")
          .eq("private_pool_code", code)
          .order("submitted_at", { ascending: true });

    if (result.error) {
      setPrivateStatus("Private Pool needs the Supabase SQL update before it can load.");
      return;
    }
    setPrivateEntries(mapRowsToEntries((result.data as LeaderboardRow[] | null) ?? [], canOpenBrackets));
  }, [viewerCanOpenBrackets]);

  const joinPrivatePool = async () => {
    setPrivateStatus("");
    const code = normalizePoolCode(privateCodeInput);
    if (!code) {
      setPrivateStatus("Enter the private pool code.");
      return;
    }
    if (code !== privatePoolPassword) {
      setPrivateStatus("That code does not match this private pool. Try az, and if you just changed the code, restart/redeploy the site first.");
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setPrivateStatus(supabaseSetupMessage());
      return;
    }
    setJoiningPrivatePool(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setPrivateStatus("Sign in and submit a bracket before joining the private pool.");
        return;
      }
      const { data: ownBracket, error: ownError } = await supabase
        .from("brackets")
        .select("id")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (ownError || !ownBracket) {
        setPrivateStatus("Submit your official bracket first, then come back here to join the private pool.");
        return;
      }
      const { error } = await supabase
        .from("brackets")
        .update({ private_pool_code: code, private_pool_joined_at: new Date().toISOString() })
        .eq("user_id", userData.user.id);
      if (error) {
        const message = error.message.toLowerCase();
        if (message.includes("private_pool_code") || message.includes("column")) {
          setPrivateStatus("Run the Supabase SQL update first, then try joining again.");
        } else if (message.includes("row-level security") || message.includes("policy")) {
          setPrivateStatus("Supabase blocked the private pool update. Add the private pool update policy in SQL, then try again.");
        } else {
          setPrivateStatus(error.message);
        }
        return;
      }
      window.localStorage.setItem(privatePoolStorageKey, code);
      setPrivatePoolCode(code);
      setPrivateCodeInput("");
      setPrivateStatus("Private Pool unlocked. Settlements stay outside the app.");
      await loadPrivatePool(code, true);
    } finally {
      setJoiningPrivatePool(false);
    }
  };

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const loadLeaderboard = async () => {
      const { data: userData } = await supabase.auth.getUser();
      let canOpenBrackets = false;
      if (userData.user) {
        setPersonalDisplayName(userData.user.user_metadata?.full_name || userData.user.email?.split("@")[0] || "Player");
        const { data: ownBracket } = await supabase
          .from("brackets")
          .select("id")
          .eq("user_id", userData.user.id)
          .maybeSingle();
        canOpenBrackets = Boolean(ownBracket);
        setViewerCanOpenBrackets(canOpenBrackets);
      }

      const result = canOpenBrackets
        ? await supabase.from("brackets").select("id, display_name, champion_pick, picks, submitted_at, leaderboard_scores(points, rank)").order("submitted_at", { ascending: true })
        : await supabase.from("brackets").select("id, display_name, champion_pick, submitted_at, leaderboard_scores(points, rank)").order("submitted_at", { ascending: true });
      const data = result.data as LeaderboardRow[] | null;
      const error = result.error;

      if (error) {
        setStatus("Leaderboard is showing local/demo entries. Add public read policy for brackets to show everyone.");
        return;
      }
      if (!data?.length) return;
      setRemoteEntries(mapRowsToEntries(data, canOpenBrackets));
      const { data: resultRows } = await supabase
        .from("match_results")
        .select("match_id, winner_team_id, stage")
        .eq("status", "completed");
      if (resultRows?.length) {
        setMatchResults(
          mergeCompletedResults((resultRows as MatchResultRow[]).map((row) => ({
            matchId: row.match_id,
            winnerTeamId: row.winner_team_id,
            stage: row.stage,
          }))),
        );
      }
      if (!canOpenBrackets) {
        setStatus("Submit your own official bracket to unlock public bracket previews.");
      }
      const savedPrivateCode = typeof window === "undefined" ? "" : window.localStorage.getItem(privatePoolStorageKey);
      if (savedPrivateCode) {
        setPrivatePoolCode(savedPrivateCode);
        await loadPrivatePool(savedPrivateCode, canOpenBrackets);
      }
    };
    loadLeaderboard();
  }, [loadPrivatePool]);

  if (selectedEntry?.picks) {
    return <BracketPreviewPage entry={selectedEntry} matchResults={matchResults} onBack={() => setSelectedEntry(null)} />;
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Public pool</p>
          <h2 className="mt-1 text-2xl font-black">Leaderboard</h2>
          <p className="mt-2 text-sm text-stone-600">Only rank, display name, points, and champion pick are public. Tie-breakers stay hidden until needed.</p>
        </div>
        <button className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-bold">
          <Download className="h-4 w-4" />
          Copy share link
        </button>
      </div>
      {status ? <p className="mt-4 rounded-md bg-stone-100 px-3 py-2 text-sm font-bold text-stone-700">{status}</p> : null}
      <div className="mt-5 overflow-x-auto rounded-md border border-stone-200">
        <table className="min-w-[520px] w-full border-collapse text-left text-sm">
          <thead className="bg-stone-100 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="p-3">Rank</th>
              <th className="p-3">Display name</th>
              <th className="p-3">Points</th>
              <th className="p-3 text-right">Tournament winner</th>
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((entry, index) => {
              const viewableEntry = entry as ViewableLeaderboardEntry;
              return (
                <tr
                  key={`${entry.displayName}-${index}`}
                  onClick={() => viewerCanOpenBrackets && viewableEntry.picks && setSelectedEntry(viewableEntry)}
                  className={`border-t border-stone-200 ${viewerCanOpenBrackets && viewableEntry.picks ? "cursor-pointer transition hover:bg-white/10" : ""}`}
                >
                  <td className="p-3 font-black">{index + 1}</td>
                  <td className="p-3 font-bold">{entry.displayName}</td>
                  <td className="p-3">{entry.points}</td>
                  <td className="p-3 text-right text-xl font-bold" title={entry.championPick}>
                    <span className="inline-flex justify-end"><TeamFlag team={championTeamFromPick(entry.championPick)} /></span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="private-pool-panel mt-6 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="private-eyebrow text-xs font-black uppercase tracking-wide">Private Pool</p>
            <h3 className="mt-1 text-xl font-black">Code-gated leaderboard</h3>
            <p className="private-muted mt-2 max-w-2xl text-sm">
              Optional side pool for invited people only. The app tracks standings; any money collection or payout is handled outside the app by the group.
            </p>
          </div>
          {privatePoolCode ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-900">Unlocked</span>
          ) : (
            <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-stone-500">Locked</span>
          )}
        </div>

        {!privatePoolCode ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              value={privateCodeInput}
              onChange={(event) => setPrivateCodeInput(event.target.value)}
              placeholder="Enter private pool code"
              className="private-input h-11 rounded-md border px-3 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
            />
            <button
              type="button"
              onClick={joinPrivatePool}
              disabled={joiningPrivatePool}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-800 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              <Lock className="h-4 w-4" />
              {joiningPrivatePool ? "Joining" : "Join Private Pool"}
            </button>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-md border border-stone-200">
            <table className="min-w-[520px] w-full border-collapse text-left text-sm">
              <thead className="bg-stone-100 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="p-3">Rank</th>
                  <th className="p-3">Display name</th>
                  <th className="p-3">Points</th>
                  <th className="p-3 text-right">Tournament winner</th>
                </tr>
              </thead>
              <tbody>
                {(privateEntries ?? []).map((entry, index) => {
                  const viewableEntry = entry as ViewableLeaderboardEntry;
                  return (
                    <tr
                      key={`private-${entry.displayName}-${index}`}
                      onClick={() => viewerCanOpenBrackets && viewableEntry.picks && setSelectedEntry(viewableEntry)}
                      className={`border-t border-stone-200 ${viewerCanOpenBrackets && viewableEntry.picks ? "cursor-pointer transition hover:bg-white/10" : ""}`}
                    >
                      <td className="p-3 font-black">{index + 1}</td>
                      <td className="p-3 font-bold">{entry.displayName}</td>
                      <td className="p-3">{entry.points}</td>
                      <td className="p-3 text-right text-xl font-bold" title={entry.championPick}>
                        <span className="inline-flex justify-end"><TeamFlag team={championTeamFromPick(entry.championPick)} /></span>
                      </td>
                    </tr>
                  );
                })}
                {privateEntries && privateEntries.length === 0 ? (
                  <tr>
                    <td className="private-muted p-3 text-sm font-bold" colSpan={4}>No one has joined this private pool yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
        {privateStatus ? <p className="private-status mt-3 rounded-md px-3 py-2 text-sm font-bold">{privateStatus}</p> : null}
      </div>
    </section>
  );
}

function BracketPreviewPage({ entry, matchResults, onBack }: { entry: ViewableLeaderboardEntry; matchResults: CompletedKnockoutResult[]; onBack: () => void }) {
  const picks = entry.picks ? normalizedKnockoutDraft(entry.picks) : null;
  if (!picks) return null;
  const scoringResults = matchResults.length ? matchResults : undefined;
  const champion = draftChampion(picks);
  const score = scoreBracket(picks, scoringResults);
  const groupDetails = groupScoreDetails(picks);
  const knockoutDetails = knockoutScoreDetails(picks, scoringResults);
  const teamFromPick = (matchId: string) => teamById.get(picks.knockoutPicks[matchId]);
  const r32Matches = firstRoundMatches(picks, teams);
  const allKnockoutMatches = [
    ...r32Matches,
    { id: "m89", label: "Match 89", date: "Sat 4 Jul", venue: "Philadelphia Stadium", home: teamFromPick("m74"), away: teamFromPick("m77") },
    { id: "m90", label: "Match 90", date: "Sat 4 Jul", venue: "Houston Stadium", home: teamFromPick("m73"), away: teamFromPick("m75") },
    { id: "m91", label: "Match 91", date: "Sun 5 Jul", venue: "New York New Jersey Stadium", home: teamFromPick("m76"), away: teamFromPick("m78") },
    { id: "m92", label: "Match 92", date: "Sun 5 Jul", venue: "Mexico City Stadium", home: teamFromPick("m79"), away: teamFromPick("m80") },
    { id: "m93", label: "Match 93", date: "Mon 6 Jul", venue: "Dallas Stadium", home: teamFromPick("m83"), away: teamFromPick("m84") },
    { id: "m94", label: "Match 94", date: "Mon 6 Jul", venue: "Seattle Stadium", home: teamFromPick("m81"), away: teamFromPick("m82") },
    { id: "m95", label: "Match 95", date: "Tue 7 Jul", venue: "Atlanta Stadium", home: teamFromPick("m86"), away: teamFromPick("m88") },
    { id: "m96", label: "Match 96", date: "Tue 7 Jul", venue: "BC Place Vancouver", home: teamFromPick("m85"), away: teamFromPick("m87") },
    { id: "m97", label: "Match 97", date: "Thu 9 Jul", venue: "Boston Stadium", home: teamFromPick("m89"), away: teamFromPick("m90") },
    { id: "m98", label: "Match 98", date: "Fri 10 Jul", venue: "Los Angeles Stadium", home: teamFromPick("m93"), away: teamFromPick("m94") },
    { id: "m99", label: "Match 99", date: "Sat 11 Jul", venue: "Miami Stadium", home: teamFromPick("m91"), away: teamFromPick("m92") },
    { id: "m100", label: "Match 100", date: "Sat 11 Jul", venue: "Kansas City Stadium", home: teamFromPick("m95"), away: teamFromPick("m96") },
    { id: "m101", label: "Match 101", date: "Tue 14 Jul", venue: "Dallas Stadium", home: teamFromPick("m97"), away: teamFromPick("m98") },
    { id: "m102", label: "Match 102", date: "Wed 15 Jul", venue: "Atlanta Stadium", home: teamFromPick("m99"), away: teamFromPick("m100") },
    { id: "m104", label: "Match 104", date: "Sun 19 Jul", venue: "New York New Jersey Stadium", home: teamFromPick("m101"), away: teamFromPick("m102") },
  ];
  const completedMatchIds = new Set(knockoutDetails.map((detail) => detail.matchId));
  const futureKnockoutPicks = allKnockoutMatches.filter((match) => picks.knockoutPicks[match.id] && !completedMatchIds.has(match.id));

  return (
    <section className="w-full overflow-hidden rounded-lg border border-stone-200 bg-stone-50 p-4 shadow-2xl">
      <div className="w-full min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-emerald-800">Public bracket</p>
            <h2 className="mt-1 text-2xl font-black">{entry.displayName}</h2>
            <p className="mt-1 text-sm font-bold text-stone-500">
              Champion: {teamText(teamById.get(champion ?? "") ?? undefined)}
            </p>
          </div>
          <button type="button" onClick={onBack} className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-black">
            Back to leaderboard
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Metric label="Total points" value={`${score.points}/${score.possiblePoints}`} strong />
          <Metric label="Group points" value={`${score.groupPoints}`} />
          <Metric label="Knockout points" value={`${score.knockoutPoints}`} />
          <Metric label="Correct KO picks" value={`${score.correctPicks}/${score.completedMatches}`} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-full border border-emerald-500/40 bg-emerald-100 px-3 py-1 text-emerald-900">Green = full credit</span>
          <span className="rounded-full border border-amber-500/40 bg-amber-50 px-3 py-1 text-amber-200">Yellow = partial credit</span>
          <span className="rounded-full border border-red-500/40 bg-red-950/40 px-3 py-1 text-red-100">Red = missed</span>
        </div>

        <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-2">
          <div className="min-w-0">
            <h3 className="text-sm font-black uppercase tracking-wide text-stone-500">Group picks</h3>
            <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">
              {groupDetails.map((detail) => {
                const statusClass = detail.perfect
                  ? "border-emerald-500/60 bg-emerald-100"
                  : detail.topTwoCorrect || detail.firstPlaceCorrect || detail.thirdAdvancerCorrect
                    ? "border-amber-400/60 bg-amber-50"
                    : "border-red-500/40 bg-red-950/30";
                return (
                  <div key={detail.group} className={`min-w-0 rounded-md border p-3 ${statusClass}`}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-black uppercase tracking-wide text-stone-500">Group {detail.group}</p>
                      <span className="rounded-full bg-white/20 px-2 py-1 text-xs font-black">{detail.points}/{detail.possiblePoints}</span>
                    </div>
                    {detail.pickedOrder.map((teamId, index) => {
                      const exact = teamId === detail.actualOrder[index];
                      const topTwoTeam = index < 2 && detail.actualOrder.slice(0, 2).includes(teamId);
                      const firstPlaceHit = index === 0 && detail.firstPlaceCorrect;
                      const thirdBonus = index === 2 && detail.thirdAdvancerCorrect;
                      const marker = exact ? "✓" : topTwoTeam || firstPlaceHit || thirdBonus ? "~" : "×";
                      return (
                        <p key={`${detail.group}-${index}`} className="flex items-center justify-between gap-2 text-sm font-bold">
                          <span>{index + 1}. <TeamLabel team={teamById.get(teamId)} /></span>
                          <span className="text-xs">{marker}</span>
                        </p>
                      );
                    })}
                    <p className="mt-2 text-xs font-bold text-stone-500">
                      Actual: {detail.actualOrder.map((teamId, index) => (
                        <span key={teamId}>{index ? ", " : ""}{index + 1}. {teamById.get(teamId)?.name ?? teamId}</span>
                      ))}
                      </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="min-w-0">
            <h3 className="text-sm font-black uppercase tracking-wide text-stone-500">Completed knockout picks</h3>
            <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">
              {knockoutDetails.map((detail) => {
                const hit = detail.points > 0;
                const match = allKnockoutMatches.find((item) => item.id === detail.matchId);
                return (
                  <div key={detail.matchId} className={`min-w-0 rounded-md border p-3 ${hit ? "border-emerald-500/60 bg-emerald-100" : "border-red-500/40 bg-red-950/30"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-black uppercase tracking-wide text-stone-500">{detail.matchId.replace("m", "Match ")}</p>
                      <span className="rounded-full bg-white/20 px-2 py-1 text-xs font-black">{detail.points}/{detail.possiblePoints}</span>
                    </div>
                    <p className="mt-1 text-xs font-bold text-stone-500">
                      <TeamLabel team={match?.home} /> <span className="px-1">vs</span> <TeamLabel team={match?.away} />
                    </p>
                    <p className="mt-2 text-sm font-bold">Pick: <TeamLabel team={teamById.get(detail.pickedTeamId ?? "")} /></p>
                    <p className="mt-1 text-xs font-bold text-stone-500">Winner: {teamById.get(detail.winnerTeamId)?.name ?? detail.winnerTeamId}</p>
                  </div>
                );
              })}
            </div>
            <h3 className="mt-5 text-sm font-black uppercase tracking-wide text-stone-500">Future knockout picks</h3>
            <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">
              {futureKnockoutPicks.map((match) => (
                <div key={match.id} className="min-w-0 rounded-md border border-stone-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-black uppercase tracking-wide text-stone-500">{match.label}</p>
                    <span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-black text-stone-500">Pending</span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-stone-500">
                    <TeamLabel team={match.home} /> <span className="px-1">vs</span> <TeamLabel team={match.away} />
                  </p>
                  <p className="mt-2 text-sm font-bold">Pick: <TeamLabel team={teamById.get(picks.knockoutPicks[match.id])} /></p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CelebrationOverlay({ entry, onNext }: { entry: LeaderboardEntry; onNext: () => void }) {
  const champion = teams.find((team) => team.name === entry.championPick || team.id === entry.championPick);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="celebration-card relative w-full max-w-lg overflow-hidden rounded-lg border border-white/15 p-6 text-center shadow-2xl">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {Array.from({ length: 34 }, (_, index) => (
            <span
              key={index}
              className="confetti-piece"
              style={{
                left: `${(index * 13) % 100}%`,
                animationDelay: `${(index % 9) * 0.12}s`,
                backgroundColor: ["#1ed58b", "#f5c451", "#6db8ff", "#f26f4f", "#f6f1df"][index % 5],
              }}
            />
          ))}
        </div>
        <div className="relative">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-md bg-emerald-400 text-emerald-950">
            <Trophy className="h-7 w-7" />
          </div>
          <p className="mt-5 text-sm font-black uppercase tracking-wide text-emerald-200">Congratulations!</p>
          <h2 className="mt-2 text-3xl font-black">Your Champion</h2>
          <div className="mt-5 rounded-md border border-white/15 bg-white/10 px-4 py-5">
            <p className="text-5xl leading-none"><TeamFlag team={champion} className="champion-flag" /></p>
            <p className="mt-3 text-3xl font-black">{entry.championPick}</p>
          </div>
          <p className="mt-4 text-sm font-semibold text-stone-300">Your official bracket is locked. The leaderboard shows public entries only.</p>
          <button
            type="button"
            onClick={onNext}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-emerald-400 px-5 text-sm font-black text-emerald-950"
          >
            Next: Leaderboard
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("bracket");
  const [submittedEntry, setSubmittedEntry] = useState<LeaderboardEntry | null>(null);
  const [celebrationEntry, setCelebrationEntry] = useState<LeaderboardEntry | null>(null);

  const handleSubmitted = (entry: LeaderboardEntry) => {
    setSubmittedEntry(entry);
    setCelebrationEntry(entry);
  };

  return (
    <>
      <Header activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="mx-auto max-w-7xl px-4 py-6">
        {activeTab === "bracket" ? <BracketPool onSubmitted={handleSubmitted} /> : null}
        {activeTab === "groups" ? <GroupStage /> : null}
        {activeTab === "knockouts" ? <Knockouts /> : null}
        {activeTab === "leaderboard" ? <Leaderboard localEntry={submittedEntry} /> : null}
      </main>
      {celebrationEntry ? (
        <CelebrationOverlay
          entry={celebrationEntry}
          onNext={() => {
            setCelebrationEntry(null);
            setActiveTab("leaderboard");
          }}
        />
      ) : null}
    </>
  );
}
