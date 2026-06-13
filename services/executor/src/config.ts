import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { existsSync, readFileSync } from "node:fs";

export interface ExecutorConfig {
  erRpc: string;
  erWs: string;
  programId: PublicKey;
  feed: PublicKey;
  /** Signs mark_executed/cancel ER txs and pays nothing (ER txs are free). */
  executorKeypair: Keypair;
  /** Flash session signer (scoped, expiring, cannot withdraw). */
  sessionSigner: Keypair;
  sessionToken: string;
  /** Basket owner whose positions we protect. */
  owner: string;
  stateFile: string;
}

export function loadConfig(): ExecutorConfig {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY missing from .env");
  const executorKeypair = Keypair.fromSecretKey(bs58.decode(pk.trim()));

  const sessionFile = process.env.SESSION_FILE ?? ".session.json";
  if (!existsSync(sessionFile)) throw new Error(`${sessionFile} not found — run scripts/probe-session.ts first`);
  const session = JSON.parse(readFileSync(sessionFile, "utf8"));
  if (session.validUntil < Date.now() / 1000 + 60) throw new Error("session expired — mint a new one");

  return {
    erRpc: process.env.GHOST_ER_RPC ?? "https://devnet.magicblock.app",
    erWs: process.env.GHOST_ER_WS ?? "wss://devnet.magicblock.app",
    programId: new PublicKey(process.env.GHOST_PROGRAM_ID ?? "8RzFuFdxwWedBoug44zjWGgs4WhhcpLTmo8e1tZVpCBb"),
    feed: new PublicKey(process.env.GHOST_FEED ?? "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu"),
    executorKeypair,
    sessionSigner: Keypair.fromSecretKey(Uint8Array.from(session.secretKey)),
    sessionToken: session.sessionToken,
    owner: process.env.GHOST_OWNER ?? executorKeypair.publicKey.toBase58(),
    stateFile: process.env.EXECUTOR_STATE_FILE ?? ".executor-state.json",
  };
}
