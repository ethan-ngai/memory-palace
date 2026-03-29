// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudyMaterialImporter } from "@/features/concept-extraction/components/study-material-importer";

const { generateConceptAssets, extractConcepts, generateConceptMetaphors, persistConcepts } =
  vi.hoisted(() => ({
    generateConceptAssets: vi.fn(),
    extractConcepts: vi.fn(),
    generateConceptMetaphors: vi.fn(),
    persistConcepts: vi.fn(),
  }));

vi.mock("@/features/asset-generation/functions", () => ({
  generateConceptAssets,
}));

vi.mock("@/features/concept-extraction/functions", () => ({
  extractConcepts,
  generateConceptMetaphors,
  persistConcepts,
}));

describe("StudyMaterialImporter", () => {
  beforeEach(() => {
    extractConcepts.mockResolvedValue([
      { name: "Neuron", description: "Signal cell" },
      { name: "Synapse", description: "Connection point" },
    ]);
    persistConcepts.mockResolvedValue({
      concepts: [
        {
          id: "concept-1",
          userId: "user-1",
          name: "Neuron",
          description: "Signal cell",
          normalizedName: "neuron",
          room: { roomId: "room-1", name: "Science", slug: "science" },
          metaphor: null,
          embedding: null,
          asset: null,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
        },
        {
          id: "concept-2",
          userId: "user-1",
          name: "Synapse",
          description: "Connection point",
          normalizedName: "synapse",
          room: { roomId: "room-1", name: "Science", slug: "science" },
          metaphor: null,
          embedding: null,
          asset: null,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
        },
      ],
      rooms: [
        {
          id: "room-1",
          userId: "user-1",
          name: "Science",
          slug: "science",
          description: "STEM concepts",
          conceptCount: 2,
          anchorSetImportedAt: null,
          anchorCount: 0,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
        },
      ],
    });
    generateConceptMetaphors.mockResolvedValue({
      concepts: [
        {
          id: "concept-1",
          metaphor: {
            status: "ready",
            objectName: "Battery",
            prompt: "a battery",
            rationale: "Energy storage object",
            generatedAt: "2026-03-29T00:00:00.000Z",
          },
        },
      ],
    });
    generateConceptAssets.mockResolvedValue({
      totalRequested: 1,
      totalClaimed: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      results: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("extracts concepts from pasted text and persists them into the single room", async () => {
    const onImported = vi.fn();
    const onPlacementReady = vi.fn();
    render(<StudyMaterialImporter onImported={onImported} onPlacementReady={onPlacementReady} />);

    fireEvent.change(screen.getByPlaceholderText(/Paste lecture notes/i), {
      target: {
        value: "Neuron and synapse notes",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import Material/i }));

    await waitFor(() => {
      expect(extractConcepts).toHaveBeenCalledWith({
        data: {
          type: "text",
          content: "Neuron and synapse notes",
        },
      });
    });

    expect(persistConcepts).toHaveBeenCalledWith({
      data: {
        concepts: [
          { name: "Neuron", description: "Signal cell" },
          { name: "Synapse", description: "Connection point" },
        ],
      },
    });

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith();
    });
    expect(onPlacementReady).toHaveBeenCalledTimes(2);

    expect(generateConceptMetaphors).toHaveBeenNthCalledWith(1, {
      data: {
        conceptIds: ["concept-1"],
      },
    });
    expect(generateConceptMetaphors).toHaveBeenNthCalledWith(2, {
      data: {
        conceptIds: ["concept-2"],
      },
    });
    expect(generateConceptAssets).toHaveBeenNthCalledWith(1, {
      data: {
        conceptIds: ["concept-1"],
      },
    });
    expect(generateConceptAssets).toHaveBeenNthCalledWith(2, {
      data: {
        conceptIds: ["concept-2"],
      },
    });

    expect(
      screen.getByText(
        /Added 2 concepts to Science, generated their objects, and refreshed the viewer/i,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Science")).toBeTruthy();
  });

  it("switches import modes when a different source is selected", () => {
    render(<StudyMaterialImporter />);

    expect(screen.getByPlaceholderText(/Paste lecture notes/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /PDF URL/i }));
    expect(screen.getByPlaceholderText(/chapter-3\.pdf/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /PDF Upload/i }));
    expect(screen.getByText(/Choose a local PDF/i)).toBeTruthy();
  });
});
