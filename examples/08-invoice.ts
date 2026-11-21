/**
 * Crypto payments for an order: one deposit address per invoice, paid out to
 * your account (or your contract, see contract/payments.cpp) with the order id
 * as the memo, then wait until it is paid.
 *
 * The customer pays from any wallet or exchange, on any network the address
 * lists. No fee but the forward's gas, which comes out of the payment: what
 * arrives is a little less than what was sent. Decide how close to the price
 * counts as paid.
 *
 *   node examples/08-invoice.ts wax yourshop order-1001 25
 *
 * Here "paid" is read from the bridge's events, for the page the customer
 * watches. Your books should credit on the payout transfer itself, on your chain.
 */
import { get, post, printAddress, args, ApiError, type DepositAddress } from '../src/alcor.ts';

const [chain, to, orderId, price] = args('08-invoice.ts <telos|wax|xpr|vaulta> <your account> <order id> <price in USDC/USDT>', 4);

interface Events {
  events: { change: string; transfer: { key: string; amount: string; sent?: string; asset: { symbol: string } } }[];
  last: number | null;
}

let invoice: DepositAddress;
try {
  invoice = await post<DepositAddress>('/v1/deposit-addresses', { chain, to, memo: orderId });
} catch (err) {
  if (err instanceof ApiError) console.error(err.message);
  else throw err;
  process.exit(1);
}

console.log(`Order ${orderId}: pay ${price} USDC or USDT to`);
printAddress(invoice);

// Every address of the invoice, on every network: a payment may come through any of them.
const parties = [invoice.address, invoice.ton?.rawAddress, invoice.near?.address, invoice.sui?.address, invoice.solana?.address]
  .filter((p): p is string => Boolean(p));
let paid = 0;
let after: number | null = null;
console.log('\nWaiting for the payment; Ctrl+C to stop.');
while (paid < Number(price)) {
  const q = new URLSearchParams([...parties.map((p) => ['party', p]), ['change', 'delivered'], ['limit', '100']]);
  if (after !== null) q.set('after', String(after));
  const page = await get<Events>(`/v1/events?${q}`);
  for (const { transfer: t } of page.events) {
    if (t.asset.symbol !== 'USDC' && t.asset.symbol !== 'USDT') continue;
    paid += Number(t.amount);
    console.log(`${t.key}: ${t.amount} ${t.asset.symbol} arrived (sent ${t.sent ?? t.amount}), ${paid} of ${price}`);
  }
  after = page.last ?? after;
  if (paid < Number(price)) await new Promise((r) => setTimeout(r, 10_000));
}
console.log(`Order ${orderId} is paid.`);
