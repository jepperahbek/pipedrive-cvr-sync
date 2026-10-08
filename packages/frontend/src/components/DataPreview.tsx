import type { CvrCompany } from '../types.ts';
import { PREVIEW_FIELDS } from '../fields.ts';
import { FieldToggle } from './FieldToggle.tsx';

interface DataPreviewProps {
  company: CvrCompany;
  selected: Record<string, boolean>;
  onToggle: (id: string, checked: boolean) => void;
}

export function DataPreview({ company, selected, onToggle }: DataPreviewProps) {
  return (
    <div className="preview">
      {PREVIEW_FIELDS.map((f) => (
        <FieldToggle
          key={f.id}
          id={f.id}
          label={f.label}
          value={f.value(company)}
          checked={selected[f.id] ?? false}
          onChange={onToggle}
        />
      ))}
    </div>
  );
}
