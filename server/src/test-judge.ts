import { judge } from "./judge.ts";

const LARP =
  "Honestly we're just leveraging synergies across the ecosystem to disrupt the " +
  "paradigm. It's a 10x AI-native, web3-first play. Trust me, everyone knows this " +
  "is the future. We're thought leaders driving massive value, full stop.";

const REAL =
  "We cut p95 latency from 800ms to 210ms by adding a Redis cache in front of the " +
  "Postgres read path and batching the three N+1 queries on the orders page. " +
  "Took about two weeks, shipped last Thursday.";

async function main() {
  for (const [label, text] of [
    ["LARP", LARP],
    ["REAL", REAL],
  ] as const) {
    const t0 = Date.now();
    const r = await judge(label, text);
    console.log(`${label} -> ${JSON.stringify(r)} (${Date.now() - t0}ms)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
