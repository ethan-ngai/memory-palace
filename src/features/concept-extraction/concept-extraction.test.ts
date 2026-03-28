/**
 * @file concept-extraction.test.ts
 * @description Verifies pipeline orchestration across ingestion, cleanup, deduplication, and safe error handling.
 * @module concept-extraction
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Concept } from "@/features/concept-extraction/types";

const ingestSourceMock = vi.fn<(input: unknown) => Promise<string>>();
const extractConceptsWithModelMock = vi.fn<(text: string, input: unknown) => Promise<Concept[]>>();

vi.mock("@/features/concept-extraction/server/source-ingestion.server", () => ({
  ingestSource: ingestSourceMock,
}));

vi.mock("@/features/concept-extraction/server/model-extractor.server", () => ({
  extractConceptsWithModel: extractConceptsWithModelMock,
}));

describe("extractConceptsFromSource", () => {
  beforeEach(() => {
    ingestSourceMock.mockReset();
    extractConceptsWithModelMock.mockReset();
  });

  it("uses raw text ingestion and deduplicates concepts", async () => {
    ingestSourceMock.mockResolvedValue("Alpha concept\nBeta concept");
    extractConceptsWithModelMock.mockResolvedValue([
      { name: "Neuron", description: "A nerve cell." },
      { name: " neuron ", description: "Duplicate that should be removed." },
    ]);

    const { extractConceptsFromSource } =
      await import("@/features/concept-extraction/server/concept-extraction.server");
    const result = await extractConceptsFromSource({
      type: "text",
      content: "ignored by mock",
    });

    expect(ingestSourceMock).toHaveBeenCalledWith({
      type: "text",
      content: "ignored by mock",
    });
    expect(extractConceptsWithModelMock).toHaveBeenCalled();
    expect(result).toEqual([{ name: "Neuron", description: "A nerve cell." }]);
  });

  it("returns an empty array when cleaned content is not meaningful", async () => {
    ingestSourceMock.mockResolvedValue("  \n\t");

    const { extractConceptsFromSource } =
      await import("@/features/concept-extraction/server/concept-extraction.server");
    const result = await extractConceptsFromSource({
      type: "text",
      content: "ignored by mock",
    });

    expect(result).toEqual([]);
    expect(extractConceptsWithModelMock).not.toHaveBeenCalled();
  });

  it("passes PDF input through the ingestion layer", async () => {
    ingestSourceMock.mockResolvedValue("Photosynthesis converts light energy.");
    extractConceptsWithModelMock.mockResolvedValue([
      { name: "Photosynthesis", description: "Conversion of light into chemical energy." },
    ]);

    const { extractConceptsFromSource } =
      await import("@/features/concept-extraction/server/concept-extraction.server");

    await extractConceptsFromSource({
      type: "pdf",
      source: {
        kind: "url",
        value: "https://example.com/chapter.pdf",
      },
    });

    expect(ingestSourceMock).toHaveBeenCalledWith({
      type: "pdf",
      source: {
        kind: "url",
        value: "https://example.com/chapter.pdf",
      },
    });
  });
});
