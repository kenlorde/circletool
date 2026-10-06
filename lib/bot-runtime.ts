import { parseBotXml } from './bot-xml';

type Value = number | boolean;
interface Block {
  type: string;
  fields: Record<string, string>;
  values: Record<string, Block>;
  statements: Record<string, Block>;
  next?: Block;
}
export interface BotLimits { maxTrades: number; maxStake: number; lossLimit: number }
export interface BotProgress { message: string; trades: number; profit: number; contractId?: number }
export interface BotTransport { send<T>(payload: Record<string, unknown>): Promise<T> }
interface State { variables: Map<string, Value>; profit: number; lastProfit?: number; purchase?: string; repeat: boolean; budget: number }
const contracts = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF', 'DIGITEVEN', 'DIGITODD'];
const expressions = new Set(['math_number', 'logic_boolean', 'variables_get', 'math_arithmetic', 'logic_compare', 'logic_operation', 'logic_negate', 'contract_check_result', 'total_profit']);
const statements = new Set(['variables_set', 'math_change', 'controls_if', 'purchase', 'trade_again']);
const definitions = new Set(['trade_definition_market', 'trade_definition_tradetype', 'trade_definition_contracttype', 'trade_definition_candleinterval', 'trade_definition_restartbuysell', 'trade_definition_restartonerror']);
function children(el: Element, tag: string) { return Array.from(el.children).filter(child => child.localName === tag); }
function readBlock(el: Element | undefined): Block | undefined {
  if (!el) return undefined;
  if (el.getAttribute('disabled') === 'true') {
    const next = children(el, 'next')[0];
    return next ? readBlock(children(next, 'block')[0]) : undefined;
  }
  const result: Block = { type: el.getAttribute('type') ?? '', fields: {}, values: {}, statements: {} };
  for (const field of children(el, 'field')) {
    const name = field.getAttribute('name') ?? '';
    // Blockly variables are identified by ID, allowing labels to change without changing references.
    result.fields[name] = name === 'VAR' ? field.getAttribute('id') || field.textContent || '' : field.textContent || '';
  }
  for (const tag of ['value', 'statement', 'next']) for (const container of children(el, tag)) {
    const block = readBlock(children(container, 'block')[0] ?? children(container, 'shadow')[0]);
    if (!block) continue;
    const name = container.getAttribute('name') ?? '';
    if (tag === 'next') result.next = block;
    else if (tag === 'value') result.values[name] = block;
    else result.statements[name] = block;
  }
  return result;
}
function requireBlock(block: Block | undefined, label: string): Block {
  if (!block) throw new Error(`Missing ${label}.`);
  return block;
}
function numeric(value: Value | string, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || typeof value === 'boolean' || value === '') throw new Error(`Invalid ${label}.`);
  return number;
}
function spend(state: State) { if (--state.budget < 0) throw new Error('Bot instruction limit exceeded.'); }
function expression(block: Block | undefined, state: State): Value {
  const b = requireBlock(block, 'value block'); spend(state);
  const input = (name: string) => expression(b.values[name], state);
  switch (b.type) {
    case 'math_number': return numeric(b.fields.NUM, 'number');
    case 'logic_boolean': return b.fields.BOOL === 'TRUE';
    case 'variables_get': {
      if (!state.variables.has(b.fields.VAR)) throw new Error(`Variable ${b.fields.VAR} has not been set.`);
      return state.variables.get(b.fields.VAR)!;
    }
    case 'math_arithmetic': {
      const a = numeric(input('A'), 'arithmetic input'), c = numeric(input('B'), 'arithmetic input');
      const operations: Record<string, () => number> = { ADD: () => a + c, MINUS: () => a - c, MULTIPLY: () => a * c, DIVIDE: () => a / c, POWER: () => a ** c };
      const result = operations[b.fields.OP]?.();
      if (result === undefined || !Number.isFinite(result)) throw new Error('Invalid arithmetic operation.');
      return result;
    }
    case 'logic_compare': {
      const a = input('A'), c = input('B');
      const operations: Record<string, () => boolean> = { EQ: () => a === c, NEQ: () => a !== c, LT: () => Number(a) < Number(c), LTE: () => Number(a) <= Number(c), GT: () => Number(a) > Number(c), GTE: () => Number(a) >= Number(c) };
      const result = operations[b.fields.OP]?.();
      if (result === undefined) throw new Error('Invalid comparison.');
      return result;
    }
    case 'logic_operation': return b.fields.OP === 'AND' ? Boolean(input('A')) && Boolean(input('B')) : Boolean(input('A')) || Boolean(input('B'));
    case 'logic_negate': return !input('BOOL');
    case 'total_profit': return state.profit;
    case 'contract_check_result': {
      if (state.lastProfit === undefined) throw new Error('Contract result is only available after settlement.');
      if (b.fields.CHECK_RESULT === 'win') return state.lastProfit > 0;
      if (b.fields.CHECK_RESULT === 'loss') return state.lastProfit < 0;
      throw new Error('Unsupported contract result check.');
    }
    default: throw new Error(`Unsupported value: ${b.type}.`);
  }
}
function execute(block: Block | undefined, state: State, phase: 'init' | 'before' | 'after'): void {
  for (let b = block; b; b = b.next) {
    spend(state);
    switch (b.type) {
      case 'variables_set': state.variables.set(b.fields.VAR, expression(b.values.VALUE, state)); break;
      case 'math_change': state.variables.set(b.fields.VAR, numeric(state.variables.get(b.fields.VAR) ?? 0, 'variable') + numeric(expression(b.values.DELTA, state), 'change')); break;
      case 'controls_if': {
        let matched = false;
        for (let i = 0; b.values[`IF${i}`]; i++) {
          if (expression(b.values[`IF${i}`], state)) { execute(b.statements[`DO${i}`], state, phase); matched = true; break; }
        }
        if (!matched) execute(b.statements.ELSE, state, phase);
        if (state.repeat) return;
        break;
      }
      case 'purchase':
        if (phase !== 'before' || state.purchase) throw new Error('Only one purchase is allowed per cycle, inside Purchase conditions.');
        state.purchase = b.fields.PURCHASE_LIST;
        break;
      case 'trade_again':
        if (phase !== 'after') throw new Error('Trade again must be inside Restart conditions.');
        state.repeat = true; return;
      default: throw new Error(`Unsupported instruction: ${b.type}.`);
    }
  }
}
function validate(block: Block, kind: 'expression' | 'statement' | 'definition', phase = ''): void {
  const allowed = kind === 'expression' ? expressions : kind === 'definition' ? definitions : statements;
  if (!allowed.has(block.type)) throw new Error(`Unsupported block: ${block.type}. This bot cannot run until that instruction is supported.`);
  if (kind === 'expression' && (block.next || Object.keys(block.statements).length)) throw new Error(`Invalid value structure: ${block.type}.`);
  if (block.type === 'purchase' && (phase !== 'before' || !contracts.includes(block.fields.PURCHASE_LIST))) throw new Error('Only digit purchases inside Purchase conditions are supported.');
  if (block.type === 'trade_again' && phase !== 'after') throw new Error('Trade again must be inside Restart conditions.');
  if (/restart/.test(block.type) && Object.values(block.fields).some(value => value === 'TRUE')) throw new Error('Disable restart on error. Purchase errors stop this runner to avoid duplicate trades.');
  const choices: Record<string, [string, string[]]> = {
    math_arithmetic: ['OP', ['ADD', 'MINUS', 'MULTIPLY', 'DIVIDE', 'POWER']],
    logic_compare: ['OP', ['EQ', 'NEQ', 'LT', 'LTE', 'GT', 'GTE']],
    logic_operation: ['OP', ['AND', 'OR']], logic_boolean: ['BOOL', ['TRUE', 'FALSE']],
    contract_check_result: ['CHECK_RESULT', ['win', 'loss']],
  };
  const choice = choices[block.type];
  if (choice && !choice[1].includes(block.fields[choice[0]])) throw new Error(`Invalid setting in ${block.type}.`);
  if (block.type === 'math_number') numeric(block.fields.NUM, 'number');
  if (['variables_get', 'variables_set', 'math_change'].includes(block.type) && !block.fields.VAR) throw new Error('Missing variable identifier.');
  if (block.type === 'contract_check_result' && phase !== 'after') throw new Error('Contract result is only supported in Restart conditions.');
  // Reject unknown inputs even when their branch would not execute.
  const inputs: Record<string, string[]> = {
    math_number: [], logic_boolean: [], variables_get: [], contract_check_result: [], total_profit: [],
    math_arithmetic: ['A', 'B'], logic_compare: ['A', 'B'], logic_operation: ['A', 'B'], logic_negate: ['BOOL'],
    variables_set: ['VALUE'], math_change: ['DELTA'], purchase: [], trade_again: [],
  };
  for (const required of inputs[block.type] ?? []) if (!block.values[required]) throw new Error(`Missing ${required} in ${block.type}.`);
  if (block.type === 'controls_if') {
    const conditions = Object.keys(block.values).filter(name => /^IF\d+$/.test(name));
    if (!conditions.length || conditions.some((_, index) => !block.values[`IF${index}`])) throw new Error('Conditional branches must start at IF0 and be consecutive.');
    if (Object.keys(block.statements).some(name => /^DO\d+$/.test(name) && !block.values[name.replace('DO', 'IF')])) throw new Error('Conditional branch is missing its condition.');
  }
  for (const [name, value] of Object.entries(block.values)) {
    if (block.type === 'controls_if' ? !/^IF\d+$/.test(name) : !(inputs[block.type] ?? []).includes(name)) throw new Error(`Unsupported input ${name} in ${block.type}.`);
    validate(value, 'expression', phase);
  }
  for (const [name, body] of Object.entries(block.statements)) {
    if (block.type !== 'controls_if' || !/^(DO\d+|ELSE)$/.test(name)) throw new Error(`Unsupported statement ${name} in ${block.type}.`);
    validate(body, 'statement', phase);
  }
  if (block.next) validate(block.next, kind, phase);
}
export function compileBotXml(source: string) {
  const document = parseBotXml(source);
  const roots = children(document.documentElement, 'block').map(readBlock).filter((b): b is Block => !!b);
  for (const root of roots) if (!['trade_definition', 'before_purchase', 'after_purchase', 'during_purchase'].includes(root.type)) throw new Error(`Unsupported top-level block: ${root.type}.`);
  const root = (type: string, required = true) => {
    const matching = roots.filter(b => b.type === type);
    if (matching.length > 1 || (required && matching.length !== 1)) throw new Error(`Expected one ${type} block.`);
    return matching[0];
  };
  const trade = root('trade_definition')!, before = root('before_purchase')!, after = root('after_purchase', false);
  for (const b of roots) {
    if (b.next || Object.keys(b.values).length) throw new Error(`Unsupported structure in ${b.type}.`);
    const validNames = b.type === 'trade_definition' ? ['TRADE_OPTIONS', 'INITIALIZATION', 'SUBMARKET'] : b.type === 'before_purchase' ? ['BEFOREPURCHASE_STACK'] : b.type === 'after_purchase' ? ['AFTERPURCHASE_STACK'] : [];
    if (Object.keys(b.statements).some(name => !validNames.includes(name))) throw new Error(`Unsupported statement in ${b.type}. Sell conditions and tick strategies are not supported yet.`);
  }
  validate(requireBlock(trade.statements.TRADE_OPTIONS, 'market definitions'), 'definition');
  const settings: Record<string, Block> = {};
  for (let b: Block | undefined = trade.statements.TRADE_OPTIONS; b; b = b.next) {
    if (settings[b.type]) throw new Error(`Duplicate setting: ${b.type}.`);
    settings[b.type] = b;
  }
  const symbol = settings.trade_definition_market?.fields.SYMBOL_LIST;
  if (!symbol || !/^[a-zA-Z0-9_]+$/.test(symbol)) throw new Error('Select a valid market symbol.');
  const tradeType = settings.trade_definition_tradetype?.fields.TRADETYPE_LIST;
  if (!tradeType || !['overunder', 'matchesdiffers', 'evenodd'].includes(tradeType)) throw new Error('This runner supports digit Over/Under, Matches/Differs, and Even/Odd bots.');
  const options = requireBlock(trade.statements.SUBMARKET, 'trade options');
  if (options.type !== 'trade_definition_tradeoptions' || options.next || Object.keys(options.statements).length || options.fields.DURATIONTYPE_LIST !== 't') throw new Error('Only stake-based digit trade options with duration in ticks are supported.');
  for (const [name, value] of Object.entries(options.values)) {
    if (!['AMOUNT', 'DURATION', 'PREDICTION'].includes(name)) throw new Error(`Unsupported trade option: ${name}.`);
    validate(value, 'expression');
  }
  const initialization = trade.statements.INITIALIZATION, purchase = before.statements.BEFOREPURCHASE_STACK, restart = after?.statements.AFTERPURCHASE_STACK;
  if (initialization) validate(initialization, 'statement', 'init');
  validate(requireBlock(purchase, 'purchase conditions'), 'statement', 'before');
  if (restart) validate(restart, 'statement', 'after');
  const typeSetting = settings.trade_definition_contracttype?.fields.TYPE_LIST;
  const pair = tradeType === 'overunder' ? ['DIGITOVER', 'DIGITUNDER'] : tradeType === 'matchesdiffers' ? ['DIGITMATCH', 'DIGITDIFF'] : ['DIGITEVEN', 'DIGITODD'];
  if (typeSetting && typeSetting !== 'both' && !pair.includes(typeSetting)) throw new Error('Contract type does not match trade type.');
  const createState = (): State => {
    const state: State = { variables: new Map(), profit: 0, repeat: false, budget: 10000 };
    execute(initialization, state, 'init'); return state;
  };
  const nextTrade = (state: State) => {
    state.budget = 10000; state.purchase = undefined; state.repeat = false;
    const amount = numeric(expression(options.values.AMOUNT, state), 'stake');
    const duration = numeric(expression(options.values.DURATION, state), 'duration');
    const barrier = options.values.PREDICTION ? numeric(expression(options.values.PREDICTION, state), 'prediction') : undefined;
    if (amount <= 0 || !Number.isInteger(duration) || duration < 1 || duration > 10) throw new Error('Stake must be positive and duration must be 1–10 ticks.');
    execute(purchase, state, 'before');
    if (!state.purchase) throw new Error('Purchase conditions did not select a contract. No trade was placed.');
    if (!pair.includes(state.purchase) || (typeSetting && typeSetting !== 'both' && typeSetting !== state.purchase)) throw new Error('Purchase direction does not match the configured contract type.');
    if (!['DIGITEVEN', 'DIGITODD'].includes(state.purchase) && (barrier === undefined || !Number.isInteger(barrier) || barrier < 0 || barrier > 9)) throw new Error('Digit prediction must be an integer from 0 to 9.');
    return { symbol, amount, duration, contract_type: state.purchase, barrier: ['DIGITEVEN', 'DIGITODD'].includes(state.purchase) ? undefined : String(barrier) };
  };
  // Validate the first cycle without placing an order.
  const preview = nextTrade(createState());
  return { preview, createState, nextTrade, settled(state: State, profit: number) {
    state.profit += profit; state.lastProfit = profit; state.repeat = false; state.budget = 10000;
    execute(restart, state, 'after'); return state.repeat;
  } };
}
type Program = ReturnType<typeof compileBotXml>;
function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
export async function runBotSession(input: {
  program: Program; ws: BotTransport; currency: string; limits: BotLimits; signal: AbortSignal;
  isAccountCurrent: () => boolean; onProgress: (progress: BotProgress) => void;
  requestTimeoutMs?: number; pollIntervalMs?: number;
}): Promise<BotProgress> {
  const { program, ws, currency, limits, signal, isAccountCurrent, onProgress } = input;
  if (!Number.isInteger(limits.maxTrades) || limits.maxTrades < 1 || limits.maxTrades > 100 || !Number.isFinite(limits.maxStake) || limits.maxStake <= 0 || !Number.isFinite(limits.lossLimit) || limits.lossLimit <= 0) throw new Error('Set 1–100 trades and positive maximum stake and loss limit.');
  const state = program.createState();
  let trades = 0, spent = 0;
  const report = (message: string, contractId?: number): BotProgress => {
    const progress = { message, trades, profit: state.profit, contractId }; onProgress(progress); return progress;
  };
  const active = () => !signal.aborted && isAccountCurrent();
  const request = <T,>(payload: Record<string, unknown>, message = 'Deriv request timed out. Trading stopped.') => timeout(ws.send<T>(payload), input.requestTimeoutMs ?? 15000, message);
  while (active()) {
    const trade = program.nextTrade(state);
    // Reserve the entire next stake so the session cannot deliberately exceed its loss limit.
    if (trade.amount > limits.maxStake) return report('Stopped: next stake exceeds your maximum stake.');
    if (state.profit - trade.amount < -limits.lossLimit) return report('Stopped: next stake could exceed your session loss limit.');
    if (trades >= limits.maxTrades || spent + trade.amount > limits.maxTrades * limits.maxStake) return report('Session trade limit reached.');
    report('Getting a fresh quote…');
    const { proposal } = await request<{ proposal?: { id?: string; ask_price?: number | string } }>({ proposal: 1, underlying_symbol: trade.symbol, contract_type: trade.contract_type, amount: trade.amount, basis: 'stake', currency, duration: trade.duration, duration_unit: 't', ...(trade.barrier === undefined ? {} : { barrier: trade.barrier }) });
    if (!active()) return report('Stopped before purchase.');
    const price = Number(proposal?.ask_price);
    if (!proposal?.id || !Number.isFinite(price) || price <= 0 || price > limits.maxStake || state.profit - price < -limits.lossLimit || Math.abs(price - trade.amount) > 0.000001) throw new Error('Quote does not match the configured stake or session limits. No purchase sent.');
    report('Purchasing…');
    let contractId: number;
    try {
      const response = await request<{ buy?: { contract_id?: number | string } }>({ buy: proposal.id, price }, 'Purchase confirmation timed out. The trade may have opened. Check Trade history before running again.');
      contractId = Number(response.buy?.contract_id);
      if (!Number.isSafeInteger(contractId) || contractId <= 0) throw new Error('Missing contract confirmation.');
    } catch (error) {
      throw new Error(`Purchase was not confirmed. Check Trade history before running again. ${error instanceof Error ? error.message : ''}`);
    }
    trades++; spent += price;
    report(`Contract ${contractId} open. Waiting for settlement…`, contractId);
    const deadline = Date.now() + 120000;
    let profit: number | undefined;
    while (Date.now() < deadline) {
      // Stop prevents new purchases; it does not cancel an already purchased contract.
      if (!isAccountCurrent()) return report(`Tracking stopped for contract ${contractId}. Check Trade history; no more purchases will be sent.`, contractId);
      const { proposal_open_contract: contract } = await request<{ proposal_open_contract?: { contract_id?: number | string; is_sold?: number | boolean; profit?: number | string } }>({ proposal_open_contract: 1, contract_id: contractId }, `Settlement tracking timed out for contract ${contractId}. Check Trade history before running again.`);
      if (Number(contract?.contract_id) !== contractId) throw new Error(`Invalid settlement response for ${contractId}. Check Trade history.`);
      if (contract?.is_sold === 1 || contract?.is_sold === true) {
        profit = numeric(contract.profit ?? '', 'settled profit'); break;
      }
      await new Promise(resolve => setTimeout(resolve, input.pollIntervalMs ?? 1000));
    }
    if (profit === undefined) throw new Error(`Contract ${contractId} has not settled yet. Check Trade history before running again.`);
    const repeat = program.settled(state, profit);
    report(`Contract closed: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} ${currency}.`, contractId);
    if (!active()) return report('Stopped. Current contract settled.');
    if (!repeat) return report('Bot completed. No Trade again instruction was reached.');
    if (state.profit <= -limits.lossLimit) return report('Session loss limit reached.');
    if (trades >= limits.maxTrades) return report('Session trade limit reached.');
  }
  return report('Stopped.');
}

export const QUICK_DIGIT_BOT = `<xml xmlns="https://developers.google.com/blockly/xml">
<block type="trade_definition"><statement name="TRADE_OPTIONS"><block type="trade_definition_market"><field name="SYMBOL_LIST">1HZ100V</field><next><block type="trade_definition_tradetype"><field name="TRADETYPE_LIST">overunder</field><next><block type="trade_definition_contracttype"><field name="TYPE_LIST">both</field></block></next></block></next></block></statement>
<statement name="SUBMARKET"><block type="trade_definition_tradeoptions"><field name="DURATIONTYPE_LIST">t</field><value name="AMOUNT"><block type="math_number"><field name="NUM">1</field></block></value><value name="DURATION"><block type="math_number"><field name="NUM">1</field></block></value><value name="PREDICTION"><block type="math_number"><field name="NUM">7</field></block></value></block></statement></block>
<block type="before_purchase"><statement name="BEFOREPURCHASE_STACK"><block type="purchase"><field name="PURCHASE_LIST">DIGITUNDER</field></block></statement></block>
<block type="after_purchase"><statement name="AFTERPURCHASE_STACK"><block type="trade_again"/></statement></block>
</xml>`;
