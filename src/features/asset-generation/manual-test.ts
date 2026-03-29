/**
 * @file manual-test.ts
 * @description Manual server-side TRELLIS batch runner for one user using the fixed five-at-a-time policy.
 * @module asset-generation
 */
import { generateAssetsForPendingConceptsForUser } from "@/features/asset-generation/server/asset-generation.server";

function printSummary(result: Awaited<ReturnType<typeof generateAssetsForPendingConceptsForUser>>) {
  console.log("Selected:", result.totalSelected);
  console.log("Claimed:", result.totalClaimed);
  console.log("Succeeded:", result.succeeded);
  console.log("Failed:", result.failed);
  console.log("Skipped:", result.skipped);
  console.log("First 3 results:", result.results.slice(0, 3));
}

async function main() {
  try {
    // ===== REPLACE THIS WITH YOUR INPUT =====
    // This script runs on the server in Node, not in the browser.
    // Use the local application user id that owns the concepts in MongoDB.
    const userId = "local-dev-user";

    const result = await generateAssetsForPendingConceptsForUser(userId);

    printSummary(result);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Manual asset-generation test failed:", error);
  }
}

void main();
