import type { CvrCompany, CvrStatus } from './provider.ts';

/** Raw shapes from Datafordeler CVR GraphQL (entity-based schema). */
export interface DatafordelerVirksomhed {
  id: string;
  CVRNummer: number | string;
  status: string;
  virksomhedStartdato: string | null;
  virksomhedOphoersdato: string | null;
}

export interface DatafordelerNavn {
  vaerdi: string;
  sekvens?: number | null;
  virkningFra?: string | null;
  virkningTil?: string | null;
}

export interface DatafordelerAdresse {
  AdresseringAnvendelse?: string | null;
  CVRAdresse_vejnavn?: string | null;
  CVRAdresse_husnummerFra?: string | null;
  CVRAdresse_etagebetegnelse?: string | null;
  CVRAdresse_doerbetegnelse?: string | null;
  CVRAdresse_postnummer?: string | null;
  CVRAdresse_postdistrikt?: string | null;
  CVRAdresse_adresseFritekst?: string | null;
}

export interface DatafordelerBranche {
  vaerdi: string;
  vaerdiTekst: string;
  sekvens?: number | null;
  virkningFra?: string | null;
  virkningTil?: string | null;
}

export interface DatafordelerForm {
  vaerdi: string;
  vaerdiTekst: string;
  virkningFra?: string | null;
  virkningTil?: string | null;
}

export interface DatafordelerReklame {
  vaerdi: boolean;
  virkningFra?: string | null;
  virkningTil?: string | null;
}

export interface DatafordelerBeskaeftigelse {
  antal?: number | null;
  intervalFra?: number | null;
  intervalTil?: number | null;
  beskaeftigelsestalstype?: string | null;
  datoFra?: string | null;
  datoTil?: string | null;
  registreringsdato?: string | null;
}

export interface DatafordelerKontakt {
  vaerdi: string;
  virkningFra?: string | null;
  virkningTil?: string | null;
}

export interface DatafordelerLookupBundle {
  virksomhed: DatafordelerVirksomhed;
  navn: DatafordelerNavn[];
  adresse: DatafordelerAdresse[];
  branche: DatafordelerBranche[];
  form: DatafordelerForm[];
  reklame: DatafordelerReklame[];
  ansatte: DatafordelerBeskaeftigelse[];
  email: DatafordelerKontakt[];
  telefon: DatafordelerKontakt[];
}

interface Temporal {
  virkningFra?: string | null;
  virkningTil?: string | null;
}

/** Prefer current rows (no virkningTil), then latest virkningFra. */
export function pickCurrent<T extends Temporal>(rows: T[]): T | null {
  if (!rows.length) return null;
  const open = rows.filter((r) => r.virkningTil == null || r.virkningTil === '');
  const pool = open.length ? open : rows;
  return [...pool].sort((a, b) => String(b.virkningFra ?? '').localeCompare(String(a.virkningFra ?? '')))[0] ?? null;
}

function normalizeCvr(vat: number | string): string {
  return String(vat).padStart(8, '0');
}

function assembleStreet(a: DatafordelerAdresse): string | null {
  if (a.CVRAdresse_adresseFritekst?.trim()) return a.CVRAdresse_adresseFritekst.trim();
  const vej = a.CVRAdresse_vejnavn?.trim() || '';
  const hus = a.CVRAdresse_husnummerFra?.trim() || '';
  const etage = a.CVRAdresse_etagebetegnelse?.trim() || '';
  const doer = a.CVRAdresse_doerbetegnelse?.trim() || '';
  const floor = [etage, doer].filter(Boolean).join('. ');
  const line = [vej, hus].filter(Boolean).join(' ');
  const withFloor = floor ? `${line}, ${floor}` : line;
  return withFloor.trim() || null;
}

function assembleAddress(a: DatafordelerAdresse | null): {
  address: string | null;
  zipcode: string | null;
  city: string | null;
} {
  if (!a) return { address: null, zipcode: null, city: null };
  const street = assembleStreet(a);
  const zipcode = a.CVRAdresse_postnummer?.trim() || null;
  const city = a.CVRAdresse_postdistrikt?.trim() || null;
  const zipCity = [zipcode, city].filter(Boolean).join(' ').trim();
  const parts = [street, zipCity || null].filter(Boolean);
  return {
    address: parts.length ? parts.join(', ') : null,
    zipcode,
    city,
  };
}

function pickBranche(rows: DatafordelerBranche[]): DatafordelerBranche | null {
  if (!rows.length) return null;
  const current = rows.filter((r) => r.virkningTil == null || r.virkningTil === '');
  const pool = current.length ? current : rows;
  // sekvens 0 is hovedbranche in CVR convention; otherwise lowest sekvens.
  const sorted = [...pool].sort((a, b) => Number(a.sekvens ?? 999) - Number(b.sekvens ?? 999));
  return sorted[0] ?? null;
}

function pickName(rows: DatafordelerNavn[]): string | null {
  if (!rows.length) return null;
  const current = rows.filter((r) => r.virkningTil == null || r.virkningTil === '');
  const pool = current.length ? current : rows;
  const sorted = [...pool].sort((a, b) => Number(a.sekvens ?? 999) - Number(b.sekvens ?? 999));
  return sorted[0]?.vaerdi?.trim() || null;
}

function pickEmployees(rows: DatafordelerBeskaeftigelse[]): string | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) =>
    String(b.registreringsdato ?? b.datoTil ?? '').localeCompare(String(a.registreringsdato ?? a.datoTil ?? '')),
  );
  for (const row of sorted) {
    if (row.antal !== null && row.antal !== undefined) return String(row.antal);
  }
  for (const row of sorted) {
    if (row.intervalFra != null || row.intervalTil != null) {
      if (row.intervalFra != null && row.intervalTil != null) {
        return `${row.intervalFra}-${row.intervalTil}`;
      }
      return String(row.intervalFra ?? row.intervalTil);
    }
  }
  return null;
}

function deriveStatus(v: DatafordelerVirksomhed): CvrStatus {
  if (v.virksomhedOphoersdato) return 'ceased';
  const s = (v.status || '').toUpperCase();
  if (s.includes('OPH') || s.includes('CEASE') || s.includes('SLETTET') || s === 'UDLØBET') {
    return 'ceased';
  }
  if (!s || s === 'NORMAL' || s === 'AKTIV' || s === 'ACTIVE') return 'active';
  // Unknown status string but no ophørsdato — treat as active with caution.
  return 'active';
}

/**
 * Map a Datafordeler entity bundle into the canonical CvrCompany model.
 * Provider-specific keys live ONLY here — nothing outside cvr/ references them.
 */
export function assembleFromDatafordeler(bundle: DatafordelerLookupBundle): CvrCompany {
  const name = pickName(bundle.navn) || `CVR ${normalizeCvr(bundle.virksomhed.CVRNummer)}`;
  // Query already filters AdresseringAnvendelse = beliggenhedsadresse.
  const addressParts = assembleAddress(bundle.adresse[0] ?? null);

  const branche = pickBranche(bundle.branche);
  const form = pickCurrent(bundle.form);
  const reklame = pickCurrent(bundle.reklame);
  const email = pickCurrent(bundle.email);
  const telefon = pickCurrent(bundle.telefon);

  return {
    cvr: normalizeCvr(bundle.virksomhed.CVRNummer),
    name,
    address: addressParts.address,
    zipcode: addressParts.zipcode,
    city: addressParts.city,
    phone: telefon?.vaerdi?.trim() || null,
    email: email?.vaerdi?.trim() || null,
    startDate: bundle.virksomhed.virksomhedStartdato || null,
    industryCode: branche?.vaerdi?.trim() || null,
    industryDesc: branche?.vaerdiTekst?.trim() || null,
    companyFormCode: form?.vaerdi?.trim() || null,
    companyForm: form?.vaerdiTekst?.trim() || null,
    employees: pickEmployees(bundle.ansatte),
    protected: Boolean(reklame?.vaerdi),
    status: deriveStatus(bundle.virksomhed),
  };
}
