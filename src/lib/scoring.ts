import { scoringWeights } from "./bracket-engine";
import type { BracketDraft } from "./types";

export type CompletedKnockoutResult = {
  matchId: string;
  winnerTeamId: string;
  stage: "roundOf32" | "roundOf16" | "quarterfinal" | "semifinal" | "final";
};

const stagePoints: Record<CompletedKnockoutResult["stage"], number> = {
  roundOf32: scoringWeights.roundOf32,
  roundOf16: scoringWeights.roundOf16,
  quarterfinal: scoringWeights.quarterfinal,
  semifinal: scoringWeights.semifinal,
  final: scoringWeights.final,
};

export const completedKnockoutResults: CompletedKnockoutResult[] = [
  { matchId: "m73", winnerTeamId: "canada", stage: "roundOf32" },
  { matchId: "m74", winnerTeamId: "paraguay", stage: "roundOf32" },
  { matchId: "m75", winnerTeamId: "morocco", stage: "roundOf32" },
  { matchId: "m76", winnerTeamId: "brazil", stage: "roundOf32" },
];

export function scoreBracket(draft: BracketDraft) {
  const correctPicks = completedKnockoutResults.filter((result) => draft.knockoutPicks[result.matchId] === result.winnerTeamId);
  const points = correctPicks.reduce((total, result) => total + stagePoints[result.stage], 0);

  return {
    points,
    possiblePoints: completedKnockoutResults.reduce((total, result) => total + stagePoints[result.stage], 0),
    correctPicks: correctPicks.length,
    completedMatches: completedKnockoutResults.length,
    updatedAt: new Date().toISOString(),
  };
}
