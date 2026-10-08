export type CvrStatus = 'active' | 'ceased' | 'unknown';

export interface CvrCompany {
  cvr: string;
  name: string;
  address: string | null;
  zipcode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  startDate: string | null;
  industryCode: string | null;
  industryDesc: string | null;
  companyFormCode: string | null;
  companyForm: string | null;
  employees: string | null;
  protected: boolean;
  status: CvrStatus;
}

export type CvrWarning = 'reklamebeskyttelse' | 'ophoert' | 'quota_exceeded';

export interface CvrLookupResult {
  found: boolean;
  data: CvrCompany | null;
  warnings: CvrWarning[];
}

export interface OrgInfo {
  id: number;
  name: string | null;
  cvr: string | null;
  lastSynced: string | null;
}

export interface SyncResponse {
  ok: boolean;
  written: string[];
  skipped?: { id: string; reason: string }[];
  warnings: CvrWarning[];
  syncedAt: string;
}
