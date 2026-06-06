import type { BracketDraft, GroupId, GroupPick, Team } from "./types";
import { groups } from "./tournament-data";

export const groupIds = Object.keys(groups) as GroupId[];

export const scoringWeights = {
  groupExact: 1,
  groupPartial: 0.5,
  roundOf32: 2,
  roundOf16: 4,
  quarterfinal: 8,
  semifinal: 16,
  final: 32,
};

export const knockoutRounds = [
  { key: "r32", label: "Round of 32", points: scoringWeights.roundOf32 },
  { key: "r16", label: "Round of 16", points: scoringWeights.roundOf16 },
  { key: "qf", label: "Quarterfinals", points: scoringWeights.quarterfinal },
  { key: "sf", label: "Semifinals", points: scoringWeights.semifinal },
  { key: "final", label: "Final", points: scoringWeights.final },
] as const;

export const emptyGroupPicks = (): Record<GroupId, GroupPick> =>
  groupIds.reduce(
    (acc, group) => ({
      ...acc,
      [group]: { group },
    }),
    {} as Record<GroupId, GroupPick>,
  );

export const emptyDraft = (): BracketDraft => ({
  groupPicks: emptyGroupPicks(),
  thirdPlaceAdvancers: [],
  knockoutPicks: {},
});

export function groupTeams(group: GroupId, teams: Team[]) {
  return teams.filter((team) => team.group === group);
}

export function canBuildBracket(draft: BracketDraft) {
  const groupsComplete = groupIds.every((group) => {
    const pick = draft.groupPicks[group];
    return pick.first && pick.second && pick.third && pick.fourth;
  });
  return groupsComplete && draft.thirdPlaceAdvancers.length === 8;
}

const thirdSlots = [
  { matchId: "m74", allowed: ["A", "B", "C", "D", "F"] },
  { matchId: "m77", allowed: ["C", "D", "F", "G", "H"] },
  { matchId: "m79", allowed: ["C", "E", "F", "H", "I"] },
  { matchId: "m80", allowed: ["E", "H", "I", "J", "K"] },
  { matchId: "m81", allowed: ["B", "E", "F", "I", "J"] },
  { matchId: "m82", allowed: ["A", "E", "H", "I", "J"] },
  { matchId: "m85", allowed: ["E", "F", "G", "I", "J"] },
  { matchId: "m87", allowed: ["D", "E", "I", "J", "L"] },
];

export function allocateThirdPlaceTeams(draft: BracketDraft, teams: Team[]) {
  const selected = draft.thirdPlaceAdvancers
    .map((teamId) => teams.find((team) => team.id === teamId))
    .filter(Boolean) as Team[];
  const remaining = [...selected];
  const allocation: Record<string, Team> = {};

  for (const slot of thirdSlots) {
    const index = remaining.findIndex((team) => slot.allowed.includes(team.group));
    const [team] = remaining.splice(index >= 0 ? index : 0, 1);
    if (team) allocation[slot.matchId] = team;
  }

  return allocation;
}

export function firstRoundMatches(draft: BracketDraft, teams: Team[]) {
  const byId = (id?: string) => teams.find((team) => team.id === id);
  const pick = (group: GroupId, slot: "first" | "second" | "third") => byId(draft.groupPicks[group]?.[slot]);
  const third = allocateThirdPlaceTeams(draft, teams);

  return [
    { id: "m73", label: "Match 73", date: "Sun 28 Jun", venue: "Los Angeles Stadium", home: pick("A", "second"), away: pick("B", "second") },
    { id: "m74", label: "Match 74", date: "Mon 29 Jun", venue: "Boston Stadium", home: pick("E", "first"), away: third["m74"] },
    { id: "m75", label: "Match 75", date: "Mon 29 Jun", venue: "Estadio Monterrey", home: pick("F", "first"), away: pick("C", "second") },
    { id: "m76", label: "Match 76", date: "Mon 29 Jun", venue: "Houston Stadium", home: pick("C", "first"), away: pick("F", "second") },
    { id: "m77", label: "Match 77", date: "Tue 30 Jun", venue: "New York New Jersey Stadium", home: pick("I", "first"), away: third["m77"] },
    { id: "m78", label: "Match 78", date: "Tue 30 Jun", venue: "Dallas Stadium", home: pick("E", "second"), away: pick("I", "second") },
    { id: "m79", label: "Match 79", date: "Tue 30 Jun", venue: "Mexico City Stadium", home: pick("A", "first"), away: third["m79"] },
    { id: "m80", label: "Match 80", date: "Wed 1 Jul", venue: "Atlanta Stadium", home: pick("L", "first"), away: third["m80"] },
    { id: "m81", label: "Match 81", date: "Wed 1 Jul", venue: "San Francisco Bay Area Stadium", home: pick("D", "first"), away: third["m81"] },
    { id: "m82", label: "Match 82", date: "Wed 1 Jul", venue: "Seattle Stadium", home: pick("G", "first"), away: third["m82"] },
    { id: "m83", label: "Match 83", date: "Thu 2 Jul", venue: "Toronto Stadium", home: pick("K", "second"), away: pick("L", "second") },
    { id: "m84", label: "Match 84", date: "Thu 2 Jul", venue: "Los Angeles Stadium", home: pick("H", "first"), away: pick("J", "second") },
    { id: "m85", label: "Match 85", date: "Thu 2 Jul", venue: "BC Place Vancouver", home: pick("B", "first"), away: third["m85"] },
    { id: "m86", label: "Match 86", date: "Fri 3 Jul", venue: "Miami Stadium", home: pick("J", "first"), away: pick("H", "second") },
    { id: "m87", label: "Match 87", date: "Fri 3 Jul", venue: "Kansas City Stadium", home: pick("K", "first"), away: third["m87"] },
    { id: "m88", label: "Match 88", date: "Fri 3 Jul", venue: "Dallas Stadium", home: pick("D", "second"), away: pick("G", "second") },
  ];
}

export function draftChampion(draft: BracketDraft) {
  return draft.knockoutPicks.m104;
}
