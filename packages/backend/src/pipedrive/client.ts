/** Thin wrapper over the Pipedrive REST API v1 (single-tenant, personal token). */

export type FetchFn = typeof fetch;

export interface PipedriveClientOptions {
  apiToken: string;
  companyDomain: string;
  fetchFn?: FetchFn;
}

/** A Pipedrive organization custom-field option (for enum/set fields). */
export interface PipedriveFieldOption {
  id: number;
  label: string;
}

/** Shape of an organization field as returned by GET /organizationFields. */
export interface PipedriveOrganizationField {
  key: string; // 40-char hash key (or a standard key like "name")
  name: string; // human label
  field_type: string;
  options?: PipedriveFieldOption[];
}

/** Definition passed to createOrganizationField. */
export interface CreateFieldDef {
  name: string;
  field_type: string;
  options?: { label: string }[];
}

export class PipedriveApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'PipedriveApiError';
  }
}

interface PipedriveEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
  error_info?: string;
}

export class PipedriveClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;

  constructor(opts: PipedriveClientOptions) {
    if (!opts.apiToken) throw new Error('PIPEDRIVE_API_TOKEN is required');
    if (!opts.companyDomain) throw new Error('PIPEDRIVE_COMPANY_DOMAIN is required');
    this.apiToken = opts.apiToken;
    this.baseUrl = `https://${opts.companyDomain}.pipedrive.com/api/v1`;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${path}${sep}api_token=${encodeURIComponent(this.apiToken)}`;

    const res = await this.fetchFn(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed: PipedriveEnvelope<T> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as PipedriveEnvelope<T>) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok || !parsed?.success) {
      const msg = parsed?.error ?? `Pipedrive request failed (${res.status})`;
      throw new PipedriveApiError(msg, res.status, parsed ?? text);
    }
    return parsed.data;
  }

  getOrganization(id: number): Promise<Record<string, unknown>> {
    return this.request('GET', `/organizations/${id}`);
  }

  updateOrganization(id: number, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request('PUT', `/organizations/${id}`, body);
  }

  listOrganizationFields(): Promise<PipedriveOrganizationField[]> {
    return this.request('GET', '/organizationFields');
  }

  createOrganizationField(def: CreateFieldDef): Promise<PipedriveOrganizationField> {
    return this.request('POST', '/organizationFields', def);
  }
}
