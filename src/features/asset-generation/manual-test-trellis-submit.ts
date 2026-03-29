/**
 * @file manual-test-trellis-submit.ts
 * @description Manual server-side TRELLIS text-to-3D test using sample concept data instead of MongoDB.
 * @module asset-generation
 */
import { buildAssetGenerationPrompt } from "@/features/asset-generation/server/prompt-builder.server";
import { generateTrellisModel } from "@/features/asset-generation/server/trellis-client.server";
import type { AssetGenerationConceptRow } from "@/features/asset-generation/types";

/**
 * Runs one provider-only TRELLIS generation smoke test.
 * @returns A promise that resolves after the result or failure is printed.
 * @remarks This bypasses MongoDB so the live Gradio link can be verified independently of the rest of the pipeline.
 */
async function main() {
  try {
    const sampleConcept: AssetGenerationConceptRow = {
      id: "sample-concept",
      userId: "sample-user",
      name: "Mitochondria",
      description: "An organelle that produces most of a cell's ATP during cellular respiration.",
      metaphor: {
        status: "ready",
        objectName: "energy generator",
        prompt: "a compact energy generator",
        rationale: "Mitochondria turn nutrients into usable cellular energy.",
        generatedAt: new Date().toISOString(),
      },
      asset: null,
    };

    const prompt = buildAssetGenerationPrompt(sampleConcept);
    const result = await generateTrellisModel(prompt);

    console.log("Prompt:", prompt);
    console.log("Provider file URL:", result.providerFileUrl);
    console.log("Model URL:", result.modelUrl);
    console.log("MIME type:", result.mimeType);
    console.log("File extension:", result.fileExtension);
    console.log(JSON.stringify({ prompt, result }, null, 2));
  } catch (error) {
    console.error("Manual TRELLIS submit test failed:", error);
  }
}

void main();
