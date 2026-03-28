export interface GameSnapshot {
  cubeRotation: number;
  playerX: number;
  playerZ: number;
}

export interface GameProgress {
  snapshot: GameSnapshot;
}

export interface GameProfile {
  userId: string;
  lastPlayedAt: string | null;
  snapshot: GameSnapshot;
}

export interface GameCanvasProps {
  initialProfile: GameProfile;
}
