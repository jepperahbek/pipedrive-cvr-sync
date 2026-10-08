import type { PipedriveClient, PipedriveOrganizationField } from './client.ts';
import { CUSTOM_FIELD_DEFINITIONS, type FieldDefinition } from './fieldDefs.ts';

/** A custom field after resolution: its hash key + enum option label→id map. */
export interface ResolvedField {
  key: string; // 40-char hash key
  type: string;
  /** For enum fields: option label -> Pipedrive option id. */
  optionIds?: Record<string, number>;
}

/** Resolved custom fields, keyed by canonical field id (e.g. "cvr"). */
export type ResolvedFieldMap = Map<string, ResolvedField>;

export interface FieldSetupSummary {
  map: ResolvedFieldMap;
  resolved: number;
  created: number;
}

function optionIdMap(field: PipedriveOrganizationField): Record<string, number> | undefined {
  if (!field.options?.length) return undefined;
  const m: Record<string, number> = {};
  for (const o of field.options) m[o.label] = o.id;
  return m;
}

/**
 * Idempotent field setup. Run once on boot:
 *   1. GET /organizationFields, index existing fields by label.
 *   2. For each required custom field, reuse the existing one or create it.
 *   3. Return a map keyed by canonical field id -> { hashKey, optionIds }.
 *
 * A second run with the same Pipedrive state creates nothing.
 */
export async function setupOrganizationFields(client: PipedriveClient): Promise<FieldSetupSummary> {
  const existing = await client.listOrganizationFields();
  const byLabel = new Map<string, PipedriveOrganizationField>();
  for (const f of existing) byLabel.set(f.name, f);

  const map: ResolvedFieldMap = new Map();
  let created = 0;

  for (const def of CUSTOM_FIELD_DEFINITIONS) {
    let field = byLabel.get(def.label);
    if (!field) {
      field = await createField(client, def);
      created += 1;
    }
    map.set(def.id, {
      key: field.key,
      type: field.field_type,
      optionIds: optionIdMap(field),
    });
  }

  return { map, resolved: map.size, created };
}

async function createField(
  client: PipedriveClient,
  def: FieldDefinition,
): Promise<PipedriveOrganizationField> {
  return client.createOrganizationField({
    name: def.label,
    field_type: def.type!,
    options: def.options?.map((label) => ({ label })),
  });
}
