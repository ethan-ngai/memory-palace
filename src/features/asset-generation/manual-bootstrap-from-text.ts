/**
 * @file manual-bootstrap-from-text.ts
 * @description Manual Node-side script that extracts concepts from text, persists them, generates metaphors, and optionally generates assets for one explicit user.
 * @module asset-generation
 */
import { generateAssetsForPendingConceptsForUser } from "@/features/asset-generation/server/asset-generation.server";
import { extractConceptsFromSource } from "@/features/concept-extraction/server/concept-extraction.server";
import { generateConceptMetaphorsForUser } from "@/features/concept-extraction/server/concept-metaphor.server";
import { persistConceptsForUser } from "@/features/concept-extraction/server/concept-persistence.server";

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

async function main() {
  try {
    // ===== REPLACE THESE WITH YOUR INPUTS =====
    const userId = "mitochondria-one-concept-user";
    const shouldGenerateAssets = true;
    const studyText = `
      Mitochondria are organelles that generate most of a cell's ATP, the molecule used to store
      and transfer energy. During cellular respiration, nutrients are broken down and electrons
      move through the electron transport chain in the inner mitochondrial membrane. The energy
      released by this process powers ATP synthase, an enzyme that produces ATP.
    `;

    const extractedConcepts = await extractConceptsFromSource({
      type: "text",
      content: studyText,
    });

    const selectedConcepts = extractedConcepts.slice(0, 1);

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
      batchSize: persisted.concepts.length,
      concurrency: 1,
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
