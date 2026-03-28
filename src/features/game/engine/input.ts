export type InputController = ReturnType<typeof createInputController>;

export function createInputController(target: Window) {
  const pressedKeys = new Set<string>();

  const handleKeyDown = (event: KeyboardEvent) => {
    pressedKeys.add(event.key.toLowerCase());
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    pressedKeys.delete(event.key.toLowerCase());
  };

  target.addEventListener("keydown", handleKeyDown);
  target.addEventListener("keyup", handleKeyUp);

  return {
    getAxis() {
      return {
        x: (pressedKeys.has("d") ? 1 : 0) - (pressedKeys.has("a") ? 1 : 0),
        z: (pressedKeys.has("s") ? 1 : 0) - (pressedKeys.has("w") ? 1 : 0),
      };
    },
    dispose() {
      target.removeEventListener("keydown", handleKeyDown);
      target.removeEventListener("keyup", handleKeyUp);
    },
  };
}
