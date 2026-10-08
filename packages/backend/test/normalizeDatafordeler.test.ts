import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleFromDatafordeler,
  pickCurrent,
  type DatafordelerLookupBundle,
} from '../src/cvr/normalizeDatafordeler.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loadFixture = (name: string): DatafordelerLookupBundle =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));

describe('pickCurrent', () => {
  it('prefers rows without virkningTil', () => {
    const picked = pickCurrent([
      { vaerdi: 'old', virkningFra: '2010-01-01', virkningTil: '2020-01-01' },
      { vaerdi: 'new', virkningFra: '2020-01-01', virkningTil: null },
    ]);
    expect(picked?.vaerdi).toBe('new');
  });
});

describe('assembleFromDatafordeler — public entity fixture', () => {
  const company = assembleFromDatafordeler(loadFixture('datafordeler-10150817.json'));

  it('maps every canonical field', () => {
    expect(company).toEqual({
      cvr: '10150817',
      name: 'Erhvervsstyrelsen',
      address: 'Langelinie Allé 17, 2100 København Ø',
      zipcode: '2100',
      city: 'København Ø',
      phone: null,
      email: null,
      startDate: '1964-04-01',
      industryCode: '841300',
      industryDesc: 'Administration af og bidrag til erhvervsfremme',
      companyFormCode: '230',
      companyForm: 'Statslig administrativ enhed',
      employees: '911',
      protected: false,
      status: 'active',
    });
  });
});

describe('assembleFromDatafordeler — example ApS fixture', () => {
  const company = assembleFromDatafordeler(loadFixture('datafordeler-example-aps.json'));

  it('maps email, company form, floor address, and 0 employees', () => {
    expect(company.cvr).toBe('12345678');
    expect(company.name).toBe('Eksempel ApS');
    expect(company.email).toBe('kontakt@example.com');
    expect(company.phone).toBeNull();
    expect(company.companyForm).toBe('Anpartsselskab');
    expect(company.companyFormCode).toBe('80');
    expect(company.industryCode).toBe('620100');
    expect(company.employees).toBe('0');
    expect(company.startDate).toBe('2016-11-04');
    expect(company.status).toBe('active');
    expect(company.protected).toBe(false);
    expect(company.address).toBe('Eksempelvej 1, st. tv, 2100 København Ø');
  });
});

describe('assembleFromDatafordeler — status and protection', () => {
  const base = loadFixture('datafordeler-example-aps.json');

  it('marks ceased when ophørsdato is present', () => {
    const ceased = assembleFromDatafordeler({
      ...base,
      virksomhed: { ...base.virksomhed, virksomhedOphoersdato: '2020-12-31' },
    });
    expect(ceased.status).toBe('ceased');
  });

  it('marks protected from reklamebeskyttelse.vaerdi', () => {
    const protectedCompany = assembleFromDatafordeler({
      ...base,
      reklame: [{ vaerdi: true, virkningFra: '2016-11-04', virkningTil: null }],
    });
    expect(protectedCompany.protected).toBe(true);
  });
});
