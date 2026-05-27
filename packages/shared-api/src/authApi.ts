import axios from "axios";
import type {
  AuthEnvelope,
  LoginRequest,
  LoginResponse,
  RefreshRequest,
} from "@erp/shared-types";

/**
 * Llamadas directas al backend de auth. NO usan el apiClient con
 * interceptors (para evitar dependencia circular: el interceptor de
 * refresh termina llamando a esta misma función).
 *
 * Cada función crea un axios fresco por call — el overhead es trivial
 * (ms) y mantiene el call aislado.
 */

export class AuthApi {
  constructor(private readonly baseURL: string) {}

  async login(req: LoginRequest): Promise<LoginResponse> {
    const resp = await axios.post<AuthEnvelope<LoginResponse>>(
      `${this.baseURL}/api/auth/login`,
      req,
      {
        timeout: 15_000,
        headers: { "X-Client-Kind": "mobile", "Content-Type": "application/json" },
      }
    );
    if (!resp.data.success || !resp.data.data) {
      throw new AuthError(resp.data.code, resp.data.message);
    }
    return resp.data.data;
  }

  async refresh(req: RefreshRequest): Promise<LoginResponse> {
    const resp = await axios.post<AuthEnvelope<LoginResponse>>(
      `${this.baseURL}/api/auth/refresh`,
      req,
      {
        timeout: 15_000,
        headers: { "X-Client-Kind": "mobile", "Content-Type": "application/json" },
      }
    );
    if (!resp.data.success || !resp.data.data) {
      throw new AuthError(resp.data.code, resp.data.message);
    }
    return resp.data.data;
  }
}

export class AuthError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
  }
}
