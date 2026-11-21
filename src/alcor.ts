/**
 * The few calls every example shares: the bridge API, its server-sent event
 * streams, and a Telos node. No keys, no signing: nothing here moves money.
 */

export const BRIDGE_API = process.env.ALCOR_BRIDGE_API ?? 'https://telos.alcor.exchange/api/bridge';
export const TELOS_RPC = process.env.TELOS_RPC ?? 'https://telos.greymass.com';

/** An answer the API refused, with its `code` (`INVALID_REQUEST`, `NAME_TAKEN`, `RATE_LIMITED`…) and message. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(`${status} ${code}: ${message}`);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BRIDGE_API}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.code ?? 'ERROR', data.error ?? res.statusText);
  return data as T;
}

export const get = <T>(path: string) => call<T>('GET', path);
export const post = <T>(path: string, body: unknown) => call<T>('POST', path, body);

/** A token a deposit address takes on one network. Amounts are raw units: divide by 10^decimals. */
export interface DepositToken {
  symbol: string;
  token: string;
  decimals: number;
  min: string;
  max: string | null;
  /** What to show as the minimum: enough to be forwarded now, gas included. */
  least?: string;
}

export interface DepositAddress {
  /** The address on Ethereum, BNB Smart Chain and Polygon: one address on all three. */
  address: string;
  destination: { chain: string; to: string };
  memo?: string;
  account?: string;
  buys?: string;
  chains: { id: string; name: string; chainId: number; tokens: DepositToken[] }[];
  ton?: { address: string; rawAddress: string; tokens: DepositToken[] };
  near?: { address: string; ready: boolean; tokens: DepositToken[] };
  sui?: { address: string; tokens: DepositToken[] };
  solana?: { address: string; tokens: DepositToken[] };
}

/** Every network a deposit address works on, with its own address there. */
export function networksOf(a: DepositAddress): { network: string; address: string; tokens: DepositToken[] }[] {
  return [
    ...a.chains.map((c) => ({ network: c.name, address: a.address, tokens: c.tokens })),
    ...(a.ton ? [{ network: 'TON', address: a.ton.address, tokens: a.ton.tokens }] : []),
    ...(a.near?.ready ? [{ network: 'NEAR', address: a.near.address, tokens: a.near.tokens }] : []),
    ...(a.sui ? [{ network: 'Sui', address: a.sui.address, tokens: a.sui.tokens }] : []),
    ...(a.solana ? [{ network: 'Solana', address: a.solana.address, tokens: a.solana.tokens }] : []),
  ];
}

/** A raw amount as a decimal string: `5050505` with 6 decimals is `5.050505`. */
export function units(raw: string, decimals: number): string {
  const padded = raw.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Print a deposit address the way a user should see it: networks, tokens, minimums, and the warning. */
export function printAddress(a: DepositAddress): void {
  for (const n of networksOf(a)) {
    console.log(`\n${n.network}: ${n.address}`);
    for (const t of n.tokens) {
      const least = units(t.least ?? t.min, t.decimals);
      const max = t.max === null ? 'no limit' : `max ${units(t.max, t.decimals)}`;
      console.log(`  ${t.symbol.padEnd(5)} from ${least} (${max})`);
    }
  }
  console.log('\nOnly the networks above. Sending on any other network (Arbitrum, Base, Tron…) may lose the money.');
}

export type StreamHandlers = Record<string, (data: any) => void>;

/**
 * Follow a server-sent event stream, the way a browser's `EventSource` does:
 * named events, reconnecting after a drop with `Last-Event-ID`, so the server
 * sends again what was missed. Runs until `signal` aborts.
 */
export async function follow(path: string, handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
  let lastId: string | undefined;
  while (!signal?.aborted) {
    try {
      const res = await fetch(`${BRIDGE_API}${path}`, {
        headers: { accept: 'text/event-stream', ...(lastId ? { 'last-event-id': lastId } : {}) },
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`stream answered ${res.status}`);
      lastId = await readEvents(res.body, handlers, lastId);
    } catch (err) {
      if (signal?.aborted) return;
      console.error(`stream dropped (${(err as Error).message}), reconnecting`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function readEvents(body: ReadableStream<Uint8Array>, handlers: StreamHandlers, lastId?: string) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        else if (line.startsWith('id:')) lastId = line.slice(3).trim();
      }
      if (data.length && handlers[event]) handlers[event](JSON.parse(data.join('\n')));
    }
  }
  return lastId;
}

/**
 * A Telos contract's table, read straight from a node: the last rows by its
 * primary key, or by a secondary `index` (2 for the first one, a uint64 key).
 */
export async function telosTable<T>(code: string, table: string, opts: { limit?: number; reverse?: boolean; index?: number } = {}) {
  const res = await fetch(`${TELOS_RPC}/v1/chain/get_table_rows`, {
    method: 'POST',
    body: JSON.stringify({
      code, scope: code, table, json: true, limit: opts.limit ?? 1, reverse: opts.reverse ?? true,
      ...(opts.index ? { index_position: opts.index, key_type: 'i64' } : {}),
    }),
  });
  if (!res.ok) throw new Error(`${TELOS_RPC} answered ${res.status} for ${code}::${table}`);
  return ((await res.json()) as { rows: T[] }).rows;
}

/** The command line's arguments after the script, or a usage line and exit. */
export function args(usage: string, required: number): string[] {
  const list = process.argv.slice(2);
  if (list.length < required) {
    console.error(`usage: ${usage}`);
    process.exit(2);
  }
  return list;
}
