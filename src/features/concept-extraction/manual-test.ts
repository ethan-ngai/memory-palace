/**
 * @file manual-test.ts
 * @description Manual Node-side script for testing concept extraction with pasted text input.
 * @module concept-extraction
 */
import { extractConceptsFromSource } from "./server/concept-extraction.server";
import { manualStudyText } from "./manual-study-text";
import type { Concept, ExtractionInput } from "./types";

function printSummary(concepts: Concept[]) {
  console.log("Total concepts:", concepts.length);
  console.log("First 3:", concepts.slice(0, 3));
}

async function main() {
  // These scripts run on the server in Node, not in the browser.
  // Text input goes straight to extraction with no scraping step.
  // Because this script runs outside the TanStack app runtime, it calls the
  // server implementation directly instead of the createServerFn wrapper.

  // ===== REPLACE THIS WITH YOUR INPUT =====
  const input: ExtractionInput = {
    type: "text",
    content: manualStudyText,
  };

  try {
    const concepts = await extractConceptsFromSource(input);

    printSummary(concepts);
    console.log(JSON.stringify(concepts, null, 2));
  } catch (err) {
    console.error("Test failed:", err);
  }
}

void main();
