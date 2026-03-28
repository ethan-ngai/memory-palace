import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
} from "three";
import type { GameSnapshot } from "@/features/game/types";

export function createGameScene(initialSnapshot: GameSnapshot) {
  const scene = new Scene();
  scene.background = new Color("#08141f");

  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 2.8, 6);

  const cube = new Mesh(
    new BoxGeometry(1.1, 1.1, 1.1),
    new MeshStandardMaterial({ color: "#43b3a0" }),
  );
  cube.position.set(initialSnapshot.playerX, 0, initialSnapshot.playerZ);
  cube.rotation.y = initialSnapshot.cubeRotation;
  scene.add(cube);

  const ambientLight = new AmbientLight("#d0f5ff", 1.6);
  scene.add(ambientLight);

  const directionalLight = new DirectionalLight("#fff4d6", 1.8);
  directionalLight.position.set(3, 5, 4);
  scene.add(directionalLight);

  return {
    camera,
    cube,
    dispose() {
      cube.geometry.dispose();
      const material = cube.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material.dispose();
      }
    },
    scene,
  };
}
