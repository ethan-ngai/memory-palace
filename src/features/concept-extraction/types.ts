/**
 * @file types.ts
 * @description Shared transport types for the concept extraction feature.
 * @module concept-extraction
 */

/**
 * A study-worthy concept extracted from source material before persistence.
 * @description Keeps the extraction payload small so upstream parsing and downstream storage can evolve independently.
 */
export type ExtractedConcept = {
  /** Short human-readable label that will also be normalized for dedupe-friendly storage queries. */
  name: string;
  /** Plain-language explanation that gives Gemini enough context to place the concept into a room. */
  description: string;
};

/**
 * Backwards-compatible alias for the extraction result concept shape.
 * @description Preserves the original public type name so existing extraction callers do not need to change immediately.
 */
export type Concept = ExtractedConcept;

/**
 * JSON-safe representation of a PDF source.
 * @description Uses strings instead of browser-only file objects so the feature can stay inside TanStack server function boundaries.
 */
export type PdfSource =
  | { kind: "url"; value: string }
  | { kind: "path"; value: string }
  | { kind: "base64"; value: string };

/**
 * Supported input payloads for concept extraction.
 * @description Discriminated union keeps validation strict while allowing text and PDF flows to share one API.
 */
export type ExtractionInput =
  | { type: "text"; content: string }
  | { type: "pdf"; source: PdfSource };

/**
 * JSON-serializable concept extraction result.
 * @description Alias exists to make server function signatures read as a feature contract instead of a raw array type.
 */
export type ConceptExtractionResult = ExtractedConcept[];

/**
 * Embedding metadata stored alongside a concept.
 * @description Carries model and dimension information so future embedding model swaps do not require a schema rewrite.
 */
export type ConceptEmbedding = {
  /** Embedding model identifier used to generate the vector. */
  model: string;
  /** Number of vector dimensions expected by Atlas vector indexes or downstream search code. */
  dimensions: number;
  /** Raw vector values stored directly on the concept for retrieval and future vector search. */
  values: number[];
  /** ISO timestamp indicating when the embedding was generated. */
  createdAt: string;
};

/**
 * Storage reference for a generated or uploaded 3D asset.
 * @description Leaves room for multiple storage providers while keeping the first schema pass small and nullable.
 */
export type ConceptAssetRef = {
  /** Backend that owns the object key so later retrieval code can choose the right client. */
  provider: "gcs" | "s3" | "r2" | "local" | "unknown";
  /** Provider-specific object key or relative path used as the durable lookup handle. */
  key: string;
  /** Public or signed URL when one is already available at read time. */
  url?: string;
  /** Media type for renderers that need to branch on file format. */
  mimeType?: string;
};

/**
 * Lifecycle state for the current concept metaphor.
 * @description Separates semantic metaphor readiness from the downstream 3D asset pipeline so clients can react before an asset exists.
 */
export type ConceptMetaphorStatus = "pending" | "ready" | "failed";

/**
 * Current Gemini-generated metaphor attached to a stored concept.
 * @description Bridges semantic concept understanding and text-to-3D generation by storing both the visual object and its diffusion prompt.
 */
export type ConceptMetaphor = {
  /** Current lifecycle state for the stored metaphor. */
  status: ConceptMetaphorStatus;
  /** Short noun phrase naming the concrete physical stand-in for the concept. */
  objectName: string;
  /** Diffusion-model-ready prompt derived from the metaphor. */
  prompt: string;
  /** Human-readable explanation of why the metaphor matches the concept. */
  rationale: string;
  /** ISO timestamp of the most recent successful metaphor generation, or null before success. */
  generatedAt: string | null;
  /** Optional last error message when metaphor generation fails. */
  errorMessage?: string;
};

/**
 * Lightweight room reference stored on each concept.
 * @description Denormalizes room identity onto concept documents so common reads do not need a second collection lookup.
 */
export type ConceptRoomRef = {
  /** Stable room id encoded as a Mongo ObjectId hex string. */
  roomId: string;
  /** Current room name shown to users. */
  name: string;
  /** User-scoped slug used for stable matching and URL-friendly lookups. */
  slug: string;
};

/**
 * Persisted concept returned by the concept storage workflow.
 * @description Represents application state after room assignment and Atlas persistence rather than the raw extraction payload.
 */
export type StoredConcept = {
  /** Stable concept id encoded as a Mongo ObjectId hex string. */
  id: string;
  /** Owning local application user id, not the raw Auth0 subject. */
  userId: string;
  /** Human-readable concept title. */
  name: string;
  /** Explanation or definition associated with the concept. */
  description: string;
  /** Lower-noise storage key used for user-scoped lookup and future dedupe work. */
  normalizedName: string;
  /** Room selected or created for this concept. */
  room: ConceptRoomRef;
  /** Current metaphor object used as the future handoff to text-to-3D generation. */
  metaphor: ConceptMetaphor | null;
  /** Optional embedding payload when semantic search generation is enabled. */
  embedding: ConceptEmbedding | null;
  /** Optional 3D asset reference once object generation/upload is available. */
  asset: ConceptAssetRef | null;
  /** ISO creation timestamp from Atlas persistence. */
  createdAt: string;
  /** ISO update timestamp from Atlas persistence. */
  updatedAt: string;
};

/**
 * Room summary returned to feature callers after persistence.
 * @description Gives the client enough metadata to render the user palace structure without exposing raw Mongo document shapes.
 */
export type RoomSummary = {
  /** Stable room id encoded as a Mongo ObjectId hex string. */
  id: string;
  /** Owning local application user id. */
  userId: string;
  /** User-visible room category name. */
  name: string;
  /** User-scoped slug used for deterministic Gemini matching and future routing. */
  slug: string;
  /** Short explanation of what belongs in this room. */
  description: string;
  /** Number of concepts currently assigned to the room. */
  conceptCount: number;
  /** ISO creation timestamp from Atlas persistence. */
  createdAt: string;
  /** ISO update timestamp from Atlas persistence. */
  updatedAt: string;
};

/**
 * Payload accepted by the first concept persistence server API.
 * @description Accepts already-extracted concepts so storage and room classification can ship before raw-input extraction is wired end-to-end.
 */
export type PersistConceptsInput = {
  /** Concepts extracted from text and PDFs and ready for room assignment. */
  concepts: ExtractedConcept[];
};

/**
 * Result returned after concepts are classified and persisted.
 * @description Returns both stored concepts and room summaries so the client can refresh the palace structure in one round trip.
 */
export type PersistConceptsResult = {
  /** Persisted concepts with room refs, timestamps, and nullable future-facing fields. */
  concepts: StoredConcept[];
  /** Updated room summaries for the current user after the write completes. */
  rooms: RoomSummary[];
};

/**
 * Single-concept input shape for callers that work with one concept at a time.
 * @description Keeps a simple contract available even though the first server implementation is batch-capable.
 */
export type GenerateConceptMetaphorInput = {
  /** Persisted concept id encoded as a Mongo ObjectId hex string. */
  conceptId: string;
};

/**
 * Single-concept metaphor generation result.
 * @description Mirrors the common regenerate-one-concept UI flow without forcing callers to unpack arrays manually.
 */
export type GenerateConceptMetaphorResult = {
  /** Updated concept with a current metaphor object. */
  concept: StoredConcept;
};

/**
 * Batch metaphor generation input.
 * @description Supports single, many, and retry flows through one server endpoint.
 */
export type GenerateConceptMetaphorsInput = {
  /** Persisted concept ids owned by the authenticated user. */
  conceptIds: string[];
};

/**
 * Batch metaphor generation result.
 * @description Returns updated concepts in request order after metaphor generation completes.
 */
export type GenerateConceptMetaphorsResult = {
  /** Updated concepts with newly generated metaphors. */
  concepts: StoredConcept[];
};
