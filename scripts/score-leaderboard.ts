import { scoringWeights } from "../src/lib/bracket-engine";

async function main() {
  console.log("Leaderboard scoring weights:");
  console.log(scoringWeights);
  console.log("Connect Supabase actual results and submitted brackets to calculate live points.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
