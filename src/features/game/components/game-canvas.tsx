/**
 * @file game-canvas.tsx
 * @description Renders the room-scoped Three.js placement viewer shell and coordinates room anchor imports with server-side placement data.
 * @module game
 */
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import "@/features/game/styles/anchor-tagger.css";
import type { RoomSummary } from "@/features/concept-extraction/types";
import {
  clearRoomObjects,
  getRoomAnchors,
  getRoomPlacements,
  importRoomAnchors,
  listBundledRooms,
  listViewerRooms,
} from "@/features/game/functions";
import type {
  BundledViewerRoom,
  GenerateRoomPlacementsResult,
  RoomAnchorSet,
  RoomPlacementInspection,
} from "@/features/game/types";

/**
 * Runtime methods exposed by the imperative Three.js viewer.
 * @description Keeps React responsible for server data and file inputs while the viewer remains focused on rendering.
 */
type RoomPlacementViewerController = {
  dispose: () => void;
  loadSceneFile: (file: File) => Promise<void>;
  renderPlacements: (placements: GenerateRoomPlacementsResult["placements"]) => Promise<void>;
  setAnchorSet: (anchorSet: RoomAnchorSet | null) => void;
  setOnPlacementInspect: (
    listener: ((placement: RoomPlacementInspection | null) => void) | null,
  ) => void;
};

/**
 * Returns a strongly typed DOM node and fails fast when the JSX shell is incomplete.
 * @param value - Ref target produced by React.
 * @param name - Human-readable element label for debugging.
 * @returns The resolved DOM node.
 * @remarks The imperative viewer expects a complete static shell, so missing refs should crash immediately rather than fail later in event handlers.
 */
function requireElement<T>(value: T | null, name: string) {
  if (!value) {
    throw new Error(`Missing room viewer element: ${name}`);
  }
  return value;
}

/**
 * Reads a user-selected JSON file into a parsed JavaScript value.
 * @param file - Browser file handle chosen from the anchor import input.
 * @returns Parsed JSON payload ready to be sent to the server for validation.
 * @remarks Parsing client-side allows the UI to reject malformed JSON early while still relying on the server for strict schema validation.
 */
async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}

/**
 * Renders the room placement viewer and wires it to the app-backed single-room placement APIs.
 * @param props - Optional refresh trigger supplied by the surrounding route after study-material imports succeed.
 * @returns SSR-safe viewer shell whose data-driven behavior is attached after hydration.
 */
export function GameCanvas(props: { placementRefreshToken?: number; roomRefreshToken?: number }) {
  const dragOverlayRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dropMessageRef = useRef<HTMLDivElement>(null);
  const loadingOverlayRef = useRef<HTMLDivElement>(null);
  const loadMessageRef = useRef<HTMLSpanElement>(null);
  const loadSubMessageRef = useRef<HTMLSpanElement>(null);
  const modeBadgeRef = useRef<HTMLDivElement>(null);
  const hudAnchorsRef = useRef<HTMLDivElement>(null);
  const filePointPillRef = useRef<HTMLDivElement>(null);
  const anchorCountPillRef = useRef<HTMLDivElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileLoadedRef = useRef<HTMLDivElement>(null);
  const btnPerfRef = useRef<HTMLButtonElement>(null);
  const pointCountStatRef = useRef<HTMLSpanElement>(null);
  const anchorListRef = useRef<HTMLDivElement>(null);
  const anchorsFileInputRef = useRef<HTMLInputElement>(null);

  const legacyAnchorLabelInputRef = useRef<HTMLInputElement>(null);
  const legacyAnchorSurfaceSelectRef = useRef<HTMLSelectElement>(null);
  const legacyBtnOrbitRef = useRef<HTMLButtonElement>(null);
  const legacyBtnPlaceRef = useRef<HTMLButtonElement>(null);
  const legacyBtnScatterRef = useRef<HTMLButtonElement>(null);
  const legacyBtnRerollRef = useRef<HTMLButtonElement>(null);
  const legacyBtnClearPropsRef = useRef<HTMLButtonElement>(null);
  const legacyBtnExportRef = useRef<HTMLButtonElement>(null);
  const legacyBtnClearAllRef = useRef<HTMLButtonElement>(null);
  const legacyBtnLoadPropRef = useRef<HTMLButtonElement>(null);
  const legacyTaggedCountStatRef = useRef<HTMLSpanElement>(null);
  const legacyPropCountInputRef = useRef<HTMLInputElement>(null);
  const legacyPropFileInputRef = useRef<HTMLInputElement>(null);
  const legacyPropLoadedRef = useRef<HTMLDivElement>(null);

  const controllerRef = useRef<RoomPlacementViewerController | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [bundledRooms, setBundledRooms] = useState<BundledViewerRoom[]>([]);
  const [selectedBundledRoomId, setSelectedBundledRoomId] = useState("");
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState("Loading the palace room...");
  const [placementSummary, setPlacementSummary] = useState<GenerateRoomPlacementsResult | null>(
    null,
  );
  const [selectedPlacement, setSelectedPlacement] = useState<RoomPlacementInspection | null>(null);

  useEffect(() => {
    let disposed = false;
    let dispose = () => {};

    void import("@/features/game/engine/anchor-tagger").then(({ createAnchorTagger }) => {
      if (disposed) {
        return;
      }

      const controller = createAnchorTagger({
        anchorCountPill: requireElement(anchorCountPillRef.current, "anchorCountPill"),
        anchorLabelInput: requireElement(
          legacyAnchorLabelInputRef.current,
          "legacyAnchorLabelInput",
        ),
        anchorList: requireElement(anchorListRef.current, "anchorList"),
        anchorSurfaceSelect: requireElement(
          legacyAnchorSurfaceSelectRef.current,
          "legacyAnchorSurfaceSelect",
        ),
        btnClearAll: requireElement(legacyBtnClearAllRef.current, "legacyBtnClearAll"),
        btnClearProps: requireElement(legacyBtnClearPropsRef.current, "legacyBtnClearProps"),
        btnExport: requireElement(legacyBtnExportRef.current, "legacyBtnExport"),
        btnLoadProp: requireElement(legacyBtnLoadPropRef.current, "legacyBtnLoadProp"),
        btnOrbit: requireElement(legacyBtnOrbitRef.current, "legacyBtnOrbit"),
        btnPerf: requireElement(btnPerfRef.current, "btnPerf"),
        btnPlace: requireElement(legacyBtnPlaceRef.current, "legacyBtnPlace"),
        btnReroll: requireElement(legacyBtnRerollRef.current, "legacyBtnReroll"),
        btnScatter: requireElement(legacyBtnScatterRef.current, "legacyBtnScatter"),
        dragOverlay: requireElement(dragOverlayRef.current, "dragOverlay"),
        dropMessage: requireElement(dropMessageRef.current, "dropMessage"),
        dropzone: requireElement(dropzoneRef.current, "dropzone"),
        fileInput: requireElement(fileInputRef.current, "fileInput"),
        fileLoaded: requireElement(fileLoadedRef.current, "fileLoaded"),
        filePointPill: requireElement(filePointPillRef.current, "filePointPill"),
        hudAnchors: requireElement(hudAnchorsRef.current, "hudAnchors"),
        loadMessage: requireElement(loadMessageRef.current, "loadMessage"),
        loadingOverlay: requireElement(loadingOverlayRef.current, "loadingOverlay"),
        loadSubMessage: requireElement(loadSubMessageRef.current, "loadSubMessage"),
        modeBadge: requireElement(modeBadgeRef.current, "modeBadge"),
        taggedCountStat: requireElement(legacyTaggedCountStatRef.current, "legacyTaggedCountStat"),
        pointCountStat: requireElement(pointCountStatRef.current, "pointCountStat"),
        propCountInput: requireElement(legacyPropCountInputRef.current, "legacyPropCountInput"),
        propFileInput: requireElement(legacyPropFileInputRef.current, "legacyPropFileInput"),
        propLoaded: requireElement(legacyPropLoadedRef.current, "legacyPropLoaded"),
        viewport: requireElement(viewportRef.current, "viewport"),
      }) as RoomPlacementViewerController;

      controller.setOnPlacementInspect((placement) => {
        setSelectedPlacement(placement);
      });
      controllerRef.current = controller;
      setViewerReady(true);
      dispose = () => {
        controller.setOnPlacementInspect(null);
        controller.dispose();
      };
    });

    return () => {
      disposed = true;
      controllerRef.current = null;
      setViewerReady(false);
      dispose();
    };
  }, []);

  useEffect(() => {
    let active = true;

    void Promise.all([listViewerRooms(), listBundledRooms()])
      .then(([loadedRooms, discoveredBundledRooms]) => {
        if (!active) {
          return;
        }

        setRooms(loadedRooms);
        setBundledRooms(discoveredBundledRooms);
        setSelectedBundledRoomId((current) => current || discoveredBundledRooms[0]?.id || "");
        setStatus(
          loadedRooms.length
            ? "Choose a bundled room or load a scene file, then review placements."
            : "No palace room exists yet. Import study material first so the MVP room is created.",
        );
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to load the palace room.";
        setStatus(message);
      });

    return () => {
      active = false;
    };
  }, [props.roomRefreshToken]);

  const selectedRoom = rooms[0] ?? null;
  const selectedRoomId = selectedRoom?.id ?? "";
  const selectedBundledRoom =
    bundledRooms.find((room) => room.id === selectedBundledRoomId) ?? bundledRooms[0] ?? null;

  /**
   * Reloads the active room's anchors and derived placements into the viewer.
   * @param nextStatus - Optional status copy to show before loading begins.
   * @remarks Centralizing this flow lets the page refresh placements on first load, manual refreshes, and per-asset generation updates.
   */
  async function syncActiveRoomPlacements(
    nextStatus = "Loading palace-room anchors and placements...",
  ) {
    if (!selectedRoomId || !controllerRef.current) {
      return null;
    }

    setIsBusy(true);
    setStatus(nextStatus);
    try {
      const [anchorSet, placements] = await Promise.all([
        getRoomAnchors({ data: { roomId: selectedRoomId } }),
        getRoomPlacements({ data: { roomId: selectedRoomId } }),
      ]);

      controllerRef.current.setAnchorSet(anchorSet);
      await controllerRef.current.renderPlacements(placements.placements);
      setPlacementSummary(placements);
      setStatus(
        anchorSet
          ? `Loaded ${placements.placements.length} placed object${placements.placements.length === 1 ? "" : "s"} for the palace room.`
          : "No anchors are ready for the palace room yet.",
      );
      return { anchorSet, placements };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load palace-room anchors and placements.";
      setStatus(message);
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  useEffect(() => {
    if (!viewerReady || !selectedRoomId || !controllerRef.current) {
      return;
    }

    let active = true;

    void (async () => {
      const result = await syncActiveRoomPlacements();
      if (!active || !result) {
        return;
      }
    })();

    return () => {
      active = false;
    };
  }, [selectedRoomId, viewerReady]);

  useEffect(() => {
    if (!viewerReady || !selectedRoomId || !controllerRef.current || !props.placementRefreshToken) {
      return;
    }

    let active = true;

    void (async () => {
      const result = await syncActiveRoomPlacements(
        "Loading newly generated objects into the palace room...",
      );
      if (!active || !result) {
        return;
      }
    })();

    return () => {
      active = false;
    };
  }, [props.placementRefreshToken, selectedRoomId, viewerReady]);

  useEffect(() => {
    if (!viewerReady || !selectedRoomId || !selectedBundledRoom || !controllerRef.current) {
      return;
    }

    let active = true;

    /**
     * Loads one prebundled public room and imports its matching anchor JSON into the current palace room.
     * @remarks Bundled rooms are defined by the public-file naming convention, so choosing a room should be enough to preload both scene and anchors.
     */
    async function loadBundledRoomSelection() {
      setIsBusy(true);
      setStatus(`Loading ${selectedBundledRoom.name}...`);

      try {
        const [sceneResponse, anchorResponse] = await Promise.all([
          fetch(selectedBundledRoom.sceneUrl),
          fetch(selectedBundledRoom.anchorUrl),
        ]);

        if (!sceneResponse.ok) {
          throw new Error(`Failed to load bundled scene: ${selectedBundledRoom.name}.`);
        }

        if (!anchorResponse.ok) {
          throw new Error(`Failed to load bundled anchors: ${selectedBundledRoom.name}.`);
        }

        const [sceneBlob, parsedAnchorSet] = await Promise.all([
          sceneResponse.blob(),
          anchorResponse.json() as Promise<unknown>,
        ]);

        const sceneExtension = selectedBundledRoom.sceneUrl.toLowerCase().endsWith(".ply")
          ? "ply"
          : "spz";
        const sceneFile = new File([sceneBlob], `${selectedBundledRoom.id}.${sceneExtension}`, {
          type: sceneExtension === "ply" ? "application/octet-stream" : "application/octet-stream",
        });

        const updatedRoom = await importRoomAnchors({
          data: {
            roomId: selectedRoomId,
            anchorSet: parsedAnchorSet,
          },
        });

        if (!active || !controllerRef.current) {
          return;
        }

        setRooms((current) =>
          current.map((room) => (room.id === updatedRoom.id ? updatedRoom : room)),
        );

        await controllerRef.current.loadSceneFile(sceneFile);
        await refreshPlacements();
        if (active) {
          setStatus(`${selectedBundledRoom.name} is loaded. Placements are ready to review.`);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Failed to preload bundled room assets.";
        setStatus(message);
        setIsBusy(false);
      }
    }

    void loadBundledRoomSelection();

    return () => {
      active = false;
    };
  }, [selectedBundledRoomId, selectedRoomId, viewerReady]);

  /**
   * Refreshes placements for the palace room.
   * @remarks Used after anchor imports and whenever the user wants a new randomized anchor subset for the same ready asset set.
   */
  async function refreshPlacements() {
    const result = await syncActiveRoomPlacements("Refreshing randomized placements...");
    if (result) {
      setStatus(`Refreshed ${result.placements.length} placement(s).`);
    }
  }

  /**
   * Imports one anchor JSON file for the palace room and immediately refreshes the placement view.
   * @param event - React file-input change event carrying the selected JSON file.
   * @remarks The server owns strict Lavender validation; the client only parses raw JSON and forwards the payload.
   */
  async function handleAnchorImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !selectedRoomId) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".json")) {
      setStatus("Only Lavender room anchor JSON files are supported.");
      return;
    }

    setIsBusy(true);
    setStatus(`Importing anchors from ${file.name}...`);
    try {
      const parsed = await readJsonFile(file);
      const updatedRoom = await importRoomAnchors({
        data: {
          roomId: selectedRoomId,
          anchorSet: parsed,
        },
      });

      setRooms((current) =>
        current.map((room) => (room.id === updatedRoom.id ? updatedRoom : room)),
      );
      await refreshPlacements();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import anchor JSON.";
      setStatus(message);
      setIsBusy(false);
    }
  }

  /**
   * Clears all concept-backed objects associated with the active room after explicit confirmation.
   * @remarks The room keeps its imported anchors and scene bundle, but removing the room concepts clears all currently placeable generated objects.
   */
  async function handleClearRoomObjects() {
    if (!selectedRoomId || isBusy) {
      return;
    }

    const confirmed = window.confirm(
      "Clear all objects for this room? This removes the room's imported concepts and generated objects.",
    );
    if (!confirmed) {
      return;
    }

    setIsBusy(true);
    setStatus("Clearing room objects...");
    setSelectedPlacement(null);
    try {
      const updatedRoom = await clearRoomObjects({
        data: {
          roomId: selectedRoomId,
        },
      });
      setRooms((current) =>
        current.map((room) => (room.id === updatedRoom.id ? updatedRoom : room)),
      );
      await refreshPlacements();
      setStatus("Cleared all room objects.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to clear room objects.";
      setStatus(message);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="anchor-tagger-shell">
      <div className="anchor-tagger-drag-overlay" ref={dragOverlayRef}>
        <div className="big">⬡</div>
        <div>DROP .SPZ OR .PLY FILE</div>
      </div>

      <header className="anchor-tagger-header panel">
        <h1>Memory Palace · Single-Room Viewer</h1>
        <div className="pill" ref={filePointPillRef}>
          No file loaded
        </div>
        <div className="pill live" ref={anchorCountPillRef} style={{ display: "none" }}>
          0 anchors imported
        </div>
      </header>

      <div className="anchor-tagger-workspace">
        <div className="anchor-tagger-viewport" ref={viewportRef}>
          <div className="drop-msg" ref={dropMessageRef}>
            <div className="big">⬡</div>
            <div>Drop a .spz or .ply file anywhere, or use the sidebar</div>
          </div>
          <div className="loading" ref={loadingOverlayRef}>
            <div className="spinner"></div>
            <span ref={loadMessageRef}>Loading...</span>
            <span ref={loadSubMessageRef}></span>
          </div>
          <div className="hud mode-badge" ref={modeBadgeRef}>
            VIEWER
          </div>
          <div className="hud hud-anchors" ref={hudAnchorsRef}></div>
          <div className="hud hud-hint">
            Orbit: <kbd>drag</kbd> · Pan: <kbd>right-drag</kbd> / <kbd>WASD</kbd> · Zoom:{" "}
            <kbd>pinch</kbd> / <kbd>scroll</kbd>
          </div>
          {selectedPlacement ? (
            <div aria-modal="true" className="placement-inspector" role="dialog">
              <button
                aria-label="Close object details"
                className="placement-inspector-close"
                onClick={() => setSelectedPlacement(null)}
                type="button"
              >
                ×
              </button>
              <div className="placement-inspector-eyebrow">Object Details</div>
              <h3>{selectedPlacement.conceptName}</h3>
              <div className="placement-inspector-section">
                <span className="placement-inspector-label">Represents</span>
                <p>{selectedPlacement.conceptName}</p>
              </div>
              <div className="placement-inspector-section">
                <span className="placement-inspector-label">Metaphor</span>
                <p>{selectedPlacement.metaphorObjectName ?? "No metaphor was generated."}</p>
              </div>
              <div className="placement-inspector-section">
                <span className="placement-inspector-label">Description</span>
                <p>{selectedPlacement.conceptDescription}</p>
              </div>
              {selectedPlacement.metaphorRationale ? (
                <div className="placement-inspector-section">
                  <span className="placement-inspector-label">Why this metaphor</span>
                  <p>{selectedPlacement.metaphorRationale}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="anchor-tagger-sidebar panel">
          <div className="sb">
            <h2>Room</h2>
            <div className="file-loaded viewer-status" style={{ display: "block" }}>
              {selectedRoom?.name ?? "No palace room yet"}
            </div>
            <p className="mini-label">Status</p>
            <div className="file-loaded viewer-status" style={{ display: "block" }}>
              {status}
            </div>
          </div>

          <div className="sb">
            <h2>Bundled Room</h2>
            <select
              aria-label="Bundled room"
              disabled={!bundledRooms.length || isBusy}
              onChange={(event) => setSelectedBundledRoomId(event.target.value)}
              value={selectedBundledRoom?.id ?? ""}
            >
              {bundledRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
            <p className="mini-label">Scene and anchor JSON preload together.</p>
          </div>

          <div className="sb">
            <h2>Scene File</h2>
            <div className="dropzone" ref={dropzoneRef}>
              <div className="dz-icon">⬡</div>
              <p>
                Click to browse or drop
                <br />
                <strong>.spz</strong> / <strong>.ply</strong> anywhere
              </p>
            </div>
            <input ref={fileInputRef} type="file" accept=".spz,.ply" />
            <div className="fmt-badges">
              <span className="fmt-badge spz">SPZ ✓</span>
              <span className="fmt-badge ply">PLY ✓</span>
            </div>
            <div ref={fileLoadedRef} className="file-loaded"></div>
          </div>

          <div className="sb">
            <h2>Anchors</h2>
            <button
              className="btn full"
              disabled={!selectedRoomId || isBusy}
              onClick={() => anchorsFileInputRef.current?.click()}
              type="button"
            >
              ↑ Import Lavender Anchor JSON
            </button>
            <input
              ref={anchorsFileInputRef}
              accept=".json,application/json"
              onChange={handleAnchorImport}
              type="file"
            />
            <div className="stats">
              <div>
                Anchors Ready:{" "}
                <span className="val g">{selectedRoom?.anchorCount?.toString() ?? "0"}</span>
              </div>
              <div>
                Updated:{" "}
                <span className="val">
                  {selectedRoom?.anchorSetImportedAt
                    ? new Date(selectedRoom.anchorSetImportedAt).toLocaleDateString()
                    : "—"}
                </span>
              </div>
            </div>
          </div>

          <div className="sb">
            <h2>Placements</h2>
            <button
              className="btn full perf"
              disabled={!selectedRoomId || isBusy}
              onClick={() => void refreshPlacements()}
              type="button"
            >
              ↻ Refresh Randomized Placements
            </button>
            <button ref={btnPerfRef} className="btn full perf active" type="button">
              ⚡ Performance Mode: On
            </button>
            <button
              className="btn full danger"
              disabled={!selectedRoomId || isBusy}
              onClick={() => void handleClearRoomObjects()}
              type="button"
            >
              Clear Room Objects
            </button>
            <div className="stats">
              <div>
                Placed: <span className="val g">{placementSummary?.placements.length ?? 0}</span>
              </div>
              <div>
                Ready Assets:{" "}
                <span className="val">{placementSummary?.totalReadyConcepts ?? 0}</span>
              </div>
            </div>
          </div>

          <div className="sb">
            <div className="stats">
              <div>
                Points:{" "}
                <span className="val" ref={pointCountStatRef}>
                  —
                </span>
              </div>
              <div>
                Unplaced:{" "}
                <span className="val">{placementSummary?.unplacedConceptIds.length ?? 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div aria-hidden="true" hidden>
        <div ref={anchorListRef}></div>
        <input ref={legacyAnchorLabelInputRef} type="text" />
        <select ref={legacyAnchorSurfaceSelectRef} defaultValue="surface">
          <option value="surface">surface</option>
        </select>
        <button ref={legacyBtnOrbitRef} type="button">
          Orbit
        </button>
        <button ref={legacyBtnPlaceRef} type="button">
          Place
        </button>
        <button ref={legacyBtnScatterRef} type="button">
          Scatter
        </button>
        <button ref={legacyBtnRerollRef} type="button">
          Reroll
        </button>
        <button ref={legacyBtnClearPropsRef} type="button">
          Clear props
        </button>
        <button ref={legacyBtnExportRef} type="button">
          Export
        </button>
        <button ref={legacyBtnClearAllRef} type="button">
          Clear all
        </button>
        <button ref={legacyBtnLoadPropRef} type="button">
          Load prop
        </button>
        <span ref={legacyTaggedCountStatRef}>0</span>
        <input ref={legacyPropCountInputRef} type="number" />
        <input ref={legacyPropFileInputRef} type="file" />
        <div ref={legacyPropLoadedRef}></div>
      </div>
    </section>
  );
}
