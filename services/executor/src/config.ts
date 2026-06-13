import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export interface ExecutorConfig {
  baseRpc: string;
  erRpc: string;
  programId: PublicKey;
  /** market symbol → MagicBlock oracle feed PDA (verified feeds only) */
  feeds: Record<string, PublicKey>;
  /** Pays devnet rent for order PDAs, signs ER txs (free), never holds user funds. */
  executorKeypair: Keypair;
  sessionsFile: string;
  stateFile: string;
  controlPort: number;
  corsOrigin: string;
}

export function loadConfig(): ExecutorConfig {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY missing from .env");
  return {
    baseRpc: process.env.GHOST_BASE_RPC ?? "https://api.devnet.solana.com",
    erRpc: process.env.GHOST_ER_RPC ?? "https://devnet.magicblock.app",
    programId: new PublicKey(process.env.GHOST_PROGRAM_ID ?? "y8gjZcwDHqZ8Sz2Uziw5nxr2cWKGyAKaqtNAUJ2mKxh"),
    feeds: {
      // SOL/USD Pyth Lazer feed — live-verified updating sub-second, 1e8 scale.
      SOL: new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu"),
    },
    executorKeypair: Keypair.fromSecretKey(bs58.decode(pk.trim())),
    sessionsFile: process.env.SESSIONS_FILE ?? ".sessions.json",
    stateFile: process.env.EXECUTOR_STATE_FILE ?? ".executor-state.json",
    controlPort: Number(process.env.EXECUTOR_PORT ?? 8787),
    corsOrigin: process.env.EXECUTOR_CORS_ORIGIN ?? "*",
  };
}
