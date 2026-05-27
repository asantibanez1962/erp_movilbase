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
 * Cliente del sync API. Recibe el AxiosInstance (compartido con auth/etc)
 * para reusar los interceptors de Bearer + Device-Id + retry on 401.
 *
 * Cada call requiere companyId del lado del consumer — se pasa al constructor
 * y se inyecta como X-Company-Id header.
 */

export class SyncApi {
  constructor(
    private readonly http: AxiosInstance,
    private readonly companyId: number
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
    return {
      "X-Company-Id": String(this.companyId),
      "Content-Type": "application/json",
    };
  }
}
