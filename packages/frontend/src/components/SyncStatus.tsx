/** Formats an ISO date (yyyy-mm-dd or full ISO) as Danish dd.mm.yyyy. */
function formatDanishDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${d}.${mo}.${y}`;
}

export function SyncStatus({ lastSynced }: { lastSynced: string | null }) {
  const formatted = formatDanishDate(lastSynced);
  return (
    <p className="sync-status">
      {formatted ? `Sidst synkroniseret: ${formatted}` : 'Endnu ikke synkroniseret'}
    </p>
  );
}
