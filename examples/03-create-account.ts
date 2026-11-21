/**
 * Sign up a user with no wallet: an address whose first deposit creates
 * `<nick>.ac` on Telos and puts the rest of the deposit on it.
 *
 * The keys are made here, on this machine. Only the public keys leave it: the
 * private ones are written to keys/<nick>.ac.json, readable by you alone, and
 * never printed. In a real app make them on the user's device.
 *
 *   node examples/03-create-account.ts vasya
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { PrivateKey } from '@wharfkit/antelope';

import { ApiError, post, printAddress, args, type DepositAddress } from '../src/alcor.ts';

const [nick] = args('03-create-account.ts <nick: 1–9 of a-z and 1-5>', 1);
if (!/^[a-z1-5]{1,9}$/.test(nick)) {
  console.error('A nick is 1–9 characters of a-z and 1-5, no dot.');
  process.exit(2);
}
const account = `${nick}.ac`;
const keyFile = `keys/${account}.json`;
if (existsSync(keyFile)) {
  console.error(`${keyFile} exists already: these keys may own an account. Not overwriting it.`);
  process.exit(1);
}

const owner = PrivateKey.generate('K1');
const active = PrivateKey.generate('K1');
// The factory memo: `<nick>.ac:<owner key>:<active key>`. It is the address's `leg`, hashed into it as sent.
const leg = `${account}:${owner.toPublic()}:${active.toPublic()}`;

try {
  const a = await post<DepositAddress>('/v1/deposit-addresses', { chain: 'telos', to: 'ac', leg });
  mkdirSync('keys', { recursive: true });
  writeFileSync(keyFile, JSON.stringify({ account, owner: owner.toString(), active: active.toString() }, null, 2), { mode: 0o600 });
  console.log(`The first deposit to this address creates ${a.account ?? account} on Telos.`);
  console.log(`Owner key ${owner.toPublic()}, active key ${active.toPublic()}; private keys in ${keyFile}.`);
  printAddress(a);
  console.log(`\nFollow it: node examples/04-account-status.ts ${a.address}`);
} catch (err) {
  // NAME_TAKEN: the name is someone else's, ask for another. INVALID_REQUEST: the factory would refuse the memo.
  if (err instanceof ApiError) console.error(err.message);
  else throw err;
  process.exit(1);
}
