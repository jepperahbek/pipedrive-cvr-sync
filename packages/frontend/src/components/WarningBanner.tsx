import type { CvrWarning } from '../types.ts';

const MESSAGES: Record<string, { level: 'warn' | 'error'; text: string }> = {
  reklamebeskyttelse: {
    level: 'warn',
    text: 'Virksomheden er reklamebeskyttet. Kontaktoplysninger synkroniseres ikke.',
  },
  ophoert: {
    level: 'error',
    text: 'Virksomheden er ophørt.',
  },
};

export function WarningBanner({ warnings }: { warnings: CvrWarning[] }) {
  const visible = warnings.filter((w) => w in MESSAGES);
  if (visible.length === 0) return null;

  return (
    <div className="banners">
      {visible.map((w) => {
        const { level, text } = MESSAGES[w];
        return (
          <div key={w} className={`banner banner--${level}`} role="alert">
            {text}
          </div>
        );
      })}
    </div>
  );
}
