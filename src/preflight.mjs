import { fetchJson, writeJson } from './io.mjs';
import { assertDevnet } from './core.mjs';

const endpoints = [
  { name: 'Solana devnet', url: process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com', rpc: true, required: true },
  { name: 'MagicBlock devnet PER', url: 'https://devnet-tee.magicblock.app', rpc: true, required: true },
  { name: 'MagicBlock payments API', url: 'https://payments.magicblock.app/health', required: false },
];
const results = await Promise.all(endpoints.map(async endpoint => {
  try {
    const data = await fetchJson(endpoint.url, endpoint.rpc ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: endpoint.name === 'Solana devnet' ? 'getGenesisHash' : 'getIdentity' }),
    } : {});
    if (data.error) throw new Error(`RPC error ${data.error.code}`);
    if (endpoint.name === 'Solana devnet') assertDevnet(data.result);
    return { name: endpoint.name, required: endpoint.required, outcome: 'reachable', data };
  } catch (e) {
    return { name: endpoint.name, required: endpoint.required, outcome: 'blocked', error: e.name,
      detail: e.message.replace(/https?:\/\/\S+/g, '[endpoint]') };
  }
}));
const report = { generatedAt: new Date().toISOString(), network: 'devnet', transactionsSubmitted: 0, results };
writeJson('reports/preflight.json', report);
for (const r of results) console.log(`${r.name}: ${r.outcome}${r.detail ? ` (${r.detail})` : ''}`);
if (results.some(r => r.required && r.outcome === 'blocked')) process.exitCode = 1;
