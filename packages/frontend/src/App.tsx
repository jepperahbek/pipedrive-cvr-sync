import { useEffect, useState } from 'react';
import { CVRPanel } from './components/CVRPanel.tsx';
import { getOrgIdFromUrl, initSdk } from './sdk.ts';

export function App() {
  const [ready, setReady] = useState(false);
  const [orgId, setOrgId] = useState<number | null>(null);

  useEffect(() => {
    // Read the org id from the URL synchronously, then initialize the SDK.
    setOrgId(getOrgIdFromUrl());
    void initSdk().finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="panel"><p className="muted">Indlæser…</p></div>;
  return <CVRPanel orgId={orgId} />;
}
