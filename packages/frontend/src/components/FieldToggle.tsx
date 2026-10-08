interface FieldToggleProps {
  id: string;
  label: string;
  value: string | null;
  checked: boolean;
  disabled?: boolean;
  onChange: (id: string, checked: boolean) => void;
}

export function FieldToggle({ id, label, value, checked, disabled, onChange }: FieldToggleProps) {
  const hasValue = value !== null && value !== '';
  return (
    <label className={`field${disabled || !hasValue ? ' field--disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked && hasValue}
        disabled={disabled || !hasValue}
        onChange={(e) => onChange(id, e.target.checked)}
      />
      <span className="field__label">{label}</span>
      <span className="field__value">{hasValue ? value : '—'}</span>
    </label>
  );
}
