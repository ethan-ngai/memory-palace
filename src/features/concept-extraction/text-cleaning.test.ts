/**
 * @file text-cleaning.test.ts
 * @description Covers text cleanup edge cases for the concept extraction feature.
 * @module concept-extraction
 */
import { describe, expect, it } from "vitest";
import { cleanText } from "@/features/concept-extraction/server/text-cleaning.server";

describe("cleanText", () => {
  it("collapses repeated whitespace and removes duplicate lines", () => {
    const result = cleanText("Neuron   cell\nNeuron   cell\nAxon\t\tpath");
    expect(result).toBe("Neuron cell\nAxon path");
  });

  it("removes junk lines and zero-width characters", () => {
    const result = cleanText("\u200BLog in\nSynapse\nAdvertisement");
    expect(result).toBe("Synapse");
  });
});
