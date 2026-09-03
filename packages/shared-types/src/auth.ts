/**
 * Auth DTOs. Mismo shape que la API del BE (PascalCase EXCEPT estos
 * endpoints son los que el BE ya servía a la web → vienen camelCase
 * después del JsonSerializer default. Distinto de sync (snake_case
 * deliberado).
 */

export interface LoginRequest {
  usuario: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  /** seconds until access expires (typically 900 = 15min) */
  expiresIn: number;
  user: { id: number; usuario: string };
  passwordExpired: boolean;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface AuthEnvelope<T> {
  success: boolean;
  code: string;
  message?: string;
  data?: T;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
