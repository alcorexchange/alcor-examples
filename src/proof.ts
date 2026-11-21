/**
 * Sign-In with Antelope, checked off chain: what `proveAccount` in the Alcor Signer
 * plugin returns, verified on your backend without deploying anything.
 *
 * The message is CAIP-122 (the fields of Sign-In with Ethereum) with an Antelope account
 * line, and the signature covers
 *   sha256("\x19Antelope Signed Message:\n" + byte length of the text + text)
 * The prefix keeps it from ever being a transaction's signature. `contract/msgproof.cpp`
 * checks the same bytes on chain.
 */
import { APIClient, Bytes, Checksum256, KeyType, PublicKey, Signature } from '@wharfkit/antelope';

export const SIGNER_HOST = 'sign.alcor.exchange';
const SIGNER_ORIGIN = `https://${SIGNER_HOST}`;
const PREFIX = '\x19Antelope Signed Message:\n';
const MAX_LIFETIME_S = 3600;
const CLOCK_SKEW_S = 60;

/** The networks the Signer works on: chain id and a default node, `<NAME>_RPC` overrides it. */
export const NETWORKS: Record<string, { chainId: string; rpc: string }> = {
  telos: { chainId: '4667b205c6838ef70ff7988f6e8257e8be0e1284a2f59699054a018f743b1d11', rpc: 'https://telos.greymass.com' },
  wax: { chainId: '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4', rpc: 'https://wax.greymass.com' },
  xpr: { chainId: '384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0', rpc: 'https://proton.greymass.com' },
  vaulta: { chainId: 'aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906', rpc: 'https://eos.greymass.com' },
};

/** What the Signer returns in `fields`: everything the text is built from. */
export interface ProofFields {
  domain: string;
  uri: string;
  account: string;
  permission: string;
  statement: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

export interface Proof {
  message: string;
  signature: string;
  fields: ProofFields;
}

export interface Verified {
  network: string;
  account: string;
  permission: string;
  key: string;
}

export const proofText = (f: ProofFields): string =>
  [
    `${f.domain} wants you to sign in with your Antelope account:`,
    `${f.account}@${f.permission}`,
    '',
    f.statement,
    '',
    `URI: ${f.uri}`,
    'Version: 1',
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expiresAt}`,
  ].join('\n');

export function proofDigest(text: string): Checksum256 {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`${PREFIX}${body.length}`);
  return Checksum256.hash(Bytes.from(new Uint8Array([...head, ...body])));
}

/**
 * The key that signed `digest`. K1 recovers directly. A passkey (`SIG_WA_`) signs
 * `sha256(authenticatorData ‖ sha256(clientDataJSON))` with the digest as its challenge,
 * so that is checked first, the way the chain checks it.
 */
export function recoverProofKey(signature: string, digest: Checksum256): string {
  const sig = Signature.from(signature);
  if (sig.type === KeyType.K1) return String(sig.recoverDigest(digest));
  if (sig.type !== KeyType.WA) throw new Error(`A ${sig.type} signature is not a proof from Alcor Signer`);

  const data = sig.data.array;
  const [authData, afterAuth] = lengthPrefixed(data, 65);
  const [clientDataJSON] = lengthPrefixed(data, afterAuth);

  const client = JSON.parse(new TextDecoder().decode(clientDataJSON));
  if (client.type !== 'webauthn.get') throw new Error('The passkey signature is not an assertion');
  if (client.origin !== SIGNER_ORIGIN) throw new Error(`The passkey signed on ${client.origin}, not ${SIGNER_ORIGIN}`);
  if (Buffer.from(client.challenge, 'base64url').toString('hex') !== String(digest)) {
    throw new Error('The passkey signed another message');
  }
  const rpIdHash = Checksum256.hash(Bytes.from(new TextEncoder().encode(SIGNER_HOST)));
  if (Bytes.from(authData.slice(0, 32)).hexString !== String(rpIdHash)) throw new Error('The passkey belongs to another site');

  const signed = Checksum256.hash(
    Bytes.from(new Uint8Array([...authData, ...Checksum256.hash(Bytes.from(clientDataJSON)).array]))
  );
  const point = new Signature(KeyType.R1, Bytes.from(data.slice(0, 65))).recoverDigest(signed).data.array;
  const flags = authData[32];
  const presence = flags & 0x04 ? 2 : flags & 0x01 ? 1 : 0;
  const rpId = new TextEncoder().encode(SIGNER_HOST);
  return String(new PublicKey(KeyType.WA, Bytes.from(new Uint8Array([...point, presence, ...varuint(rpId.length), ...rpId]))));
}

/**
 * Everything a verifier checks: the text is the one the fields build, made for your
 * domain and your nonce, still valid, on a known network, signed by a key that alone
 * satisfies account@permission right now. Returns who it proves, or throws why not.
 *
 * Burn the nonce once this returns: a proof is good once. For money-grade decisions ask
 * two nodes and require the same answer; one node can lie about an account.
 */
export async function verifyProof(
  proof: Proof,
  expected: { domain: string; nonce: string },
  nowMs = Date.now()
): Promise<Verified> {
  const f = proof.fields;
  if (proof.message !== proofText(f)) throw new Error('The message does not match its fields');
  if (f.domain !== expected.domain || new URL(f.uri).host !== expected.domain) {
    throw new Error(`The proof was made for ${f.domain}, not ${expected.domain}`);
  }
  if (f.nonce !== expected.nonce) throw new Error('The proof carries another nonce');

  const network = Object.keys(NETWORKS).find((name) => NETWORKS[name].chainId === f.chainId);
  if (!network) throw new Error(`Unknown chain ${f.chainId}`);

  const now = Math.floor(nowMs / 1000);
  const issued = Date.parse(f.issuedAt) / 1000;
  const expires = Date.parse(f.expiresAt) / 1000;
  if (!(expires > issued && expires - issued <= MAX_LIFETIME_S)) throw new Error('The proof has an invalid lifetime');
  if (issued > now + CLOCK_SKEW_S) throw new Error('The proof is issued in the future');
  if (now >= expires) throw new Error('The proof has expired');

  const key = recoverProofKey(proof.signature, proofDigest(proof.message));

  const rpc = process.env[`${network.toUpperCase()}_RPC`] ?? NETWORKS[network].rpc;
  const account = await new APIClient({ url: rpc }).v1.chain.get_account(f.account);
  const permission = account.permissions.find((p) => String(p.perm_name) === f.permission);
  if (!permission) throw new Error(`${f.account} has no ${f.permission} permission`);

  const auth = permission.required_auth;
  const enough = auth.keys.some((k) => String(k.key) === key && Number(k.weight) >= Number(auth.threshold));
  if (!enough) throw new Error(`The signing key does not satisfy ${f.account}@${f.permission} on ${network}`);

  return { network, account: f.account, permission: f.permission, key };
}

function lengthPrefixed(data: Uint8Array, at: number): [Uint8Array, number] {
  let length = 0;
  let shift = 0;
  for (;;) {
    const byte = data[at++];
    length |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7;
  }
  return [data.slice(at, at + length), at + length];
}

function varuint(value: number): number[] {
  const out: number[] = [];
  for (; ; value >>>= 7) {
    out.push(value > 0x7f ? (value & 0x7f) | 0x80 : value);
    if (value <= 0x7f) return out;
  }
}
