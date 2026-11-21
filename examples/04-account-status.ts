/**
 * Where a sign-up address stands: has the account been created, is money
 * waiting at the address, did something come back.
 *
 *   node examples/04-account-status.ts 0x4df784532805fe81e87468a9c7c2483eaa681959
 *
 * If the name was taken before the deposit arrived (`accountState: "taken"`,
 * a hold with `code: "NAME_TAKEN"`), the user picks another name:
 *
 *   POST /v1/deposit-addresses/<address>/rename  { "account": "petya.ac" }
 *
 * and the money goes on to it about two days later.
 */
import { ApiError, get, args } from '../src/alcor.ts';

const [address] = args('04-account-status.ts <deposit address>', 1);

interface Status {
  destination: { chain: string; to: string };
  account?: string;
  accountState?: 'free' | 'created' | 'taken';
  pending: { chainId: number; symbol: string; raw: string; reason?: string }[];
  forwards: { chainId: number; tx: string; at: number }[];
  held: Record<string, { code?: string }>;
  rename?: { account: string; at: number };
}

let s: Status;
try {
  s = await get<Status>(`/v1/deposit-addresses/${address}`);
} catch (err) {
  if (err instanceof ApiError && err.status === 404) {
    console.error(`${address} was never registered: ask for it first (03-create-account.ts).`);
    process.exit(1);
  }
  throw err;
}

const states = {
  free: 'not created yet: waiting for the first deposit',
  created: 'created',
  taken: 'the name is someone else\'s: offer the user another one (rename)',
};
if (s.accountState) console.log(`${s.account}: ${states[s.accountState]}`);
if (s.rename) console.log(`renamed to ${s.rename.account}`);
for (const p of s.pending) console.log(`waiting at the address: ${p.raw} raw ${p.symbol} on chain ${p.chainId}${p.reason ? ` (${p.reason})` : ''}`);
for (const f of s.forwards) console.log(`forwarded into the bridge from chain ${f.chainId}: ${f.tx}`);
for (const [key, h] of Object.entries(s.held)) console.log(`came back, held for support: ${key} ${h.code ?? ''}`);
