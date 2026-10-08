import type { CvrCompany } from '../cvr/provider.ts';
import { FIELD_DEFINITIONS_BY_ID, type FieldDefinition } from '../pipedrive/fieldDefs.ts';
import type { ResolvedFieldMap } from '../pipedrive/fields.ts';

export interface BuildUpdateOptions {
  /** Canonical field ids the user opted into. */
  selectedFieldIds: string[];
  /** ISO timestamp for "CVR Sidst Synkroniseret". */
  syncedAt?: string | null;
}

export interface SkippedField {
  id: string;
  reason: 'empty_value' | 'field_not_resolved' | 'missing_option' | 'unknown_field';
}

export interface OrganizationUpdate {
  body: Record<string, unknown>;
  written: string[]; // canonical field ids written
  skipped: SkippedField[];
}

/**
 * Build the Pipedrive organization update body from a CvrCompany, the resolved
 * custom-field hash-key map, and the user's opted-in fields.
 *
 * Invariants:
 *   - phone/email are never synced to organizations (no native field; the CVR
 *     adapter already nulls them for reklamebeskyttede companies regardless).
 *   - The org name is overwritten with the official CVR name when selected.
 *   - Empty (null) values are skipped, never clobbering existing data.
 */
export function buildOrganizationUpdate(
  company: CvrCompany,
  fieldMap: ResolvedFieldMap,
  opts: BuildUpdateOptions,
): OrganizationUpdate {
  const body: Record<string, unknown> = {};
  const written: string[] = [];
  const skipped: SkippedField[] = [];

  const writeField = (def: FieldDefinition, rawValue: string | null): void => {
    if (rawValue === null || rawValue === undefined) {
      skipped.push({ id: def.id, reason: 'empty_value' });
      return;
    }

    if (def.kind === 'standard') {
      body[def.standardKey!] = rawValue;
      written.push(def.id);
      return;
    }

    // custom field
    const resolved = fieldMap.get(def.id);
    if (!resolved) {
      skipped.push({ id: def.id, reason: 'field_not_resolved' });
      return;
    }
    if (def.type === 'enum') {
      const optionId = resolved.optionIds?.[rawValue];
      if (optionId === undefined) {
        skipped.push({ id: def.id, reason: 'missing_option' });
        return;
      }
      body[resolved.key] = optionId;
    } else if (def.type === 'double' || def.type === 'int') {
      const num = def.type === 'int' ? parseInt(rawValue, 10) : Number(rawValue);
      if (Number.isNaN(num)) {
        skipped.push({ id: def.id, reason: 'empty_value' });
        return;
      }
      body[resolved.key] = num;
    } else {
      body[resolved.key] = rawValue;
    }
    written.push(def.id);
  };

  for (const id of opts.selectedFieldIds) {
    const def = FIELD_DEFINITIONS_BY_ID.get(id);
    if (!def) {
      skipped.push({ id, reason: 'unknown_field' });
      continue;
    }
    writeField(def, def.extract(company, { syncedAt: opts.syncedAt }));
  }

  return { body, written, skipped };
}
