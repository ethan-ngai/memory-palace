/**
 * @file loop.ts
 * @description Provides the reusable animation loop used by the game engine.
 * @module game
 */
type FrameScheduler = {
  cancelFrame: (handle: number) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
};

/**
 * Creates a start/stop animation loop around `requestAnimationFrame`.
 * @param scheduler - The frame scheduler abstraction used for production code and tests.
 * @param update - Called every frame with the elapsed time in seconds.
 * @returns Loop controls for starting and stopping animation updates.
 * @remarks
 * - Uses an injected scheduler so the loop can be tested without relying on the browser runtime.
 * - Clamps large frame gaps to avoid a single tab switch or debugger pause producing a massive simulation jump.
 */
export function createGameLoop(scheduler: FrameScheduler, update: (deltaSeconds: number) => void) {
  let activeHandle = 0;
  let previousTimestamp = 0;

  const frame = (timestamp: number) => {
    if (previousTimestamp === 0) {
      previousTimestamp = timestamp;
    }

    // Clamp long frames so tab switches or debugger pauses do not turn into a
    // giant physics jump the next time rendering resumes.
    const deltaSeconds = Math.min((timestamp - previousTimestamp) / 1000, 1 / 15);
    previousTimestamp = timestamp;
    update(deltaSeconds);
    activeHandle = scheduler.requestFrame(frame);
  };

  return {
    start() {
      if (activeHandle !== 0) {
        return;
      }

      activeHandle = scheduler.requestFrame(frame);
    },
    stop() {
      if (activeHandle === 0) {
        return;
      }

      scheduler.cancelFrame(activeHandle);
      activeHandle = 0;
      previousTimestamp = 0;
    },
  };
}
