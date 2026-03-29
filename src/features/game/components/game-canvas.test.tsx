// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameCanvas } from "@/features/game/components/game-canvas";

const { listViewerRooms, listBundledRooms, getRoomAnchors, getRoomPlacements, importRoomAnchors } =
  vi.hoisted(() => ({
    listViewerRooms: vi.fn(),
    listBundledRooms: vi.fn(),
    getRoomAnchors: vi.fn(),
    getRoomPlacements: vi.fn(),
    importRoomAnchors: vi.fn(),
  }));

const { createAnchorTagger, placementInspectListenerRef } = vi.hoisted(() => {
  const placementInspectListenerRef: {
    current: ((placement: any) => void) | null;
  } = { current: null };

  return {
    createAnchorTagger: vi.fn(() => ({
      dispose: vi.fn(),
      loadSceneFile: vi.fn(async () => {}),
      renderPlacements: vi.fn(async () => {}),
      setAnchorSet: vi.fn(),
      setOnPlacementInspect: vi.fn((listener: ((placement: any) => void) | null) => {
        placementInspectListenerRef.current = listener;
      }),
    })),
    placementInspectListenerRef,
  };
});

vi.mock("@/features/game/functions", () => ({
  listViewerRooms,
  listBundledRooms,
  getRoomAnchors,
  getRoomPlacements,
  importRoomAnchors,
}));

vi.mock("@/features/game/engine/anchor-tagger", () => ({
  createAnchorTagger,
}));

describe("GameCanvas", () => {
  beforeEach(() => {
    listViewerRooms.mockResolvedValue([
      {
        id: "room-1",
        userId: "user-1",
        name: "Science",
        slug: "science",
        description: "STEM",
        conceptCount: 2,
        anchorSetImportedAt: null,
        anchorCount: 0,
        createdAt: "2026-03-29T00:00:00.000Z",
        updatedAt: "2026-03-29T00:00:00.000Z",
      },
    ]);
    listBundledRooms.mockResolvedValue([]);
    getRoomAnchors.mockResolvedValue(null);
    getRoomPlacements.mockResolvedValue({
      roomId: "room-1",
      anchorSetCreated: "",
      totalAnchors: 0,
      totalReadyConcepts: 0,
      placements: [],
      unplacedConceptIds: [],
    });
    importRoomAnchors.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the single-room viewer controls without exposing anchor editing actions", async () => {
    render(<GameCanvas />);

    await waitFor(() => {
      expect(listViewerRooms).toHaveBeenCalled();
    });
    expect(listBundledRooms).toHaveBeenCalled();

    expect(screen.getByText(/Memory Palace .* Single-Room Viewer/i)).toBeTruthy();
    expect(screen.getByLabelText(/Bundled room/i)).toBeTruthy();
    expect(screen.getByText("Scene File")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Import Lavender Anchor JSON/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Refresh Randomized Placements/i })).toBeTruthy();
    expect(screen.queryByLabelText(/Select room/i)).toBeNull();

    expect(screen.queryByText(/Tag Settings/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Scatter/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Re-roll/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Export anchors\.json/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Clear all anchors/i })).toBeNull();
  });

  it("refreshes placements when a new object becomes ready during import", async () => {
    const { rerender } = render(<GameCanvas placementRefreshToken={0} />);

    await waitFor(() => {
      expect(getRoomPlacements).toHaveBeenCalledTimes(1);
    });

    rerender(<GameCanvas placementRefreshToken={1} />);

    await waitFor(() => {
      expect(getRoomPlacements).toHaveBeenCalledTimes(2);
    });
  });

  it("shows and closes the object details popup after a placement click", async () => {
    render(<GameCanvas />);

    await waitFor(() => {
      expect(createAnchorTagger).toHaveBeenCalled();
    });

    await act(async () => {
      placementInspectListenerRef.current?.({
        anchorId: 1,
        conceptId: "concept-1",
        conceptName: "Mitochondria",
        conceptDescription: "Energy-producing organelle.",
        metaphorObjectName: "Battery",
        metaphorRationale: "It stores and releases energy for the cell.",
        label: "Anchor 1",
        surface: "surface",
      });
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("Mitochondria");
    expect(dialog.textContent).toContain("Battery");
    fireEvent.click(screen.getByRole("button", { name: /Close object details/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
