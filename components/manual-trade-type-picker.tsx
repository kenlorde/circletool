'use client';
import { ADVANCED_TYPES, DIGIT_TYPES, type ManualTradeType } from '@/lib/manual-trades';

export function ManualTradeTypePicker({ value, onChange, disabled = false }: { value: ManualTradeType; onChange: (value: ManualTradeType) => void; disabled?: boolean }) {
  return <label className="flex flex-col gap-2 text-sm font-medium">
    Trade type
    <select className="w-full rounded-lg border border-border bg-background p-3 text-foreground" value={value} disabled={disabled} onChange={event => onChange(event.target.value as ManualTradeType)}>
      <optgroup label="Digits">{DIGIT_TYPES.map(type => <option value={type.value} key={type.value}>{type.label}</option>)}</optgroup>
      {ADVANCED_TYPES.map(type => <optgroup key={type.value} label={type.group}><option value={type.value}>{type.label}</option></optgroup>)}
    </select>
  </label>;
}
