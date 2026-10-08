import type { CvrLookupResult, CvrProvider, CvrWarning } from './provider.ts';
import {
  assembleFromDatafordeler,
  type DatafordelerLookupBundle,
  type DatafordelerVirksomhed,
} from './normalizeDatafordeler.ts';

const DEFAULT_ENDPOINT = 'https://graphql.datafordeler.dk/CVR/v1';
const RETRY_DELAY_MS = 1000;

export type FetchFn = typeof fetch;

export interface DatafordelerOptions {
  apiKey: string;
  /** Override the GraphQL endpoint (tests / staging). */
  endpoint?: string;
  fetchFn?: FetchFn;
  retryDelayMs?: number;
  /** Inject "now" for virkningstid (tests). */
  now?: () => Date;
}

interface GraphQlError {
  message: string;
}

interface GraphQlResponse<T> {
  data?: T;
  errors?: GraphQlError[];
}

interface VirksomhedQueryData {
  CVR_Virksomhed?: { nodes?: DatafordelerVirksomhed[] | null } | null;
}

interface DetailsQueryData {
  navn?: { nodes?: DatafordelerLookupBundle['navn'] | null } | null;
  adresse?: { nodes?: DatafordelerLookupBundle['adresse'] | null } | null;
  branche?: { nodes?: DatafordelerLookupBundle['branche'] | null } | null;
  form?: { nodes?: DatafordelerLookupBundle['form'] | null } | null;
  reklame?: { nodes?: DatafordelerLookupBundle['reklame'] | null } | null;
  ansatte?: { nodes?: DatafordelerLookupBundle['ansatte'] | null } | null;
  email?: { nodes?: DatafordelerLookupBundle['email'] | null } | null;
  telefon?: { nodes?: DatafordelerLookupBundle['telefon'] | null } | null;
}

const VIRKSOMHED_QUERY = `
query LookupVirksomhed($cvr: Long!) {
  CVR_Virksomhed(first: 1, where: { CVRNummer: { eq: $cvr } }) {
    nodes {
      id
      CVRNummer
      status
      virksomhedStartdato
      virksomhedOphoersdato
    }
  }
}
`.trim();

const DETAILS_QUERY = `
query LookupDetails($id: String!, $virkningstid: DafDateTime) {
  navn: CVR_Navn(
    first: 10
    virkningstid: $virkningstid
    where: { CVREnhedsId: { eq: $id } }
  ) {
    nodes { vaerdi sekvens virkningFra virkningTil }
  }
  adresse: CVR_Adressering(
    first: 10
    virkningstid: $virkningstid
    where: {
      CVREnhedsId: { eq: $id }
      AdresseringAnvendelse: { eq: "beliggenhedsadresse" }
    }
  ) {
    nodes {
      AdresseringAnvendelse
      CVRAdresse_vejnavn
      CVRAdresse_husnummerFra
      CVRAdresse_etagebetegnelse
      CVRAdresse_doerbetegnelse
      CVRAdresse_postnummer
      CVRAdresse_postdistrikt
      CVRAdresse_adresseFritekst
    }
  }
  branche: CVR_Branche(
    first: 20
    virkningstid: $virkningstid
    where: { CVREnhedsId: { eq: $id } }
  ) {
    nodes { vaerdi vaerdiTekst sekvens virkningFra virkningTil }
  }
  form: CVR_Virksomhedsform(
    first: 5
    virkningstid: $virkningstid
    where: { CVREnhedsId: { eq: $id } }
  ) {
    nodes { vaerdi vaerdiTekst virkningFra virkningTil }
  }
  reklame: CVR_Reklamebeskyttelse(
    first: 5
    virkningstid: $virkningstid
    where: { CVREnhedsId: { eq: $id } }
  ) {
    nodes { vaerdi virkningFra virkningTil }
  }
  ansatte: CVR_Beskaeftigelse(
    first: 20
    where: { CVREnhedsId: { eq: $id } }
  ) {
    nodes {
      antal
      intervalFra
      intervalTil
      beskaeftigelsestalstype
      datoFra
      datoTil
      registreringsdato
    }
  }
  email: CVR_e_mailadresse(
    first: 5
    virkningstid: $virkningstid
    where: { CVREnhedsId: { eq: $id } }
  ) {
    nodes { vaerdi virkningFra virkningTil }
  }
  telefon: CVR_Telefonnummer(
    first: 5
    virkningstid: $virkningstid
    where: { CVREnhedsId: { eq: $id } }
  ) {
    nodes { vaerdi virkningFra virkningTil }
  }
}
`.trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function transientResult(): CvrLookupResult {
  return { found: false, data: null, warnings: ['quota_exceeded'] };
}

function isoNow(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Official CVR provider via Datafordeler GraphQL (entity-based).
 *
 * Lookup is two round-trips: resolve Virksomhed by CVR number, then fetch
 * related entities (navn/adresse/branche/…) by CVREnhedsId in one batched query.
 * Data is free under CC BY 4.0; each deployer needs their own API key.
 */
export class DatafordelerProvider implements CvrProvider {
  readonly name = 'datafordeler';
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchFn: FetchFn;
  private readonly retryDelayMs: number;
  private readonly now: () => Date;

  constructor(opts: DatafordelerOptions) {
    if (!opts.apiKey) throw new Error('DATAFORDELER_API_KEY is required');
    this.apiKey = opts.apiKey;
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.retryDelayMs = opts.retryDelayMs ?? RETRY_DELAY_MS;
    this.now = opts.now ?? (() => new Date());
  }

  async lookup(cvr: string): Promise<CvrLookupResult> {
    const first = await this.attempt(cvr);
    if (first.kind !== 'transient') return first.result;

    await sleep(this.retryDelayMs);
    const second = await this.attempt(cvr);
    return second.result;
  }

  private async attempt(
    cvr: string,
  ): Promise<{ kind: 'ok' | 'notfound' | 'transient'; result: CvrLookupResult }> {
    const cvrNumber = Number(cvr);
    if (!Number.isFinite(cvrNumber)) {
      return { kind: 'notfound', result: { found: false, data: null, warnings: [] } };
    }

    const virksomhedRes = await this.graphql<VirksomhedQueryData>(VIRKSOMHED_QUERY, {
      cvr: cvrNumber,
    });
    if (virksomhedRes.kind === 'transient') {
      return { kind: 'transient', result: transientResult() };
    }
    if (virksomhedRes.kind === 'error') {
      return { kind: 'transient', result: transientResult() };
    }

    const virksomhed = virksomhedRes.data.CVR_Virksomhed?.nodes?.[0] ?? null;
    if (!virksomhed?.id) {
      return { kind: 'notfound', result: { found: false, data: null, warnings: [] } };
    }

    const virkningstid = isoNow(this.now());
    const detailsRes = await this.graphql<DetailsQueryData>(DETAILS_QUERY, {
      id: virksomhed.id,
      virkningstid,
    });
    if (detailsRes.kind === 'transient' || detailsRes.kind === 'error') {
      return { kind: 'transient', result: transientResult() };
    }

    const bundle: DatafordelerLookupBundle = {
      virksomhed,
      navn: detailsRes.data.navn?.nodes ?? [],
      adresse: detailsRes.data.adresse?.nodes ?? [],
      branche: detailsRes.data.branche?.nodes ?? [],
      form: detailsRes.data.form?.nodes ?? [],
      reklame: detailsRes.data.reklame?.nodes ?? [],
      ansatte: detailsRes.data.ansatte?.nodes ?? [],
      email: detailsRes.data.email?.nodes ?? [],
      telefon: detailsRes.data.telefon?.nodes ?? [],
    };

    return { kind: 'ok', result: this.buildResult(bundle) };
  }

  private buildResult(bundle: DatafordelerLookupBundle): CvrLookupResult {
    const data = assembleFromDatafordeler(bundle);
    const warnings: CvrWarning[] = [];

    if (data.protected) {
      warnings.push('reklamebeskyttelse');
      data.phone = null;
      data.email = null;
    }
    if (data.status === 'ceased') {
      warnings.push('ophoert');
    }

    return { found: true, data, warnings };
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<
    | { kind: 'ok'; data: T }
    | { kind: 'transient' }
    | { kind: 'error'; message: string }
  > {
    const url = `${this.endpoint}?apiKey=${encodeURIComponent(this.apiKey)}`;
    let body: GraphQlResponse<T> | null = null;
    let httpOk = false;

    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      });
      httpOk = res.ok;
      const text = await res.text();
      try {
        body = text ? (JSON.parse(text) as GraphQlResponse<T>) : null;
      } catch {
        body = null;
      }
    } catch {
      return { kind: 'transient' };
    }

    // Auth / rate / gateway problems → retryable.
    if (!httpOk) {
      return { kind: 'transient' };
    }
    if (!body) {
      return { kind: 'transient' };
    }
    if (body.errors?.length && !body.data) {
      return { kind: 'error', message: body.errors[0]?.message ?? 'graphql_error' };
    }
    if (!body.data) {
      return { kind: 'transient' };
    }
    return { kind: 'ok', data: body.data };
  }
}
