/**
 * @file manual-bootstrap-from-text.ts
 * @description Manual Node-side script that extracts concepts from text, persists them, generates metaphors, and optionally generates assets for one explicit user.
 * @module asset-generation
 */
import { generateAssetsForPendingConceptsForUser } from "@/features/asset-generation/server/asset-generation.server";
import { extractConceptsFromSource } from "@/features/concept-extraction/server/concept-extraction.server";
import { generateConceptMetaphorsForUser } from "@/features/concept-extraction/server/concept-metaphor.server";
import { persistConceptsForUser } from "@/features/concept-extraction/server/concept-persistence.server";
import type { AssetGenerationProgressEvent } from "@/features/asset-generation/types";

function printMetaphorTable(
  concepts: Array<{
    name: string;
    metaphor: {
      objectName: string;
      prompt: string;
      rationale: string;
    } | null;
  }>,
) {
  console.table(
    concepts.map((concept) => ({
      concept: concept.name,
      object: concept.metaphor?.objectName ?? "",
      prompt: concept.metaphor?.prompt ?? "",
      rationale: concept.metaphor?.rationale ?? "",
    })),
  );
}

/**
 * Prints one concise progress line for the local asset-generation batch.
 * @param event - Current batch progress event emitted by the server batch runner.
 * @returns Nothing.
 * @remarks The manual script runs without a UI, so streaming progress prevents long TRELLIS requests from looking like a frozen process.
 */
function printAssetProgress(event: AssetGenerationProgressEvent) {
  const timestamp = new Date().toISOString();
  const prefix = `[${event.conceptIndex}/${event.totalConcepts}] ${event.conceptName}`;
  const jobSuffix = event.jobId ? ` | jobId=${event.jobId}` : "";
  const objectSuffix = event.objectName ? ` | object=${event.objectName}` : "";
  const promptSuffix = event.prompt ? ` | prompt=${event.prompt}` : "";

  if (event.phase === "selected") {
    console.log(`${timestamp} ${prefix} | selected${jobSuffix}${objectSuffix}${promptSuffix}`);
    return;
  }

  if (event.phase === "started") {
    console.log(`${timestamp} ${prefix} | generating${jobSuffix}${objectSuffix}${promptSuffix}`);
    return;
  }

  if (event.phase === "succeeded") {
    console.log(
      `${timestamp} ${prefix} | succeeded${jobSuffix} | assetUrl=${event.assetUrl ?? ""}`,
    );
    return;
  }

  if (event.phase === "skipped") {
    console.log(`${timestamp} ${prefix} | skipped${jobSuffix}`);
    return;
  }

  console.log(
    `${timestamp} ${prefix} | failed${jobSuffix} | error=${event.error ?? "Unknown error."}`,
  );
}

async function main() {
  try {
    // ===== REPLACE THESE WITH YOUR INPUTS =====
    const userId = "balls-bins-all-concepts-user";
    const shouldGenerateAssets = true;
    const studyText = `
      Mitochondria are organelles that generate ATP for the cell. The electron transport chain releases energy that helps power ATP synthase. ATP synthase then produces ATP, which cells use as an energy source.

    `;

    const extractedConcepts = await extractConceptsFromSource({
      type: "text",
      content: studyText,
    });

    const selectedConcepts = extractedConcepts;

    console.log("Extracted concepts:", extractedConcepts.length);
    console.log("Selected concepts for pipeline:", selectedConcepts);

    const persisted = await persistConceptsForUser(userId, {
      concepts: selectedConcepts,
    });

    console.log("Persisted concepts:", persisted.concepts.length);
    console.log(
      "Persisted concept ids:",
      persisted.concepts.map((concept) => concept.id),
    );

    const metaphors = await generateConceptMetaphorsForUser(userId, {
      conceptIds: persisted.concepts.map((concept) => concept.id),
    });

    console.log("Metaphors ready:", metaphors.concepts.length);
    console.log(
      "First ready metaphor:",
      metaphors.concepts[0]
        ? {
            id: metaphors.concepts[0].id,
            name: metaphors.concepts[0].name,
            metaphor: metaphors.concepts[0].metaphor,
          }
        : null,
    );
    printMetaphorTable(
      metaphors.concepts.map((concept) => ({
        name: concept.name,
        metaphor: concept.metaphor,
      })),
    );

    if (!shouldGenerateAssets) {
      console.log(
        JSON.stringify({ extractedConcepts, selectedConcepts, persisted, metaphors }, null, 2),
      );
      return;
    }

    const assets = await generateAssetsForPendingConceptsForUser(userId, {
      onProgress: printAssetProgress,
    });

    console.log("Asset batch summary:", assets);
    console.log(
      JSON.stringify(
        { extractedConcepts, selectedConcepts, persisted, metaphors, assets },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Manual bootstrap test failed:", error);
  }
}

void main();
