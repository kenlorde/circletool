export type Account = { id: string; currency: string; type: 'real' | 'demo' };
type Packet = Record<string, any>;

export function copyParameters(contract: Packet, currency: string, maxStake: number, now = Date.now() / 1000): Packet {
  const type = contract.contract_type;
  if (!['DIGITUNDER', 'DIGITOVER', 'DIGITMATCH', 'DIGITDIFF', 'DIGITEVEN', 'DIGITODD', 'CALL', 'PUT'].includes(type)) throw Error('This contract type is not supported for copying.');
  if (contract.is_sold || contract.is_expired || contract.status !== 'open') throw Error('Trader contract already closed; skipped.');
  if (contract.currency !== currency) throw Error('Trader and follower currencies must match.');
  const stake = Number(contract.buy_price);
  if (!Number.isFinite(stake) || stake <= 0 || !Number.isFinite(maxStake) || maxStake <= 0) throw Error('Invalid stake.');
  if (!contract.underlying_symbol) throw Error('Contract symbol missing; skipped.');
  if (!Number.isFinite(Number(contract.purchase_time)) || now - Number(contract.purchase_time) > 10 || Number(contract.purchase_time) > now + 2) throw Error('Trader entry is stale; skipped.');
  const parameters: Packet = { amount: Math.min(stake, maxStake), basis: 'stake', currency, contract_type: type, underlying_symbol: contract.underlying_symbol };
  if (['DIGITUNDER', 'DIGITOVER', 'DIGITMATCH', 'DIGITDIFF'].includes(type)) {
    if (!/^[0-9]$/.test(String(contract.barrier))) throw Error('Digit prediction missing; skipped.');
    parameters.barrier = String(contract.barrier);
  } else if (['CALL', 'PUT'].includes(type) && Number(contract.barrier_count) !== 0) throw Error('Only barrier-free Rise/Fall contracts can be copied.');
  if (Number.isInteger(contract.tick_count) && contract.tick_count > 0) {
    parameters.duration = contract.tick_count; parameters.duration_unit = 't';
  } else {
    const expiry = Number(contract.date_expiry);
    if (!Number.isInteger(expiry) || expiry - now < 30) throw Error('Insufficient time before expiry; skipped.');
    parameters.date_expiry = expiry;
  }
  return parameters;
}

export class CopySocket {
  private id = 0;
  private pending = new Map<number, { resolve: (p: Packet) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private heartbeat?: ReturnType<typeof setInterval>;
  onPacket: (packet: Packet) => void = () => {};
  onDisconnect: () => void = () => {};
  private constructor(private socket: WebSocket) {
    socket.onmessage = event => {
      try {
        const packet = JSON.parse(event.data);
        const pending = this.pending.get(packet.req_id);
        if (pending) {
          clearTimeout(pending.timer); this.pending.delete(packet.req_id);
          if (packet.error) pending.reject(Error('Deriv rejected the request: ' + (packet.error.code ?? 'unknown error'))); else pending.resolve(packet);
        }
        this.onPacket(packet);
      } catch { this.close(); this.onDisconnect(); }
    };
    socket.onclose = () => { this.rejectPending(); this.onDisconnect(); };
    socket.onerror = () => { this.close(); this.onDisconnect(); };
    this.heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ping: 1 })); }, 25000);
  }
  static open(url: string): Promise<CopySocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => { socket.close(); reject(Error('Connection timed out.')); }, 15000);
      socket.onopen = () => { clearTimeout(timer); resolve(new CopySocket(socket)); };
      socket.onerror = socket.onclose = () => { clearTimeout(timer); reject(Error('Deriv connection failed.')); };
    });
  }
  request(payload: Packet): Promise<Packet> {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) return reject(Error('Connection closed.'));
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Deriv confirmation timed out. Check account history before restarting.')); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ ...payload, req_id: id }));
    });
  }
  private rejectPending() {
    clearInterval(this.heartbeat);
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(Error('Connection lost. Check account history before restarting.')); }
    this.pending.clear();
  }
  close() { this.rejectPending(); this.socket.onclose = null; this.socket.onerror = null; this.socket.onmessage = null; this.socket.close(); }
}

export async function copyConnection(appId: string, token: string, accountId?: string) {
  const response = await fetch('/api/copy-connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId, token, accountId }), cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? 'Deriv connection failed.');
  return data;
}
