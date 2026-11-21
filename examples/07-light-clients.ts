/**
 * The bridge's light clients, read as any contract of yours would read them.
 *
 * On Telos, one table per chain: each row is a block proved final by that
 * chain's validators, with the roots your own merkle proof folds to. On
 * Ethereum, BSC and Polygon, `TelosLightClient.trustedRoots(root)` says
 * whether a Telos `finality_mroot` is trusted.
 *
 *   node examples/07-light-clients.ts
 *   node examples/07-light-clients.ts 0x<a Telos finality_mroot>
 *
 * Guide: https://docs.alcor.exchange/developers-api/light-clients
 */
import { get, telosTable } from '../src/alcor.ts';

const root = process.argv[2];

// `headers` rows are keyed by block hash; their `bynumber` index (2) gives the newest block.
const TELOS_TABLES = [
  { chain: 'Ethereum', account: 'eth.lc.alcor', table: 'headers', root: 'receipts_root', index: 2 },
  { chain: 'BNB Smart Chain', account: 'bsc.lc.alcor', table: 'headers', root: 'receipts_root', index: 2 },
  { chain: 'Polygon', account: 'pol.lc.alcor', table: 'headers', root: 'receipts_root', index: 2 },
  { chain: 'WAX', account: 'wax.lc.alcor', table: 'blocks', root: 'action_mroot' },
  { chain: 'XPR Network', account: 'xpr.lc.alcor', table: 'blocks', root: 'action_mroot' },
  { chain: 'Vaulta', account: 'vlt.lc.alcor', table: 'blocks', root: 'finality_mroot' },
  { chain: 'NEAR', account: 'nearlc.alcor', table: 'heads', root: 'block_merkle_root' },
  { chain: 'Sui', account: 'sui.lc.alcor', table: 'checkpoints', root: 'content_digest' },
  { chain: 'TON', account: 'ton.lc.alcor', table: 'heads', root: 'root_hash' },
];

console.log('Proved blocks on Telos (a row the bridge paid for may be pruned soon: prove your own block as the payer)\n');
for (const t of TELOS_TABLES) {
  const [row] = await telosTable<Record<string, unknown>>(t.account, t.table, { index: t.index });
  if (!row) {
    console.log(`${t.chain.padEnd(16)} ${t.account}::${t.table}  empty right now`);
    continue;
  }
  const height = row.block_number ?? row.block_num ?? row.height ?? row.sequence ?? row.seq_no;
  const final = row.finalized === 0 ? '  NOT finalized (optimistic)' : '';
  console.log(`${t.chain.padEnd(16)} ${t.account}::${t.table}  block ${height}  ${t.root} ${row[t.root]}${final}`);
}

// The Telos light client on each EVM chain, by the address the bridge API gives.
const chains = await get<{ sources: { id: string; lightClient: { contract: string | null } }[] }>('/v1/chains');
const RPC: Record<string, string> = {
  mainnet: 'https://ethereum-rpc.publicnode.com',
  bsc: 'https://bsc-dataseed.bnbchain.org',
  polygon: 'https://polygon-bor-rpc.publicnode.com',
};
const TRUSTED_ROOTS = '0x7657e90d'; // trustedRoots(bytes32)

if (root) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(root)) throw new Error('a root is 0x and 64 hex digits');
  console.log(`\nIs ${root} a trusted Telos root?`);
  for (const c of chains.sources.filter((s) => RPC[s.id])) {
    const res = await fetch(RPC[c.id], {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: c.lightClient.contract, data: TRUSTED_ROOTS + root.slice(2) }, 'latest'],
      }),
    });
    const { result } = (await res.json()) as { result: string };
    console.log(`${c.id.padEnd(8)} ${c.lightClient.contract}  ${BigInt(result) === 1n ? 'trusted' : 'not trusted'}`);
  }
}
