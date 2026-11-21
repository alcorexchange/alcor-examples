/**
 * Follow a deposit address, from the money arriving to the payout.
 *
 * Two stages, one stream each:
 *   1. at the address, not forwarded yet: `/v1/deposit-addresses/<address>/stream`
 *   2. in the bridge, from the forward to the payout: `/v1/stream?party=<address>`
 *
 * This is for showing progress. Credit your user on the payout itself, on your
 * chain (see 05-credit-users.ts).
 *
 *   node examples/02-follow-address.ts 0xb4b257e395f84f586479548d624302384d65ec58
 */
import { follow, args } from '../src/alcor.ts';

const [address] = args('02-follow-address.ts <deposit address>', 1);

// Stage 1. `pending`: what sits at the address, with a `reason` while something keeps it there.
// `held`: what came back and waits for support; show "contact support", not an error.
void follow(`/v1/deposit-addresses/${address}/stream`, {
  status: ({ pending, held }) => {
    for (const p of pending) console.log(`at the address: ${p.raw} raw ${p.symbol} on chain ${p.chainId}${p.reason ? ` (${p.reason})` : ', forwarding'}`);
    if (Object.keys(held).length) console.log('held for support:', held);
  },
});

// Stage 2. `snapshot` is the list as it stands; each `transfer` is one change to put in it by `key`.
void follow(`/v1/stream?party=${encodeURIComponent(address)}`, {
  snapshot: ({ transfers }) => console.log(`${transfers.length} transfer(s) so far`),
  transfer: ({ change, transfer: t }) => {
    console.log(`${t.key} ${change}: ${t.stage} (${t.percent}%) ${t.amount ?? ''} ${t.asset?.symbol ?? ''}`);
  },
});

console.log('Following; Ctrl+C to stop.');
