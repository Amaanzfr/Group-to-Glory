import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dataUpdatedIso, fixtures, teams } from "../src/lib/tournament-data";

async function main() {
  const snapshot = {
    refreshedAt: new Date().toISOString(),
    source: process.env.SPORTS_API_KEY ? "sports-api-plus-public-sources" : "seeded-public-snapshot",
    previousSeedTime: dataUpdatedIso,
    teamCount: teams.length,
    fixtureCount: fixtures.length,
    teams,
    fixtures,
  };

  await writeFile(resolve("data/latest.json"), JSON.stringify(snapshot, null, 2));
  console.log(`Wrote data/latest.json with ${teams.length} teams and ${fixtures.length} fixtures.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
