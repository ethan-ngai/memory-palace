/**
 * @file text-cleaning.server.ts
 * @description Shared text normalization and concept deduplication helpers for concept extraction.
 * @module concept-extraction
 */
import type { Concept } from "@/features/concept-extraction/types";

const JUNK_PATTERNS = [
  /^log in$/i,
  /^sign up$/i,
  /^upgrade$/i,
  /^advertisement$/i,
  /^skip to main content$/i,
  /^cookie preferences$/i,
  /^accept all$/i,
  /^reject all$/i,
];

function isJunkLine(line: string) {
  return JUNK_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Normalizes raw text before it is sent to the model.
 * @param raw - Untrusted text produced by scraping, PDF extraction, or pasted content.
 * @returns Trimmed text with obvious junk and duplicate lines removed.
 * @remarks The cleanup is intentionally conservative so study terminology is preserved while common page chrome is stripped away.
 */
export function cleanText(raw: string) {
  const normalized = raw.replace(/\r\n?/g, "\n").replace(/[\u200B-\u200D\uFEFF]/g, "");
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .filter((line) => !isJunkLine(line));

  const dedupedLines: string[] = [];
  const seenLines = new Set<string>();

  for (const line of lines) {
    const key = line.toLowerCase();
    if (seenLines.has(key)) {
      continue;
    }

    seenLines.add(key);
    dedupedLines.push(line);
  }

  return dedupedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Deduplicates concepts by normalized name while preserving the first stable label.
 * @param concepts - Candidate concepts returned by the model.
 * @returns Concepts collapsed by case-insensitive name.
 * @remarks Keeps the first spelling of the concept name so memorization-oriented terminology is not rewritten during cleanup.
 */
export function dedupeConcepts(concepts: Concept[]) {
  const deduped = new Map<string, Concept>();

  for (const concept of concepts) {
    const normalizedName = concept.name.trim().toLowerCase();
    const normalizedDescription = concept.description.trim();

    if (!normalizedName || !normalizedDescription) {
      continue;
    }

    if (!deduped.has(normalizedName)) {
      deduped.set(normalizedName, {
        name: concept.name.trim(),
        description: normalizedDescription,
      });
      continue;
    }

    const existing = deduped.get(normalizedName);
    if (existing && existing.description.length === 0 && normalizedDescription.length > 0) {
      deduped.set(normalizedName, {
        name: existing.name,
        description: normalizedDescription,
      });
    }
  }

  return Array.from(deduped.values());
}
