import type { CvrCompany } from './types.ts';

/**
 * The user-toggleable fields shown in the preview. Ids MUST match the backend
 * FIELD_DEFINITIONS ids (packages/backend/src/pipedrive/fieldDefs.ts).
 * "lastSynced" is intentionally omitted — it is always stamped server-side.
 */
export interface FieldDescriptor {
  id: string;
  label: string; // Danish
  value: (c: CvrCompany) => string | null;
}

export const PREVIEW_FIELDS: FieldDescriptor[] = [
  { id: 'name', label: 'Navn', value: (c) => c.name || null },
  { id: 'address', label: 'Adresse', value: (c) => c.address },
  { id: 'cvr', label: 'CVR-nummer', value: (c) => c.cvr },
  { id: 'companyForm', label: 'Selskabsform', value: (c) => c.companyForm },
  { id: 'industryDesc', label: 'Branche', value: (c) => c.industryDesc },
  { id: 'industryCode', label: 'Branchekode', value: (c) => c.industryCode },
  { id: 'employees', label: 'Antal ansatte', value: (c) => c.employees },
];
