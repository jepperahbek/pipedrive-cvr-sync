import type { CvrCompany } from '../cvr/provider.ts';

/** Context passed to value extractors that need data beyond the CvrCompany. */
export interface ExtractContext {
  /** ISO timestamp for "CVR Sidst Synkroniseret"; set by the sync route. */
  syncedAt?: string | null;
}

export type FieldKind = 'standard' | 'custom';
export type CustomFieldType = 'varchar' | 'double' | 'int' | 'date' | 'enum';

export interface FieldDefinition {
  /** Stable canonical id used by the API (`fields: string[]`) and the UI. */
  id: string;
  /** Danish label. For custom fields this is what we match/create in Pipedrive. */
  label: string;
  kind: FieldKind;
  /** For standard fields: the built-in Pipedrive org key (e.g. "name"). */
  standardKey?: string;
  /** For custom fields: the Pipedrive field type. */
  type?: CustomFieldType;
  /** For enum fields: the option labels to create, in order. */
  options?: string[];
  /** Compute the value to write; null/undefined means "skip this field". */
  extract: (c: CvrCompany, ctx: ExtractContext) => string | null;
}

/**
 * The complete set of writable fields. Standard fields map to built-in org keys;
 * custom fields are created in Pipedrive (idempotently) and addressed by hash key.
 */
export const FIELD_DEFINITIONS: FieldDefinition[] = [
  // --- Standard Pipedrive organization fields ---
  {
    id: 'name',
    label: 'Navn',
    kind: 'standard',
    standardKey: 'name',
    // Overwrite the org name with the official CVR name (owner decision).
    extract: (c) => c.name || null,
  },
  {
    id: 'address',
    label: 'Adresse',
    kind: 'standard',
    standardKey: 'address',
    extract: (c) => c.address,
  },
  // NOTE: phone/email are intentionally NOT synced. Pipedrive organizations have
  // no native phone/email field (verified against the live organizationFields
  // contract), and contact details live on Persons (out of scope v1). The CVR
  // values are still suppressed at the adapter for reklamebeskyttede companies.

  // --- Custom CVR fields (created on boot if missing) ---
  // Reuses the pre-existing "CVR" organization field (type double). Danish CVR
  // numbers are 8 digits with no leading zero, so a double stores them exactly.
  { id: 'cvr', label: 'CVR', kind: 'custom', type: 'double', extract: (c) => c.cvr },
  { id: 'industryDesc', label: 'Branche', kind: 'custom', type: 'varchar', extract: (c) => c.industryDesc },
  { id: 'industryCode', label: 'Branchekode', kind: 'custom', type: 'varchar', extract: (c) => c.industryCode },
  { id: 'companyForm', label: 'Selskabsform', kind: 'custom', type: 'varchar', extract: (c) => c.companyForm },
  // Reuses the native "Number of employees" organization field (type int).
  { id: 'employees', label: 'Number of employees', kind: 'custom', type: 'int', extract: (c) => c.employees },
  // NOTE: Stiftelsesdato, Reklamebeskyttelse, Markedsføringsbeskyttet and CVR
  // Status are intentionally not synced (per owner decision). The protected /
  // ceased conditions still surface as warnings in the panel UI; they are just
  // not written as organization fields.
  {
    id: 'lastSynced',
    label: 'CVR Sidst Synkroniseret',
    kind: 'custom',
    type: 'date',
    extract: (_c, ctx) => ctx.syncedAt ?? null,
  },
];

export const FIELD_DEFINITIONS_BY_ID: Map<string, FieldDefinition> = new Map(
  FIELD_DEFINITIONS.map((f) => [f.id, f]),
);

/** Custom fields only — the set fields.ts must ensure exist in Pipedrive. */
export const CUSTOM_FIELD_DEFINITIONS = FIELD_DEFINITIONS.filter((f) => f.kind === 'custom');
