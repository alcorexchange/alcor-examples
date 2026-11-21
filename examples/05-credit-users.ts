/**
 * A backend following every deposit paid out to your account, for every user
 * at once.
 *
 * Each delivered transfer's `from.address` is the deposit address it came
 * through, so you know whose it is (keep address → user when you hand the
 * addresses out). Use this for display and alerts.
 *
 * Credit the user on the payout itself: an ordinary token transfer to your
 * account, from `bridge.alcor`, with the memo you set. On WAX, XPR and Vaulta
 * it carries your memo exactly; on Telos the memo is `<your memo>|<network>:<address>`,
 * read it up to the first `|`. If your account is a contract, check the token
 * contract and the sender, and never fail the transfer.
 *
 *   node examples/05-credit-users.ts yourproject
 */
import { get, args } from '../src/alcor.ts';

const [account] = args('05-credit-users.ts <your account>', 1);

interface Events {
  events: { id: number; change: string; transfer: { key: string; from: { address: string }; amount: string; asset: { symbol: string } } }[];
  last: number | null;
}

// Polling instead of streaming: pass back `last` each time. Keep it across restarts in a real backend.
let after: number | null = null;
for (;;) {
  const q = new URLSearchParams({ party: account, role: 'recipient', change: 'delivered', limit: '100' });
  if (after !== null) q.set('after', String(after));
  const page = await get<Events>(`/v1/events?${q}`);
  for (const e of page.events) {
    const t = e.transfer;
    console.log(`${t.key}: ${t.amount} ${t.asset.symbol} delivered, came through ${t.from.address}`);
  }
  after = page.last ?? after;
  await new Promise((r) => setTimeout(r, 10_000));
}
