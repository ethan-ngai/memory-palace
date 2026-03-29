import { describe, expect, it } from "vitest";
import {
  SHARED_STYLE_BLOCK,
  buildAssetGenerationPrompt,
} from "@/features/asset-generation/server/prompt-builder.server";

describe("buildAssetGenerationPrompt", () => {
  it("builds a short object-first prompt with the shared style suffix when it fits", () => {
    const prompt = buildAssetGenerationPrompt({
      id: "concept-1",
      userId: "user-1",
      name: "Neuron",
      description: "Cell that transmits signals.",
      metaphor: {
        status: "ready",
        objectName: "glass neuron lantern",
        prompt: "a neuron lantern",
        rationale: "The lantern suggests signal transmission.",
        generatedAt: "2026-03-28T12:00:00.000Z",
      },
      asset: null,
    });

    expect(prompt).toBe("a neuron lantern, isolated single object, white background");
    expect(prompt).toContain(SHARED_STYLE_BLOCK);
  });

  it("falls back to the core object phrase when the styled prompt would be too long", () => {
    const prompt = buildAssetGenerationPrompt({
      id: "concept-1",
      userId: "user-1",
      name: "Neuron",
      description: "Cell that transmits signals.",
      metaphor: {
        status: "ready",
        objectName: "glass neuron lantern",
        prompt:
          "A glass neuron lantern with glowing branching filaments and layered metallic control fins.",
        rationale: "The lantern suggests signal transmission.",
        generatedAt: "2026-03-28T12:00:00.000Z",
      },
      asset: null,
    });

    expect(prompt).toBe(
      "A glass neuron lantern with glowing branching filaments and layered metallic control fins",
    );
    expect(prompt).not.toContain(SHARED_STYLE_BLOCK);
  });

  it("throws when the concept is missing a ready metaphor", () => {
    expect(() =>
      buildAssetGenerationPrompt({
        id: "concept-1",
        userId: "user-1",
        name: "Neuron",
        description: "Cell that transmits signals.",
        metaphor: null,
        asset: null,
      }),
    ).toThrow("Concept is missing a ready metaphor.");
  });

  it("throws when the metaphor exists but is not ready", () => {
    expect(() =>
      buildAssetGenerationPrompt({
        id: "concept-1",
        userId: "user-1",
        name: "Neuron",
        description: "Cell that transmits signals.",
        metaphor: {
          status: "failed",
          objectName: "glass neuron lantern",
          prompt: "A glass neuron lantern with glowing branching filaments.",
          rationale: "The lantern suggests signal transmission.",
          generatedAt: "2026-03-28T12:00:00.000Z",
          errorMessage: "generation failed",
        },
        asset: null,
      }),
    ).toThrow("Concept is missing a ready metaphor.");
  });
});
