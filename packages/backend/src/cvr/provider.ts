export type CvrStatus = 'active' | 'ceased' | 'unknown';

export interface CvrCompany {
  cvr: string; // 8 digits
  name: string;
  address: string | null; // assembled: street, zip city
  zipcode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  startDate: string | null; // ISO yyyy-mm-dd
  industryCode: string | null;
  industryDesc: string | null; // human readable
  companyFormCode: string | null;
  companyForm: string | null; // human readable, e.g. "Anpartsselskab"
  employees: string | null; // normalized to a display string
  protected: boolean; // reklamebeskyttelse
  status: CvrStatus;
}

export type CvrWarning = 'reklamebeskyttelse' | 'ophoert' | 'quota_exceeded';

export interface CvrLookupResult {
  found: boolean;
  data: CvrCompany | null;
  warnings: CvrWarning[];
}

export interface CvrProvider {
  name: string;
  lookup(cvr: string): Promise<CvrLookupResult>;
}
