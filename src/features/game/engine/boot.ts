/**
 * @file boot.ts
 * @description Boots and tears down the imperative Three.js runtime used by the game feature.
 * @module game
 */
import { WebGLRenderer } from "three";
import { createInputController } from "@/features/game/engine/input";
import { createGameLoop } from "@/features/game/engine/loop";
import { createGameScene } from "@/features/game/engine/scene";
import type { GameSnapshot } from "@/features/game/types";

type RendererLike = {
  dispose: () => void;
  render: (...args: Array<any>) => void;
  setPixelRatio: (value: number) => void;
  setSize: (width: number, height: number, updateStyle?: boolean) => void;
};

function createRenderer(canvas: HTMLCanvasElement): RendererLike {
  return new WebGLRenderer({
    antialias: true,
    canvas,
  });
}

/**
 * Creates the runtime for the Three.js play scene.
 * @param options - Canvas, initial snapshot, and lifecycle hooks for the game runtime.
 * @returns Controls for disposing the runtime and reading the latest transport-safe snapshot.
 * @remarks
 * - Keeps React responsible for mounting and persistence while rendering, input, and frame scheduling stay imperative where they are simpler and cheaper.
 * - Accepts injected renderer and scheduler implementations so the engine can be verified in tests without requiring a real WebGL pipeline.
 */
export function createGameEngine(options: {
  canvas: HTMLCanvasElement;
  initialSnapshot: GameSnapshot;
  onSnapshotChange?: (snapshot: GameSnapshot) => void;
  rendererFactory?: (canvas: HTMLCanvasElement) => RendererLike;
  scheduler?: {
    cancelFrame: (handle: number) => void;
    requestFrame: (callback: FrameRequestCallback) => number;
  };
  windowRef?: Window;
}) {
  const windowRef = options.windowRef ?? window;
  const renderer = (options.rendererFactory ?? createRenderer)(options.canvas);
  const { camera, cube, dispose: disposeScene, scene } = createGameScene(options.initialSnapshot);
  const input = createInputController(windowRef);

  const resize = () => {
    const width = options.canvas.clientWidth || options.canvas.width || 800;
    const height = options.canvas.clientHeight || options.canvas.height || 560;
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(windowRef.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
  };

  const loop = createGameLoop(
    options.scheduler ?? {
      cancelFrame: (handle) => windowRef.cancelAnimationFrame(handle),
      requestFrame: (callback) => windowRef.requestAnimationFrame(callback),
    },
    (deltaSeconds) => {
      const axis = input.getAxis();
      cube.rotation.y += deltaSeconds + axis.x * deltaSeconds * 0.6;
      cube.position.x += axis.x * deltaSeconds * 2;
      cube.position.z += axis.z * deltaSeconds * 2;

      renderer.render(scene, camera);
      options.onSnapshotChange?.({
        cubeRotation: cube.rotation.y,
        playerX: cube.position.x,
        playerZ: cube.position.z,
      });
    },
  );

  resize();
  windowRef.addEventListener("resize", resize);
  loop.start();

  return {
    dispose() {
      loop.stop();
      windowRef.removeEventListener("resize", resize);
      input.dispose();
      renderer.dispose();
      disposeScene();
    },
    /**
     * Returns the latest serializable gameplay state.
     * @returns A plain snapshot suitable for persistence and RPC transport.
     * @remarks Exposes primitive values rather than Three.js objects so save operations remain decoupled from the rendering layer.
     */
    getSnapshot() {
      return {
        cubeRotation: cube.rotation.y,
        playerX: cube.position.x,
        playerZ: cube.position.z,
      };
    },
  };
}
