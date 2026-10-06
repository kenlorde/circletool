'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight, ArrowUpRight, ArrowDownRight, Activity } from 'lucide-react';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ADVANCED_TYPES, DIGIT_TYPES, type ManualTradeType } from '@/lib/manual-trades';
const groups = ['Accumulators', 'Digits', 'Ups & Downs', 'Touch & No Touch', 'In & Out', 'Multipliers', 'Turbos', 'Vanillas', 'Asian', 'Reset', 'Tick trades'];
export function ManualTradeTypePicker({ value, onChange, disabled = false }: { value: ManualTradeType; onChange: (value: ManualTradeType) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [learn, setLearn] = useState(false);
  const selected = [...DIGIT_TYPES, ...ADVANCED_TYPES].find(type => type.value === value);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" disabled={disabled} className="manual-type-trigger"><span><small>Trade type</small><strong>{selected?.label ?? 'Select trade type'}</strong></span><ChevronDown size={20} aria-hidden /></button></DialogTrigger>
    <DialogContent className="manual-type-panel">
      <DialogTitle className="manual-type-heading">Trade types</DialogTitle>
      <DialogDescription className="sr-only">Choose a contract type for Manual Trader. Availability depends on your market and Deriv account.</DialogDescription>
      <div className="manual-type-scroll">
        <button type="button" className="manual-type-learn" aria-expanded={learn} onClick={() => setLearn(previous => !previous)}>Learn more about trade types <ChevronRight size={20} aria-hidden /></button>
        {learn && <p className="manual-type-help">Digits predict the final digit. Ups & Downs predict price direction. Touch trades use a price barrier; In & Out trades use two barriers. Accumulators use a growth rate, while Multipliers amplify price movements. Choose a type, review its live quote and terms, then tap Buy. Your stake can be lost.</p>}
        {groups.map(group => {
          const types = group === 'Digits' ? DIGIT_TYPES : ADVANCED_TYPES.filter(type => type.group === group);
          return <section key={group} className="manual-type-group"><h2>{group}</h2>{types.map(type => <button type="button" key={type.value} className={value === type.value ? 'manual-type-option selected' : 'manual-type-option'} aria-pressed={value === type.value} onClick={() => { onChange(type.value); setOpen(false); }}>
            <span className="manual-type-icons" aria-hidden>{group === 'Accumulators' ? <i><Activity /></i> : <><i><ArrowUpRight /></i><i><ArrowDownRight /></i></>}</span><span>{type.label}</span>
          </button>)}</section>;
        })}
      </div>
    </DialogContent>
  </Dialog>;
}
