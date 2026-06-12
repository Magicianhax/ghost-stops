import 'dotenv/config';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const pk = process.env.PRIVATE_KEY;
if (!pk) {
  console.error('PRIVATE_KEY missing from .env');
  process.exit(1);
}

let keypair;
try {
  keypair = Keypair.fromSecretKey(bs58.decode(pk.trim()));
} catch (e) {
  console.error('Could not parse PRIVATE_KEY as base58 secret key:', e.message);
  process.exit(1);
}

const owner = keypair.publicKey;
console.log('Wallet:', owner.toBase58());

const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

const sol = await conn.getBalance(owner);
console.log('SOL:', (sol / 1e9).toFixed(4));

const tokenAccounts = await conn.getParsedTokenAccountsByOwner(owner, { mint: USDC_MINT });
const usdc = tokenAccounts.value.reduce(
  (sum, acc) => sum + (acc.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0),
  0
);
console.log('USDC:', usdc.toFixed(2));
