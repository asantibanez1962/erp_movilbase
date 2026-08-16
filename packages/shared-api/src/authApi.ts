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
  /**
   * La direccion se resuelve EN CADA LLAMADA, no al construir.
   *
   * Cada beneficio corre su backend en su red, y la pantalla de Servidor deja
   * corregir la direccion desde el drawer. Con la URL congelada en el constructor,
   * cambiarla mostraba la nueva en pantalla mientras el login seguia yendo a la
   * vieja: "error de red" mientras todo dice que esta bien, hasta reiniciar la app.
   * Es justo el escenario para el que existe esa pantalla — quien instala en un
   * beneficio corrige la IP y espera seguir.
   *
   * Acepta un string por compatibilidad, pero la app pasa una funcion.
   */
  constructor(private readonly url: string | (() => string)) {}

  private get baseURL(): string {
    return typeof this.url === "function" ? this.url() : this.url;
  }

  async login(req: LoginRequest): Promise<LoginResponse> {
    return this.postAuth("/api/auth/login", req);
  }

  async refresh(req: RefreshRequest): Promise<LoginResponse> {
    return this.postAuth("/api/auth/refresh", req);
  }

  /**
   * POST a un endpoint de auth, distinguiendo "el servidor dijo que no" de "no
   * pude hablar con el servidor".
   *
   * Importa más de lo que parece: el BE responde 401 ante credenciales inválidas y
   * axios lanza por su cuenta ante cualquier no-2xx. Antes sólo se construía un
   * AuthError cuando venía `success:false` DENTRO de un 2xx, así que un 401 salía
   * como AxiosError y la pantalla de login lo mostraba como "Error de conexión.
   * Verificá la red" — mandando al usuario a revisar el WiFi cuando en realidad
   * había tecleado mal la contraseña.
   *
   * Con respuesta del servidor → AuthError con su code (INVALID_CREDENTIALS,
   * ACCOUNT_LOCKED, ...). Sin respuesta (timeout, DNS, socket) → se propaga tal
   * cual, que ahí sí es un problema de red.
   */
  private async postAuth(
    ruta: string,
    req: LoginRequest | RefreshRequest
  ): Promise<LoginResponse> {
    let resp;
    try {
      resp = await axios.post<AuthEnvelope<LoginResponse>>(
        `${this.baseURL}${ruta}`,
        req,
        {
          timeout: 15_000,
          headers: { "X-Client-Kind": "mobile", "Content-Type": "application/json" },
        }
      );
    } catch (e) {
      const cuerpo = (e as { response?: { data?: AuthEnvelope<LoginResponse> } })
        ?.response?.data;
      if (cuerpo?.code) throw new AuthError(cuerpo.code, cuerpo.message);
      // Hubo respuesta del servidor pero sin envelope reconocible: sigue siendo un
      // rechazo, no un problema de red.
      if ((e as { response?: unknown })?.response) {
        throw new AuthError("AUTH_FAILED", "El servidor rechazó el ingreso.");
      }
      throw e; // sin response = red de verdad
    }

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
