'use client';
import { AlertCircle } from 'lucide-react';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
export function RiskDisclaimer() {
  return <Dialog>
    <DialogTrigger asChild><button type="button" className="circle-risk-trigger"><AlertCircle size={18} aria-hidden /><span>Risk Disclaimer</span></button></DialogTrigger>
    <DialogContent className="circle-risk-dialog">
      <DialogTitle className="circle-risk-title"><span><AlertCircle size={23} aria-hidden /></span>Risk Disclaimer</DialogTitle>
      <div className="circle-risk-body">
        <DialogDescription className="circle-risk-description">Deriv offers complex derivatives, such as options and contracts for difference ("CFDs"). These products may not be suitable for all clients, and trading them puts you at risk.</DialogDescription>
        <h2>Please ensure you understand these risks:</h2>
        <ul><li>You may lose some or all of your invested capital</li><li>Currency conversion affects your profit/loss</li><li>Markets can be volatile and unpredictable</li></ul>
        <p className="circle-risk-important"><strong>Important: Never trade with borrowed money or funds you cannot afford to lose.</strong></p>
        <p className="circle-risk-confirm">By continuing, you confirm that you understand these risks and that you are aware that Deriv does not provide investment advice.</p>
      </div>
      <div className="circle-risk-footer"><DialogClose asChild><button type="button">Close</button></DialogClose></div>
    </DialogContent>
  </Dialog>;
}
