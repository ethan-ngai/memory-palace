import { createRequire } from "node:module";

const DEFAULT_INPUT_PATH = "rohan/car.glb";
const INPUT_PATH = process.env.PLACEMENT_ROOM_INPUT_PATH?.trim() || DEFAULT_INPUT_PATH;
const OUTPUT_DIR_OVERRIDE = process.env.PLACEMENT_OUTPUT_DIR?.trim() || null;
const OUTPUT_BASENAME_OVERRIDE = process.env.PLACEMENT_OUTPUT_BASENAME?.trim() || null;
const SPZ_VISUAL_PATH = process.env.PLACEMENT_SPZ_VISUAL_PATH?.trim() || null;

const DEFAULT_OBJECT_SPECS: PlacementSpec[] = [
  {
    id: "duck",
    inputPath: "rohan/Duck.glb",
    count: 15,
    targetCentroidDistance: 0.35,
    centroidDistanceTolerance: 0.2,
    collisionPadding: 0.02,
    scaleMultiplier: 0.55,
  },
  {
    id: "avocado",
    inputPath: "rohan/Avocado.glb",
    count: 7,
    targetCentroidDistance: 0.25,
    centroidDistanceTolerance: 0.2,
    collisionPadding: 0.02,
    scaleMultiplier: 0.85,
  },
];
const OBJECT_SPECS: PlacementSpec[] = DEFAULT_OBJECT_SPECS;

const SAMPLES = 400;
const NORMAL_THRESHOLD = 0.9;
const MIN_EDGE_DISTANCE = 0.25;
const HEIGHT_TOLERANCE = 0.05;
const SEED: number | null = 12345;
const OBJECT_SCALE_BIAS_CANDIDATES = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
const MIN_AUTO_OBJECT_SCALE = 0.05;
const MAX_AUTO_OBJECT_SCALE = 100;
const YAW_CANDIDATES = 16;
const COUNT_OVERRIDE = readOptionalIntegerEnv("PLACEMENT_COUNT_OVERRIDE");
const MAX_ROOM_FACES = readOptionalIntegerEnv("PLACEMENT_MAX_ROOM_FACES");
const MIN_SURFACE_AREA = readOptionalNumberEnv("PLACEMENT_MIN_SURFACE_AREA") ?? 0;
const MIN_SURFACE_MIN_SPAN = readOptionalNumberEnv("PLACEMENT_MIN_SURFACE_MIN_SPAN") ?? 0;

const require = createRequire(import.meta.url);

type Vec3 = [number, number, number];
type Vec2 = [number, number];

type Face = {
  area: number;
  centroid: Vec3;
  normal: Vec3;
  vertices: [Vec3, Vec3, Vec3];
};

type AxisInfo = {
  axis: number;
  label: "Y-up" | "Z-up";
  up: Vec3;
  tangentAxes: [number, number];
};

type PlacementSpec = {
  id: string;
  inputPath: string;
  count: number;
  targetCentroidDistance: number;
  centroidDistanceTolerance: number;
  collisionPadding?: number;
  scaleMultiplier?: number;
};

type SurfaceCluster = {
  index: number;
  centroid: Vec3;
  faces: Face[];
  height: number;
  samplePoints: Vec3[];
  projectedFaces: [Vec2, Vec2, Vec2][];
  projectedMin: Vec2;
  projectedMax: Vec2;
};

type MeshBounds = {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  size: Vec3;
  base: number;
  top: number;
  footprintRadius: number;
};

type ObjectGeometry = {
  inputPath: string;
  bounds: MeshBounds;
  upAxis: number;
};

type ScaledObjectGeometry = {
  inputPath: string;
  bounds: MeshBounds;
  footprintHalfExtents: Vec2;
  upAxis: number;
  scale: number;
};

type CandidateEvaluation = {
  tooCloseToCentroid: number;
  wrongCentroidDistance: number;
  unsupported: number;
  collided: number;
};

type Placement = {
  center: Vec3;
  footprintHalfExtents: Vec2;
  id: string;
  inputPath: string;
  surfaceIndex: number;
  position: Vec3;
  scale: number;
  yaw: number;
  supportNormal: Vec3;
  centroidDistance: number;
  worldAabbMin: Vec3;
  worldAabbMax: Vec3;
};

type PlanResult = {
  failures: Array<{ id: string; inputPath: string; evaluation: CandidateEvaluation }>;
  objectScaleBias: number;
  placements: Placement[];
  roomAxis: AxisInfo;
  surfaces: SurfaceCluster[];
};

type LoadedAsset = {
  document: import("@gltf-transform/core").Document;
  inputPath: string;
};

const fs = require("node:fs/promises") as typeof import("node:fs/promises");
const path = require("node:path") as typeof import("node:path");
const { NodeIO } = require("@gltf-transform/core") as typeof import("@gltf-transform/core");
const { ALL_EXTENSIONS } =
  require("@gltf-transform/extensions") as typeof import("@gltf-transform/extensions");

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v: Vec3, factor: number): Vec3 {
  return [v[0] * factor, v[1] * factor, v[2] * factor];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function vecLength(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

function normalize(v: Vec3): Vec3 {
  const len = vecLength(v);
  if (len === 0) return [0, 0, 0];
  return scale(v, 1 / len);
}

function component(v: Vec3, axis: number): number {
  return v[axis];
}

function withComponent(v: Vec3, axis: number, value: number): Vec3 {
  const next: Vec3 = [v[0], v[1], v[2]];
  next[axis] = value;
  return next;
}

function vec2Distance(a: Vec2, b: Vec2): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function projectPoint(point: Vec3, axes: [number, number]): Vec2 {
  return [point[axes[0]], point[axes[1]]];
}

function transformPoint(matrix: number[], point: Vec3): Vec3 {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];

  const iw = w !== 0 ? 1 / w : 1;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * iw,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * iw,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * iw,
  ];
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function createRandom(seed: number | null): () => number {
  return seed === null ? () => Math.random() : mulberry32(seed);
}

function readOptionalIntegerEnv(name: string): number | null {
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Reads an optional numeric environment variable used for geometric threshold tuning.
 * @param name - Environment variable name.
 * @returns Parsed finite number, or null when missing/invalid.
 */
function readOptionalNumberEnv(name: string): number | null {
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shuffleInPlace<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

/**
 * Resolves a generated artifact path, optionally redirecting output to a custom directory and basename.
 * @param inputPath - Source room path used as the default stem when no override is provided.
 * @param extension - File extension suffix to append, including the leading dot.
 * @returns Absolute or relative path where the generated artifact should be written.
 */
function resolveOutputPath(inputPath: string, extension: string): string {
  const parsed = path.parse(inputPath);
  const outputDir = OUTPUT_DIR_OVERRIDE ?? parsed.dir;
  const outputBasename = OUTPUT_BASENAME_OVERRIDE ?? parsed.name;
  return path.join(outputDir, `${outputBasename}${extension}`);
}

function getAccessorVec3(accessor: { getArray(): ArrayLike<number> }, index: number): Vec3 {
  const array = accessor.getArray();
  const offset = index * 3;
  return [array[offset], array[offset + 1], array[offset + 2]];
}

function getTriangleIndices(mode: number, vertexCount: number, indices: number[]): number[] {
  if (mode === 4) {
    return indices;
  }

  if (mode === 5) {
    const triangles: number[] = [];
    for (let i = 0; i < indices.length - 2; i += 1) {
      if (i % 2 === 0) {
        triangles.push(indices[i], indices[i + 1], indices[i + 2]);
      } else {
        triangles.push(indices[i + 1], indices[i], indices[i + 2]);
      }
    }
    return triangles;
  }

  if (mode === 6) {
    const triangles: number[] = [];
    for (let i = 1; i < indices.length - 1; i += 1) {
      triangles.push(indices[0], indices[i], indices[i + 1]);
    }
    return triangles;
  }

  throw new Error(
    `Unsupported primitive mode ${mode} for ${vertexCount} vertices. Use TRIANGLES, TRIANGLE_STRIP, or TRIANGLE_FAN.`,
  );
}

function makeSequentialIndices(vertexCount: number): number[] {
  return Array.from({ length: vertexCount }, (_, index) => index);
}

function faceFromTriangle(a: Vec3, b: Vec3, c: Vec3): Face | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const crossProduct = cross(ab, ac);
  const crossLength = vecLength(crossProduct);
  const area = crossLength * 0.5;
  if (area === 0) return null;

  return {
    area,
    centroid: scale(add(add(a, b), c), 1 / 3),
    normal: normalize(crossProduct),
    vertices: [a, b, c],
  };
}

function weightedCentroid(faces: Face[]): Vec3 {
  let totalArea = 0;
  let accum: Vec3 = [0, 0, 0];

  for (const face of faces) {
    totalArea += face.area;
    accum = add(accum, scale(face.centroid, face.area));
  }

  return totalArea === 0 ? [0, 0, 0] : scale(accum, 1 / totalArea);
}

function totalArea(faces: Face[]): number {
  let sum = 0;
  for (const face of faces) sum += face.area;
  return sum;
}

function samplePointOnFace(face: Face, random: () => number): Vec3 {
  const r1 = random();
  const r2 = random();
  const sqrtR1 = Math.sqrt(r1);
  const u = 1 - sqrtR1;
  const v = sqrtR1 * (1 - r2);
  const w = sqrtR1 * r2;

  return add(
    add(scale(face.vertices[0], u), scale(face.vertices[1], v)),
    scale(face.vertices[2], w),
  );
}

function sampleWeightedFace(faces: Face[], random: () => number): Face {
  const areaSum = totalArea(faces);
  if (areaSum === 0) return faces[0];

  let target = random() * areaSum;
  for (const face of faces) {
    target -= face.area;
    if (target <= 0) return face;
  }

  return faces[faces.length - 1];
}

function computeAxisSpread(points: Vec3[], axis: number): number {
  if (points.length === 0) return 0;
  let min = component(points[0], axis);
  let max = min;
  for (const point of points) {
    const value = component(point, axis);
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

function detectUpAxis(faces: Face[]): AxisInfo {
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const face of faces) {
    maxY = Math.max(maxY, dot(face.normal, [0, 1, 0]));
    maxZ = Math.max(maxZ, dot(face.normal, [0, 0, 1]));
  }

  return maxY >= maxZ
    ? { axis: 1, label: "Y-up", up: [0, 1, 0], tangentAxes: [0, 2] }
    : { axis: 2, label: "Z-up", up: [0, 0, 1], tangentAxes: [0, 1] };
}

function clusterHorizontalFaces(faces: Face[]): { axis: number; clusters: Face[][] } {
  const centroids = faces.map((face) => face.centroid);
  const spreads = [
    computeAxisSpread(centroids, 0),
    computeAxisSpread(centroids, 1),
    computeAxisSpread(centroids, 2),
  ];

  let axis = 0;
  for (let i = 1; i < spreads.length; i += 1) {
    if (spreads[i] < spreads[axis]) axis = i;
  }

  const sorted = [...faces].sort(
    (a, b) => component(a.centroid, axis) - component(b.centroid, axis),
  );

  const clusters: Face[][] = [];
  let current: Face[] = [];
  let previousHeight: number | null = null;

  for (const face of sorted) {
    const height = component(face.centroid, axis);
    if (previousHeight !== null && Math.abs(height - previousHeight) > HEIGHT_TOLERANCE) {
      clusters.push(current);
      current = [];
    }

    current.push(face);
    previousHeight = height;
  }

  if (current.length > 0) clusters.push(current);
  return { axis, clusters };
}

function readWorldMatrix(node: { getWorldMatrix(): number[] | ArrayLike<number> }): number[] {
  return Array.from(node.getWorldMatrix());
}

function collectFacesFromPrimitive(
  primitive: {
    getAttribute(name: string): { getArray(): ArrayLike<number>; getCount(): number } | null;
    getIndices(): { getArray(): ArrayLike<number> } | null;
    getMode(): number;
  },
  worldMatrix: number[],
): Face[] {
  const positionAccessor = primitive.getAttribute("POSITION");
  if (!positionAccessor) return [];

  const vertexCount = positionAccessor.getCount();
  const indexAccessor = primitive.getIndices();
  const sourceIndices = indexAccessor
    ? Array.from(indexAccessor.getArray(), (value) => Number(value))
    : makeSequentialIndices(vertexCount);
  const triangles = getTriangleIndices(primitive.getMode(), vertexCount, sourceIndices);

  const worldPositions: Vec3[] = [];
  for (let i = 0; i < vertexCount; i += 1) {
    worldPositions.push(transformPoint(worldMatrix, getAccessorVec3(positionAccessor, i)));
  }

  const faces: Face[] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const face = faceFromTriangle(
      worldPositions[triangles[i]],
      worldPositions[triangles[i + 1]],
      worldPositions[triangles[i + 2]],
    );
    if (face) faces.push(face);
  }

  return faces;
}

function collectFacesFromNode(node: {
  getMesh(): { listPrimitives(): Array<unknown> } | null;
  listChildren(): Array<unknown>;
  getWorldMatrix(): number[] | ArrayLike<number>;
}): Face[] {
  const faces: Face[] = [];
  const visited = new Set<unknown>();
  const stack: Array<{
    getMesh(): { listPrimitives(): Array<unknown> } | null;
    listChildren(): Array<unknown>;
    getWorldMatrix(): number[] | ArrayLike<number>;
  }> = [node];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const worldMatrix = readWorldMatrix(current);
    const mesh = current.getMesh();

    if (mesh) {
      for (const primitive of mesh.listPrimitives() as Array<{
        getAttribute(name: string): { getArray(): ArrayLike<number>; getCount(): number } | null;
        getIndices(): { getArray(): ArrayLike<number> } | null;
        getMode(): number;
      }>) {
        const primitiveFaces = collectFacesFromPrimitive(primitive, worldMatrix);
        for (const face of primitiveFaces) {
          faces.push(face);
        }
      }
    }

    for (const child of current.listChildren() as Array<{
      getMesh(): { listPrimitives(): Array<unknown> } | null;
      listChildren(): Array<unknown>;
      getWorldMatrix(): number[] | ArrayLike<number>;
    }>) {
      if (!visited.has(child)) {
        stack.push(child);
      }
    }
  }

  return faces;
}

function collectSceneFaces(root: {
  listScenes(): Array<{
    listChildren(): Array<unknown>;
  }>;
  listNodes(): Array<unknown>;
}): Face[] {
  const faces: Face[] = [];
  const scenes = root.listScenes();

  if (scenes.length > 0) {
    for (const scene of scenes) {
      for (const node of scene.listChildren()) {
        const nodeFaces = collectFacesFromNode(
          node as {
            getMesh(): { listPrimitives(): Array<unknown> } | null;
            listChildren(): Array<unknown>;
            getWorldMatrix(): number[] | ArrayLike<number>;
          },
        );
        for (const face of nodeFaces) {
          faces.push(face);
        }
      }
    }
    return faces;
  }

  for (const node of root.listNodes()) {
    const nodeFaces = collectFacesFromNode(
      node as {
        getMesh(): { listPrimitives(): Array<unknown> } | null;
        listChildren(): Array<unknown>;
        getWorldMatrix(): number[] | ArrayLike<number>;
      },
    );
    for (const face of nodeFaces) {
      faces.push(face);
    }
  }

  return faces;
}

function computeBoundsFromFaces(
  faces: Face[],
  upAxis: number,
  tangentAxes: [number, number],
): MeshBounds {
  if (faces.length === 0) {
    throw new Error("Cannot compute bounds for empty face list.");
  }

  let min: Vec3 = [...faces[0].vertices[0]];
  let max: Vec3 = [...faces[0].vertices[0]];

  for (const face of faces) {
    for (const vertex of face.vertices) {
      for (let axis = 0; axis < 3; axis += 1) {
        if (vertex[axis] < min[axis]) min[axis] = vertex[axis];
        if (vertex[axis] > max[axis]) max[axis] = vertex[axis];
      }
    }
  }

  const center = scale(add(min, max), 0.5);
  let footprintRadius = 0;

  for (const face of faces) {
    for (const vertex of face.vertices) {
      const projectedVertex = projectPoint(vertex, tangentAxes);
      const projectedCenter = projectPoint(center, tangentAxes);
      footprintRadius = Math.max(footprintRadius, vec2Distance(projectedVertex, projectedCenter));
    }
  }

  return {
    min,
    max,
    center,
    size: sub(max, min),
    base: min[upAxis],
    top: max[upAxis],
    footprintRadius,
  };
}

function scaleBounds(bounds: MeshBounds, factor: number): MeshBounds {
  return {
    min: scale(bounds.min, factor),
    max: scale(bounds.max, factor),
    center: scale(bounds.center, factor),
    size: scale(bounds.size, factor),
    base: bounds.base * factor,
    top: bounds.top * factor,
    footprintRadius: bounds.footprintRadius * factor,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pointInTriangle2D(point: Vec2, triangle: [Vec2, Vec2, Vec2], epsilon = 1e-6): boolean {
  const [a, b, c] = triangle;
  const v0: Vec2 = [c[0] - a[0], c[1] - a[1]];
  const v1: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const v2: Vec2 = [point[0] - a[0], point[1] - a[1]];

  const dot00 = v0[0] * v0[0] + v0[1] * v0[1];
  const dot01 = v0[0] * v1[0] + v0[1] * v1[1];
  const dot02 = v0[0] * v2[0] + v0[1] * v2[1];
  const dot11 = v1[0] * v1[0] + v1[1] * v1[1];
  const dot12 = v1[0] * v2[0] + v1[1] * v2[1];
  const denom = dot00 * dot11 - dot01 * dot01;

  if (Math.abs(denom) <= epsilon) return false;

  const invDenom = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= -epsilon && v >= -epsilon && u + v <= 1 + epsilon;
}

function isProjectedPointOnSurface(
  surface: SurfaceCluster,
  point: Vec3,
  tangentAxes: [number, number],
): boolean {
  const projected = projectPoint(point, tangentAxes);
  for (const triangle of surface.projectedFaces) {
    if (pointInTriangle2D(projected, triangle)) {
      return true;
    }
  }
  return false;
}

function planarDistance(a: Vec3, b: Vec3, tangentAxes: [number, number]): number {
  return vec2Distance(projectPoint(a, tangentAxes), projectPoint(b, tangentAxes));
}

function buildSurfaceCluster(
  faces: Face[],
  heightAxis: number,
  tangentAxes: [number, number],
  random: () => number,
  index: number,
): SurfaceCluster {
  const centroid = weightedCentroid(faces);
  const survivors: Vec3[] = [];

  for (let i = 0; i < SAMPLES; i += 1) {
    const face = sampleWeightedFace(faces, random);
    const candidate = samplePointOnFace(face, random);
    if (planarDistance(candidate, centroid, tangentAxes) >= MIN_EDGE_DISTANCE) {
      survivors.push(candidate);
    }
  }

  return {
    index,
    centroid,
    faces,
    height: component(centroid, heightAxis),
    samplePoints: survivors,
    projectedFaces: faces.map((face) => [
      projectPoint(face.vertices[0], tangentAxes),
      projectPoint(face.vertices[1], tangentAxes),
      projectPoint(face.vertices[2], tangentAxes),
    ]),
    projectedMin: [
      Math.min(...faces.flatMap((face) => face.vertices.map((vertex) => vertex[tangentAxes[0]]))),
      Math.min(...faces.flatMap((face) => face.vertices.map((vertex) => vertex[tangentAxes[1]]))),
    ],
    projectedMax: [
      Math.max(...faces.flatMap((face) => face.vertices.map((vertex) => vertex[tangentAxes[0]]))),
      Math.max(...faces.flatMap((face) => face.vertices.map((vertex) => vertex[tangentAxes[1]]))),
    ],
  };
}

function candidateRingAngles(requestedCount: number): number {
  return Math.max(24, Math.min(192, requestedCount * 6));
}

function makeRingCandidates(
  surface: SurfaceCluster,
  distanceFromCentroid: number,
  roomAxis: AxisInfo,
  angleCount: number,
): Vec3[] {
  const candidates: Vec3[] = [];
  if (distanceFromCentroid <= 0) {
    return [withComponent(surface.centroid, roomAxis.axis, surface.height)];
  }

  for (let i = 0; i < angleCount; i += 1) {
    const angle = (Math.PI * 2 * i) / angleCount;
    const candidate: Vec3 = [...surface.centroid];
    candidate[roomAxis.tangentAxes[0]] += Math.cos(angle) * distanceFromCentroid;
    candidate[roomAxis.tangentAxes[1]] += Math.sin(angle) * distanceFromCentroid;
    candidate[roomAxis.axis] = surface.height;
    candidates.push(candidate);
  }

  return candidates;
}

function dedupeCandidates(points: Vec3[], epsilon = 1e-5): Vec3[] {
  const seen = new Set<string>();
  const deduped: Vec3[] = [];

  for (const point of points) {
    const key = point.map((value) => Math.round(value / epsilon)).join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(point);
  }

  return deduped;
}

function makeCentroidDistanceCandidates(
  surface: SurfaceCluster,
  targetDistance: number,
  tolerance: number,
  roomAxis: AxisInfo,
  requestedCount: number,
): Vec3[] {
  const angleCount = candidateRingAngles(requestedCount);
  const radii = dedupeNumbers([
    targetDistance,
    Math.max(MIN_EDGE_DISTANCE, targetDistance - tolerance),
    Math.max(MIN_EDGE_DISTANCE, targetDistance - tolerance * 0.5),
    targetDistance + tolerance * 0.5,
    targetDistance + tolerance,
  ]);

  const candidates: Vec3[] = [];
  for (const radius of radii) {
    candidates.push(...makeRingCandidates(surface, radius, roomAxis, angleCount));
  }
  return candidates;
}

function dedupeNumbers(values: number[], epsilon = 1e-6): number[] {
  const deduped: number[] = [];
  for (const value of values) {
    if (deduped.some((existing) => Math.abs(existing - value) <= epsilon)) continue;
    deduped.push(value);
  }
  return deduped;
}

function surfacePlanarSize(surface: SurfaceCluster): Vec2 {
  return [
    surface.projectedMax[0] - surface.projectedMin[0],
    surface.projectedMax[1] - surface.projectedMin[1],
  ];
}

/**
 * Determines whether a horizontal surface cluster is large enough for object placement attempts.
 * @param surface - Candidate horizontal surface cluster.
 * @returns True when the surface meets configured area/span thresholds.
 */
function isSurfaceEligible(surface: SurfaceCluster): boolean {
  const area = totalArea(surface.faces);
  const planarSize = surfacePlanarSize(surface);
  const minSpan = Math.min(planarSize[0], planarSize[1]);
  return area >= MIN_SURFACE_AREA && minSpan >= MIN_SURFACE_MIN_SPAN;
}

function rotateVec2(point: Vec2, yaw: number): Vec2 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [point[0] * c - point[1] * s, point[0] * s + point[1] * c];
}

function makeFootprintCorners(
  center: Vec3,
  halfExtents: Vec2,
  yaw: number,
  roomAxis: AxisInfo,
): Vec3[] {
  const localCorners: Vec2[] = [
    [-halfExtents[0], -halfExtents[1]],
    [halfExtents[0], -halfExtents[1]],
    [halfExtents[0], halfExtents[1]],
    [-halfExtents[0], halfExtents[1]],
  ];

  return localCorners.map((corner) => {
    const rotated = rotateVec2(corner, yaw);
    const point: Vec3 = [...center];
    point[roomAxis.tangentAxes[0]] += rotated[0];
    point[roomAxis.tangentAxes[1]] += rotated[1];
    return point;
  });
}

function isFootprintSupported(
  surface: SurfaceCluster,
  center: Vec3,
  halfExtents: Vec2,
  yaw: number,
  roomAxis: AxisInfo,
): boolean {
  const corners = makeFootprintCorners(center, halfExtents, yaw, roomAxis);
  for (const corner of corners) {
    if (!isProjectedPointOnSurface(surface, corner, roomAxis.tangentAxes)) {
      return false;
    }
  }
  return true;
}

function projectionRange(points: Vec2[], axis: Vec2): { min: number; max: number } {
  let min = points[0][0] * axis[0] + points[0][1] * axis[1];
  let max = min;
  for (let i = 1; i < points.length; i += 1) {
    const value = points[i][0] * axis[0] + points[i][1] * axis[1];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function normalizedVec2(value: Vec2): Vec2 {
  const len = Math.sqrt(value[0] * value[0] + value[1] * value[1]);
  if (len === 0) return [0, 0];
  return [value[0] / len, value[1] / len];
}

function rectanglesOverlap2D(a: Vec2[], b: Vec2[], padding: number): boolean {
  const axes: Vec2[] = [
    normalizedVec2([a[1][0] - a[0][0], a[1][1] - a[0][1]]),
    normalizedVec2([a[3][0] - a[0][0], a[3][1] - a[0][1]]),
    normalizedVec2([b[1][0] - b[0][0], b[1][1] - b[0][1]]),
    normalizedVec2([b[3][0] - b[0][0], b[3][1] - b[0][1]]),
  ];

  for (const axis of axes) {
    const rangeA = projectionRange(a, axis);
    const rangeB = projectionRange(b, axis);
    if (rangeA.max + padding <= rangeB.min || rangeB.max + padding <= rangeA.min) {
      return false;
    }
  }

  return true;
}

function verticalRangesOverlap(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
  padding: number,
): boolean {
  return !(aMax + padding <= bMin || bMax + padding <= aMin);
}

function yawAngles(): number[] {
  return Array.from(
    { length: YAW_CANDIDATES },
    (_, index) => (Math.PI * 2 * index) / YAW_CANDIDATES,
  );
}

function tryPlacementCandidate(
  spec: PlacementSpec,
  geometry: ScaledObjectGeometry,
  surface: SurfaceCluster,
  candidate: Vec3,
  placements: Placement[],
  roomAxis: AxisInfo,
  targetDistance: number,
  distanceTolerance: number,
  evaluation: CandidateEvaluation,
): Placement | null {
  const centroidDistance = planarDistance(candidate, surface.centroid, roomAxis.tangentAxes);
  if (centroidDistance < MIN_EDGE_DISTANCE) {
    evaluation.tooCloseToCentroid += 1;
    return null;
  }

  if (Math.abs(centroidDistance - targetDistance) > distanceTolerance) {
    evaluation.wrongCentroidDistance += 1;
    return null;
  }

  const center = withComponent(candidate, roomAxis.axis, surface.height);
  const collisionPadding = spec.collisionPadding ?? 0;

  for (const yaw of yawAngles()) {
    if (!isFootprintSupported(surface, center, geometry.footprintHalfExtents, yaw, roomAxis)) {
      continue;
    }

    const translation = computePlacementTranslation(
      center,
      geometry.bounds,
      roomAxis.axis,
      roomAxis.tangentAxes,
    );
    const worldBounds = translateBounds(geometry.bounds, translation);
    const footprintCorners = makeFootprintCorners(
      center,
      geometry.footprintHalfExtents,
      yaw,
      roomAxis,
    ).map((point) => projectPoint(point, roomAxis.tangentAxes));

    let collided = false;
    for (const existing of placements) {
      const existingFootprint = makeFootprintCorners(
        existing.center,
        existing.footprintHalfExtents,
        existing.yaw,
        roomAxis,
      ).map((point) => projectPoint(point, roomAxis.tangentAxes));

      if (
        verticalRangesOverlap(
          worldBounds.min[roomAxis.axis],
          worldBounds.max[roomAxis.axis],
          existing.worldAabbMin[roomAxis.axis],
          existing.worldAabbMax[roomAxis.axis],
          collisionPadding,
        ) &&
        rectanglesOverlap2D(footprintCorners, existingFootprint, collisionPadding)
      ) {
        collided = true;
        evaluation.collided += 1;
        break;
      }
    }

    if (collided) continue;

    return {
      center,
      footprintHalfExtents: geometry.footprintHalfExtents,
      id: spec.id,
      inputPath: spec.inputPath,
      surfaceIndex: surface.index,
      position: translation,
      scale: geometry.scale,
      yaw,
      supportNormal: roomAxis.up,
      centroidDistance,
      worldAabbMin: worldBounds.min,
      worldAabbMax: worldBounds.max,
    };
  }

  evaluation.unsupported += 1;
  return null;
}

function translateBounds(bounds: MeshBounds, translation: Vec3): { min: Vec3; max: Vec3 } {
  return {
    min: add(bounds.min, translation),
    max: add(bounds.max, translation),
  };
}

function computePlacementTranslation(
  candidate: Vec3,
  bounds: MeshBounds,
  upAxis: number,
  tangentAxes: [number, number],
): Vec3 {
  const translation: Vec3 = [0, 0, 0];
  translation[tangentAxes[0]] = candidate[tangentAxes[0]] - bounds.center[tangentAxes[0]];
  translation[tangentAxes[1]] = candidate[tangentAxes[1]] - bounds.center[tangentAxes[1]];
  translation[upAxis] = candidate[upAxis] - bounds.base;
  return translation;
}

async function loadGeometry(inputPath: string): Promise<Face[]> {
  const document = await loadDocument(inputPath);
  const root = document.getRoot();
  const faces = collectSceneFaces(root as Parameters<typeof collectSceneFaces>[0]);

  if (faces.length === 0) {
    throw new Error(`No triangle faces found in ${inputPath}`);
  }

  if (MAX_ROOM_FACES && faces.length > MAX_ROOM_FACES) {
    const stride = Math.ceil(faces.length / MAX_ROOM_FACES);
    const downsampledFaces: Face[] = [];
    for (let index = 0; index < faces.length; index += stride) {
      downsampledFaces.push(faces[index]);
      if (downsampledFaces.length >= MAX_ROOM_FACES) {
        break;
      }
    }
    console.log(
      `Downsampled room faces from ${faces.length} to ${downsampledFaces.length} using stride ${stride}.`,
    );
    return downsampledFaces;
  }

  return faces;
}

async function loadDocument(inputPath: string): Promise<import("@gltf-transform/core").Document> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  return io.read(inputPath);
}

async function loadObjectGeometry(
  spec: PlacementSpec,
  roomAxis: AxisInfo,
): Promise<ObjectGeometry> {
  const faces = await loadGeometry(spec.inputPath);
  return {
    inputPath: spec.inputPath,
    bounds: computeBoundsFromFaces(faces, roomAxis.axis, roomAxis.tangentAxes),
    upAxis: roomAxis.axis,
  };
}

function scaleObjectForSurface(
  geometry: ObjectGeometry,
  surface: SurfaceCluster,
  spec: PlacementSpec,
  requestedCount: number,
  objectScaleBias: number,
): ScaledObjectGeometry {
  const surfaceSize = surfacePlanarSize(surface);
  const objectPlanarSize: Vec2 = [
    geometry.bounds.size[surfacePlanarSizeAxisIndex(geometry.upAxis, 0)],
    geometry.bounds.size[surfacePlanarSizeAxisIndex(geometry.upAxis, 1)],
  ];
  const maxObjectSpan = Math.max(objectPlanarSize[0], objectPlanarSize[1], 1e-6);
  const minSurfaceSpan = Math.min(surfaceSize[0], surfaceSize[1]);
  const maxSurfaceSpan = Math.max(surfaceSize[0], surfaceSize[1]);
  const targetSurfaceFraction = clamp(0.45 / Math.sqrt(Math.max(requestedCount, 1)), 0.12, 0.35);
  const targetSpan = maxSurfaceSpan * targetSurfaceFraction;
  const maxAllowedSpan = minSurfaceSpan * 0.8;
  const unclampedScale = targetSpan / maxObjectSpan;
  const fitScale = maxAllowedSpan / maxObjectSpan;
  const heuristicScale = Math.min(unclampedScale, fitScale);
  const scaleMultiplier = spec.scaleMultiplier ?? 1;
  const finalScale = clamp(
    heuristicScale * scaleMultiplier * objectScaleBias,
    MIN_AUTO_OBJECT_SCALE,
    MAX_AUTO_OBJECT_SCALE,
  );

  return {
    inputPath: geometry.inputPath,
    upAxis: geometry.upAxis,
    scale: finalScale,
    bounds: scaleBounds(geometry.bounds, finalScale),
    footprintHalfExtents: [
      objectPlanarSize[0] * finalScale * 0.5,
      objectPlanarSize[1] * finalScale * 0.5,
    ],
  };
}

function surfacePlanarSizeAxisIndex(upAxis: number, planarIndex: number): number {
  if (upAxis === 1) {
    return planarIndex === 0 ? 0 : 2;
  }
  return planarIndex === 0 ? 0 : 1;
}

function placeObjectInstance(
  spec: PlacementSpec,
  objectGeometry: ObjectGeometry,
  surfaces: SurfaceCluster[],
  placements: Placement[],
  roomAxis: AxisInfo,
  requestedCount: number,
  objectScaleBias: number,
  random: () => number,
): { placement: Placement | null; evaluation: CandidateEvaluation } {
  const evaluation: CandidateEvaluation = {
    tooCloseToCentroid: 0,
    wrongCentroidDistance: 0,
    unsupported: 0,
    collided: 0,
  };

  const surfacesInOrder = [...surfaces].sort((a, b) => totalArea(b.faces) - totalArea(a.faces));
  const targetDistance = spec.targetCentroidDistance;
  const distanceTolerance = spec.centroidDistanceTolerance;

  for (const surface of surfacesInOrder) {
    const scaledGeometry = scaleObjectForSurface(
      objectGeometry,
      surface,
      spec,
      requestedCount,
      objectScaleBias,
    );
    const candidates = dedupeCandidates([
      ...makeCentroidDistanceCandidates(
        surface,
        targetDistance,
        distanceTolerance,
        roomAxis,
        requestedCount,
      ),
      ...surface.samplePoints.map((point) => withComponent(point, roomAxis.axis, surface.height)),
    ]);
    shuffleInPlace(candidates, random);

    for (const candidate of candidates) {
      const result = tryPlacementCandidate(
        spec,
        scaledGeometry,
        surface,
        candidate,
        placements,
        roomAxis,
        targetDistance,
        distanceTolerance,
        evaluation,
      );

      if (result) {
        return { placement: result, evaluation };
      }
    }
  }

  return { placement: null, evaluation };
}

function totalRequestedCount(specs: PlacementSpec[]): number {
  return specs.reduce((sum, spec) => sum + spec.count, 0);
}

function normalizeSpecs(specs: PlacementSpec[]): PlacementSpec[] {
  if (COUNT_OVERRIDE === null) return specs;
  return specs.map((spec) => ({ ...spec, count: COUNT_OVERRIDE }));
}

async function buildPlan(
  roomFaces: Face[],
  objectGeometries: Map<string, ObjectGeometry>,
  specs: PlacementSpec[],
  objectScaleBias: number,
): Promise<PlanResult> {
  const random = createRandom(SEED);
  const roomAxis = detectUpAxis(roomFaces);
  const horizontalFaces = roomFaces.filter(
    (face) => dot(face.normal, roomAxis.up) >= NORMAL_THRESHOLD,
  );

  if (horizontalFaces.length === 0) {
    throw new Error(
      `No horizontal faces met NORMAL_THRESHOLD=${NORMAL_THRESHOLD} using ${roomAxis.label}`,
    );
  }

  const clustered = clusterHorizontalFaces(horizontalFaces);
  const allSurfaces = clustered.clusters.map((cluster, index) =>
    buildSurfaceCluster(cluster, clustered.axis, roomAxis.tangentAxes, random, index),
  );
  const surfaces = allSurfaces.filter(isSurfaceEligible);

  if (surfaces.length === 0) {
    throw new Error(
      `No horizontal surfaces passed placement thresholds (minArea=${MIN_SURFACE_AREA}, minSpan=${MIN_SURFACE_MIN_SPAN}).`,
    );
  }

  const placements: Placement[] = [];
  const failures: Array<{ id: string; inputPath: string; evaluation: CandidateEvaluation }> = [];
  const requestedCount = totalRequestedCount(specs);

  for (const spec of specs) {
    for (let i = 0; i < spec.count; i += 1) {
      const instanceSpec: PlacementSpec = {
        ...spec,
        id: spec.count === 1 ? spec.id : `${spec.id}-${i + 1}`,
      };
      const geometry = objectGeometries.get(spec.inputPath);
      if (!geometry) {
        throw new Error(`Missing geometry for ${spec.inputPath}`);
      }

      const result = placeObjectInstance(
        instanceSpec,
        geometry,
        surfaces,
        placements,
        roomAxis,
        requestedCount,
        objectScaleBias,
        random,
      );

      if (result.placement) {
        placements.push(result.placement);
      } else {
        failures.push({
          id: instanceSpec.id,
          inputPath: instanceSpec.inputPath,
          evaluation: result.evaluation,
        });
      }
    }
  }

  return {
    failures,
    objectScaleBias,
    placements,
    roomAxis,
    surfaces,
  };
}

function chooseBetterPlan(currentBest: PlanResult | null, candidate: PlanResult): PlanResult {
  if (!currentBest) return candidate;
  if (candidate.failures.length < currentBest.failures.length) return candidate;
  if (candidate.failures.length > currentBest.failures.length) return currentBest;
  if (candidate.objectScaleBias > currentBest.objectScaleBias) return candidate;
  return currentBest;
}

function getAssetRootNodes(
  document: import("@gltf-transform/core").Document,
): Array<import("@gltf-transform/core").Node> {
  const root = document.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  if (scene) return scene.listChildren();
  return root.listNodes().filter((node) => node.getParentNode() === null);
}

function createPropertyResolver(
  targetDocument: import("@gltf-transform/core").Document,
  sharedBuffer: import("@gltf-transform/core").Buffer,
) {
  const cache = new Map<object, unknown>();

  const resolve = (source: any): any => {
    if (cache.has(source)) return cache.get(source);

    let target: any;
    switch (source.propertyType) {
      case "Accessor":
        target = targetDocument.createAccessor(source.getName());
        break;
      case "Animation":
        target = targetDocument.createAnimation(source.getName());
        break;
      case "AnimationChannel":
        target = targetDocument.createAnimationChannel(source.getName());
        break;
      case "AnimationSampler":
        target = targetDocument.createAnimationSampler(source.getName());
        break;
      case "Buffer":
        cache.set(source, sharedBuffer);
        return sharedBuffer;
      case "Camera":
        target = targetDocument.createCamera(source.getName());
        break;
      case "Material":
        target = targetDocument.createMaterial(source.getName());
        break;
      case "Mesh":
        target = targetDocument.createMesh(source.getName());
        break;
      case "Node":
        target = targetDocument.createNode(source.getName());
        break;
      case "Primitive":
        target = targetDocument.createPrimitive();
        break;
      case "PrimitiveTarget":
        target = targetDocument.createPrimitiveTarget(source.getName());
        break;
      case "Scene":
        target = targetDocument.createScene(source.getName());
        break;
      case "Skin":
        target = targetDocument.createSkin(source.getName());
        break;
      case "Texture":
        target = targetDocument.createTexture(source.getName());
        break;
      case "TextureInfo":
        cache.set(source, source);
        return source;
      default:
        throw new Error(`Unsupported property copy for type ${String(source.propertyType)}`);
    }

    cache.set(source, target);
    target.copy(source, resolve);
    return target;
  };

  return resolve;
}

function yawQuaternion(axisInfo: AxisInfo, yaw: number): [number, number, number, number] {
  const halfYaw = yaw * 0.5;
  const s = Math.sin(halfYaw);
  const c = Math.cos(halfYaw);

  if (axisInfo.axis === 1) {
    return [0, s, 0, c];
  }

  return [0, 0, s, c];
}

async function writePlacedScene(
  roomInputPath: string,
  outputPath: string,
  plan: PlanResult,
  objectAssets: Map<string, LoadedAsset>,
): Promise<string> {
  const roomDocument = await loadDocument(roomInputPath);
  const roomRoot = roomDocument.getRoot();
  const roomScene =
    roomRoot.getDefaultScene() || roomRoot.listScenes()[0] || roomDocument.createScene("Scene");
  if (!roomRoot.getDefaultScene()) {
    roomRoot.setDefaultScene(roomScene);
  }
  const sharedBuffer = roomRoot.listBuffers()[0] || roomDocument.createBuffer("buffer");

  for (const placement of plan.placements) {
    const asset = objectAssets.get(placement.inputPath);
    if (!asset) {
      throw new Error(`Missing loaded asset for ${placement.inputPath}`);
    }
    const resolve = createPropertyResolver(roomDocument, sharedBuffer);

    const placementNode = roomDocument
      .createNode(`placement:${placement.id}`)
      .setTranslation(placement.position)
      .setRotation(yawQuaternion(plan.roomAxis, placement.yaw))
      .setScale([placement.scale, placement.scale, placement.scale]);

    for (const sourceRootNode of getAssetRootNodes(asset.document)) {
      placementNode.addChild(resolve(sourceRootNode));
    }

    roomScene.addChild(placementNode);
  }

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  await io.write(outputPath, roomDocument);
  return outputPath;
}

async function main(): Promise<void> {
  const roomFaces = await loadGeometry(INPUT_PATH);
  const effectiveSpecs = normalizeSpecs(OBJECT_SPECS);

  const objectGeometries = new Map<string, ObjectGeometry>();
  const objectAssets = new Map<string, LoadedAsset>();
  const roomAxisForGeometry = detectUpAxis(roomFaces);
  for (const spec of effectiveSpecs) {
    if (!objectGeometries.has(spec.inputPath)) {
      objectGeometries.set(spec.inputPath, await loadObjectGeometry(spec, roomAxisForGeometry));
    }
    if (!objectAssets.has(spec.inputPath)) {
      objectAssets.set(spec.inputPath, {
        document: await loadDocument(spec.inputPath),
        inputPath: spec.inputPath,
      });
    }
  }

  let bestPlan: PlanResult | null = null;
  for (const objectScaleBias of OBJECT_SCALE_BIAS_CANDIDATES) {
    const candidate = await buildPlan(roomFaces, objectGeometries, effectiveSpecs, objectScaleBias);
    bestPlan = chooseBetterPlan(bestPlan, candidate);
    if (candidate.failures.length === 0) {
      break;
    }
  }

  if (!bestPlan) {
    throw new Error("Failed to build any placement plan.");
  }

  const horizontalFaceCount = bestPlan.surfaces.reduce(
    (sum, surface) => sum + surface.faces.length,
    0,
  );

  const outputPath = resolveOutputPath(INPUT_PATH, ".placements.json");
  const placedScenePath = await writePlacedScene(
    INPUT_PATH,
    resolveOutputPath(INPUT_PATH, ".placed.glb"),
    bestPlan,
    objectAssets,
  );
  const sceneBundlePath = resolveOutputPath(INPUT_PATH, ".scene-bundle.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(
      {
        room: {
          inputPath: INPUT_PATH,
          upAxis: bestPlan.roomAxis.label,
          horizontalFaceCount,
          surfaceCount: bestPlan.surfaces.length,
        },
        planner: {
          objectScaleBias: bestPlan.objectScaleBias,
          requestedObjects: totalRequestedCount(effectiveSpecs),
        },
        placeableSurfaceLayer: {
          upAxis: bestPlan.roomAxis.axis,
          tangentAxes: bestPlan.roomAxis.tangentAxes,
          surfaces: bestPlan.surfaces.map((surface) => ({
            area: totalArea(surface.faces),
            centroid: surface.centroid,
            height: surface.height,
            index: surface.index,
            triangles: surface.faces.map((face) => face.vertices),
            projectedMax: surface.projectedMax,
            projectedMin: surface.projectedMin,
          })),
        },
        placements: bestPlan.placements,
        failures: bestPlan.failures,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await fs.writeFile(
    sceneBundlePath,
    `${JSON.stringify(
      {
        visualSplatPath: SPZ_VISUAL_PATH,
        collisionRoomPath: INPUT_PATH,
        placedScenePath,
        placementsPath: outputPath,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`Room input: ${INPUT_PATH}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Placed scene: ${placedScenePath}`);
  console.log(`Scene bundle: ${sceneBundlePath}`);
  if (SPZ_VISUAL_PATH) {
    console.log(`Visual splat: ${SPZ_VISUAL_PATH}`);
  }
  console.log(`Room faces: ${roomFaces.length}`);
  console.log(`Horizontal faces: ${horizontalFaceCount}`);
  console.log(`Up axis: ${bestPlan.roomAxis.label}`);
  console.log(`Surface clusters: ${bestPlan.surfaces.length}`);
  console.log(`Surface min area threshold: ${MIN_SURFACE_AREA}`);
  console.log(`Surface min span threshold: ${MIN_SURFACE_MIN_SPAN}`);
  console.log(`Requested objects: ${totalRequestedCount(effectiveSpecs)}`);
  console.log(`Placed objects: ${bestPlan.placements.length}`);
  console.log(`Failed objects: ${bestPlan.failures.length}`);
  console.log(`Object scale bias: ${bestPlan.objectScaleBias}`);

  for (const surface of bestPlan.surfaces) {
    console.log(
      [
        `Surface ${surface.index + 1}`,
        `height=${surface.height.toFixed(4)}`,
        `faces=${surface.faces.length}`,
        `area=${totalArea(surface.faces).toFixed(4)}`,
        `centroid=[${surface.centroid.map((value) => value.toFixed(4)).join(", ")}]`,
        `candidates=${surface.samplePoints.length}`,
        `size=[${surfacePlanarSize(surface)
          .map((value) => value.toFixed(4))
          .join(", ")}]`,
      ].join(" | "),
    );
  }

  console.log("Placement preview:");
  console.log(
    JSON.stringify(
      bestPlan.placements.slice(0, 10).map((placement) => ({
        id: placement.id,
        inputPath: placement.inputPath,
        surfaceIndex: placement.surfaceIndex,
        position: placement.position.map((value) => Number(value.toFixed(6))),
        scale: Number(placement.scale.toFixed(6)),
        yaw: Number(placement.yaw.toFixed(6)),
        centroidDistance: Number(placement.centroidDistance.toFixed(6)),
      })),
      null,
      2,
    ),
  );

  if (bestPlan.failures.length > 0) {
    console.log("Failures:");
    console.log(JSON.stringify(bestPlan.failures, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
