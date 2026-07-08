import { scoringWeights } from "./bracket-engine";
import { canonicalTeamId } from "./tournament-data";
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
  { matchId: "m77", winnerTeamId: "france", stage: "roundOf32" },
  { matchId: "m78", winnerTeamId: "norway", stage: "roundOf32" },
  { matchId: "m79", winnerTeamId: "mexico", stage: "roundOf32" },
  { matchId: "m80", winnerTeamId: "england", stage: "roundOf32" },
  { matchId: "m81", winnerTeamId: "usa", stage: "roundOf32" },
  { matchId: "m82", winnerTeamId: "belgium", stage: "roundOf32" },
  { matchId: "m83", winnerTeamId: "portugal", stage: "roundOf32" },
  { matchId: "m84", winnerTeamId: "spain", stage: "roundOf32" },
  { matchId: "m85", winnerTeamId: "switzerland", stage: "roundOf32" },
  { matchId: "m86", winnerTeamId: "argentina", stage: "roundOf32" },
  { matchId: "m87", winnerTeamId: "colombia", stage: "roundOf32" },
  { matchId: "m88", winnerTeamId: "egypt", stage: "roundOf32" },
  { matchId: "m89", winnerTeamId: "france", stage: "roundOf16" },
  { matchId: "m90", winnerTeamId: "morocco", stage: "roundOf16" },
  { matchId: "m91", winnerTeamId: "norway", stage: "roundOf16" },
  { matchId: "m92", winnerTeamId: "england", stage: "roundOf16" },
  { matchId: "m93", winnerTeamId: "spain", stage: "roundOf16" },
  { matchId: "m94", winnerTeamId: "belgium", stage: "roundOf16" },
  { matchId: "m95", winnerTeamId: "argentina", stage: "roundOf16" },
  { matchId: "m96", winnerTeamId: "switzerland", stage: "roundOf16" },
];

export function mergeCompletedResults(extraResults: CompletedKnockoutResult[]) {
  const byMatch = new Map(completedKnockoutResults.map((result) => [result.matchId, result]));
  for (const result of extraResults) {
    byMatch.set(result.matchId, result);
  }
  return [...byMatch.values()].sort((a, b) => Number(a.matchId.slice(1)) - Number(b.matchId.slice(1)));
}

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

export function groupScoreDetails(draft: BracketDraft) {
  return (Object.entries(finalGroupStandings) as Array<[GroupId, [string, string, string, string]]>).map(([group, actualOrder]) => {
    const pick = draft.groupPicks[group];
    const pickedOrder = groupSlots.map((slot) => canonicalTeamId(pick?.[slot] ?? ""));
    const perfect = pickedOrder.every((teamId, index) => teamId === actualOrder[index]);
    const pickedTopTwo = new Set([pick?.first, pick?.second].flatMap((teamId) => (teamId ? [canonicalTeamId(teamId)] : [])));
    const actualTopTwo = new Set(actualOrder.slice(0, 2));
    const topTwoCorrect = pickedTopTwo.size === 2 && [...actualTopTwo].every((teamId) => pickedTopTwo.has(teamId));
    const actualThird = actualOrder[2];
    const pickedThird = canonicalTeamId(pick?.third ?? "");
    const advancingThirdIds = new Set(draft.thirdPlaceAdvancers.map((teamId) => canonicalTeamId(teamId)));
    const firstPlaceCorrect = canonicalTeamId(pick?.first ?? "") === actualOrder[0];
    const thirdAdvancerCorrect =
      pickedThird === actualThird &&
      advancingThirdPlaceTeamIds.has(actualThird) &&
      advancingThirdIds.has(actualThird);
    const placementPoints = perfect ? 4 : topTwoCorrect ? 2 : firstPlaceCorrect ? 1 : 0;
    const points = placementPoints + (thirdAdvancerCorrect ? 1 : 0);

    return {
      group,
      actualOrder,
      pickedOrder,
      perfect,
      topTwoCorrect,
      firstPlaceCorrect,
      thirdAdvancerCorrect,
      points,
      possiblePoints: 4 + (advancingThirdPlaceTeamIds.has(actualThird) ? 1 : 0),
    };
  });
}

export function knockoutScoreDetails(draft: BracketDraft, results = completedKnockoutResults) {
  const winnersByStage = results.reduce(
    (acc, result) => {
      const stageWinners = acc[result.stage] ?? new Set<string>();
      stageWinners.add(canonicalTeamId(result.winnerTeamId));
      acc[result.stage] = stageWinners;
      return acc;
    },
    {} as Partial<Record<CompletedKnockoutResult["stage"], Set<string>>>,
  );
  const creditedByStage = {} as Partial<Record<CompletedKnockoutResult["stage"], Set<string>>>;

  return results.map((result) => {
    const pickedTeamId = canonicalTeamId(draft.knockoutPicks[result.matchId] ?? "");
    const advancedInRound = Boolean(pickedTeamId && winnersByStage[result.stage]?.has(pickedTeamId));
    const alreadyCredited = Boolean(pickedTeamId && creditedByStage[result.stage]?.has(pickedTeamId));
    const points = advancedInRound && !alreadyCredited ? stagePoints[result.stage] : 0;

    if (points > 0) {
      const creditedTeams = creditedByStage[result.stage] ?? new Set<string>();
      creditedTeams.add(pickedTeamId);
      creditedByStage[result.stage] = creditedTeams;
    }

    return {
      ...result,
      pickedTeamId,
      advancedInRound,
      points,
      possiblePoints: stagePoints[result.stage],
    };
  });
}

function scoreGroups(draft: BracketDraft) {
  let points = 0;
  let correctTopTwoGroups = 0;
  let perfectGroups = 0;
  let correctThirdAdvancers = 0;

  for (const detail of groupScoreDetails(draft)) {
    points += detail.points;
    if (detail.perfect) {
      perfectGroups += 1;
    } else if (detail.topTwoCorrect) {
      correctTopTwoGroups += 1;
    }
    if (detail.thirdAdvancerCorrect) {
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

export function scoreBracket(draft: BracketDraft, results = completedKnockoutResults) {
  const knockoutDetails = knockoutScoreDetails(draft, results);
  const correctPicks = knockoutDetails.filter((result) => result.points > 0);
  const knockoutPoints = knockoutDetails.reduce((total, result) => total + result.points, 0);
  const groupScore = scoreGroups(draft);

  return {
    points: groupScore.points + knockoutPoints,
    possiblePoints: groupScore.possiblePoints + knockoutDetails.reduce((total, result) => total + result.possiblePoints, 0),
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
