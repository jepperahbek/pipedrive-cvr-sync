import { useCallback, useEffect, useRef, useState } from 'react';
import type { CvrCompany, CvrWarning } from '../types.ts';
import { PREVIEW_FIELDS } from '../fields.ts';
import { ApiError, getOrgInfo, lookupCvr, syncOrg } from '../api.ts';
import { isEmbedded, resizePanel, showConfirmation, showSnackbar } from '../sdk.ts';
import { DataPreview } from './DataPreview.tsx';
import { WarningBanner } from './WarningBanner.tsx';
import { SyncStatus } from './SyncStatus.tsx';

type Phase = 'init' | 'idle' | 'looking_up' | 'preview' | 'syncing' | 'error';

interface ErrorState {
  kind: 'not_found' | 'quota' | 'generic';
  message: string;
}

function defaultSelection(company: CvrCompany): Record<string, boolean> {
  const sel: Record<string, boolean> = {};
  for (const f of PREVIEW_FIELDS) {
    const v = f.value(company);
    sel[f.id] = v !== null && v !== ''; // all available fields on by default
  }
  return sel;
}

export function CVRPanel({ orgId }: { orgId: number | null }) {
  const [phase, setPhase] = useState<Phase>('init');
  const [cvrInput, setCvrInput] = useState('');
  const [company, setCompany] = useState<CvrCompany | null>(null);
  const [warnings, setWarnings] = useState<CvrWarning[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);

  // Keep the Pipedrive panel sized to the content.
  useEffect(() => {
    if (rootRef.current) resizePanel(rootRef.current.scrollHeight + 24);
  });

  const runLookup = useCallback(async (cvrnr: string) => {
    setPhase('looking_up');
    setError(null);
    try {
      const result = await lookupCvr(cvrnr);
      if (result.found && result.data) {
        setCompany(result.data);
        setWarnings(result.warnings);
        setSelected(defaultSelection(result.data));
        setPhase('preview');
      } else if (result.warnings.includes('quota_exceeded')) {
        setError({ kind: 'quota', message: 'CVR-tjenesten er midlertidigt begrænset — prøv igen om lidt.' });
        setPhase('error');
      } else {
        setError({ kind: 'not_found', message: 'CVR-nummer ikke fundet. Tjek nummeret eller søg på virk.dk.' });
        setPhase('error');
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Der opstod en fejl. Prøv igen.';
      setError({ kind: 'generic', message });
      setPhase('error');
    }
  }, []);

  // On load: if the org already has a CVR number, auto-look it up.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (orgId !== null && isEmbedded()) {
        try {
          const info = await getOrgInfo(orgId);
          if (cancelled) return;
          setLastSynced(info.lastSynced);
          if (info.cvr) {
            setCvrInput(info.cvr);
            void runLookup(info.cvr);
            return;
          }
        } catch {
          /* fall through to manual input */
        }
      }
      if (!cancelled) setPhase('idle');
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [orgId, runLookup]);

  const onToggle = useCallback((id: string, checked: boolean) => {
    setSelected((prev) => ({ ...prev, [id]: checked }));
  }, []);

  const isCvrValid = /^\d{8}$/.test(cvrInput.trim());

  const onSync = useCallback(async () => {
    if (!company || orgId === null) return;
    const fields = PREVIEW_FIELDS.filter((f) => selected[f.id]).map((f) => f.id);
    if (fields.length === 0) {
      await showSnackbar('Vælg mindst ét felt at synkronisere.');
      return;
    }

    const labels = PREVIEW_FIELDS.filter((f) => fields.includes(f.id)).map((f) => f.label);
    const confirmed = await showConfirmation(
      'Overskriv organisationsdata?',
      `Følgende felter overskrives med data fra CVR:\n\n${labels.join(', ')}`,
    );
    if (!confirmed) return;

    setPhase('syncing');
    try {
      const result = await syncOrg(orgId, company.cvr, fields);
      setLastSynced(result.syncedAt);
      setPhase('preview');
      await showSnackbar('CVR-data synkroniseret.');
    } catch (err) {
      setPhase('preview');
      const message = err instanceof ApiError ? err.message : 'Kunne ikke gemme data i Pipedrive.';
      await showSnackbar(message);
    }
  }, [company, orgId, selected]);

  return (
    <div className="panel" ref={rootRef}>
      <h1 className="panel__title">CVR-data</h1>

      {phase === 'init' && <p className="muted">Indlæser…</p>}

      {(phase === 'idle' || phase === 'looking_up' || phase === 'error') && (
        <div className="lookup">
          <label className="lookup__label" htmlFor="cvr">
            Indtast CVR-nummer
          </label>
          <div className="lookup__row">
            <input
              id="cvr"
              inputMode="numeric"
              maxLength={8}
              placeholder="8 cifre"
              value={cvrInput}
              onChange={(e) => setCvrInput(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isCvrValid) void runLookup(cvrInput.trim());
              }}
            />
            <button
              className="btn btn--primary"
              disabled={!isCvrValid || phase === 'looking_up'}
              onClick={() => void runLookup(cvrInput.trim())}
            >
              {phase === 'looking_up' ? 'Henter…' : 'Hent CVR-data'}
            </button>
          </div>

          {phase === 'error' && error && (
            <div className={`banner banner--${error.kind === 'not_found' ? 'warn' : 'error'}`}>
              {error.message}{' '}
              {error.kind === 'not_found' && (
                <a href="https://datacvr.virk.dk" target="_blank" rel="noreferrer">
                  Åbn virk.dk
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {(phase === 'preview' || phase === 'syncing') && company && (
        <div className="result">
          <SyncStatus lastSynced={lastSynced} />
          <WarningBanner warnings={warnings} />
          <DataPreview company={company} selected={selected} onToggle={onToggle} />

          {!isEmbedded() && (
            <p className="muted">Synkronisering er kun tilgængelig inde i Pipedrive.</p>
          )}

          <div className="actions">
            <button
              className="btn"
              disabled={phase === 'syncing'}
              onClick={() => void runLookup(company.cvr)}
            >
              Opdater data
            </button>
            <button
              className="btn btn--primary"
              disabled={phase === 'syncing' || !isEmbedded() || orgId === null}
              onClick={() => void onSync()}
            >
              {phase === 'syncing' ? 'Synkroniserer…' : 'Synkronisér til Pipedrive'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
