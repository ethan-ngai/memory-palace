/**
 * @file anchor-tagger.ts
 * @description Hosts the imperative Memory Palace anchor-tagging runtime adapted from the standalone HTML prototype.
 */
import {
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  RingGeometry,
  Scene,
  ShaderChunk,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import pako from "pako";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import type {
  RoomAnchorSet,
  RoomPlacementInspection,
  RoomPlacementItem,
} from "@/features/game/types";

const ANCHOR_SPHERE_RADIUS = 0.003;
const ANCHOR_RING_INNER_RADIUS = 0.006;
const ANCHOR_RING_OUTER_RADIUS = 0.008;
const ANCHOR_STEM_HEIGHT = 0.025;
const DEFAULT_EMPTY_STATE =
  "No anchors imported yet.<br>Load a .spz or .ply room,<br>then import the Lavender<br>anchor JSON for this room.";
/**
 * Uses a bundled CDN entry so Spark's internal bare `three` import resolves without the
 * import map present in the original standalone HTML prototype.
 */
const SPARK_CDN_MODULE_URL = "https://esm.sh/@sparkjsdev/spark@0.1.10?bundle&deps=three@0.178.0";
const SPZ_DEBUG_TIMEOUT_MS = 15000;
const SPARK_SPLAT_DEFINES_CHUNK = `const float LN_SCALE_MIN = -12.0;
const float LN_SCALE_MAX = 9.0;

const uint SPLAT_TEX_WIDTH_BITS = 11u;
const uint SPLAT_TEX_HEIGHT_BITS = 11u;
const uint SPLAT_TEX_DEPTH_BITS = 11u;
const uint SPLAT_TEX_LAYER_BITS = SPLAT_TEX_WIDTH_BITS + SPLAT_TEX_HEIGHT_BITS;

const uint SPLAT_TEX_WIDTH = 1u << SPLAT_TEX_WIDTH_BITS;
const uint SPLAT_TEX_HEIGHT = 1u << SPLAT_TEX_HEIGHT_BITS;
const uint SPLAT_TEX_DEPTH = 1u << SPLAT_TEX_DEPTH_BITS;

const uint SPLAT_TEX_WIDTH_MASK = SPLAT_TEX_WIDTH - 1u;
const uint SPLAT_TEX_HEIGHT_MASK = SPLAT_TEX_HEIGHT - 1u;
const uint SPLAT_TEX_DEPTH_MASK = SPLAT_TEX_DEPTH - 1u;

const uint F16_INF = 0x7c00u;
const float PI = 3.1415926535897932384626433832795;

const float INFINITY = 1.0 / 0.0;
const float NEG_INFINITY = -INFINITY;

float sqr(float x) {
    return x * x;
}

float pow4(float x) {
    float x2 = x * x;
    return x2 * x2;
}

float pow8(float x) {
    float x4 = pow4(x);
    return x4 * x4;
}

vec3 srgbToLinear(vec3 rgb) {
    return pow(rgb, vec3(2.2));
}

vec3 linearToSrgb(vec3 rgb) {
    return pow(rgb, vec3(1.0 / 2.2));
}

uint encodeQuatOctXy88R8(vec4 q) {
    if (q.w < 0.0) {
        q = -q;
    }

    float theta = 2.0 * acos(q.w);
    float halfTheta = theta * 0.5;
    float s = sin(halfTheta);
    vec3 axis = (abs(s) < 1e-6) ? vec3(1.0, 0.0, 0.0) : q.xyz / s;

    float sum = abs(axis.x) + abs(axis.y) + abs(axis.z);
    vec2 p = vec2(axis.x, axis.y) / sum;

    if (axis.z < 0.0) {
        float oldPx = p.x;
        p.x = (1.0 - abs(p.y)) * (p.x >= 0.0 ? 1.0 : -1.0);
        p.y = (1.0 - abs(oldPx)) * (p.y >= 0.0 ? 1.0 : -1.0);
    }

    float u_f = p.x * 0.5 + 0.5;
    float v_f = p.y * 0.5 + 0.5;
    uint quantU = uint(clamp(round(u_f * 255.0), 0.0, 255.0));
    uint quantV = uint(clamp(round(v_f * 255.0), 0.0, 255.0));
    uint angleInt = uint(clamp(round((theta / 3.14159265359) * 255.0), 0.0, 255.0));
    return (angleInt << 16u) | (quantV << 8u) | quantU;
}

vec4 decodeQuatOctXy88R8(uint encoded) {
    uint quantU = encoded & uint(0xFFu);
    uint quantV = (encoded >> 8u) & uint(0xFFu);
    uint angleInt = encoded >> 16u;

    float u_f = float(quantU) / 255.0;
    float v_f = float(quantV) / 255.0;
    vec2 f = vec2(u_f * 2.0 - 1.0, v_f * 2.0 - 1.0);

    vec3 axis = vec3(f.xy, 1.0 - abs(f.x) - abs(f.y));
    float t = max(-axis.z, 0.0);
    axis.x += (axis.x >= 0.0) ? -t : t;
    axis.y += (axis.y >= 0.0) ? -t : t;
    axis = normalize(axis);

    float theta = (float(angleInt) / 255.0) * 3.14159265359;
    float halfTheta = theta * 0.5;
    float s = sin(halfTheta);
    float w = cos(halfTheta);

    return vec4(axis * s, w);
}

uvec4 packSplatEncoding(
    vec3 center, vec3 scales, vec4 quaternion, vec4 rgba, vec4 rgbMinMaxLnScaleMinMax
) {
    float rgbMin = rgbMinMaxLnScaleMinMax.x;
    float rgbMax = rgbMinMaxLnScaleMinMax.y;
    vec3 encRgb = (rgba.rgb - vec3(rgbMin)) / (rgbMax - rgbMin);
    uvec4 uRgba = uvec4(round(clamp(vec4(encRgb, rgba.a) * 255.0, 0.0, 255.0)));

    uint uQuat = encodeQuatOctXy88R8(quaternion);
    uvec3 uQuat3 = uvec3(uQuat & 0xffu, (uQuat >> 8u) & 0xffu, (uQuat >> 16u) & 0xffu);

    float lnScaleMin = rgbMinMaxLnScaleMinMax.z;
    float lnScaleMax = rgbMinMaxLnScaleMinMax.w;
    float lnScaleScale = 254.0 / (lnScaleMax - lnScaleMin);
    uvec3 uScales = uvec3(
        (scales.x == 0.0) ? 0u : uint(round(clamp((log(scales.x) - lnScaleMin) * lnScaleScale, 0.0, 254.0))) + 1u,
        (scales.y == 0.0) ? 0u : uint(round(clamp((log(scales.y) - lnScaleMin) * lnScaleScale, 0.0, 254.0))) + 1u,
        (scales.z == 0.0) ? 0u : uint(round(clamp((log(scales.z) - lnScaleMin) * lnScaleScale, 0.0, 254.0))) + 1u
    );

    uint word0 = uRgba.r | (uRgba.g << 8u) | (uRgba.b << 16u) | (uRgba.a << 24u);
    uint word1 = packHalf2x16(center.xy);
    uint word2 = packHalf2x16(vec2(center.z, 0.0)) | (uQuat3.x << 16u) | (uQuat3.y << 24u);
    uint word3 = uScales.x | (uScales.y << 8u) | (uScales.z << 16u) | (uQuat3.z << 24u);
    return uvec4(word0, word1, word2, word3);
}

uvec4 packSplat(vec3 center, vec3 scales, vec4 quaternion, vec4 rgba) {
    return packSplatEncoding(center, scales, quaternion, rgba, vec4(0.0, 1.0, LN_SCALE_MIN, LN_SCALE_MAX));
}

void unpackSplatEncoding(uvec4 packed, out vec3 center, out vec3 scales, out vec4 quaternion, out vec4 rgba, vec4 rgbMinMaxLnScaleMinMax) {
    uint word0 = packed.x, word1 = packed.y, word2 = packed.z, word3 = packed.w;

    uvec4 uRgba = uvec4(word0 & 0xffu, (word0 >> 8u) & 0xffu, (word0 >> 16u) & 0xffu, (word0 >> 24u) & 0xffu);
    float rgbMin = rgbMinMaxLnScaleMinMax.x;
    float rgbMax = rgbMinMaxLnScaleMinMax.y;
    rgba = (vec4(uRgba) / 255.0);
    rgba.rgb = rgba.rgb * (rgbMax - rgbMin) + rgbMin;

    center = vec4(
        unpackHalf2x16(word1),
        unpackHalf2x16(word2 & 0xffffu)
    ).xyz;

    uvec3 uScales = uvec3(word3 & 0xffu, (word3 >> 8u) & 0xffu, (word3 >> 16u) & 0xffu);
    float lnScaleMin = rgbMinMaxLnScaleMinMax.z;
    float lnScaleMax = rgbMinMaxLnScaleMinMax.w;
    float lnScaleScale = (lnScaleMax - lnScaleMin) / 254.0;
    scales = vec3(
        (uScales.x == 0u) ? 0.0 : exp(lnScaleMin + float(uScales.x - 1u) * lnScaleScale),
        (uScales.y == 0u) ? 0.0 : exp(lnScaleMin + float(uScales.y - 1u) * lnScaleScale),
        (uScales.z == 0u) ? 0.0 : exp(lnScaleMin + float(uScales.z - 1u) * lnScaleScale)
    );

    uint uQuat = ((word2 >> 16u) & 0xFFFFu) | ((word3 >> 8u) & 0xFF0000u);
    quaternion = decodeQuatOctXy88R8(uQuat);
}

void unpackSplat(uvec4 packed, out vec3 center, out vec3 scales, out vec4 quaternion, out vec4 rgba) {
    unpackSplatEncoding(packed, center, scales, quaternion, rgba, vec4(0.0, 1.0, LN_SCALE_MIN, LN_SCALE_MAX));
}

vec3 quatVec(vec4 q, vec3 v) {
    vec3 t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

vec4 quatQuat(vec4 q1, vec4 q2) {
    return vec4(
        q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
        q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
        q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w,
        q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z
    );
}

mat3 scaleQuaternionToMatrix(vec3 s, vec4 q) {
    return mat3(
        s.x * (1.0 - 2.0 * (q.y * q.y + q.z * q.z)),
        s.x * (2.0 * (q.x * q.y + q.w * q.z)),
        s.x * (2.0 * (q.x * q.z - q.w * q.y)),
        s.y * (2.0 * (q.x * q.y - q.w * q.z)),
        s.y * (1.0 - 2.0 * (q.x * q.x + q.z * q.z)),
        s.y * (2.0 * (q.y * q.z + q.w * q.x)),
        s.z * (2.0 * (q.x * q.z + q.w * q.y)),
        s.z * (2.0 * (q.y * q.z - q.w * q.x)),
        s.z * (1.0 - 2.0 * (q.x * q.x + q.y * q.y))
    );
}

vec4 slerp(vec4 q1, vec4 q2, float t) {
    float cosHalfTheta = dot(q1, q2);
    if (abs(cosHalfTheta) >= 0.999) {
        return q1;
    }
    if (cosHalfTheta < 0.0) {
        q2 = -q2;
        cosHalfTheta = -cosHalfTheta;
    }

    float halfTheta = acos(cosHalfTheta);
    float sinHalfTheta = sqrt(1.0 - cosHalfTheta * cosHalfTheta);
    float ratioA = sin((1.0 - t) * halfTheta) / sinHalfTheta;
    float ratioB = sin(t * halfTheta) / sinHalfTheta;
    return q1 * ratioA + q2 * ratioB;
}

ivec3 splatTexCoord(int index) {
    uint x = uint(index) & SPLAT_TEX_WIDTH_MASK;
    uint y = (uint(index) >> SPLAT_TEX_WIDTH_BITS) & SPLAT_TEX_HEIGHT_MASK;
    uint z = uint(index) >> SPLAT_TEX_LAYER_BITS;
    return ivec3(x, y, z);
}`;

/**
 * Defines the interaction mode for the viewport.
 */
type EditorMode = "orbit" | "place";

/**
 * Captures serializable anchor coordinates for export and UI display.
 */
interface AnchorPosition {
  x: number;
  y: number;
  z: number;
}

/**
 * Represents one editable anchor and its linked scene objects.
 */
interface AnchorRecord {
  id: number;
  label: string;
  surface: string;
  position: AnchorPosition;
  mesh: Group;
  sphere: Mesh<SphereGeometry, MeshBasicMaterial>;
  ring: Mesh<RingGeometry, MeshBasicMaterial>;
  stem: Line<BufferGeometry, LineBasicMaterial>;
}

/**
 * Describes keyboard movement state for the orbit camera.
 */
interface KeyState {
  back: boolean;
  boost: boolean;
  down: boolean;
  forward: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
}

/**
 * Stores the orbit camera's spherical controls around the current target.
 */
interface OrbitState {
  phi: number;
  r: number;
  theta: number;
}

/**
 * Provides all DOM handles needed by the client-only editor runtime.
 */
export interface AnchorTaggerElements {
  anchorCountPill: HTMLDivElement;
  anchorLabelInput: HTMLInputElement;
  anchorList: HTMLDivElement;
  anchorSurfaceSelect: HTMLSelectElement;
  btnOrbit: HTMLButtonElement;
  btnPerf: HTMLButtonElement;
  btnPlace: HTMLButtonElement;
  btnScatter: HTMLButtonElement;
  btnReroll: HTMLButtonElement;
  btnClearProps: HTMLButtonElement;
  btnExport: HTMLButtonElement;
  btnClearAll: HTMLButtonElement;
  btnLoadProp: HTMLButtonElement;
  dragOverlay: HTMLDivElement;
  dropMessage: HTMLDivElement;
  dropzone: HTMLDivElement;
  fileInput: HTMLInputElement;
  fileLoaded: HTMLDivElement;
  filePointPill: HTMLDivElement;
  hudAnchors: HTMLDivElement;
  loadMessage: HTMLSpanElement;
  loadSubMessage: HTMLSpanElement;
  loadingOverlay: HTMLDivElement;
  modeBadge: HTMLDivElement;
  taggedCountStat: HTMLSpanElement;
  pointCountStat: HTMLSpanElement;
  propCountInput: HTMLInputElement;
  propFileInput: HTMLInputElement;
  propLoaded: HTMLDivElement;
  viewport: HTMLDivElement;
}

/**
 * Exposes the teardown handle for the anchor-tagging runtime.
 */
export interface AnchorTaggerController {
  dispose: () => void;
  loadSceneFile: (file: File) => Promise<void>;
  renderPlacements: (placements: RoomPlacementItem[]) => Promise<void>;
  setAnchorSet: (anchorSet: RoomAnchorSet | null) => void;
  setOnPlacementInspect: (
    listener: ((placement: RoomPlacementInspection | null) => void) | null,
  ) => void;
}

/**
 * Describes a mesh template that can be instanced across multiple anchors.
 */
interface PropBlueprint {
  geometry: BufferGeometry;
  material: any;
  matrix: Matrix4;
}

/**
 * Describes the subset of Spark's constructor shape used by the editor.
 */
interface SplatMeshConstructor {
  new (options: { fileBytes: ArrayBuffer; fileName?: string }): {
    initialized: Promise<unknown>;
    position: Vector3;
  } & Object3D;
}

let sparkSplatMeshPromise: Promise<SplatMeshConstructor> | undefined;

/**
 * Loads the exact Spark browser build used by the working standalone prototype.
 * @returns The `SplatMesh` constructor exported by Spark's CDN module.
 * @remarks
 * - The npm package hangs during internal worker bootstrap in the TanStack/Vite bundle while the prototype's CDN build does not.
 * - Loading the same browser module as `rohan/index.html` removes that runtime discrepancy.
 */
async function loadSparkSplatMesh() {
  sparkSplatMeshPromise ??= (async () => {
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const first = typeof args[0] === "string" ? args[0] : "";
      if (first.includes("Multiple instances of Three.js being imported")) {
        return;
      }

      originalWarn(...args);
    };

    try {
      const module = await import(/* @vite-ignore */ SPARK_CDN_MODULE_URL);
      console.info("[anchor-tagger] Loaded Spark CDN module.", {
        url: SPARK_CDN_MODULE_URL,
      });
      return module.SplatMesh as SplatMeshConstructor;
    } catch (error) {
      console.error("[anchor-tagger] Failed to load Spark CDN module.", {
        error,
        url: SPARK_CDN_MODULE_URL,
      });
      throw error;
    } finally {
      console.warn = originalWarn;
    }
  })();

  return sparkSplatMeshPromise;
}

/**
 * Mirrors Spark's custom shader chunk registration onto the app's Three.js instance.
 * @remarks
 * Spark registers this chunk on its own bundled `three`, but the app renderer compiles
 * shaders using the local `three` import. Without this patch, shader compilation fails
 * on `#include <splatDefines>`.
 */
function ensureSparkShaderChunk() {
  const shaderChunkRegistry = ShaderChunk as Record<string, string | undefined>;
  if (shaderChunkRegistry.splatDefines !== SPARK_SPLAT_DEFINES_CHUNK) {
    shaderChunkRegistry.splatDefines = SPARK_SPLAT_DEFINES_CHUNK;
    console.info("[anchor-tagger] Registered local ShaderChunk.splatDefines.");
  }
}

/**
 * Rejects when an awaited step appears hung so console output points to the exact stage.
 * @param label - Human-readable step name for diagnostics.
 * @param promise - Step being observed.
 * @param timeoutMs - Timeout before considering the step stalled.
 * @returns The resolved promise value when the step completes in time.
 */
async function withDebugTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs = SPZ_DEBUG_TIMEOUT_MS,
) {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      console.error("[anchor-tagger] Step timed out.", {
        label,
        timeoutMs,
      });
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Creates the native TanStack Start-compatible editor runtime against an existing JSX shell.
 * @param elements - Stable DOM nodes rendered by React and owned by the play route.
 * @returns A disposer that releases renderer, listeners, and loaded scene assets.
 */
export function createAnchorTagger(elements: AnchorTaggerElements): AnchorTaggerController {
  const raycaster = new Raycaster();
  const pointerNdc = new Vector2();
  const gltfLoader = new GLTFLoader();
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.001, 2000);
  const renderer = new WebGLRenderer({ antialias: true });
  const orbitTarget = new Vector3();
  const keyState: KeyState = {
    back: false,
    boost: false,
    down: false,
    forward: false,
    left: false,
    right: false,
    up: false,
  };
  const orbit: OrbitState = { phi: 1.1, r: 6, theta: 0.3 };
  const propLights = {
    dir: new DirectionalLight(0xffffff, 1.3),
    hemi: new HemisphereLight(0xffffff, 0x24354a, 1.15),
  };
  const listeners: Array<{ event: string; target: EventTarget; handler: EventListener }> = [];
  const placementAssetPromises = new Map<string, Promise<Object3D>>();

  let anchors: AnchorRecord[] = [];
  let activeAnchorSet: RoomAnchorSet | null = null;
  let importedAnchorCount = 0;
  let currentPlacements: RoomPlacementItem[] = [];
  let placementInspectListener: ((placement: RoomPlacementInspection | null) => void) | null = null;
  let dragCounter = 0;
  let draggedAnchor: AnchorRecord | null = null;
  let isDraggingAnchor = false;
  let lastDragUiUpdate = 0;
  let lastFrameTs = performance.now();
  let mousedownX = 0;
  let mousedownY = 0;
  let mode: EditorMode = "orbit";
  let pendingDragPointer: { x: number; y: number } | null = null;
  let performanceMode = true;
  let placedPropInstancedMeshes: InstancedMesh[] = [];
  let placedPropRoots: Object3D[] = [];
  let propBlueprints: PropBlueprint[] = [];
  let propPlacementMode: "clone" | "instanced" = "clone";
  let propSourceScene: Object3D | null = null;
  let propTemplate: Object3D | null = null;
  let rayCloud: Points<BufferGeometry, PointsMaterial> | null = null;
  let renderPending = false;
  let rightButton = false;
  let sceneScale = 1;
  let sceneContentOffset = new Vector3();
  let sourceRayCount = 0;
  let sourceRayPositions: Float32Array | null = null;
  let scenePointCloud:
    | Points<BufferGeometry, PointsMaterial>
    | (Object3D & { initialized: Promise<unknown>; position: Vector3 })
    | null = null;
  let viewportDragging = false;
  let viewportMouseX = 0;
  let viewportMouseY = 0;

  /**
   * Builds the popup-friendly inspection payload for one clicked placement.
   * @param placement - Clicked placement metadata from the rendered object graph.
   * @returns JSON-safe inspection content for React state.
   */
  function toPlacementInspection(placement: RoomPlacementItem): RoomPlacementInspection {
    return {
      anchorId: placement.anchorId,
      conceptId: placement.conceptId,
      conceptName: placement.conceptName,
      conceptDescription: placement.conceptDescription,
      metaphorObjectName: placement.metaphorObjectName,
      metaphorRationale: placement.metaphorRationale,
      label: placement.label,
      surface: placement.surface,
    };
  }

  scene.background = new Color("#07090d");
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.domElement.style.touchAction = "none";
  elements.viewport.appendChild(renderer.domElement);
  scene.add(propLights.hemi);
  scene.add(propLights.dir);

  /**
   * Registers an event listener and tracks it for disposal.
   * @param target - Event target that owns the listener.
   * @param event - Browser event name.
   * @param handler - Bound handler to remove during teardown.
   */
  function addListener(target: EventTarget, event: string, handler: EventListener) {
    target.addEventListener(event, handler);
    listeners.push({ event, handler, target });
  }

  /**
   * Updates the renderer DPR according to the current performance toggle.
   */
  function applyRendererQuality() {
    const maxDpr = performanceMode ? 1.0 : 1.25;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  }

  /**
   * Resizes the camera and renderer to the viewport's current box.
   */
  function onResize() {
    const width = elements.viewport.clientWidth || 1;
    const height = elements.viewport.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    applyRendererQuality();
    renderer.setSize(width, height);
    requestRender();
  }

  /**
   * Schedules a single render tick while collapsing redundant requests.
   */
  function requestRender() {
    if (renderPending) {
      return;
    }

    renderPending = true;
    window.requestAnimationFrame(renderFrame);
  }

  /**
   * Advances keyboard movement, anchor dragging, and scene rendering.
   * @param now - High-resolution frame timestamp.
   */
  function renderFrame(now: number) {
    renderPending = false;
    const dt = Math.min(0.05, (now - lastFrameTs) / 1000);
    lastFrameTs = now;
    const needsAnotherFrame = updateKeyboardMotion(dt);
    processPendingAnchorDrag(now);

    for (const anchor of anchors) {
      const color = anchor === draggedAnchor ? 0xffdd00 : 0x00e5ff;
      anchor.sphere.material.color.setHex(color);
      anchor.ring.material.color.setHex(color);
    }

    renderer.render(scene, camera);
    if (needsAnotherFrame || isDraggingAnchor) {
      requestRender();
    }
  }

  /**
   * Applies any queued pointer update while an anchor is being dragged.
   * @param now - Current frame timestamp used to throttle DOM work.
   */
  function processPendingAnchorDrag(now: number) {
    if (!isDraggingAnchor || !draggedAnchor || !rayCloud || !pendingDragPointer) {
      return;
    }

    const point = getRayHitFromClient(pendingDragPointer.x, pendingDragPointer.y);
    pendingDragPointer = null;
    if (!point) {
      return;
    }

    draggedAnchor.mesh.position.copy(point);
    draggedAnchor.position = toAnchorPosition(point);
    if (now - lastDragUiUpdate > 120) {
      lastDragUiUpdate = now;
      updateUi();
    }
  }

  /**
   * Converts a world-space vector into the rounded export format used by the prototype.
   * @param point - Vector to serialize.
   * @returns Rounded anchor coordinates.
   */
  function toAnchorPosition(point: Vector3): AnchorPosition {
    return {
      x: +point.x.toFixed(4),
      y: +point.y.toFixed(4),
      z: +point.z.toFixed(4),
    };
  }

  /**
   * Updates camera movement state from keyboard events.
   * @param key - Pressed key string from the browser.
   * @param pressed - Whether the key is currently active.
   * @returns True when the key maps to camera motion.
   */
  function setMoveKeyState(key: string, pressed: boolean) {
    switch (key.toLowerCase()) {
      case "w":
        keyState.forward = pressed;
        return true;
      case "s":
        keyState.back = pressed;
        return true;
      case "a":
        keyState.left = pressed;
        return true;
      case "d":
        keyState.right = pressed;
        return true;
      case "q":
        keyState.down = pressed;
        return true;
      case "e":
        keyState.up = pressed;
        return true;
      case "shift":
        keyState.boost = pressed;
        return true;
      default:
        return false;
    }
  }

  /**
   * Clears any sticky movement keys when the window loses focus.
   */
  function clearMoveKeys() {
    keyState.back = false;
    keyState.boost = false;
    keyState.down = false;
    keyState.forward = false;
    keyState.left = false;
    keyState.right = false;
    keyState.up = false;
    requestRender();
  }

  /**
   * Moves the orbit target using the current keyboard state.
   * @param dt - Frame delta in seconds.
   * @returns True when movement should keep the render loop alive.
   */
  function updateKeyboardMotion(dt: number) {
    const moveX = (keyState.right ? 1 : 0) - (keyState.left ? 1 : 0);
    const moveY = (keyState.up ? 1 : 0) - (keyState.down ? 1 : 0);
    const moveZ = (keyState.forward ? 1 : 0) - (keyState.back ? 1 : 0);
    if (!moveX && !moveY && !moveZ) {
      return false;
    }

    const forward = camera.position.clone().sub(orbitTarget).normalize().negate();
    const flatForward = new Vector3(forward.x, 0, forward.z);
    if (flatForward.lengthSq() < 1e-8) {
      flatForward.set(0, 0, -1);
    }
    flatForward.normalize();

    const right = new Vector3().crossVectors(flatForward, camera.up).normalize();
    const move = new Vector3()
      .addScaledVector(right, moveX)
      .addScaledVector(camera.up, moveY)
      .addScaledVector(flatForward, moveZ);
    if (!move.lengthSq()) {
      return false;
    }

    move.normalize();
    const speedBase = Math.max(sceneScale * 0.2, orbit.r * 0.24, 0.12);
    const speed = speedBase * (keyState.boost ? 1.8 : 1) * dt;
    orbitTarget.addScaledVector(move, speed);
    updateCamera();
    return true;
  }

  /**
   * Recomputes the camera transform from the orbit state.
   */
  function updateCamera() {
    camera.position.set(
      orbitTarget.x + orbit.r * Math.sin(orbit.phi) * Math.sin(orbit.theta),
      orbitTarget.y + orbit.r * Math.cos(orbit.phi),
      orbitTarget.z + orbit.r * Math.sin(orbit.phi) * Math.cos(orbit.theta),
    );
    camera.lookAt(orbitTarget);
  }

  /**
   * Updates UI affordances when the interaction mode changes.
   * @param nextMode - Desired orbit or tagging mode.
   */
  function setMode(nextMode: EditorMode) {
    mode = nextMode;
    elements.btnOrbit.classList.toggle("active", nextMode === "orbit");
    elements.btnPlace.classList.toggle("active", nextMode === "place");
    elements.modeBadge.textContent =
      nextMode === "place" ? "⊞ TAG MODE - click a surface" : "ORBIT";
    elements.modeBadge.classList.toggle("place", nextMode === "place");
    renderer.domElement.style.cursor = nextMode === "place" ? "crosshair" : "default";
    requestRender();
  }

  /**
   * Picks a hidden raycast point from the sampled cloud under the provided pointer.
   * @param clientX - Viewport-space x coordinate.
   * @param clientY - Viewport-space y coordinate.
   * @returns The hit position, if any.
   */
  function getRayHitFromClient(clientX: number, clientY: number) {
    if (!rayCloud) {
      return null;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      ((clientY - rect.top) / rect.height) * -2 + 1,
    );
    raycaster.params.Points.threshold = sceneScale * 0.012;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObject(rayCloud);
    return hits.length ? (hits[0]?.point.clone() ?? null) : null;
  }

  /**
   * Finds the closest rendered placed object under the pointer.
   * @param clientX - Viewport-space x coordinate.
   * @param clientY - Viewport-space y coordinate.
   * @returns The clicked placement metadata, or null when no placement was hit.
   * @remarks Recursive mesh raycasts provide accurate picking on generated assets with complex child hierarchies.
   */
  function pickPlacement(clientX: number, clientY: number) {
    if (!placedPropRoots.length) {
      return null;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      ((clientY - rect.top) / rect.height) * -2 + 1,
    );
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(placedPropRoots, true);
    for (const hit of hits) {
      let current: Object3D | null = hit.object;
      while (current) {
        const placement = current.userData.roomPlacement as RoomPlacementItem | undefined;
        if (placement) {
          return placement;
        }
        current = current.parent;
      }
    }

    return null;
  }

  /**
   * Finds the closest projected anchor to the pointer for drag-to-reposition.
   * @param clientX - Viewport-space x coordinate.
   * @param clientY - Viewport-space y coordinate.
   * @returns The nearest anchor within the selection radius.
   */
  function pickAnchor(clientX: number, clientY: number) {
    if (!anchors.length) {
      return null;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    let best: AnchorRecord | null = null;
    let bestDistance = 24;
    for (const anchor of anchors) {
      const projected = anchor.mesh.position.clone().project(camera);
      const screenX = ((projected.x + 1) / 2) * rect.width;
      const screenY = ((-projected.y + 1) / 2) * rect.height;
      const distance = Math.hypot(screenX - (clientX - rect.left), screenY - (clientY - rect.top));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = anchor;
      }
    }

    return best;
  }

  /**
   * Adds an anchor marker to the scene and editor list.
   * @param point - World position selected from the raycast cloud.
   * @param label - Human-friendly anchor label.
   * @param surface - Selected surface classification.
   */
  function addAnchor(
    point: Vector3,
    label: string,
    surface: string,
    id = Date.now() + Math.random(),
  ) {
    const scale = sceneScale;
    const group = new Group();
    const sphere = new Mesh(
      new SphereGeometry(scale * ANCHOR_SPHERE_RADIUS, 8, 8),
      new MeshBasicMaterial({ color: 0x00e5ff }),
    );
    const ring = new Mesh(
      new RingGeometry(scale * ANCHOR_RING_INNER_RADIUS, scale * ANCHOR_RING_OUTER_RADIUS, 20),
      new MeshBasicMaterial({
        color: 0x00e5ff,
        opacity: 0.6,
        side: DoubleSide,
        transparent: true,
      }),
    );
    const stem = new Line(
      new BufferGeometry().setFromPoints([
        new Vector3(0, 0, 0),
        new Vector3(0, scale * ANCHOR_STEM_HEIGHT, 0),
      ]),
      new LineBasicMaterial({ color: 0x00e5ff, opacity: 0.5, transparent: true }),
    );

    group.add(sphere);
    group.add(ring);
    group.add(stem);
    group.position.copy(point);
    scene.add(group);
    anchors.push({
      id,
      label,
      mesh: group,
      position: toAnchorPosition(point),
      ring,
      sphere,
      stem,
      surface,
    });
    updateUi();
    requestRender();
  }

  /**
   * Removes one anchor and its linked scene objects.
   * @param id - Stable runtime identifier for the anchor.
   */
  function removeAnchor(id: number) {
    const index = anchors.findIndex((anchor) => anchor.id === id);
    if (index < 0) {
      return;
    }

    const [anchor] = anchors.splice(index, 1);
    if (!anchor) {
      return;
    }

    scene.remove(anchor.mesh);
    disposeAnchor(anchor);
    updateUi();
    requestRender();
  }

  /**
   * Removes the most recently created anchor.
   */
  function undoLast() {
    const anchor = anchors.pop();
    if (!anchor) {
      return;
    }

    scene.remove(anchor.mesh);
    disposeAnchor(anchor);
    updateUi();
    requestRender();
  }

  /**
   * Clears all anchors after explicit user confirmation.
   */
  function clearAll() {
    if (!anchors.length) {
      return;
    }
    if (!window.confirm(`Remove all ${anchors.length} anchors?`)) {
      return;
    }

    for (const anchor of anchors) {
      scene.remove(anchor.mesh);
      disposeAnchor(anchor);
    }
    anchors = [];
    clearPropModels();
    updateUi();
    requestRender();
  }

  /**
   * Releases per-anchor geometries and materials.
   * @param anchor - Anchor whose visuals are no longer needed.
   */
  function disposeAnchor(anchor: AnchorRecord) {
    anchor.sphere.geometry.dispose();
    anchor.ring.geometry.dispose();
    anchor.stem.geometry.dispose();
    anchor.sphere.material.dispose();
    anchor.ring.material.dispose();
    anchor.stem.material.dispose();
  }

  /**
   * Removes all current anchors without prompting.
   * @remarks Room anchor imports replace the entire active set, so this path intentionally skips the old editor confirmation flow.
   */
  function resetAnchors() {
    for (const anchor of anchors) {
      scene.remove(anchor.mesh);
      disposeAnchor(anchor);
    }
    anchors = [];
    importedAnchorCount = 0;
    updateUi();
    requestRender();
  }

  /**
   * Records the provided imported room anchor set without rendering authoring markers.
   * @param anchorSet - Active room anchor payload, or null when the selected room has none.
   * @remarks The MVP viewer still uses imported anchors for placement generation, but the
   * user-facing viewer no longer exposes anchor points in the world or sidebar.
   */
  function setAnchorSet(anchorSet: RoomAnchorSet | null) {
    resetAnchors();
    activeAnchorSet = anchorSet;
    importedAnchorCount = anchorSet?.anchors.length ?? 0;
    updateUi();
    requestRender();
  }

  /**
   * Mirrors viewer stats into the sidebar without exposing anchor details.
   */
  function updateUi() {
    const count = importedAnchorCount;
    elements.anchorCountPill.style.display = count ? "block" : "none";
    elements.anchorCountPill.textContent = `${count} anchor${count === 1 ? "" : "s"} imported`;
    elements.hudAnchors.textContent = "";
    elements.taggedCountStat.textContent = count.toString();
    elements.anchorList.innerHTML = `<div class="empty-msg">${DEFAULT_EMPTY_STATE}</div>`;
    elements.pointCountStat.textContent = sourceRayCount ? sourceRayCount.toLocaleString() : "—";
  }

  /**
   * Exports the current anchor set using the standalone prototype's JSON shape.
   */
  function exportJson() {
    if (!anchors.length) {
      window.alert("No anchors to export.");
      return;
    }

    const payload = {
      anchors: anchors.map((anchor, index) => ({
        id: index,
        label: anchor.label,
        position: anchor.position,
        surface: anchor.surface,
      })),
      created: new Date().toISOString(),
      description:
        "Memory palace anchor candidates. Randomly select a subset at runtime to place memory objects.",
      totalCandidates: anchors.length,
      version: "1.0",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "anchors.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Reads a user-selected file into an ArrayBuffer.
   * @param file - Browser file handle from a drop or input event.
   * @returns The full file contents.
   */
  function readBuffer(file: File) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result as ArrayBuffer);
      reader.onerror = () => reject(new Error("FileReader failed"));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Loads the scene point cloud and splat mesh from an SPZ or PLY file.
   * @param file - Scene file chosen by the user.
   */
  async function loadSceneFile(file: File) {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".spz") && !name.endsWith(".ply")) {
      window.alert("Please use a .spz or .ply file.");
      return;
    }

    showLoading(
      `Loading ${file.name}...`,
      name.endsWith(".spz") ? "Decompressing gzip..." : "Parsing PLY...",
    );

    try {
      console.groupCollapsed("[anchor-tagger] loadSceneFile");
      console.info("[anchor-tagger] Starting scene load.", {
        fileName: file.name,
        fileSize: file.size,
        fileType: name.endsWith(".spz") ? "spz" : "ply",
      });
      clearPropModels();
      disposeLoadedSceneMeshes();
      const fileBytes = await readBuffer(file);
      console.info("[anchor-tagger] File bytes loaded.", {
        byteLength: fileBytes.byteLength,
      });
      const { count, positions } = name.endsWith(".spz")
        ? await parseSpzPositions(fileBytes)
        : parsePlyPositions(fileBytes);
      console.info("[anchor-tagger] Point positions parsed.", {
        count,
      });
      if (!count) {
        throw new Error("No points found in the supplied file.");
      }

      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let index = 0; index < count; index += 1) {
        cx += positions[index * 3];
        cy += positions[index * 3 + 1];
        cz += positions[index * 3 + 2];
      }
      cx /= count;
      cy /= count;
      cz /= count;

      for (let index = 0; index < count; index += 1) {
        positions[index * 3] -= cx;
        positions[index * 3 + 1] -= cy;
        positions[index * 3 + 2] -= cz;
      }

      sceneScale = computeSceneScale(positions, count);
      sourceRayPositions = positions;
      sourceRayCount = count;

      const rayPositions = buildRaycastPositions(positions, count);
      console.info("[anchor-tagger] Raycast cloud prepared.", {
        raycastPointCount: rayPositions.length / 3,
        sceneScale,
      });
      const rayGeometry = new BufferGeometry();
      rayGeometry.setAttribute("position", new Float32BufferAttribute(rayPositions, 3));
      rayCloud = new Points(rayGeometry, new PointsMaterial({ visible: false }));
      scene.add(rayCloud);

      sceneContentOffset.set(-cx, -cy, -cz);
      ensureSparkShaderChunk();
      const SplatMesh = await loadSparkSplatMesh();
      const splatMesh = new SplatMesh({ fileBytes, fileName: file.name });
      splatMesh.position.copy(sceneContentOffset);
      scenePointCloud = splatMesh;
      scene.add(splatMesh);
      await withDebugTimeout("splatMesh.initialized", splatMesh.initialized);

      orbit.r = sceneScale * 1.5;
      orbit.phi = 1.1;
      orbit.theta = 0.3;
      orbitTarget.set(0, 0, 0);
      updateCamera();
      propLights.hemi.intensity = 1.15;
      propLights.dir.intensity = 1.3;
      propLights.dir.position.set(sceneScale * 0.45, sceneScale * 0.9, sceneScale * 0.6);
      if (propSourceScene) {
        refreshPropTemplateForScene();
      }

      syncPropCountInput();
      elements.dropMessage.classList.add("hidden");
      elements.filePointPill.textContent = `${count.toLocaleString()} pts`;
      elements.fileLoaded.textContent = `✓ ${file.name}`;
      elements.fileLoaded.style.display = "block";
      updateUi();
      hideLoading();
      if (currentPlacements.length) {
        await renderPlacements(currentPlacements);
      }
      requestRender();
    } catch (error) {
      hideLoading();
      const message = error instanceof Error ? error.message : "Unknown scene load error";
      console.error("[anchor-tagger] Scene load failed.", {
        error,
        fileName: file.name,
      });
      window.alert(`Error loading file: ${message}`);
    } finally {
      console.groupEnd();
    }
  }

  /**
   * Removes currently loaded scene geometry and raycast point data before loading a new file.
   */
  function disposeLoadedSceneMeshes() {
    if (scenePointCloud) {
      scene.remove(scenePointCloud);
      if ("geometry" in scenePointCloud && scenePointCloud.geometry) {
        scenePointCloud.geometry.dispose();
      }
      if ("material" in scenePointCloud && scenePointCloud.material) {
        if (Array.isArray(scenePointCloud.material)) {
          scenePointCloud.material.forEach((material) => material.dispose());
        } else {
          scenePointCloud.material.dispose();
        }
      }
      scenePointCloud = null;
    }
    if (rayCloud) {
      scene.remove(rayCloud);
      rayCloud.geometry.dispose();
      rayCloud.material.dispose();
      rayCloud = null;
    }
    sourceRayPositions = null;
    sourceRayCount = 0;
    sceneContentOffset.set(0, 0, 0);
  }

  /**
   * Computes the maximum scene extent so interaction radii scale with the point cloud.
   * @param positions - Centered point positions.
   * @param count - Number of points in the cloud.
   * @returns Maximum axis-aligned extent.
   */
  function computeSceneScale(positions: Float32Array, count: number) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let index = 0; index < count; index += 1) {
      const x = positions[index * 3];
      const y = positions[index * 3 + 1];
      const z = positions[index * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    return Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  }

  /**
   * Parses SPZ point positions from a gzipped file buffer.
   * @param buffer - Raw `.spz` bytes.
   * @returns Centerable point positions and point count.
   * @remarks The viewer uses the stable `pako` path directly because native decompression repeatedly stalls in the current browser environment.
   */
  async function parseSpzPositions(buffer: ArrayBuffer) {
    const decompressed = decompressPako(buffer);
    console.info("[anchor-tagger] Pako gzip decompression completed.", {
      byteLength: decompressed.byteLength,
    });

    const bytes = new Uint8Array(decompressed);
    const view = new DataView(decompressed);
    const numPoints = view.getUint32(8, true);
    const fractBits = bytes[13] ?? 0;
    console.info("[anchor-tagger] Parsed SPZ header.", {
      fractBits,
      numPoints,
    });
    if (numPoints === 0 || numPoints > 50_000_000) {
      throw new Error(`Unexpected numPoints: ${numPoints}`);
    }

    const positions = new Float32Array(numPoints * 3);
    const colors = new Float32Array(numPoints * 3);
    const positionScale = 1 / (1 << fractBits);
    for (let index = 0; index < numPoints; index += 1) {
      const offset = 16 + index * 9;
      positions[index * 3] = readSigned24(bytes, offset) * positionScale;
      positions[index * 3 + 1] = readSigned24(bytes, offset + 3) * positionScale;
      positions[index * 3 + 2] = readSigned24(bytes, offset + 6) * positionScale;
    }

    const alphaOffset = 16 + numPoints * 9;
    const colorOffset = alphaOffset + numPoints;
    for (let index = 0; index < numPoints; index += 1) {
      const offset = colorOffset + index * 3;
      colors[index * 3] = (bytes[offset] ?? 191) / 255;
      colors[index * 3 + 1] = (bytes[offset + 1] ?? 212) / 255;
      colors[index * 3 + 2] = (bytes[offset + 2] ?? 255) / 255;
    }

    return { colors, count: numPoints, positions };
  }

  /**
   * Reads one signed 24-bit integer from an SPZ byte buffer.
   * @param bytes - Source byte array.
   * @param offset - Starting byte offset for the packed integer.
   * @returns Sign-extended integer value.
   */
  function readSigned24(bytes: Uint8Array, offset: number) {
    let value = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
    if (value & 0x800000) {
      value |= 0xff000000;
    }
    return value | 0;
  }

  /**
   * Inflates a gzip buffer through the globally loaded `pako` fallback.
   * @param buffer - Compressed SPZ bytes.
   * @returns Decompressed payload buffer.
   */
  function decompressPako(buffer: ArrayBuffer) {
    const inflated = pako.inflate(new Uint8Array(buffer));
    console.info("[anchor-tagger] Pako inflate finished.", {
      byteLength: inflated.byteLength,
    });
    return inflated.buffer.slice(
      inflated.byteOffset,
      inflated.byteOffset + inflated.byteLength,
    ) as ArrayBuffer;
  }

  /**
   * Parses vertex positions from either ASCII or binary PLY files.
   * @param buffer - Raw `.ply` bytes.
   * @returns Position buffer and vertex count.
   */
  function parsePlyPositions(buffer: ArrayBuffer) {
    const headerProbe = new TextDecoder().decode(
      new Uint8Array(buffer, 0, Math.min(8192, buffer.byteLength)),
    );
    if (!headerProbe.startsWith("ply")) {
      throw new Error("Not a PLY file");
    }

    const format = headerProbe.includes("binary_big_endian")
      ? "big"
      : headerProbe.includes("binary_little_endian")
        ? "little"
        : "ascii";
    const headerEnd = headerProbe.indexOf("end_header");
    if (headerEnd < 0) {
      throw new Error("Missing end_header");
    }

    const header = headerProbe.substring(0, headerEnd + "end_header".length);
    let vertexCount = 0;
    let inVertexBlock = false;
    const properties: Array<{ name: string; type: string }> = [];
    for (const rawLine of header.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("element vertex")) {
        vertexCount = Number.parseInt(line.split(" ")[2] ?? "0", 10);
        inVertexBlock = true;
      } else if (line.startsWith("element") && !line.startsWith("element vertex")) {
        inVertexBlock = false;
      } else if (line.startsWith("property") && inVertexBlock) {
        const [_, type, name] = line.split(/\s+/);
        properties.push({ name: name ?? "", type: type ?? "float" });
      }
    }

    const xIndex = properties.findIndex((property) => property.name === "x");
    const yIndex = properties.findIndex((property) => property.name === "y");
    const zIndex = properties.findIndex((property) => property.name === "z");
    const rIndex = properties.findIndex(
      (property) => property.name === "red" || property.name === "r",
    );
    const gIndex = properties.findIndex(
      (property) => property.name === "green" || property.name === "g",
    );
    const bIndex = properties.findIndex(
      (property) => property.name === "blue" || property.name === "b",
    );
    if (xIndex < 0 || yIndex < 0 || zIndex < 0) {
      throw new Error("PLY vertex properties must include x, y, and z.");
    }

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    fillDefaultPointColors(colors);
    if (format === "ascii") {
      parseAsciiPlyPositions(
        buffer,
        vertexCount,
        positions,
        colors,
        xIndex,
        yIndex,
        zIndex,
        rIndex,
        gIndex,
        bIndex,
      );
      return { colors, count: vertexCount, positions };
    }

    parseBinaryPlyPositions(
      buffer,
      header,
      format,
      properties,
      positions,
      colors,
      xIndex,
      yIndex,
      zIndex,
      rIndex,
      gIndex,
      bIndex,
    );
    return { colors, count: vertexCount, positions };
  }

  /**
   * Parses ASCII PLY vertices into the shared position buffer.
   * @param buffer - Raw file bytes.
   * @param vertexCount - Number of vertex rows to read.
   * @param positions - Output position buffer.
   * @param xIndex - Column index for x.
   * @param yIndex - Column index for y.
   * @param zIndex - Column index for z.
   */
  function parseAsciiPlyPositions(
    buffer: ArrayBuffer,
    vertexCount: number,
    positions: Float32Array,
    colors: Float32Array,
    xIndex: number,
    yIndex: number,
    zIndex: number,
    rIndex: number,
    gIndex: number,
    bIndex: number,
  ) {
    const body = new TextDecoder().decode(new Uint8Array(buffer));
    const start = body.indexOf("end_header\n") + "end_header\n".length;
    const lines = body.substring(start).split("\n");
    for (let index = 0; index < vertexCount && index < lines.length; index += 1) {
      const values = lines[index]?.trim().split(/\s+/) ?? [];
      positions[index * 3] = Number.parseFloat(values[xIndex] ?? "0");
      positions[index * 3 + 1] = Number.parseFloat(values[yIndex] ?? "0");
      positions[index * 3 + 2] = Number.parseFloat(values[zIndex] ?? "0");
      assignNormalizedColorFromRow(colors, index, values, rIndex, gIndex, bIndex);
    }
  }

  /**
   * Parses binary PLY vertices into the shared position buffer.
   * @param buffer - Raw file bytes.
   * @param header - Decoded header string.
   * @param format - Endianness marker from the header.
   * @param properties - Vertex property declarations.
   * @param positions - Output position buffer.
   * @param xIndex - Column index for x.
   * @param yIndex - Column index for y.
   * @param zIndex - Column index for z.
   */
  function parseBinaryPlyPositions(
    buffer: ArrayBuffer,
    header: string,
    format: "big" | "little",
    properties: Array<{ name: string; type: string }>,
    positions: Float32Array,
    colors: Float32Array,
    xIndex: number,
    yIndex: number,
    zIndex: number,
    rIndex: number,
    gIndex: number,
    bIndex: number,
  ) {
    const sizeByType: Record<string, number> = {
      char: 1,
      double: 8,
      float: 4,
      int: 4,
      int8: 1,
      int32: 4,
      short: 2,
      uchar: 1,
      uint: 4,
      uint32: 4,
      uint8: 1,
      ushort: 2,
    };
    const littleEndian = format === "little";
    const dataStart = new TextEncoder().encode(`${header}\n`).length;
    const view = new DataView(buffer, dataStart);

    const offsets: number[] = [];
    let rowSize = 0;
    for (const property of properties) {
      offsets.push(rowSize);
      rowSize += sizeByType[property.type] ?? 4;
    }

    /**
     * Reads one numeric property out of a binary vertex row.
     * @param rowOffset - Starting byte offset for the row.
     * @param propertyIndex - Property index to read.
     * @returns Numeric value cast to float-compatible output.
     */
    function readValue(rowOffset: number, propertyIndex: number) {
      const property = properties[propertyIndex];
      const offset = rowOffset + (offsets[propertyIndex] ?? 0);
      switch (property?.type) {
        case "double":
          return view.getFloat64(offset, littleEndian);
        case "uchar":
        case "uint8":
          return view.getUint8(offset);
        case "char":
        case "int8":
          return view.getInt8(offset);
        case "short":
          return view.getInt16(offset, littleEndian);
        case "ushort":
          return view.getUint16(offset, littleEndian);
        case "int":
        case "int32":
          return view.getInt32(offset, littleEndian);
        case "uint":
        case "uint32":
          return view.getUint32(offset, littleEndian);
        case "float":
        default:
          return view.getFloat32(offset, littleEndian);
      }
    }

    for (let index = 0; index < positions.length / 3; index += 1) {
      const rowOffset = index * rowSize;
      positions[index * 3] = readValue(rowOffset, xIndex);
      positions[index * 3 + 1] = readValue(rowOffset, yIndex);
      positions[index * 3 + 2] = readValue(rowOffset, zIndex);
      assignNormalizedColor(
        colors,
        index,
        rIndex >= 0 ? Number(readValue(rowOffset, rIndex)) : undefined,
        gIndex >= 0 ? Number(readValue(rowOffset, gIndex)) : undefined,
        bIndex >= 0 ? Number(readValue(rowOffset, bIndex)) : undefined,
      );
    }
  }

  /**
   * Fills one color buffer with the viewer's fallback room tint.
   * @param colors - Output RGB buffer in normalized float form.
   * @remarks Provides a stable fallback when scene files omit per-point color data.
   */
  function fillDefaultPointColors(colors: Float32Array) {
    for (let index = 0; index < colors.length; index += 3) {
      colors[index] = 191 / 255;
      colors[index + 1] = 212 / 255;
      colors[index + 2] = 255 / 255;
    }
  }

  /**
   * Writes one normalized RGB triplet into the shared point-color buffer.
   * @param colors - Output RGB buffer in normalized float form.
   * @param pointIndex - Vertex index whose color should be assigned.
   * @param red - Optional red channel in byte or float form.
   * @param green - Optional green channel in byte or float form.
   * @param blue - Optional blue channel in byte or float form.
   * @remarks PLY color channels may arrive as either bytes or floats, so this helper normalizes both cases consistently.
   */
  function assignNormalizedColor(
    colors: Float32Array,
    pointIndex: number,
    red?: number,
    green?: number,
    blue?: number,
  ) {
    if (red === undefined || green === undefined || blue === undefined) {
      return;
    }

    const offset = pointIndex * 3;
    colors[offset] = normalizeColorChannel(red);
    colors[offset + 1] = normalizeColorChannel(green);
    colors[offset + 2] = normalizeColorChannel(blue);
  }

  /**
   * Reads optional RGB values out of one parsed ASCII PLY row and normalizes them.
   * @param colors - Output RGB buffer in normalized float form.
   * @param pointIndex - Vertex index whose color should be assigned.
   * @param values - Tokenized ASCII PLY row.
   * @param rIndex - Column index for red, or `-1` when absent.
   * @param gIndex - Column index for green, or `-1` when absent.
   * @param bIndex - Column index for blue, or `-1` when absent.
   */
  function assignNormalizedColorFromRow(
    colors: Float32Array,
    pointIndex: number,
    values: string[],
    rIndex: number,
    gIndex: number,
    bIndex: number,
  ) {
    assignNormalizedColor(
      colors,
      pointIndex,
      rIndex >= 0 ? Number.parseFloat(values[rIndex] ?? "") : undefined,
      gIndex >= 0 ? Number.parseFloat(values[gIndex] ?? "") : undefined,
      bIndex >= 0 ? Number.parseFloat(values[bIndex] ?? "") : undefined,
    );
  }

  /**
   * Normalizes one color channel that may be stored as either a byte or a unit float.
   * @param value - Raw color channel value from SPZ or PLY data.
   * @returns The channel in the `[0, 1]` range expected by Three.js vertex colors.
   */
  function normalizeColorChannel(value: number) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    if (value <= 1) {
      return Math.max(0, Math.min(1, value));
    }

    return Math.max(0, Math.min(1, value / 255));
  }

  /**
   * Downsamples the source point cloud used for interaction raycasts.
   * @param positions - Full position buffer.
   * @param count - Number of source points.
   * @returns Either the full array or a sampled copy.
   */
  function buildRaycastPositions(positions: Float32Array, count: number) {
    const stride = getRaycastStride(count);
    if (stride <= 1) {
      return positions;
    }

    const sampleCount = Math.ceil(count / stride);
    const sampled = new Float32Array(sampleCount * 3);
    let outputIndex = 0;
    for (let index = 0; index < count; index += stride) {
      const source = index * 3;
      sampled[outputIndex++] = positions[source];
      sampled[outputIndex++] = positions[source + 1];
      sampled[outputIndex++] = positions[source + 2];
    }
    return sampled;
  }

  /**
   * Chooses the raycast sampling stride used in performance mode.
   * @param count - Total number of source points.
   * @returns Sampling stride where `1` means no downsampling.
   */
  function getRaycastStride(count: number) {
    if (performanceMode) {
      if (count > 4_000_000) return 24;
      if (count > 2_000_000) return 16;
      if (count > 1_000_000) return 12;
      if (count > 400_000) return 8;
      if (count > 150_000) return 4;
      return 2;
    }

    if (count > 2_000_000) return 8;
    if (count > 1_000_000) return 6;
    if (count > 400_000) return 4;
    if (count > 150_000) return 2;
    return 1;
  }

  /**
   * Rebuilds the hidden raycast cloud after the performance toggle changes.
   */
  function rebuildRayCloud() {
    if (!rayCloud || !sourceRayPositions || !sourceRayCount) {
      return;
    }

    const rebuilt = buildRaycastPositions(sourceRayPositions, sourceRayCount);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(rebuilt, 3));
    rayCloud.geometry.dispose();
    rayCloud.geometry = geometry;
  }

  /**
   * Loads a GLB prop used for anchor scattering.
   * @param file - GLB file selected by the user.
   */
  async function loadPropFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".glb")) {
      window.alert("Please use a .glb file for prop scatter.");
      return;
    }

    showLoading(`Loading ${file.name}...`, "Preparing GLB prop...");
    try {
      const bytes = await readBuffer(file);
      const gltf = await parseGlb(bytes);
      clearPropModels();
      propSourceScene = gltf.scene;
      refreshPropTemplateForScene();
      elements.propLoaded.textContent = `✓ ${file.name}`;
      elements.propLoaded.style.display = "block";
      hideLoading();
      requestRender();
    } catch (error) {
      hideLoading();
      const message = error instanceof Error ? error.message : "Unknown GLB error";
      window.alert(`Error loading GLB: ${message}`);
      console.error(error);
    }
  }

  /**
   * Parses a GLB file via Three's GLTFLoader.
   * @param buffer - Raw GLB file bytes.
   * @returns Resolved GLTF asset.
   */
  function parseGlb(buffer: ArrayBuffer) {
    return new Promise<{ scene: Object3D }>((resolve, reject) => {
      gltfLoader.parse(buffer, "", (gltf) => resolve(gltf as { scene: Object3D }), reject);
    });
  }

  /**
   * Rebuilds the reusable prop template after either the scene scale or GLB asset changes.
   */
  function refreshPropTemplateForScene() {
    if (!propSourceScene) {
      return;
    }

    propTemplate = cloneSkinned(propSourceScene);
    normalizePropTemplate(propTemplate);
    propBlueprints = buildPropBlueprints(propTemplate);
    propPlacementMode = propBlueprints.length ? "instanced" : "clone";
  }

  /**
   * Normalizes the GLB root so props sit upright and scale to anchor markers.
   * @param root - Cloned GLB scene root.
   */
  function normalizePropTemplate(root: Object3D) {
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    const size = new Vector3();
    const center = new Vector3();
    box.getSize(size);
    box.getCenter(center);
    root.position.sub(center);

    const maxDimension = Math.max(size.x, size.y, size.z) || 1;
    const scale = getAnchorVisualSize() / maxDimension;
    root.scale.setScalar(scale);
    root.position.y += size.y * 0.5 * scale;
    root.updateMatrixWorld(true);
  }

  /**
   * Returns the target world-space size used for prop normalization.
   */
  function getAnchorVisualSize() {
    return Math.max(sceneScale * ANCHOR_STEM_HEIGHT, sceneScale * ANCHOR_RING_OUTER_RADIUS * 2);
  }

  /**
   * Derives instancing blueprints when the GLB structure supports it.
   * @param root - Normalized prop template.
   * @returns Instancing blueprints or an empty array when cloning is required.
   */
  function buildPropBlueprints(root: Object3D) {
    const blueprints: PropBlueprint[] = [];
    let canInstance = true;
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      const mesh = object as Mesh;
      if ((object as any).isSkinnedMesh) {
        canInstance = false;
      }
      if (!(object as any).isMesh) {
        return;
      }
      if (Array.isArray(mesh.material)) {
        canInstance = false;
      }
      if ((mesh as any).morphTargetInfluences?.length) {
        canInstance = false;
      }
      if (!mesh.geometry || !mesh.material) {
        canInstance = false;
        return;
      }
      blueprints.push({
        geometry: mesh.geometry,
        material: mesh.material,
        matrix: object.matrixWorld.clone(),
      });
    });
    return canInstance ? blueprints : [];
  }

  /**
   * Randomly scatters prop instances across a subset of anchors.
   */
  function scatterPropModels() {
    if (!propTemplate) {
      window.alert("Load a .glb prop first.");
      return;
    }
    if (!anchors.length) {
      window.alert("Place at least one anchor first.");
      return;
    }

    clearPropModels();
    const selection = chooseScatterAnchors();
    if (propPlacementMode === "instanced") {
      scatterInstancedProps(selection);
    } else {
      for (const anchor of selection) {
        placePropAtAnchor(anchor);
      }
    }
    requestRender();
  }

  /**
   * Re-runs prop scatter using the same control flow as the standalone prototype.
   */
  function rerollPropModels() {
    scatterPropModels();
  }

  /**
   * Chooses the requested number of anchors in a randomized order.
   * @returns Selected anchors for prop placement.
   */
  function chooseScatterAnchors() {
    const raw = elements.propCountInput.value.trim();
    const requested = raw ? Math.max(1, Number.parseInt(raw, 10) || 1) : anchors.length;
    const limit = Math.min(requested, anchors.length);
    const shuffled = [...anchors];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
    }
    return shuffled.slice(0, limit);
  }

  /**
   * Places one cloned prop at the provided anchor.
   * @param anchor - Anchor to receive the prop.
   */
  function placePropAtAnchor(anchor: AnchorRecord) {
    if (!propTemplate) {
      return;
    }

    const root = cloneSkinned(propTemplate);
    root.position.set(anchor.position.x, anchor.position.y, anchor.position.z);
    root.rotation.y = Math.random() * Math.PI * 2;
    root.updateMatrixWorld(true);
    scene.add(root);
    placedPropRoots.push(root);
  }

  /**
   * Removes all previously scattered prop objects from the scene.
   */
  function clearPropModels() {
    for (const root of placedPropRoots) {
      root.removeFromParent();
    }
    for (const mesh of placedPropInstancedMeshes) {
      mesh.removeFromParent();
    }
    placedPropRoots = [];
    placedPropInstancedMeshes = [];
    requestRender();
  }

  /**
   * Normalizes one placement asset URL to the same-origin proxy path expected by the viewer.
   * @param assetUrl - Placement asset URL returned by the placement payload.
   * @returns Same-origin asset URL safe for `GLTFLoader` browser fetches.
   * @remarks Some running clients can still receive absolute storage URLs from stale server code, so the viewer defensively rewrites them through the proxy.
   */
  function normalizePlacementAssetUrl(assetUrl: string) {
    if (!assetUrl) {
      return assetUrl;
    }

    if (assetUrl.startsWith("/api/game/asset?")) {
      return assetUrl;
    }

    if (/^https?:\/\//iu.test(assetUrl)) {
      return `/api/game/asset?url=${encodeURIComponent(assetUrl)}`;
    }

    return assetUrl;
  }

  /**
   * Loads and caches a GLB scene used by one or more generated concept placements.
   * @param assetUrl - Public asset URL returned by the asset-generation pipeline.
   * @returns A reusable scene root for later cloning.
   * @remarks Promise caching prevents repeated network fetches when multiple placements reference the same generated asset.
   */
  async function loadPlacementAssetScene(assetUrl: string) {
    const normalizedAssetUrl = normalizePlacementAssetUrl(assetUrl);
    let promise = placementAssetPromises.get(normalizedAssetUrl);
    if (!promise) {
      promise = gltfLoader.loadAsync(normalizedAssetUrl).then((gltf) => gltf.scene);
      placementAssetPromises.set(normalizedAssetUrl, promise);
    }
    return promise;
  }

  /**
   * Applies the current room-scene recentering offset to one imported anchor position.
   * @param placement - Generated placement anchored in the source room coordinate space.
   * @returns World position aligned to the currently loaded centered room scene.
   * @remarks Scene files are shifted by their centroid on load, so placements must receive the same translation or they drift away from the room.
   */
  function getPlacementWorldPosition(placement: RoomPlacementItem) {
    return new Vector3(
      placement.position.x + sceneContentOffset.x,
      placement.position.y + sceneContentOffset.y,
      placement.position.z + sceneContentOffset.z,
    );
  }

  /**
   * Snaps one placement position to the visible sampled room surface near the anchor.
   * @param placement - Placement metadata anchored in the imported room coordinate space.
   * @returns World position whose Y value is derived from the loaded room surface when available.
   * @remarks Imported anchor heights are not reliable enough on their own, so floor placement uses the sampled point cloud as the final support surface.
   */
  function getSnappedPlacementWorldPosition(placement: RoomPlacementItem) {
    const worldPosition = getPlacementWorldPosition(placement);
    if (!rayCloud) {
      return worldPosition;
    }

    const positions = rayCloud.geometry.getAttribute("position");
    if (!positions) {
      return worldPosition;
    }

    const targetSize = getPlacementTargetSize(placement);
    const searchRadius = Math.max(targetSize * 0.9, sceneScale * 0.02);
    const fallbackRadius = Math.max(targetSize * 1.8, sceneScale * 0.04);
    const upwardTolerance = Math.max(targetSize * 0.75, sceneScale * 0.04);
    const downwardTolerance = Math.max(targetSize * 0.18, sceneScale * 0.015);
    let bestSupportY = Infinity;
    let bestSupportHorizontalDistanceSq = Infinity;
    let foundSupportPoint = false;
    let nearestDistanceSq = Infinity;
    let nearestY = worldPosition.y;

    for (let index = 0; index < positions.count; index += 1) {
      const pointX = positions.getX(index);
      const pointY = positions.getY(index);
      const pointZ = positions.getZ(index);
      const dx = pointX - worldPosition.x;
      const dz = pointZ - worldPosition.z;
      const horizontalDistanceSq = dx * dx + dz * dz;

      if (horizontalDistanceSq <= searchRadius * searchRadius) {
        const verticalDelta = pointY - worldPosition.y;
        if (verticalDelta >= -downwardTolerance && verticalDelta <= upwardTolerance) {
          const isBetterSupport =
            pointY < bestSupportY ||
            (Math.abs(pointY - bestSupportY) < 1e-4 &&
              horizontalDistanceSq < bestSupportHorizontalDistanceSq);

          if (isBetterSupport) {
            bestSupportY = pointY;
            bestSupportHorizontalDistanceSq = horizontalDistanceSq;
            foundSupportPoint = true;
          }
        }
      }

      if (
        horizontalDistanceSq <= fallbackRadius * fallbackRadius &&
        horizontalDistanceSq < nearestDistanceSq
      ) {
        nearestDistanceSq = horizontalDistanceSq;
        nearestY = pointY;
      }
    }

    if (foundSupportPoint) {
      worldPosition.y = bestSupportY;
      return worldPosition;
    }

    if (nearestDistanceSq < Infinity) {
      worldPosition.y = nearestY;
    }

    return worldPosition;
  }

  /**
   * Normalizes one generated placement model so it is centered, grounded, and visible at anchor scale.
   * @param root - Cloned GLB scene root for one placement.
   * @returns `true` when the model produced a finite bounding box and was normalized successfully.
   * @remarks TRELLIS outputs can vary wildly in root offset and scale, so placements reuse the stable prototype normalization path before entering the room.
   */
  function normalizePlacementRoot(root: Object3D, placement: RoomPlacementItem) {
    root.updateMatrixWorld(true);
    const initialBox = new Box3().setFromObject(root);
    if (initialBox.isEmpty()) {
      return false;
    }

    const size = new Vector3();
    const center = new Vector3();
    initialBox.getSize(size);
    initialBox.getCenter(center);
    const maxDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
      return false;
    }

    root.position.sub(center);
    const scale = getPlacementTargetSize(placement) / maxDimension;
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);

    const groundedBox = new Box3().setFromObject(root);
    if (groundedBox.isEmpty()) {
      return false;
    }

    const groundedSize = new Vector3();
    groundedBox.getSize(groundedSize);
    const clearance = getPlacementClearance(placement, groundedSize.y);
    root.position.y += -groundedBox.min.y + clearance;
    root.updateMatrixWorld(true);
    return true;
  }

  /**
   * Returns whether one placement targets a floor-like support surface.
   * @param placement - Placement metadata including the semantic anchor surface label.
   * @returns `true` when the anchor label describes a surface that tends to visually absorb meshes.
   * @remarks Floor splats render with noticeable thickness, so those placements need more aggressive lift and depth bias than wall or shelf anchors.
   */
  function isFloorLikePlacement(placement: RoomPlacementItem) {
    const surface = placement.surface.trim().toLowerCase();
    return (
      surface.length === 0 ||
      surface === "surface" ||
      surface.includes("floor") ||
      surface.includes("rug") ||
      surface.includes("carpet") ||
      surface.includes("ground") ||
      surface.includes("stair") ||
      surface.includes("step")
    );
  }

  /**
   * Returns the local target size for one generated placement.
   * @param placement - Placement metadata used to look up nearby anchors.
   * @returns Maximum desired object dimension in room-space units.
   * @remarks Scaling from nearest-anchor spacing is more stable than scaling from whole-room extent because it keeps objects small enough for the actual anchor density.
   */
  function getPlacementTargetSize(placement: RoomPlacementItem) {
    const anchors = activeAnchorSet?.anchors ?? [];
    const currentAnchor = anchors.find((anchor) => anchor.id === placement.anchorId);
    if (!currentAnchor || anchors.length <= 1) {
      return Math.max(sceneScale * 0.02, Math.min(sceneScale * 0.035, getAnchorVisualSize() * 1.2));
    }

    let nearestDistance = Infinity;
    for (const anchor of anchors) {
      if (anchor.id === currentAnchor.id) {
        continue;
      }

      const distance = Math.hypot(
        currentAnchor.position.x - anchor.position.x,
        currentAnchor.position.y - anchor.position.y,
        currentAnchor.position.z - anchor.position.z,
      );
      nearestDistance = Math.min(nearestDistance, distance);
    }

    if (!Number.isFinite(nearestDistance)) {
      return Math.max(sceneScale * 0.02, Math.min(sceneScale * 0.035, getAnchorVisualSize() * 1.2));
    }

    return Math.max(sceneScale * 0.02, Math.min(nearestDistance * 0.3, sceneScale * 0.035));
  }

  /**
   * Returns the additional vertical clearance used after grounding a generated placement.
   * @param placement - Placement metadata including the semantic surface label.
   * @param height - Post-scale placement height.
   * @returns Upward offset that keeps objects visibly above dense scanned surfaces.
   * @remarks Floor-like anchors need a slightly larger buffer because splat surfaces render with thickness and can visually swallow thin meshes.
   */
  function getPlacementClearance(placement: RoomPlacementItem, height: number) {
    const baseClearance = Math.max(height * 0.06, sceneScale * 0.004);
    if (!isFloorLikePlacement(placement)) {
      return baseClearance;
    }

    return Math.max(height * 0.1, sceneScale * 0.008);
  }

  /**
   * Applies mesh-level render bias for one generated placement.
   * @param root - Placement root whose renderable meshes should be tuned.
   * @param placement - Placement metadata describing the target support surface.
   * @remarks Floor placements receive polygon offset so the room splat is less likely to visually cut through them at close depth values.
   */
  function configurePlacementRendering(root: Object3D, placement: RoomPlacementItem) {
    const floorLikePlacement = isFloorLikePlacement(placement);
    root.userData.roomPlacement = placement;
    root.traverse((object) => {
      const mesh = object as Mesh;
      object.userData.roomPlacement = placement;
      if (!(mesh as any).isMesh) {
        return;
      }

      object.renderOrder = floorLikePlacement ? 4 : 3;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) {
          continue;
        }

        material.side = DoubleSide;
        material.depthTest = true;
        material.depthWrite = true;
        material.polygonOffset = floorLikePlacement;
        material.polygonOffsetFactor = floorLikePlacement ? -2 : 0;
        material.polygonOffsetUnits = floorLikePlacement ? -4 : 0;
      }
    });
  }

  /**
   * Renders the current set of generated object placements.
   * @param placements - Generated concept asset placements selected for the active room.
   * @remarks Individual asset load failures are logged and skipped so room viewability is never blocked by one broken model URL.
   */
  async function renderPlacements(placements: RoomPlacementItem[]) {
    currentPlacements = [...placements];
    clearPropModels();
    placementInspectListener?.(null);

    for (const placement of placements) {
      try {
        const template = await loadPlacementAssetScene(placement.assetUrl);
        const root = cloneSkinned(template);
        const normalized = normalizePlacementRoot(root, placement);
        if (!normalized) {
          console.warn("[anchor-tagger] Placement asset produced an empty bounding box.", {
            assetUrl: placement.assetUrl,
            conceptId: placement.conceptId,
          });
        }
        configurePlacementRendering(root, placement);
        const worldPosition = getSnappedPlacementWorldPosition(placement);
        root.position.add(worldPosition);
        root.rotation.y = Math.random() * Math.PI * 2;
        root.updateMatrixWorld(true);
        scene.add(root);
        placedPropRoots.push(root);
      } catch (error) {
        console.error("[anchor-tagger] Failed to load placement asset.", {
          assetUrl: placement.assetUrl,
          conceptId: placement.conceptId,
          error,
        });
      }
    }

    requestRender();
  }

  /**
   * Synchronizes the scatter count placeholder with the current anchor count.
   */
  function syncPropCountInput() {
    elements.propCountInput.placeholder = anchors.length
      ? `Leave blank for all ${anchors.length} anchors`
      : "Leave blank for all anchors";
  }

  /**
   * Creates instanced prop meshes when the loaded GLB supports it.
   * @param selection - Anchors chosen for scatter.
   */
  function scatterInstancedProps(selection: AnchorRecord[]) {
    const anchorMatrix = new Matrix4();
    const rotationMatrix = new Matrix4();
    for (const blueprint of propBlueprints) {
      const mesh = new InstancedMesh(blueprint.geometry, blueprint.material, selection.length);
      selection.forEach((anchor, index) => {
        anchorMatrix.makeTranslation(anchor.position.x, anchor.position.y, anchor.position.z);
        rotationMatrix.makeRotationY(Math.random() * Math.PI * 2);
        const matrix = anchorMatrix.clone().multiply(rotationMatrix).multiply(blueprint.matrix);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
      placedPropInstancedMeshes.push(mesh);
    }
  }

  /**
   * Shows the blocking loading overlay with status copy.
   * @param message - Primary status text.
   * @param subMessage - Secondary status text.
   */
  function showLoading(message: string, subMessage: string) {
    elements.loadMessage.textContent = message;
    elements.loadSubMessage.textContent = subMessage;
    elements.loadingOverlay.classList.add("show");
  }

  /**
   * Hides the blocking loading overlay.
   */
  function hideLoading() {
    elements.loadingOverlay.classList.remove("show");
  }

  /**
   * Toggles the reduced raycast/renderer quality mode from the prototype.
   */
  function togglePerformanceMode() {
    performanceMode = !performanceMode;
    elements.btnPerf.classList.toggle("active", performanceMode);
    elements.btnPerf.textContent = `⚡ Performance Mode: ${performanceMode ? "On" : "Off"}`;
    applyRendererQuality();
    rebuildRayCloud();
    requestRender();
  }

  /**
   * Handles click-to-place anchor creation when tag mode is active.
   * @param event - Mouse click from the renderer canvas.
   */
  function onViewportClick(event: MouseEvent) {
    if (mode !== "place" || !rayCloud || isDraggingAnchor) {
      return;
    }
    if (Math.abs(event.clientX - mousedownX) > 5 || Math.abs(event.clientY - mousedownY) > 5) {
      return;
    }
    if (pickAnchor(event.clientX, event.clientY)) {
      return;
    }

    const point = getRayHitFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    const label = elements.anchorLabelInput.value.trim() || `Anchor ${anchors.length + 1}`;
    addAnchor(point, label, elements.anchorSurfaceSelect.value);
    elements.anchorLabelInput.value = "";
  }

  /**
   * Wires orbit controls, drag repositioning, and viewport click handling.
   */
  function initOrbit() {
    const canvas = renderer.domElement;

    addListener(canvas, "mousedown", ((event: MouseEvent) => {
      mousedownX = event.clientX;
      mousedownY = event.clientY;

      viewportDragging = true;
      rightButton = event.button === 2;
      viewportMouseX = event.clientX;
      viewportMouseY = event.clientY;
      event.preventDefault();
      requestRender();
    }) as EventListener);

    addListener(canvas, "click", ((event: MouseEvent) => {
      if (Math.abs(event.clientX - mousedownX) > 5 || Math.abs(event.clientY - mousedownY) > 5) {
        return;
      }

      const placement = pickPlacement(event.clientX, event.clientY);
      placementInspectListener?.(placement ? toPlacementInspection(placement) : null);
    }) as EventListener);
    addListener(canvas, "contextmenu", ((event: Event) => event.preventDefault()) as EventListener);

    addListener(window, "mouseup", (() => {
      isDraggingAnchor = false;
      draggedAnchor = null;
      pendingDragPointer = null;
      viewportDragging = false;
      requestRender();
    }) as EventListener);

    addListener(window, "mousemove", ((event: MouseEvent) => {
      if (!viewportDragging) {
        return;
      }

      const dx = event.clientX - viewportMouseX;
      const dy = event.clientY - viewportMouseY;
      viewportMouseX = event.clientX;
      viewportMouseY = event.clientY;

      if (rightButton) {
        const right = new Vector3();
        camera.getWorldDirection(right);
        right.cross(camera.up).normalize();
        orbitTarget.addScaledVector(right, -dx * orbit.r * 0.0006);
        orbitTarget.addScaledVector(camera.up, dy * orbit.r * 0.0006);
      } else {
        orbit.theta -= dx * 0.007;
        orbit.phi = Math.max(0.05, Math.min(Math.PI - 0.05, orbit.phi - dy * 0.007));
      }
      updateCamera();
      requestRender();
    }) as EventListener);

    addListener(canvas, "wheel", ((event: WheelEvent) => {
      event.preventDefault();
      orbit.r = Math.max(0.01, orbit.r * (1 + event.deltaY * 0.001));
      updateCamera();
      requestRender();
    }) as EventListener);

    updateCamera();
  }

  /**
   * Handles drag-and-drop scene uploads at the document level.
   */
  function initDragAndDrop() {
    addListener(document, "dragenter", ((event: DragEvent) => {
      event.preventDefault();
      dragCounter += 1;
      elements.dragOverlay.classList.add("show");
    }) as EventListener);

    addListener(document, "dragleave", (() => {
      dragCounter -= 1;
      if (dragCounter <= 0) {
        dragCounter = 0;
        elements.dragOverlay.classList.remove("show");
      }
    }) as EventListener);

    addListener(document, "dragover", ((event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    }) as EventListener);

    addListener(document, "drop", ((event: DragEvent) => {
      event.preventDefault();
      dragCounter = 0;
      elements.dragOverlay.classList.remove("show");
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        void loadSceneFile(file);
      }
    }) as EventListener);
  }

  /**
   * Handles keyboard shortcuts and button-based UI events.
   */
  function initControls() {
    addListener(window, "resize", onResize as EventListener);
    addListener(window, "keydown", ((event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) {
        return;
      }
      if (setMoveKeyState(event.key, true)) {
        event.preventDefault();
        requestRender();
      }
    }) as EventListener);
    addListener(window, "keyup", ((event: KeyboardEvent) => {
      if (setMoveKeyState(event.key, false)) {
        requestRender();
      }
    }) as EventListener);
    addListener(window, "blur", clearMoveKeys as EventListener);

    addListener(elements.fileInput, "change", (() => {
      const file = elements.fileInput.files?.[0];
      if (file) {
        void loadSceneFile(file);
      }
      elements.fileInput.value = "";
    }) as EventListener);
    addListener(elements.dropzone, "click", (() => elements.fileInput.click()) as EventListener);
    addListener(elements.btnPerf, "click", togglePerformanceMode as EventListener);
  }

  // The remaining editor-only helpers stay in the file to minimize risk around the scene-loading
  // runtime, but the room viewer intentionally leaves them unreachable.
  void [
    setMode,
    removeAnchor,
    undoLast,
    clearAll,
    exportJson,
    loadPropFile,
    rerollPropModels,
    onViewportClick,
  ];

  initOrbit();
  initDragAndDrop();
  initControls();
  elements.modeBadge.textContent = "VIEWER";
  elements.modeBadge.classList.remove("place");
  renderer.domElement.style.cursor = "default";
  updateUi();
  onResize();
  requestRender();

  return {
    async loadSceneFile(file: File) {
      await loadSceneFile(file);
    },
    async renderPlacements(placements: RoomPlacementItem[]) {
      await renderPlacements(placements);
    },
    setOnPlacementInspect(listener) {
      placementInspectListener = listener;
    },
    setAnchorSet(anchorSet: RoomAnchorSet | null) {
      setAnchorSet(anchorSet);
    },
    dispose() {
      for (const { event, handler, target } of listeners) {
        target.removeEventListener(event, handler);
      }
      clearPropModels();
      clearMoveKeys();
      disposeLoadedSceneMeshes();
      for (const anchor of anchors) {
        scene.remove(anchor.mesh);
        disposeAnchor(anchor);
      }
      anchors = [];
      renderer.dispose();
      if (elements.viewport.contains(renderer.domElement)) {
        elements.viewport.removeChild(renderer.domElement);
      }
    },
  };
}
