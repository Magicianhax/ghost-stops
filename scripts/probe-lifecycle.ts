// Probe A — full Flash V2 lifecycle on mainnet, driven through the vendored
// lifecycle walkthrough. Exports the .env wallet to .keypair.json (git-ignored)
// then runs packages/flash-v2/src/lifecycle.ts in-process.
// Safety: asserts wallet holds >= $15 USDC before running (risk playbook cap).
import { exportKeypairJson } from "./lib/wallet.ts";
import { Connection, PublicKey } from "@solana/web3.js";

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const kp = exportKeypairJson(".keypair.json");
console.log("owner:", kp.publicKey.toBase58());

const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const tokenAccounts = await conn.getParsedTokenAccountsByOwner(kp.publicKey, { mint: USDC_MINT });
const usdc = tokenAccounts.value.reduce(
  (s, a) => s + (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0),
  0
);
const sol = (await conn.getBalance(kp.publicKey)) / 1e9;
console.log(`balances: ${sol.toFixed(4)} SOL, ${usdc.toFixed(2)} USDC`);
if (usdc < 15) throw new Error("risk cap: need >= $15 USDC in wallet before probing");

process.env.KEYPAIR_PATH = ".keypair.json";
process.env.DEPOSIT_UI = process.env.DEPOSIT_UI ?? "15";
process.env.OPEN_UI = process.env.OPEN_UI ?? "11";

await import("../packages/flash-v2/src/lifecycle.ts");
