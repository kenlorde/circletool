'use client';
import { useLayoutEffect, useState, type CSSProperties } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronRight, X, Activity, Binary, Crosshair, TrendingUp, MoveHorizontal, Zap, ArrowUpDown } from 'lucide-react';
import { ADVANCED_TYPES, DIGIT_TYPES, type ManualTradeType } from '@/lib/manual-trades';
const groups = ['Accumulators', 'Digits', 'Ups & Downs', 'Touch & No Touch', 'Multipliers', 'Turbos', 'In & Out', 'Vanillas', 'Asian', 'Reset', 'Tick trades'];
const digits = [DIGIT_TYPES[0], DIGIT_TYPES[2], DIGIT_TYPES[1]];
function TradeTypeIcon({ value }: { value: ManualTradeType }) {
  const Icon = value === 'accumulators' ? Activity : value === 'even-odd' ? Binary : value === 'matches-differs' || value === 'touch-no-touch' ? Crosshair : value === 'multipliers' ? X : value === 'turbos' ? Zap : value.includes('between') ? MoveHorizontal : value === 'over-under' ? ArrowUpDown : TrendingUp;
  return <span className="manual-type-icons" aria-hidden><i><Icon /></i><i><Icon /></i></span>;
}
export function ManualTradeTypePicker({ value, onChange, disabled = false }: { value: ManualTradeType; onChange: (value: ManualTradeType) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [learn, setLearn] = useState(false);
  const [top, setTop] = useState(0);
  const selected = [...DIGIT_TYPES, ...ADVANCED_TYPES].find(type => type.value === value);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const navigation = document.querySelector('.mobile-terminal-nav');
      const bottom = navigation?.getBoundingClientRect().bottom ?? 0;
      setTop(Math.max(0, Math.min(bottom, window.innerHeight * .4)));
    };
    measure(); window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);
  const panelStyle = { '--trade-panel-top': `${top}px` } as CSSProperties;
  return <Dialog.Root open={open} onOpenChange={next => { setOpen(next); if (!next) setLearn(false); }}>
    <div className="manual-type-select-row">
      <Dialog.Trigger asChild><button type="button" disabled={disabled} className="manual-type-trigger manual-type-current" aria-label={`Choose trade type: ${selected?.label ?? 'Select trade type'}`}><TradeTypeIcon value={value} /><strong>{selected?.label ?? 'Select trade type'}</strong><ChevronRight size={18} aria-hidden /></button></Dialog.Trigger>
    </div>
    <Dialog.Portal>
      <Dialog.Overlay className="manual-type-overlay" style={panelStyle} />
      <Dialog.Content className="manual-type-panel" style={panelStyle}>
        <div className="manual-type-titlebar"><Dialog.Title className="manual-type-heading">Trade types</Dialog.Title><Dialog.Close type="button" aria-label="Close trade types"><X size={22} aria-hidden /></Dialog.Close></div>
        <Dialog.Description className="sr-only">Choose a contract type for Manual Trader. Availability depends on your market and Deriv account.</Dialog.Description>
        <div className="manual-type-scroll">
          <button type="button" className="manual-type-learn" aria-expanded={learn} onClick={() => setLearn(previous => !previous)}>Learn more about trade types <ChevronRight size={17} aria-hidden /></button>
          {learn && <p className="manual-type-help">Digits predict the final digit. Ups & Downs predict price direction. Touch trades use a price barrier; In & Out trades use two barriers. Accumulators use a growth rate, while Multipliers amplify price movements. Choose a type, review its live quote and terms, then tap Buy. Your stake can be lost.</p>}
          {groups.map(group => {
            const types = group === 'Digits' ? digits : ADVANCED_TYPES.filter(type => type.group === group);
            return <section key={group} className="manual-type-group"><h2>{group}</h2>{types.map(type => <button type="button" key={type.value} className={value === type.value ? 'manual-type-option selected' : 'manual-type-option'} aria-pressed={value === type.value} onClick={() => { onChange(type.value); setOpen(false); setLearn(false); }}><TradeTypeIcon value={type.value} /><span>{type.label}</span></button>)}</section>;
          })}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
