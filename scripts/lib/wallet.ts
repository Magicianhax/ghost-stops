import "dotenv/config";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { writeFileSync } from "node:fs";

/** Load the dev wallet from .env (base58). Never log the secret. */
export function loadWallet(): Keypair {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY missing from .env");
  return Keypair.fromSecretKey(bs58.decode(pk.trim()));
}

/** Export to JSON-array format for tools expecting KEYPAIR_PATH. Git-ignored. */
export function exportKeypairJson(path: string): Keypair {
  const kp = loadWallet();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}
