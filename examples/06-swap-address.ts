/**
 * An address that swaps on the way (beta): every deposit to it is swapped on
 * Telos into the token you name and delivered to `to` on its chain. "Send USDC
 * on Polygon, get GRAM on TON", with nothing for the user to sign.
 *
 * `refund` is where a deposit that cannot be swapped goes back, on the chain
 * it came from: the user's own wallet, never an exchange's deposit address.
 *
 *   node examples/06-swap-address.ts ton UQCL…h8IC GRAM 0x4451…3C5C
 *   node examples/06-swap-address.ts ton UQCL…h8IC GRAM 0x4451…3C5C polygon USDC 10000000
 *
 * With the last three arguments it also asks what such a deposit would pay now.
 */
import { get, post, printAddress, args, ApiError, type DepositAddress } from '../src/alcor.ts';

const [chain, to, token, refund, sendChain, sendToken, amount] = args(
  '06-swap-address.ts <chain> <recipient> <token to buy> [refund address] [send chain] [send token] [raw amount]',
  3,
);

interface Estimate {
  possible: boolean;
  reason?: string;
  receive: { symbol: string; expected: string; least: string };
  priceImpact: string;
}

try {
  const a = await post<DepositAddress>('/v1/deposit-addresses', { chain, to, token, ...(refund ? { refund } : {}) });
  console.log(`Every deposit buys ${a.buys} for ${a.destination.to} on ${a.destination.chain}.`);
  printAddress(a);

  if (sendChain && sendToken && amount) {
    const q = new URLSearchParams({ chain: sendChain, token: sendToken, amount });
    const e = await get<Estimate>(`/v1/deposit-addresses/${a.address}/estimate?${q}`);
    // Show `expected`, and say "at the rate when your deposit arrives": the swap happens then.
    if (e.possible) console.log(`\nNow: about ${e.receive.expected} ${e.receive.symbol}, at least ${e.receive.least}, impact ${e.priceImpact}%`);
    else console.log(`\nWould not swap now: ${e.reason}`);
  }
} catch (err) {
  if (err instanceof ApiError) console.error(err.message);
  else throw err;
  process.exit(1);
}
