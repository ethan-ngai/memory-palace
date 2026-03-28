// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createGameEngine } from "@/features/game/engine/boot";

describe("createGameEngine", () => {
  it("starts and disposes without leaking animation frames", () => {
    const requestedCallbacks: Array<FrameRequestCallback> = [];
    const cancelFrame = vi.fn();
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      requestedCallbacks.push(callback);
      return requestedCallbacks.length;
    });
    const renderer = {
      dispose: vi.fn(),
      render: vi.fn(),
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
    };

    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 800 });
    Object.defineProperty(canvas, "clientHeight", { value: 560 });

    const engine = createGameEngine({
      canvas,
      initialSnapshot: { cubeRotation: 0, playerX: 0, playerZ: 0 },
      rendererFactory: () => renderer,
      scheduler: {
        cancelFrame,
        requestFrame,
      },
      windowRef: window,
    });

    expect(requestFrame).toHaveBeenCalled();
    engine.dispose();

    expect(cancelFrame).toHaveBeenCalled();
    expect(renderer.dispose).toHaveBeenCalled();
  });
});
