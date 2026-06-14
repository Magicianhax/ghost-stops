import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Normalize an RPC endpoint from env: trim, fall back when blank, and prepend
 * https:// when the protocol is missing. A bare host like "x.helius-rpc.com/..."
 * is a common paste mistake that otherwise crashes `new Connection(...)` at
 * startup with "Endpoint URL must start with `http:` or `https:`".
 */
export function normalizeRpcUrl(raw: string | undefined, fallback: string): string {
  const v = raw?.trim();
  if (!v) return fallback;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

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
    baseRpc: normalizeRpcUrl(process.env.GHOST_BASE_RPC, "https://api.devnet.solana.com"),
    erRpc: normalizeRpcUrl(process.env.GHOST_ER_RPC, "https://devnet.magicblock.app"),
    programId: new PublicKey(process.env.GHOST_PROGRAM_ID ?? "y8gjZcwDHqZ8Sz2Uziw5nxr2cWKGyAKaqtNAUJ2mKxh"),
    // MagicBlock pushes Pyth Lazer feeds into the devnet ER as PriceUpdateV3
    // accounts (price i64 @ byte 73 — matches the program's FEED_PRICE_OFFSET, so
    // every feed below is layout-identical to SOL: no redeploy). Each PDA was
    // DERIVED (seeds ["price_feed","pyth-lazer",<lazer_id>], program PriCems5…)
    // and VERIFIED live on the ER + price-matched to Flash's mainnet mark by
    // scripts/discover-feeds.ts (re-run it to refresh / add markets). These are
    // the 14 of Flash's markets that have a verified feed; the rest (equities,
    // FX, commodities, niche tokens) aren't pushed to the ER and stay gated out.
    feeds: {
      SOL: new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu"),
      BTC: new PublicKey("71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr"),
      ETH: new PublicKey("5vaYr1hpv8yrSpu8w3K95x22byYxUJCCNCSYJtqVWPvG"),
      BNB: new PublicKey("BYcDWZKZcGo8y3252xkK9ZrLoRoeMFaixWD6SoeW12fs"),
      XRP: new PublicKey("6ghNHfjf5YP1aKtpAfdHK1KrtKEm5Ww6SaDffDTxf5xX"),
      SUI: new PublicKey("5WLZBMYdJ9PyNLEVxUumz9XZ11446L6dEPHGkPGehJ2j"),
      HYPE: new PublicKey("CxEkVoCUwSAprvAhdWRPH63JeioQVNDtyZYEMRXuLu6x"),
      NEAR: new PublicKey("9Uz4aJ2LKfc6Dt4zByG6qRDVtGbHC2ZBHissoc9x343P"),
      ADA: new PublicKey("9XuTM9AcQJFRrQSMWKuFx2yWWmpjb4u25njfUJZpLU8D"),
      TRX: new PublicKey("CXgUgTHAohbKS66EwVihupFSJeuyUx2Ej8DN1tm1Yjc8"),
      TON: new PublicKey("HUDNszzFSAkPpYb9BF9KYtiQZ5CFjyzzZknsYm5cLAto"),
      TAO: new PublicKey("2MtF3H7Wzkp3xM6G9gdqJp55Aht1QrQdTagCKmHqJUJj"),
      ZEC: new PublicKey("6XWQr2Y1XEpJrCdVbYGupnDeb3wkR4YXazVXdgn2Lwpg"),
      ONDO: new PublicKey("Eptpc3kp9riN679SwGTACsuy2KY4LzHwPdeodGPyTJc2"),
    },
    executorKeypair: Keypair.fromSecretKey(bs58.decode(pk.trim())),
    sessionsFile: process.env.SESSIONS_FILE ?? ".sessions.json",
    stateFile: process.env.EXECUTOR_STATE_FILE ?? ".executor-state.json",
    // PaaS hosts (Railway, Render, Fly) inject a dynamic $PORT and route to it;
    // honour that first, then an explicit override, then the local default.
    controlPort: Number(process.env.PORT ?? process.env.EXECUTOR_PORT ?? 8787),
    corsOrigin: process.env.EXECUTOR_CORS_ORIGIN ?? "*",
  };
}
