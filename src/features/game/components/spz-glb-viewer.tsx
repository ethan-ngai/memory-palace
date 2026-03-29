import { SplatMesh } from "@sparkjsdev/spark";
import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  BufferGeometry,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Material,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const DEFAULT_SCENE_BUNDLE_PATH = "/rohan/lavendar_room.web.scene-bundle.json";
const WALK_SPEED = 2.8;
const WALK_SPEED_BOOST = 6.2;
const MAX_FRAME_DELTA_SECONDS = 0.1;

/**
 * Represents a numeric 3D point tuple.
 */
type Vec3Tuple = [number, number, number];

/**
 * Describes the SPZ + GLB asset bundle used by the combined viewer.
 */
type SceneBundle = {
  visualSplatPath: string;
  collisionRoomPath: string;
  placedScenePath: string;
  placementsPath?: string;
};

/**
 * Tracks one placeable-surface region payload from placements JSON.
 */
type PlaceableSurface = {
  area: number;
  centroid: Vec3Tuple;
  height: number;
  index: number;
  projectedMax?: [number, number];
  projectedMin?: [number, number];
  triangles?: [Vec3Tuple, Vec3Tuple, Vec3Tuple][];
};

/**
 * Encodes placement-surface visualization data emitted by the placement generator.
 */
type PlaceableSurfaceLayer = {
  surfaces: PlaceableSurface[];
  tangentAxes: [number, number];
  upAxis: number;
};

/**
 * Describes the subset of placement JSON fields needed by the viewer.
 */
type PlacementsFile = {
  placeableSurfaceLayer?: PlaceableSurfaceLayer;
};

type LayerMaterial = Material & {
  colorWrite: boolean;
  depthTest: boolean;
  depthWrite: boolean;
};

type PlacementRootSet = Set<Object3D>;
type PlacementGroup = {
  meshes: Mesh[];
  root: Object3D;
};
type SceneMeshGroups = {
  collisionMeshes: Mesh[];
  placementGroups: PlacementGroup[];
};

/**
 * Encapsulates pressed-state flags for viewer keyboard movement.
 */
type ViewerKeyboardState = {
  backward: boolean;
  boost: boolean;
  forward: boolean;
  left: boolean;
  right: boolean;
};

/**
 * Creates a fresh keyboard state object for movement controls.
 * @returns Zeroed keyboard state.
 */
function createViewerKeyboardState(): ViewerKeyboardState {
  return {
    backward: false,
    boost: false,
    forward: false,
    left: false,
    right: false,
  };
}

/**
 * Resets all movement flags so camera drift stops immediately.
 * @param state - Mutable keyboard state to clear.
 */
function clearViewerKeyboardState(state: ViewerKeyboardState): void {
  state.backward = false;
  state.boost = false;
  state.forward = false;
  state.left = false;
  state.right = false;
}

/**
 * Determines whether a keyboard event should be ignored because the user is typing into a form element.
 * @param event - Browser keyboard event.
 * @returns True when key presses should not drive camera motion.
 */
function shouldIgnoreViewerKeyboardEvent(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    tag === "button"
  );
}

/**
 * Applies one key transition to the keyboard state.
 * @param state - Mutable keyboard movement state.
 * @param code - KeyboardEvent `code` field.
 * @param pressed - Whether the key is currently down.
 * @returns True when the key maps to movement controls.
 */
function updateViewerKeyboardState(
  state: ViewerKeyboardState,
  code: string,
  pressed: boolean,
): boolean {
  switch (code) {
    case "KeyW":
      state.forward = pressed;
      return true;
    case "KeyS":
      state.backward = pressed;
      return true;
    case "KeyA":
      state.left = pressed;
      return true;
    case "KeyD":
      state.right = pressed;
      return true;
    case "ShiftLeft":
    case "ShiftRight":
      state.boost = pressed;
      return true;
    default:
      return false;
  }
}

/**
 * Moves the viewer camera/target pair using WASD on the horizontal walk plane.
 * @param camera - Active scene camera.
 * @param controls - Orbit controls that own camera targeting.
 * @param state - Current keyboard movement state.
 * @param deltaSeconds - Frame time delta in seconds.
 */
function applyViewerKeyboardMovement(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  state: ViewerKeyboardState,
  deltaSeconds: number,
): void {
  const movementDirection = new Vector3();
  const cameraForward = controls.target.clone().sub(camera.position);
  if (cameraForward.lengthSq() <= 1e-8) {
    return;
  }
  cameraForward.normalize();

  const worldUp = camera.up.clone().normalize();
  const planarForward = cameraForward.sub(
    worldUp.clone().multiplyScalar(cameraForward.dot(worldUp)),
  );
  if (planarForward.lengthSq() <= 1e-8) {
    return;
  }
  planarForward.normalize();
  const planarRight = new Vector3().crossVectors(planarForward, worldUp).normalize();

  if (state.forward) movementDirection.add(planarForward);
  if (state.backward) movementDirection.sub(planarForward);
  if (state.right) movementDirection.add(planarRight);
  if (state.left) movementDirection.sub(planarRight);

  if (movementDirection.lengthSq() <= 1e-8) {
    return;
  }
  movementDirection.normalize();

  const speed = state.boost ? WALK_SPEED_BOOST : WALK_SPEED;
  const step = movementDirection.multiplyScalar(speed * deltaSeconds);
  camera.position.add(step);
  controls.target.add(step);
}

/**
 * Finds top-level placement roots in a generated placed GLB scene.
 * @param root - Root object returned by GLTFLoader (`gltf.scene`).
 * @returns Set of direct children whose names start with `placement`.
 */
function collectPlacementRoots(root: Object3D): PlacementRootSet {
  const placementRoots: PlacementRootSet = new Set();
  for (const child of root.children) {
    const normalizedName = child.name.trim().toLowerCase();
    if (normalizedName.startsWith("placement")) {
      placementRoots.add(child);
    }
  }
  return placementRoots;
}

/**
 * Checks whether a mesh belongs to one of the detected placement roots.
 * @param object - Candidate object in the placed GLB hierarchy.
 * @param placementRoots - Precomputed placement roots from the loaded scene.
 * @returns True if the object is inside a placement subtree.
 */
function isPlacementObject(object: Object3D, placementRoots: PlacementRootSet): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (placementRoots.has(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Configures a placement mesh material for normal depth-tested rendering.
 * @param material - Target material from a placed mesh.
 */
function applyPlacementMaterial(material: Material): void {
  const layerMaterial = material as LayerMaterial;
  layerMaterial.colorWrite = true;
  layerMaterial.depthTest = true;
  layerMaterial.depthWrite = true;
}

/**
 * Configures a collision material for either visible rendering or depth-only occlusion.
 * @param material - Target material from the collision room mesh.
 * @param showCollisionMesh - Whether collision geometry should be color-visible.
 */
function applyCollisionMaterial(material: Material, showCollisionMesh: boolean): void {
  const layerMaterial = material as LayerMaterial;
  layerMaterial.colorWrite = showCollisionMesh;
  layerMaterial.depthTest = showCollisionMesh;
  layerMaterial.depthWrite = showCollisionMesh;
}

/**
 * Builds placement and collision mesh groups so we can manage visibility and occlusion robustly.
 * @param root - Root of the loaded placed GLB scene graph.
 * @returns Grouped mesh lists for placement roots and collision geometry.
 */
function collectPlacementGroups(root: Object3D): PlacementGroup[] {
  const placementRoots = collectPlacementRoots(root);
  const placementGroupsByRoot = new Map<Object3D, PlacementGroup>();

  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) {
      return;
    }

    const isPlacement = placementRoots.size === 0 ? true : isPlacementObject(mesh, placementRoots);
    mesh.visible = isPlacement;
    if (!isPlacement) {
      return;
    }

    let placementRoot: Object3D | null = mesh.parent;
    while (placementRoot && placementRoots.size > 0 && !placementRoots.has(placementRoot)) {
      placementRoot = placementRoot.parent;
    }
    const effectiveRoot = placementRoot ?? root;
    const existing = placementGroupsByRoot.get(effectiveRoot);
    if (existing) {
      existing.meshes.push(mesh);
      return;
    }
    placementGroupsByRoot.set(effectiveRoot, { meshes: [mesh], root: effectiveRoot });
  });

  return Array.from(placementGroupsByRoot.values());
}

/**
 * Collects mesh references used as collision/occlusion geometry.
 * @param root - Root of the collision GLB scene.
 * @returns Flat list of collision meshes for ray tests and depth prepass.
 */
function collectCollisionMeshes(root: Object3D): Mesh[] {
  const collisionMeshes: Mesh[] = [];
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh) {
      collisionMeshes.push(mesh);
    }
  });
  return collisionMeshes;
}

/**
 * Configures placement mesh materials and render order.
 * @param placementGroups - Placement groups derived from the placed GLB.
 */
function configurePlacementMeshes(placementGroups: PlacementGroup[]): void {
  for (const placement of placementGroups) {
    for (const mesh of placement.meshes) {
      mesh.visible = true;
      mesh.renderOrder = 100;
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => applyPlacementMaterial(entry));
      } else {
        applyPlacementMaterial(material);
      }
    }
  }
}

/**
 * Applies mesh/material visibility settings for placement + collision compositing.
 * @param root - Root of the loaded placed GLB scene graph.
 * @param showCollisionMesh - Whether to show collision room colors or keep depth-only.
 * @returns Grouped mesh lists used by per-frame occlusion updates.
 */
function configureCollisionMeshes(collisionMeshes: Mesh[], showCollisionMesh: boolean): void {
  for (const collisionMesh of collisionMeshes) {
    collisionMesh.visible = true;
    collisionMesh.renderOrder = 0;
    const material = collisionMesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => applyCollisionMaterial(entry, showCollisionMesh));
    } else {
      applyCollisionMaterial(material, showCollisionMesh);
    }
  }
}

/**
 * Applies mesh/material visibility settings for placement + collision compositing.
 * @param placedRoot - Root of the placed GLB containing placed objects.
 * @param collisionRoot - Root of the collision GLB used for occlusion and optional mesh view.
 * @param showCollisionMesh - Whether to show collision room colors or keep depth-only.
 * @returns Grouped mesh lists used by per-frame occlusion updates.
 */
function configureSceneMeshVisibility(
  placedRoot: Object3D,
  collisionRoot: Object3D,
  showCollisionMesh: boolean,
): SceneMeshGroups {
  const placementGroups = collectPlacementGroups(placedRoot);
  const collisionMeshes = collectCollisionMeshes(collisionRoot);
  configurePlacementMeshes(placementGroups);
  configureCollisionMeshes(collisionMeshes, showCollisionMesh);
  return {
    collisionMeshes,
    placementGroups,
  };
}

/**
 * Generates representative points for visibility tests on a placed object group.
 * @param root - Placement root node.
 * @returns Sample points spanning center/top/sides so partial visibility is preserved.
 */
function placementSamplePoints(root: Object3D): Vector3[] {
  const bounds = new Box3().setFromObject(root);
  if (bounds.isEmpty()) {
    return [root.getWorldPosition(new Vector3())];
  }

  const center = bounds.getCenter(new Vector3());
  const min = bounds.min;
  const max = bounds.max;
  return [
    center,
    new Vector3(center.x, max.y, center.z),
    new Vector3(center.x, min.y, center.z),
    new Vector3(min.x, center.y, center.z),
    new Vector3(max.x, center.y, center.z),
    new Vector3(center.x, center.y, min.z),
    new Vector3(center.x, center.y, max.z),
  ];
}

/**
 * Tests whether a sampled point is front-face occluded by collision geometry.
 * @param target - World-space point to test.
 * @param collisionMeshes - Collision meshes used for occlusion checks.
 * @param camera - Active camera for the view.
 * @param raycaster - Reusable raycaster instance.
 * @param normalMatrix - Reusable normal matrix scratch object.
 * @returns True when the sampled point is blocked by a front-facing collision hit.
 */
function isSamplePointOccluded(
  target: Vector3,
  collisionMeshes: Mesh[],
  camera: PerspectiveCamera,
  raycaster: Raycaster,
  normalMatrix: Matrix3,
): boolean {
  const direction = target.clone().sub(camera.position);
  const distance = direction.length();
  if (distance <= 1e-5) {
    return false;
  }
  direction.normalize();

  raycaster.set(camera.position, direction);
  raycaster.far = Math.max(distance - 1e-3, 1e-4);
  const hits = raycaster.intersectObjects(collisionMeshes, false);
  if (hits.length === 0) {
    return false;
  }

  const nearestHit = hits[0];
  if (!nearestHit.face) {
    return false;
  }

  normalMatrix.getNormalMatrix(nearestHit.object.matrixWorld);
  const hitNormal = nearestHit.face.normal.clone().applyNormalMatrix(normalMatrix).normalize();
  return hitNormal.dot(direction) < -0.05;
}

/**
 * Determines whether a placement root is currently occluded by collision geometry.
 * @param placementRoot - Placement node whose world position anchors the visibility test.
 * @param collisionMeshes - Collision meshes used for occlusion checks.
 * @param camera - Active camera for the view.
 * @param raycaster - Reusable raycaster instance to avoid frame allocations.
 * @param normalMatrix - Reusable normal matrix scratch object.
 * @returns True when collision geometry blocks the placement from the camera.
 */
function isPlacementOccluded(
  placementRoot: Object3D,
  collisionMeshes: Mesh[],
  camera: PerspectiveCamera,
  raycaster: Raycaster,
  normalMatrix: Matrix3,
): boolean {
  if (collisionMeshes.length === 0) {
    return false;
  }
  const samplePoints = placementSamplePoints(placementRoot);
  return samplePoints.every((point) =>
    isSamplePointOccluded(point, collisionMeshes, camera, raycaster, normalMatrix),
  );
}

/**
 * Updates placement mesh visibility so objects hidden behind walls are culled from the composite render.
 * @param placementGroups - Placement mesh groups keyed by placement root nodes.
 * @param collisionMeshes - Collision meshes used for occlusion checks.
 * @param camera - Active camera for the view.
 * @param raycaster - Reusable raycaster instance.
 * @param normalMatrix - Reusable normal matrix scratch object.
 */
function updatePlacementOcclusion(
  placementGroups: PlacementGroup[],
  collisionMeshes: Mesh[],
  camera: PerspectiveCamera,
  raycaster: Raycaster,
  normalMatrix: Matrix3,
): void {
  for (const group of placementGroups) {
    const occluded = isPlacementOccluded(
      group.root,
      collisionMeshes,
      camera,
      raycaster,
      normalMatrix,
    );
    for (const mesh of group.meshes) {
      mesh.visible = !occluded;
    }
  }
}

/**
 * Applies visibility rules so SPZ stays visually dominant while placed GLB objects remain visible.
 * @param root - Root of the loaded placed GLB scene graph.
 * @param showCollisionMesh - Whether to show the non-placement room mesh.
 */
function applyGlbBlendVisibility(
  placedRoot: Object3D,
  collisionRoot: Object3D,
  showCollisionMesh: boolean,
): SceneMeshGroups {
  return configureSceneMeshVisibility(placedRoot, collisionRoot, showCollisionMesh);
}

/**
 * Converts one placeable-surface payload into world-space triangles for rendering.
 * @param layer - Surface-layer axis metadata.
 * @param surface - Surface payload from placements JSON.
 * @returns Flat xyz vertex array containing render triangles.
 */
function placeableSurfaceVertices(
  layer: PlaceableSurfaceLayer,
  surface: PlaceableSurface,
): number[] {
  const lift = 0.015;

  if (surface.triangles && surface.triangles.length > 0) {
    const vertices: number[] = [];
    for (const triangle of surface.triangles) {
      for (const vertex of triangle) {
        const lifted: Vec3Tuple = [vertex[0], vertex[1], vertex[2]];
        lifted[layer.upAxis] += lift;
        vertices.push(lifted[0], lifted[1], lifted[2]);
      }
    }
    return vertices;
  }

  if (!surface.projectedMin || !surface.projectedMax) {
    return [];
  }

  const [axisA, axisB] = layer.tangentAxes;
  const minA = surface.projectedMin[0];
  const maxA = surface.projectedMax[0];
  const minB = surface.projectedMin[1];
  const maxB = surface.projectedMax[1];

  const toWorld = (a: number, b: number): [number, number, number] => {
    const point: [number, number, number] = [0, 0, 0];
    point[layer.upAxis] = surface.height + lift;
    point[axisA] = a;
    point[axisB] = b;
    return point;
  };

  const p1 = toWorld(minA, minB);
  const p2 = toWorld(maxA, minB);
  const p3 = toWorld(maxA, maxB);
  const p4 = toWorld(minA, maxB);
  return [...p1, ...p2, ...p3, ...p1, ...p3, ...p4];
}

/**
 * Builds a debug layer mesh group that visualizes placeable surface regions.
 * @param layer - Surface-layer payload read from placements JSON.
 * @returns Group containing translucent quads for each placeable surface.
 */
function createPlaceableSurfaceLayerGroup(layer: PlaceableSurfaceLayer): Group {
  const group = new Group();
  group.name = "placeable-surface-layer";

  for (const surface of layer.surfaces) {
    const vertices = placeableSurfaceVertices(layer, surface);
    if (vertices.length === 0) {
      continue;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();

    const areaIntensity = Math.min(1, Math.max(0.2, surface.area / 12));
    const material = new MeshBasicMaterial({
      color: new Color(0.12, 0.85, 0.52).multiplyScalar(areaIntensity),
      depthWrite: false,
      opacity: 0.18,
      side: DoubleSide,
      transparent: true,
    });

    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = 50;
    mesh.name = `placeable-surface:${surface.index}`;
    group.add(mesh);
  }

  return group;
}

/**
 * Releases mesh/material resources for a scene graph before removing it.
 * @param root - Root scene object to dispose.
 */
function disposeSceneGraph(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
      return;
    }
    material.dispose();
  });
}

/**
 * Normalizes unknown errors into a readable status message.
 * @param error - Unknown error object thrown during load/setup.
 * @returns A user-friendly error string.
 */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown viewer error.";
}

/**
 * Renders a combined SPZ + GLB viewer so high-quality splat visuals and placed mesh objects appear together.
 * @returns Interactive viewer UI with bundle loading and collision-layer toggles.
 */
export function SpzGlbViewer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const placedRootRef = useRef<Object3D | null>(null);
  const collisionRootRef = useRef<Object3D | null>(null);
  const placeableSurfaceLayerRef = useRef<Group | null>(null);
  const splatRef = useRef<SplatMesh | null>(null);
  const meshGroupsRef = useRef<SceneMeshGroups | null>(null);
  const [bundlePathInput, setBundlePathInput] = useState(DEFAULT_SCENE_BUNDLE_PATH);
  const [bundlePath, setBundlePath] = useState(DEFAULT_SCENE_BUNDLE_PATH);
  const [showCollisionMesh, setShowCollisionMesh] = useState(false);
  const [showPlaceableSurfaces, setShowPlaceableSurfaces] = useState(false);
  const [status, setStatus] = useState("Loading viewer...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    let isDisposed = false;
    const scene = new Scene();
    scene.background = new Color("#02060f");

    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 1.6, 3.2);

    const renderer = new WebGLRenderer({
      antialias: true,
      canvas: canvasRef.current,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1.2, 0);
    const keyboardState = createViewerKeyboardState();
    let previousFrameTime = performance.now();

    const ambientLight = new AmbientLight("#dfe8ff", 1.3);
    scene.add(ambientLight);
    const keyLight = new DirectionalLight("#ffffff", 1.1);
    keyLight.position.set(4, 8, 3);
    scene.add(keyLight);
    const raycaster = new Raycaster();
    const normalMatrix = new Matrix3();

    const resize = () => {
      const width = canvasRef.current?.clientWidth || 1200;
      const height = canvasRef.current?.clientHeight || 700;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const frame = () => {
      const now = performance.now();
      const deltaSeconds = Math.min((now - previousFrameTime) / 1000, MAX_FRAME_DELTA_SECONDS);
      previousFrameTime = now;
      applyViewerKeyboardMovement(camera, controls, keyboardState, deltaSeconds);
      controls.update();
      const groups = meshGroupsRef.current;
      if (groups) {
        updatePlacementOcclusion(
          groups.placementGroups,
          groups.collisionMeshes,
          camera,
          raycaster,
          normalMatrix,
        );
      }
      renderer.render(scene, camera);
    };

    const fitCameraToContent = () => {
      const bounds = new Box3();
      const placementRoot = placedRootRef.current;
      const splat = splatRef.current;
      if (placementRoot) {
        bounds.expandByObject(placementRoot);
      }
      if (splat) {
        bounds.expandByObject(splat);
      }
      if (bounds.isEmpty()) {
        return;
      }

      const center = bounds.getCenter(new Vector3());
      const size = bounds.getSize(new Vector3()).length();
      const distance = Math.max(size * 0.9, 2.5);
      camera.position.set(center.x + distance, center.y + distance * 0.5, center.z + distance);
      controls.target.copy(center);
      controls.update();
    };

    const loadBundle = async () => {
      setStatus(`Loading bundle: ${bundlePath}`);
      setError(null);

      const response = await fetch(bundlePath);
      if (!response.ok) {
        throw new Error(`Failed to load scene bundle (${response.status})`);
      }
      const bundle = (await response.json()) as SceneBundle;

      const splat = new SplatMesh({ url: bundle.visualSplatPath });
      splat.renderOrder = -100;
      splatRef.current = splat;
      scene.add(splat);
      await splat.initialized;

      const collisionGltf = await new GLTFLoader().loadAsync(bundle.collisionRoomPath);
      const placedGltf = await new GLTFLoader().loadAsync(bundle.placedScenePath);
      collisionRootRef.current = collisionGltf.scene;
      placedRootRef.current = placedGltf.scene;
      meshGroupsRef.current = applyGlbBlendVisibility(
        placedGltf.scene,
        collisionGltf.scene,
        showCollisionMesh,
      );
      scene.add(collisionGltf.scene);
      scene.add(placedGltf.scene);

      if (bundle.placementsPath) {
        const placementsResponse = await fetch(bundle.placementsPath);
        if (placementsResponse.ok) {
          const placementsFile = (await placementsResponse.json()) as PlacementsFile;
          if (placementsFile.placeableSurfaceLayer) {
            const surfaceLayer = createPlaceableSurfaceLayerGroup(
              placementsFile.placeableSurfaceLayer,
            );
            surfaceLayer.visible = showPlaceableSurfaces;
            placeableSurfaceLayerRef.current = surfaceLayer;
            scene.add(surfaceLayer);
          }
        }
      }

      fitCameraToContent();
      setStatus("Loaded SPZ + placed GLB.");
    };

    void loadBundle().catch((nextError: unknown) => {
      if (isDisposed) {
        return;
      }
      setStatus("Viewer load failed.");
      setError(toErrorMessage(nextError));
    });

    resize();
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreViewerKeyboardEvent(event)) {
        return;
      }
      if (updateViewerKeyboardState(keyboardState, event.code, true)) {
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (updateViewerKeyboardState(keyboardState, event.code, false)) {
        event.preventDefault();
      }
    };
    const onWindowBlur = () => {
      clearViewerKeyboardState(keyboardState);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("resize", resize);
    renderer.setAnimationLoop(frame);

    return () => {
      isDisposed = true;
      clearViewerKeyboardState(keyboardState);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("resize", resize);
      renderer.setAnimationLoop(null);
      controls.dispose();
      if (placedRootRef.current) {
        scene.remove(placedRootRef.current);
        disposeSceneGraph(placedRootRef.current);
      }
      if (collisionRootRef.current) {
        scene.remove(collisionRootRef.current);
        disposeSceneGraph(collisionRootRef.current);
      }
      if (placeableSurfaceLayerRef.current) {
        scene.remove(placeableSurfaceLayerRef.current);
        disposeSceneGraph(placeableSurfaceLayerRef.current);
      }
      if (splatRef.current) {
        scene.remove(splatRef.current);
        splatRef.current.dispose();
      }
      placedRootRef.current = null;
      collisionRootRef.current = null;
      placeableSurfaceLayerRef.current = null;
      meshGroupsRef.current = null;
      splatRef.current = null;
      renderer.dispose();
    };
  }, [bundlePath]);

  useEffect(() => {
    if (!placedRootRef.current || !collisionRootRef.current) {
      return;
    }
    meshGroupsRef.current = applyGlbBlendVisibility(
      placedRootRef.current,
      collisionRootRef.current,
      showCollisionMesh,
    );
  }, [showCollisionMesh]);

  useEffect(() => {
    if (!placeableSurfaceLayerRef.current) {
      return;
    }
    placeableSurfaceLayerRef.current.visible = showPlaceableSurfaces;
  }, [showPlaceableSurfaces]);

  return (
    <section className="panel card viewer-shell">
      <div className="viewer-toolbar">
        <label className="viewer-field">
          <span>Scene bundle JSON</span>
          <input
            className="viewer-input"
            onChange={(event) => setBundlePathInput(event.target.value)}
            value={bundlePathInput}
          />
        </label>
        <button className="button button-secondary" onClick={() => setBundlePath(bundlePathInput)}>
          Reload
        </button>
        <label className="viewer-toggle">
          <input
            checked={showCollisionMesh}
            onChange={(event) => setShowCollisionMesh(event.target.checked)}
            type="checkbox"
          />
          Show collision room mesh
        </label>
        <label className="viewer-toggle">
          <input
            checked={showPlaceableSurfaces}
            onChange={(event) => setShowPlaceableSurfaces(event.target.checked)}
            type="checkbox"
          />
          Show placeable surfaces
        </label>
      </div>
      <div className="viewer-status">
        <strong>{status}</strong>
        <p className="muted">WASD: move camera, Shift: faster movement.</p>
        {error ? <p className="muted">{error}</p> : null}
      </div>
      <div className="panel viewer-stage">
        <canvas className="viewer-canvas" ref={canvasRef} />
      </div>
    </section>
  );
}
