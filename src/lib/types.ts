export type GroupId =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L";

export type Team = {
  id: string;
  name: string;
  group: GroupId;
  flag: string;
  fifaRank: number;
  elo: number;
  gdpPerCapita: number;
  attack: number;
  defense: number;
  form: number;
  players: Player[];
};

export type Player = {
  id: string;
  name: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  nationalGoals: number;
  expectedMinutes: number;
  clubForm: number;
  starterScore: number;
};

export type Fixture = {
  id: string;
  stage: "group" | "knockout";
  group?: GroupId;
  date: string;
  venue?: string;
  homeTeamId: string;
  awayTeamId: string;
  status: "scheduled" | "live" | "completed";
  homeScore?: number;
  awayScore?: number;
};

export type Prediction = {
  homeWin: number;
  draw: number;
  awayWin: number;
  homeAdvance?: number;
  awayAdvance?: number;
  projectedScore: [number, number];
  confidence: "High" | "Medium" | "Low";
  cleanSheets: [number, number];
  corners: [number, number];
  shots: [number, number];
  shotsOnTarget: [number, number];
  saves: [number, number];
  cards: [number, number];
  fouls: [number, number];
  homeScorers: ScorerProjection[];
  awayScorers: ScorerProjection[];
  drivers: string[];
  generatedAt?: string;
  sourceNote?: string;
  rosterStatus?: string;
};

export type ScorerProjection = {
  playerId: string;
  name: string;
  position: Player["position"];
  probability: number;
};

export type GroupPick = {
  group: GroupId;
  first?: string;
  second?: string;
  third?: string;
  fourth?: string;
};

export type BracketDraft = {
  groupPicks: Record<GroupId, GroupPick>;
  thirdPlaceAdvancers: string[];
  knockoutPicks: Record<string, string>;
  finalScorer?: string;
  finalScore?: [number, number];
  displayName?: string;
};

export type LeaderboardEntry = {
  rank: number;
  displayName: string;
  points: number;
  championPick: string;
};
