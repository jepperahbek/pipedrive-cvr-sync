import { describe, it, expect, vi } from 'vitest';
import type {
  PipedriveClient,
  PipedriveOrganizationField,
  CreateFieldDef,
} from '../src/pipedrive/client.ts';
import { setupOrganizationFields } from '../src/pipedrive/fields.ts';
import { CUSTOM_FIELD_DEFINITIONS } from '../src/pipedrive/fieldDefs.ts';

/**
 * Fake Pipedrive client backed by an in-memory field list. createOrganizationField
 * assigns a fake hash key + option ids and appends to the list, so a second
 * setup run sees the fields as already existing.
 */
function makeFakeClient() {
  const fields: PipedriveOrganizationField[] = [
    // a couple of pre-existing standard/native fields to prove we match by label
    { key: 'name', name: 'Navn', field_type: 'varchar' },
  ];
  let hashCounter = 0;
  const createSpy = vi.fn(async (def: CreateFieldDef): Promise<PipedriveOrganizationField> => {
    hashCounter += 1;
    const created: PipedriveOrganizationField = {
      key: `hash${String(hashCounter).padStart(36, '0')}`,
      name: def.name,
      field_type: def.field_type,
      options: def.options?.map((o, i) => ({ id: 100 + hashCounter * 10 + i, label: o.label })),
    };
    fields.push(created);
    return created;
  });

  const client = {
    listOrganizationFields: vi.fn(async () => structuredClone(fields)),
    createOrganizationField: createSpy,
  } as unknown as PipedriveClient;

  return { client, createSpy };
}

describe('setupOrganizationFields', () => {
  it('creates every required custom field on first run and resolves keys', async () => {
    const { client, createSpy } = makeFakeClient();

    const summary = await setupOrganizationFields(client);

    expect(createSpy).toHaveBeenCalledTimes(CUSTOM_FIELD_DEFINITIONS.length);
    expect(summary.created).toBe(CUSTOM_FIELD_DEFINITIONS.length);
    expect(summary.resolved).toBe(CUSTOM_FIELD_DEFINITIONS.length);

    // every custom field resolves to a hash key
    const cvr = summary.map.get('cvr');
    expect(cvr?.key).toMatch(/^hash/);
    expect(cvr?.type).toBe('double');
  });

  it('is idempotent — a second run with the same state creates nothing', async () => {
    const { client, createSpy } = makeFakeClient();

    await setupOrganizationFields(client); // first run creates
    createSpy.mockClear();
    const second = await setupOrganizationFields(client); // same backing store

    expect(createSpy).not.toHaveBeenCalled();
    expect(second.created).toBe(0);
    expect(second.resolved).toBe(CUSTOM_FIELD_DEFINITIONS.length);
  });
});
