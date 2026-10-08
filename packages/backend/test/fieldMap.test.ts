import { describe, it, expect } from 'vitest';
import type { CvrCompany } from '../src/cvr/provider.ts';
import { buildOrganizationUpdate } from '../src/mapping/fieldMap.ts';
import type { ResolvedFieldMap } from '../src/pipedrive/fields.ts';
import { CUSTOM_FIELD_DEFINITIONS } from '../src/pipedrive/fieldDefs.ts';

/** A resolved map covering every custom field, with fake keys. */
function makeFieldMap(): ResolvedFieldMap {
  const map: ResolvedFieldMap = new Map();
  for (const def of CUSTOM_FIELD_DEFINITIONS) {
    map.set(def.id, {
      key: `key_${def.id}`,
      type: def.type!,
      optionIds: def.type === 'enum' ? { Ja: 1, Nej: 2 } : undefined,
    });
  }
  return map;
}

const baseCompany: CvrCompany = {
  cvr: '12345678',
  name: 'Eksempel ApS',
  address: 'Eksempelvej 1, 2100 København Ø',
  zipcode: '2100',
  city: 'København Ø',
  phone: '12345678',
  email: 'kontakt@example.com',
  startDate: '2016-11-04',
  industryCode: '620100',
  industryDesc: 'Computerprogrammering',
  companyFormCode: '80',
  companyForm: 'Anpartsselskab',
  employees: '0',
  protected: false,
  status: 'active',
};

// The synced set after the owner's field-reduction decision.
const ALL_FIELDS = [
  'name', 'address', 'cvr', 'industryDesc', 'industryCode',
  'companyForm', 'employees', 'lastSynced',
];

describe('buildOrganizationUpdate', () => {
  it('writes opted-in fields, resolving custom hash keys and the standard address key', () => {
    const map = makeFieldMap();
    const { body, written } = buildOrganizationUpdate(baseCompany, map, {
      selectedFieldIds: ['cvr', 'industryDesc', 'companyForm', 'employees', 'address'],
      syncedAt: '2026-06-25',
    });

    expect(body.key_cvr).toBe(12345678); // double field -> numeric
    expect(body.key_industryDesc).toBe('Computerprogrammering');
    expect(body.key_companyForm).toBe('Anpartsselskab');
    expect(body.key_employees).toBe(0); // int field -> numeric, 0 is meaningful
    expect(body.address).toBe('Eksempelvej 1, 2100 København Ø'); // standard key
    expect(written).toEqual(
      expect.arrayContaining(['cvr', 'industryDesc', 'companyForm', 'employees', 'address']),
    );
  });

  it('writes the CVR Sidst Synkroniseret timestamp from syncedAt', () => {
    const map = makeFieldMap();
    const { body, written } = buildOrganizationUpdate(baseCompany, map, {
      selectedFieldIds: ['lastSynced'],
      syncedAt: '2026-06-25',
    });
    expect(body.key_lastSynced).toBe('2026-06-25');
    expect(written).toContain('lastSynced');
  });

  it('never syncs phone/email or removed protection/status fields', () => {
    const map = makeFieldMap();
    const { body } = buildOrganizationUpdate(baseCompany, map, {
      // none of these are in the registry anymore
      selectedFieldIds: ['phone', 'email', 'protected', 'marketingProtected', 'status', 'startDate'],
    });
    expect(Object.keys(body)).toHaveLength(0);
  });

  it('overwrites the org name with the official CVR name', () => {
    const map = makeFieldMap();
    const { body, written } = buildOrganizationUpdate(baseCompany, map, {
      selectedFieldIds: ['name'],
    });
    expect(body.name).toBe('Eksempel ApS');
    expect(written).toContain('name');
  });

  it('still syncs normal fields for a protected company (no contact data involved)', () => {
    const map = makeFieldMap();
    const protectedCompany: CvrCompany = { ...baseCompany, protected: true };

    const { body } = buildOrganizationUpdate(protectedCompany, map, {
      selectedFieldIds: ALL_FIELDS,
    });

    expect(body.key_cvr).toBe(12345678);
    expect(body.phone).toBeUndefined();
    expect(body.email).toBeUndefined();
  });

  it('skips empty values instead of clobbering with null', () => {
    const map = makeFieldMap();
    const noIndustry: CvrCompany = { ...baseCompany, industryDesc: null };
    const { body, skipped } = buildOrganizationUpdate(noIndustry, map, {
      selectedFieldIds: ['industryDesc'],
    });
    expect(body.key_industryDesc).toBeUndefined();
    expect(skipped).toContainEqual({ id: 'industryDesc', reason: 'empty_value' });
  });
});
