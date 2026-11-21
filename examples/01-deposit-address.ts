/**
 * A deposit address for one of your users.
 *
 * Whatever the user sends to it, on any network listed, from a wallet or
 * straight from an exchange, is paid out to your account with your memo. Ask
 * again every time you show it: the same request always answers the same
 * address, and the minimums move with gas.
 *
 *   node examples/01-deposit-address.ts wax yourproject user-42
 */
import { ApiError, post, printAddress, args, type DepositAddress } from '../src/alcor.ts';

const [chain, to, memo] = args('01-deposit-address.ts <telos|wax|xpr|vaulta> <your account> [memo]', 2);

try {
  const a = await post<DepositAddress>('/v1/deposit-addresses', { chain, to, ...(memo ? { memo } : {}) });
  console.log(`Pays out to ${a.destination.to} on ${a.destination.chain}${a.memo ? `, memo "${a.memo}"` : ''}`);
  printAddress(a);
} catch (err) {
  // INVALID_REQUEST: a deposit there would only come back (no such account, a bad memo). Show the message.
  // RATE_LIMITED: 20 new addresses an hour from one client. An address asked for before always answers.
  if (err instanceof ApiError) console.error(err.message);
  else throw err;
  process.exit(1);
}
