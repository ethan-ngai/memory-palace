export interface AuthUser {
  id: string;
  auth0Sub: string;
  email: string;
  name: string;
  picture?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  sid: string;
  userId: string;
  expiresAt: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
}
