/**
 * @file manual-test-pdf.ts
 * @description Manual Node-side script for testing concept extraction with PDF inputs.
 * @module concept-extraction
 */
import { extractConceptsFromSource } from "./server/concept-extraction.server";
import type { Concept, ExtractionInput } from "./types";

function printSummary(concepts: Concept[]) {
  console.log("Total concepts:", concepts.length);
  console.log("First 3:", concepts.slice(0, 3));
}

async function main() {
  // These scripts run on the server in Node, not in the browser.
  // For PDFs, yes, you pass a file path from your computer or a PDF URL.
  // If you use a local path, Node must be able to read that file.
  // Relative paths are resolved from the current working directory, usually the project root.
  // Because this script runs outside the TanStack app runtime, it calls the
  // server implementation directly instead of the createServerFn wrapper.

  // ===== REPLACE THIS WITH YOUR INPUT =====

  // OPTION 1: URL
  // Puppeteer is not used here. The server fetches the PDF bytes directly and parses them.
  // Replace this if you want to test a remote PDF URL.
  const pdfInputOptions: Record<"url" | "path" | "base64", ExtractionInput> = {
    url: {
      type: "pdf",
      source: {
        kind: "url",
        value: "PASTE_PDF_URL_HERE",
      },
    },

    // OPTION 2: LOCAL FILE PATH
    // IMPORTANT: This can be an absolute path or a path relative to your project root.
    // Node must have access to the file on disk.
    path: {
      type: "pdf",
      source: {
        kind: "path",
        value: "/Users/andydo/Downloads/CS_2800_Textbook.pdf",
      },
    },

    // OPTION 3: BASE64
    // This is optional. You can paste a raw base64 string or a data URL.
    base64: {
      type: "pdf",
      source: {
        kind: "base64",
        value: "PASTE_BASE64_PDF_HERE",
      },
    },
  };

  // ===== CHOOSE ONE INPUT =====
  const input = pdfInputOptions.path;

  try {
    const concepts = await extractConceptsFromSource(input);

    printSummary(concepts);
    console.log(JSON.stringify(concepts, null, 2));
  } catch (err) {
    console.error("Test failed:", err);
  }
}

void main();
