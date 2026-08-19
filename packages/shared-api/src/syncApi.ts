import type { AxiosInstance } from "axios";
import type {
  ManifestRequest,
  ManifestResponse,
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
} from "@erp/shared-types";

/**
 * Contexto de sesión que viaja en los headers de cada call de sync.
 *
 * `cosecha` recorta las colecciones que dependen de ella (solicitudes, visitas,
 * entregadores). Es CONTEXTO, no autorización: las zonas autorizadas las resuelve
 * el BE desde el JWT y el cliente no las manda ni las puede pisar.
 */
export interface SyncContext {
  companyId: number;
  cosecha?: string | null;
  /**
   * AppId de mt.MobileCollections. Desambigua colecciones homónimas entre apps:
   * la URL /api/sync/{collection}/pull no lleva la app, y sin este header el BE
   * resuelve por nombre y puede devolver la spec de OTRA app — con otras columnas,
   * otro permiso y sin los filtros de scoping. Pasó con 'productores'.
   */
  appId?: string | null;
  /**
   * Recibidor donde se está trabajando (app de recibos). Angosta el pull a la zona de
   * ESE recibidor en vez de a todas las que el usuario tiene autorizadas.
   *
   * Sin él, un usuario con acceso amplio —admin— se baja el país entero: la primera
   * prueba trajo 12.825 productores porque el BE, al ver "todas las zonas", omite el
   * filtro. Igual que la cosecha, es CONTEXTO: sólo puede restringir, y el BE lo cruza
   * contra el JWT antes de aplicarlo.
   */
  recibidor?: string | null;
}

/**
 * Cliente del sync API. Recibe el AxiosInstance (compartido con auth/etc)
 * para reusar los interceptors de Bearer + Device-Id + retry on 401.
 *
 * El contexto se pasa como GETTER, no como valor: empresa y cosecha las elige el
 * usuario después del login y puede cambiarlas en la sesión. Con un valor fijo en
 * el constructor habría que reconstruir el cliente en cada cambio, y cualquier
 * referencia vieja seguiría sincronizando contra el contexto anterior.
 */
export class SyncApi {
  constructor(
    private readonly http: AxiosInstance,
    private readonly getContext: () => SyncContext
  ) {}

  async manifest(req: ManifestRequest): Promise<ManifestResponse> {
    const resp = await this.http.post<ManifestResponse>(
      "/api/sync/manifest",
      req,
      { headers: this.headers() }
    );
    return resp.data;
  }

  async pull(collection: string, req: PullRequest): Promise<PullResponse> {
    const resp = await this.http.post<PullResponse>(
      `/api/sync/${collection}/pull`,
      req,
      { headers: this.headers() }
    );
    return resp.data;
  }

  async push(collection: string, req: PushRequest): Promise<PushResponse> {
    const resp = await this.http.post<PushResponse>(
      `/api/sync/${collection}/push`,
      req,
      { headers: this.headers() }
    );
    return resp.data;
  }

  private headers(): Record<string, string> {
    const ctx = this.getContext();
    const h: Record<string, string> = {
      "X-Company-Id": String(ctx.companyId),
      "Content-Type": "application/json",
    };
    // Sin cosecha elegida no se manda el header: el BE lo interpreta como "no
    // recortes por cosecha", que es lo correcto antes de que el usuario elija.
    if (ctx.cosecha) h["X-Cosecha"] = ctx.cosecha;
    if (ctx.appId) h["X-App-Id"] = ctx.appId;
    // Promotor no lo manda y el BE lo trata como ausente: sigue acotando por las zonas
    // del JWT, que es lo correcto para una app que trabaja por zonas y no por recibidor.
    if (ctx.recibidor) h["X-Recibidor"] = ctx.recibidor;
    return h;
  }
}
