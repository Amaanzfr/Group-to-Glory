import { scoringWeights } from "./bracket-engine";
import type { BracketDraft, GroupId } from "./types";

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

export const finalGroupStandings: Record<GroupId, [string, string, string, string]> = {
  A: ["mexico", "south-africa", "south-korea", "czechia"],
  B: ["switzerland", "canada", "bosnia-and-herzegovina", "qatar"],
  C: ["brazil", "morocco", "scotland", "haiti"],
  D: ["usa", "australia", "paraguay", "turkiye"],
  E: ["germany", "ivory-coast", "ecuador", "curacao"],
  F: ["netherlands", "japan", "sweden", "tunisia"],
  G: ["belgium", "egypt", "iran", "new-zealand"],
  H: ["spain", "cape-verde", "uruguay", "saudi-arabia"],
  I: ["france", "norway", "senegal", "iraq"],
  J: ["argentina", "austria", "algeria", "jordan"],
  K: ["colombia", "portugal", "dr-congo", "uzbekistan"],
  L: ["england", "croatia", "ghana", "panama"],
};

export const advancingThirdPlaceTeamIds = new Set([
  "bosnia-and-herzegovina",
  "paraguay",
  "ecuador",
  "sweden",
  "senegal",
  "algeria",
  "dr-congo",
  "ghana",
]);

const groupSlots = ["first", "second", "third", "fourth"] as const;

function scoreGroups(draft: BracketDraft) {
  let points = 0;
  let correctTopTwoGroups = 0;
  let perfectGroups = 0;
  let correctThirdAdvancers = 0;

  for (const [group, actualOrder] of Object.entries(finalGroupStandings) as Array<[GroupId, [string, string, string, string]]>) {
    const pick = draft.groupPicks[group];
    const pickedOrder = groupSlots.map((slot) => pick?.[slot] ?? "");
    const perfect = pickedOrder.every((teamId, index) => teamId === actualOrder[index]);

    if (perfect) {
      points += 4;
      perfectGroups += 1;
    } else {
      const pickedTopTwo = new Set([pick?.first, pick?.second].filter(Boolean));
      const actualTopTwo = new Set(actualOrder.slice(0, 2));
      if (pickedTopTwo.size === 2 && [...actualTopTwo].every((teamId) => pickedTopTwo.has(teamId))) {
        points += 2;
        correctTopTwoGroups += 1;
      }
    }

    const actualThird = actualOrder[2];
    if (
      pick?.third === actualThird &&
      advancingThirdPlaceTeamIds.has(actualThird) &&
      draft.thirdPlaceAdvancers.includes(actualThird)
    ) {
      points += 1;
      correctThirdAdvancers += 1;
    }
  }

  return {
    points,
    possiblePoints: Object.keys(finalGroupStandings).length * 4 + advancingThirdPlaceTeamIds.size,
    perfectGroups,
    correctTopTwoGroups,
    correctThirdAdvancers,
  };
}

export function scoreBracket(draft: BracketDraft) {
  const correctPicks = completedKnockoutResults.filter((result) => draft.knockoutPicks[result.matchId] === result.winnerTeamId);
  const knockoutPoints = correctPicks.reduce((total, result) => total + stagePoints[result.stage], 0);
  const groupScore = scoreGroups(draft);

  return {
    points: groupScore.points + knockoutPoints,
    possiblePoints: groupScore.possiblePoints + completedKnockoutResults.reduce((total, result) => total + stagePoints[result.stage], 0),
    groupPoints: groupScore.points,
    knockoutPoints,
    perfectGroups: groupScore.perfectGroups,
    correctTopTwoGroups: groupScore.correctTopTwoGroups,
    correctThirdAdvancers: groupScore.correctThirdAdvancers,
    correctPicks: correctPicks.length,
    completedMatches: completedKnockoutResults.length,
    updatedAt: new Date().toISOString(),
  };
}
