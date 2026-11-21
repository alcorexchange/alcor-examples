/**
 * Check on your backend that a person controls an account: Sign-In with Antelope from
 * the Alcor Signer. Nothing to deploy, nothing signed here.
 *
 * 1. Your server issues a nonce (16–64 letters and digits) and remembers it.
 * 2. Your page asks the Signer, after the person signed in with the WharfKit plugin:
 *
 *      const proof = await session.walletPlugin.proveAccount({
 *        chain: session.chain.id,
 *        account: String(session.actor),
 *        statement: 'Sign in to yourapp',
 *        nonce,
 *        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
 *      })
 *
 *    The person reads your statement in the Signer window and signs with their passkey.
 * 3. The page posts `proof` to your server, which runs what this script runs, then burns the nonce.
 *
 *   node examples/09-verify-proof.ts proof.json yourapp.com <nonce>
 *
 * On chain, `contract/msgproof.cpp` does the same check in a contract.
 */
import { readFileSync } from 'node:fs';
import { args } from '../src/alcor.ts';
import { verifyProof, type Proof } from '../src/proof.ts';

const [file, domain, nonce] = args('09-verify-proof.ts <proof.json> <your domain> <the nonce you issued>', 3);

const proof = JSON.parse(readFileSync(file, 'utf8')) as Proof;

try {
  const who = await verifyProof(proof, { domain, nonce });
  console.log(`Proved: ${who.account}@${who.permission} on ${who.network}, signed by ${who.key}`);
  console.log(`They agreed to: ${proof.fields.statement}`);
} catch (err) {
  console.error(`Not proved: ${(err as Error).message}`);
  process.exit(1);
}
