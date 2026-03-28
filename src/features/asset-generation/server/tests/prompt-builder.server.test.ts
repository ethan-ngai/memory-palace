import { describe, expect, it } from "vitest";
import {
  SHARED_STYLE_BLOCK,
  buildHunyuanPrompt,
} from "@/features/asset-generation/server/prompt-builder.server";

describe("buildHunyuanPrompt", () => {
  it("includes concept, metaphor, and the shared style block", () => {
    const prompt = buildHunyuanPrompt({
      id: "concept-1",
      userId: "user-1",
      name: "Neuron",
      description: "Cell that transmits signals.",
      metaphor: {
        status: "ready",
        objectName: "glass neuron lantern",
        prompt: "A glass neuron lantern with glowing branching filaments.",
        rationale: "The lantern suggests signal transmission.",
        generatedAt: "2026-03-28T12:00:00.000Z",
      },
      asset: null,
    });

    expect(prompt).toContain("Concept name: Neuron.");
    expect(prompt).toContain("Metaphor object: glass neuron lantern.");
    expect(prompt).toContain(SHARED_STYLE_BLOCK);
    expect(prompt).toContain("single central object only");
  });

  it("throws when the concept is missing a ready metaphor", () => {
    expect(() =>
      buildHunyuanPrompt({
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
      buildHunyuanPrompt({
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
