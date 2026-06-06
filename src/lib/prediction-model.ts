import type { Prediction, ScorerProjection, Team } from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

const poissonMode = (lambda: number) => clamp(Math.round(lambda), 0, 5);

const teamStrength = (team: Team) =>
  team.elo / 24 +
  (100 - team.fifaRank) * 0.42 +
  team.attack * 0.48 +
  team.defense * 0.35 +
  team.form * 0.34 +
  Math.log10(Math.max(team.gdpPerCapita, 500)) * 0.7;

const expectedGoals = (team: Team, opponent: Team) => {
  const attackEdge = team.attack - opponent.defense;
  const eloEdge = (team.elo - opponent.elo) / 130;
  const formEdge = (team.form - opponent.form) / 80;
  return clamp(1.18 + attackEdge / 42 + eloEdge * 0.18 + formEdge, 0.25, 3.4);
};

const scorerProjection = (team: Team, opponent: Team, teamXg: number): ScorerProjection[] => {
  const opponentPenalty = clamp((90 - opponent.defense) / 100, 0.05, 0.55);
  return team.players
    .map((player) => {
      const role = player.position === "FWD" ? 1.3 : player.position === "MID" ? 0.82 : player.position === "DEF" ? 0.28 : 0.03;
      const history = Math.log1p(player.nationalGoals) / 6;
      const minutes = player.expectedMinutes / 90;
      const starter = player.starterScore / 100;
      const form = player.clubForm / 100;
      const probability = clamp((teamXg / 2.4) * role * (0.25 + history) * minutes * starter * (0.7 + form) + opponentPenalty * 0.06, 0.01, 0.62);
      return {
        playerId: player.id,
        name: player.name,
        position: player.position,
        probability: Math.round(probability * 100),
      };
    })
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);
};

export function predictMatch(home: Team, away: Team, knockout = false): Prediction {
  const homeStrength = teamStrength(home);
  const awayStrength = teamStrength(away);
  const diff = homeStrength - awayStrength;
  const homeXg = expectedGoals(home, away);
  const awayXg = expectedGoals(away, home);
  const draw = clamp(0.28 - Math.abs(diff) / 720, 0.12, 0.31);
  const nonDraw = 1 - draw;
  const homeShare = logistic(diff / 34 + (homeXg - awayXg) / 1.8);
  const homeWin = nonDraw * homeShare;
  const awayWin = nonDraw * (1 - homeShare);
  const homeAdvance = knockout ? clamp(homeWin + draw * logistic(diff / 28), 0.05, 0.95) : undefined;
  const awayAdvance = knockout && homeAdvance ? 1 - homeAdvance : undefined;
  const confidence =
    Math.abs(diff) > 26 || Math.abs(homeXg - awayXg) > 0.55 ? "High" : Math.abs(diff) > 12 ? "Medium" : "Low";

  return {
    homeWin: Math.round(homeWin * 100),
    draw: Math.round(draw * 100),
    awayWin: Math.round(awayWin * 100),
    homeAdvance: homeAdvance ? Math.round(homeAdvance * 100) : undefined,
    awayAdvance: awayAdvance ? Math.round(awayAdvance * 100) : undefined,
    projectedScore: [poissonMode(homeXg), poissonMode(awayXg)],
    confidence,
    cleanSheets: [Math.round(clamp(1 - awayXg / 3.2, 0.08, 0.72) * 100), Math.round(clamp(1 - homeXg / 3.2, 0.08, 0.72) * 100)],
    corners: [Math.round(clamp(3.6 + home.attack / 32 - away.defense / 55, 2, 9)), Math.round(clamp(3.6 + away.attack / 32 - home.defense / 55, 2, 9))],
    shots: [Math.round(clamp(8 + homeXg * 4.2, 5, 21)), Math.round(clamp(8 + awayXg * 4.2, 5, 21))],
    shotsOnTarget: [Math.round(clamp(2.5 + homeXg * 1.8, 1, 10)), Math.round(clamp(2.5 + awayXg * 1.8, 1, 10))],
    saves: [Math.round(clamp(1.5 + awayXg * 1.3, 1, 8)), Math.round(clamp(1.5 + homeXg * 1.3, 1, 8))],
    cards: [Math.round(clamp(1.5 + (100 - home.form) / 45, 1, 5)), Math.round(clamp(1.5 + (100 - away.form) / 45, 1, 5))],
    fouls: [Math.round(clamp(9 + (100 - home.form) / 8, 7, 20)), Math.round(clamp(9 + (100 - away.form) / 8, 7, 20))],
    homeScorers: scorerProjection(home, away, homeXg),
    awayScorers: scorerProjection(away, home, awayXg),
    drivers: [
      `${home.name} strength index ${Math.round(homeStrength)} vs ${away.name} ${Math.round(awayStrength)}.`,
      `${home.name} projected xG ${homeXg.toFixed(2)}; ${away.name} projected xG ${awayXg.toFixed(2)}.`,
      "GDP is included as a tiny background factor; rankings, Elo, form, and squad role carry the model.",
    ],
  };
}

export function modelChampion(teams: Team[]) {
  return [...teams].sort((a, b) => teamStrength(b) - teamStrength(a))[0];
}
