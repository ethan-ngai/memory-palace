/**
 * @file study-material-importer.tsx
 * @description User-facing workflow for importing study materials, extracting concepts, and persisting them into the single MVP room.
 * @module concept-extraction
 */
import { useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { generateConceptAssets } from "@/features/asset-generation/functions";
import {
  extractConcepts,
  generateConceptMetaphors,
  persistConcepts,
} from "@/features/concept-extraction/functions";
import type { RoomSummary } from "@/features/concept-extraction/types";

/**
 * Source modes supported by the study-material import form.
 * @description Keeps the browser UI constrained to flows the user can reasonably provide from a route-level form.
 */
type StudyMaterialMode = "text" | "pdf-url" | "pdf-file";

/**
 * User-visible generation stage shown during the post-import object pipeline.
 * @description Keeps stage-specific progress copy explicit so the UI can explain whether it is generating metaphors or 3D assets.
 */
type GenerationStage = "idle" | "metaphors" | "assets";

/**
 * Progress snapshot for the staged concept-to-object generation workflow.
 * @description Stores completed counts and timing samples so the importer can show `n/N` progress and a simple ETA.
 */
type GenerationProgress = {
  stage: GenerationStage;
  completed: number;
  total: number;
  etaMs: number | null;
};

/**
 * Formats one duration in milliseconds into short user-facing text.
 * @param ms - Remaining duration estimate in milliseconds.
 * @returns Compact text such as `42s` or `2m 15s`.
 * @remarks The import UI only needs a fast estimate, not high-precision stopwatch formatting.
 */
function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

/**
 * Computes a simple remaining-time estimate from completed item durations.
 * @param durationsMs - Durations for already completed items in the current stage.
 * @param total - Total item count in the current stage.
 * @returns Remaining-time estimate in milliseconds, or null before any item has completed.
 * @remarks The first completed item seeds the estimate and later items refine it through a rolling average.
 */
function estimateRemainingMs(durationsMs: number[], total: number) {
  if (!durationsMs.length) {
    return null;
  }

  const averageMs = durationsMs.reduce((sum, value) => sum + value, 0) / durationsMs.length;
  return Math.max(0, Math.round(averageMs * (total - durationsMs.length)));
}

/**
 * Props for the study-material import workflow component.
 * @description The route owns follow-on behavior such as refreshing the viewer, while this component owns the import pipeline UI.
 */
export interface StudyMaterialImporterProps {
  onImported?: () => void;
  onPlacementReady?: () => void;
}

/**
 * Returns the segmented-control styling for one study-material mode button.
 * @param isActive - Whether the button represents the currently selected input mode.
 * @returns Tailwind-compatible class list for the mode switch control.
 * @remarks Keeping this styling centralized avoids repeating long visual recipes across the three mode buttons.
 */
function getModeButtonClassName(isActive: boolean) {
  return isActive
    ? "rounded-full border border-[rgba(94,106,210,0.34)] bg-[linear-gradient(180deg,rgba(104,114,217,0.24),rgba(94,106,210,0.14))] px-4 py-2 text-sm font-medium text-[var(--foreground)] shadow-[0_0_0_1px_rgba(94,106,210,0.16),0_12px_28px_rgba(94,106,210,0.14)] transition duration-200 ease-out"
    : "rounded-full border border-transparent bg-transparent px-4 py-2 text-sm font-medium text-[var(--foreground-muted)] transition duration-200 ease-out hover:text-[var(--foreground)]";
}

/**
 * Converts one uploaded PDF into the base64 source shape expected by the concept-extraction server API.
 * @param file - Browser file chosen by the user.
 * @returns Raw base64 document contents without a data URL prefix.
 * @remarks The server contract is JSON-only, so uploaded browser files need one explicit serialization step before crossing the RPC boundary.
 */
async function readPdfFileAsBase64(file: File) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Renders the end-to-end study-material import workflow for populating the single MVP room from extracted concepts.
 * @param props - Optional callback used to refresh room-based UI after persistence succeeds.
 * @returns A route-friendly importer panel with text and PDF submission modes.
 */
export function StudyMaterialImporter(props: StudyMaterialImporterProps) {
  const [mode, setMode] = useState<StudyMaterialMode>("text");
  const [textContent, setTextContent] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState(
    "Paste study text or provide a PDF to populate your palace room.",
  );
  const [createdRooms, setCreatedRooms] = useState<RoomSummary[]>([]);
  const [lastConceptCount, setLastConceptCount] = useState(0);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress>({
    stage: "idle",
    completed: 0,
    total: 0,
    etaMs: null,
  });

  /**
   * Tracks the current PDF file chosen from the browser file input.
   * @param event - Browser change event carrying the latest selected file.
   * @remarks The file stays local until submit so users can switch modes without immediately triggering extraction work.
   */
  function handlePdfFileChange(event: ChangeEvent<HTMLInputElement>) {
    setPdfFile(event.target.files?.[0] ?? null);
  }

  /**
   * Notifies the surrounding route that at least one new placeable asset is ready.
   * @remarks Asset generation completes one concept at a time, so the viewer can refresh placements incrementally instead of waiting for the entire batch.
   */
  function notifyPlacementReady() {
    props.onPlacementReady?.();
  }

  /**
   * Runs extraction and persistence for the currently selected material source.
   * @remarks The viewer can only place concepts whose generated assets are ready, so the import flow also triggers metaphor and asset generation before refreshing the viewer.
   */
  async function handleSubmit() {
    setIsSubmitting(true);
    setStatus("Extracting concepts from the supplied study material...");

    try {
      const extractionInput =
        mode === "text"
          ? {
              type: "text" as const,
              content: textContent,
            }
          : mode === "pdf-url"
            ? {
                type: "pdf" as const,
                source: {
                  kind: "url" as const,
                  value: pdfUrl,
                },
              }
            : {
                type: "pdf" as const,
                source: {
                  kind: "base64" as const,
                  value: await readPdfFileAsBase64(
                    pdfFile ?? new File([], "missing.pdf", { type: "application/pdf" }),
                  ),
                },
              };

      if (mode === "text" && !textContent.trim()) {
        throw new Error("Paste some study text before importing.");
      }

      if (mode === "pdf-url" && !pdfUrl.trim()) {
        throw new Error("Enter a PDF URL before importing.");
      }

      if (mode === "pdf-file" && !pdfFile) {
        throw new Error("Choose a PDF file before importing.");
      }

      const concepts = await extractConcepts({
        data: extractionInput,
      });

      setLastConceptCount(concepts.length);
      if (!concepts.length) {
        setCreatedRooms([]);
        setStatus(
          "No study-worthy concepts were extracted, so nothing was added to the palace room.",
        );
        return;
      }

      setStatus(
        `Persisting ${concepts.length} extracted concept${concepts.length === 1 ? "" : "s"} into the palace room...`,
      );
      const persisted = await persistConcepts({
        data: {
          concepts,
        },
      });

      setCreatedRooms(persisted.rooms);
      const conceptIds = persisted.concepts.map((concept) => concept.id);
      const metaphorDurations: number[] = [];
      const assetDurations: number[] = [];

      setGenerationProgress({
        stage: "metaphors",
        completed: 0,
        total: conceptIds.length,
        etaMs: null,
      });

      for (const [index, concept] of persisted.concepts.entries()) {
        const startedAt = performance.now();
        setStatus(`Generating metaphor ${index + 1}/${conceptIds.length} for ${concept.name}...`);
        const metaphorResult = await generateConceptMetaphors({
          data: {
            conceptIds: [concept.id],
          },
        });
        const elapsedMs = performance.now() - startedAt;
        metaphorDurations.push(elapsedMs);
        console.info("[study-material-importer] Metaphor generation finished.", {
          conceptId: concept.id,
          conceptName: concept.name,
          completed: index + 1,
          total: conceptIds.length,
          metaphor: metaphorResult.concepts[0]?.metaphor,
          elapsedMs: Math.round(elapsedMs),
        });
        setGenerationProgress({
          stage: "metaphors",
          completed: index + 1,
          total: conceptIds.length,
          etaMs: estimateRemainingMs(metaphorDurations, conceptIds.length),
        });
      }

      setGenerationProgress({
        stage: "assets",
        completed: 0,
        total: conceptIds.length,
        etaMs: null,
      });

      for (const [index, concept] of persisted.concepts.entries()) {
        const startedAt = performance.now();
        setStatus(`Generating 3D object ${index + 1}/${conceptIds.length} for ${concept.name}...`);
        const assetResult = await generateConceptAssets({
          data: {
            conceptIds: [concept.id],
          },
        });
        const elapsedMs = performance.now() - startedAt;
        assetDurations.push(elapsedMs);
        console.info("[study-material-importer] Asset generation finished.", {
          conceptId: concept.id,
          conceptName: concept.name,
          completed: index + 1,
          total: conceptIds.length,
          result: assetResult.results[0],
          elapsedMs: Math.round(elapsedMs),
        });
        notifyPlacementReady();
        setGenerationProgress({
          stage: "assets",
          completed: index + 1,
          total: conceptIds.length,
          etaMs: estimateRemainingMs(assetDurations, conceptIds.length),
        });
      }

      setStatus(
        `Added ${concepts.length} concept${concepts.length === 1 ? "" : "s"} to ${persisted.rooms[0]?.name ?? "the palace room"}, generated their objects, and refreshed the viewer.`,
      );
      setGenerationProgress({
        stage: "idle",
        completed: conceptIds.length,
        total: conceptIds.length,
        etaMs: 0,
      });
      props.onImported?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Study material import failed.";
      setStatus(message);
      setGenerationProgress((current) => ({ ...current, etaMs: null }));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="surface-spotlight rounded-[30px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_28px_80px_rgba(0,0,0,0.3)] backdrop-blur-xl md:p-10">
      <div className="max-w-3xl">
        <div className="text-xs font-medium uppercase tracking-[0.28em] text-[var(--accent-bright)]">
          Study Material Import
        </div>
        <h2 className="text-gradient mt-5 text-3xl font-semibold tracking-tight md:text-4xl">
          Import study material
        </h2>
        <p className="mt-4 text-sm leading-7 text-[var(--foreground-muted)]">
          Paste text, provide a PDF URL, or upload a PDF. The app will extract concepts and add them
          to the single MVP palace room.
        </p>
      </div>

      <div
        aria-label="Study material source"
        className="mt-8 inline-flex flex-wrap items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] p-1 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]"
        role="tablist"
      >
        <button
          aria-selected={mode === "text"}
          className={getModeButtonClassName(mode === "text")}
          onClick={() => setMode("text")}
          type="button"
        >
          Paste Text
        </button>
        <button
          aria-selected={mode === "pdf-url"}
          className={getModeButtonClassName(mode === "pdf-url")}
          onClick={() => setMode("pdf-url")}
          type="button"
        >
          PDF URL
        </button>
        <button
          aria-selected={mode === "pdf-file"}
          className={getModeButtonClassName(mode === "pdf-file")}
          onClick={() => setMode("pdf-file")}
          type="button"
        >
          PDF Upload
        </button>
      </div>

      {mode === "text" ? (
        <label className="mt-8 grid gap-3">
          <span className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--foreground-subtle)]">
            Study Text
          </span>
          <textarea
            className="min-h-72 w-full rounded-[20px] border border-white/[0.08] bg-black/20 px-4 py-4 text-sm leading-7 text-[var(--foreground)] outline-none transition duration-200 ease-out placeholder:text-[var(--foreground-subtle)] focus:border-[rgba(94,106,210,0.45)] focus:bg-black/30 focus:shadow-[0_0_0_1px_rgba(94,106,210,0.12),0_0_0_6px_rgba(94,106,210,0.08)]"
            onChange={(event) => setTextContent(event.target.value)}
            placeholder="Paste lecture notes, textbook excerpts, or other study material..."
            rows={10}
            value={textContent}
          />
        </label>
      ) : null}

      {mode === "pdf-url" ? (
        <label className="mt-8 grid gap-3">
          <span className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--foreground-subtle)]">
            PDF URL
          </span>
          <input
            className="w-full rounded-[16px] border border-white/[0.08] bg-black/20 px-4 py-3 text-sm text-[var(--foreground)] outline-none transition duration-200 ease-out placeholder:text-[var(--foreground-subtle)] focus:border-[rgba(94,106,210,0.45)] focus:bg-black/30 focus:shadow-[0_0_0_1px_rgba(94,106,210,0.12),0_0_0_6px_rgba(94,106,210,0.08)]"
            onChange={(event) => setPdfUrl(event.target.value)}
            placeholder="https://example.com/chapter-3.pdf"
            type="url"
            value={pdfUrl}
          />
        </label>
      ) : null}

      {mode === "pdf-file" ? (
        <label className="mt-8 grid gap-3">
          <span className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--foreground-subtle)]">
            PDF File
          </span>
          <input
            accept="application/pdf,.pdf"
            className="block w-full rounded-[16px] border border-dashed border-white/[0.12] bg-black/20 px-4 py-4 text-sm text-[var(--foreground-muted)] file:mr-4 file:rounded-full file:border-0 file:bg-[rgba(94,106,210,0.16)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-[var(--foreground)] hover:border-white/[0.16]"
            onChange={handlePdfFileChange}
            type="file"
          />
          <small className="text-sm leading-7 text-[var(--foreground-muted)]">
            {pdfFile ? `Selected: ${pdfFile.name}` : "Choose a local PDF to extract concepts from."}
          </small>
        </label>
      ) : null}

      <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <Button disabled={isSubmitting} onClick={() => void handleSubmit()}>
          {isSubmitting ? "Importing..." : "Import Material"}
        </Button>
        <span className="max-w-2xl text-sm leading-7 text-[var(--foreground-muted)]">{status}</span>
      </div>

      {generationProgress.total > 0 && generationProgress.stage !== "idle" ? (
        <div className="viewer-section">
          <div className="surface-spotlight rounded-[24px] border border-white/[0.08] bg-black/20 p-6">
            <div className="text-xs uppercase tracking-[0.24em] text-[var(--foreground-subtle)]">
              {generationProgress.stage === "metaphors"
                ? "Metaphor Progress"
                : "3D Object Progress"}
            </div>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
              {generationProgress.completed}/{generationProgress.total}
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--foreground-muted)]">
              {generationProgress.etaMs === null
                ? "Estimating after the first completed item..."
                : `Estimated time remaining: ${formatDuration(generationProgress.etaMs)}`}
            </p>
          </div>
        </div>
      ) : null}

      <div className="viewer-section grid gap-4 md:grid-cols-2">
        <div className="surface-spotlight rounded-[24px] border border-white/[0.08] bg-black/20 p-6">
          <div className="text-xs uppercase tracking-[0.24em] text-[var(--foreground-subtle)]">
            Extracted Concepts
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
            {lastConceptCount}
          </p>
        </div>
        <div className="surface-spotlight rounded-[24px] border border-white/[0.08] bg-black/20 p-6">
          <div className="text-xs uppercase tracking-[0.24em] text-[var(--foreground-subtle)]">
            Active Room
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
            {createdRooms.length ? 1 : 0}
          </p>
        </div>
      </div>

      {createdRooms.length ? (
        <div className="viewer-section">
          <div className="text-xs font-medium uppercase tracking-[0.28em] text-[var(--accent-bright)]">
            Current Room
          </div>
          <article className="mt-5 surface-spotlight rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] p-6 shadow-[var(--shadow-card)]">
            <strong className="text-lg font-semibold tracking-tight text-[var(--foreground)]">
              {createdRooms[0]?.name}
            </strong>
            <p className="mt-3 text-sm leading-7 text-[var(--foreground-muted)]">
              {createdRooms[0]?.description}
            </p>
            <p className="mt-3 text-sm leading-7 text-[var(--foreground-muted)]">
              {createdRooms[0]?.conceptCount ?? 0} concept
              {(createdRooms[0]?.conceptCount ?? 0) === 1 ? "" : "s"}
            </p>
          </article>
        </div>
      ) : null}
    </section>
  );
}
