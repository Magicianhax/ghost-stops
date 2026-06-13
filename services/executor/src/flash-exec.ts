// The execution leg: FIRED order on our ER → session-signed close on Flash's ER.
// Validation rules from GOTCHAS encoded here; idempotence is the caller's job.
import { Keypair } from "@solana/web3.js";
import { FlashV2Client } from "../../../packages/flash-v2/src/index.ts";
import { sendAndConfirm, signWithKeypair } from "../../../packages/flash-v2/src/sign.ts";
import type { OnChainOrder } from "./orders.ts";

export interface FillResult {
  ok: boolean;
  detail: string;
  latencyMs?: number;
}

export class FlashExecutor {
  private readonly flash = new FlashV2Client();

  constructor(
    private readonly owner: string,
    private readonly sessionSigner: Keypair,
    private readonly sessionToken: string
  ) {}

  /** Close (part of) the protected position because `order` fired. */
  async executeFired(order: OnChainOrder): Promise<FillResult> {
    const t0 = Date.now();
    const side = order.isLong ? "LONG" : "SHORT";
    try {
      const snap = await this.flash.owner(this.owner);
      const pos = Object.values(snap.positionMetrics).find(
        (p) => p.marketSymbol === order.marketSymbol && p.sideUi.toUpperCase() === side
      );
      if (!pos) {
        // Position already gone (manual close, liquidation, other order) — success-by-vacancy.
        return { ok: true, detail: "position already closed", latencyMs: Date.now() - t0 };
      }

      // ≥97% of size = full close on-chain → just request a full close ("0")
      // for anything close to full; partial otherwise.
      const sizeUsd = Number(pos.sizeUsdUi);
      const pct = order.sizePctBps / 10_000;
      const closeUsd = pct >= 0.97 ? "0" : (sizeUsd * pct).toFixed(2);

      const built = await this.flash.closePosition({
        marketSymbol: order.marketSymbol,
        side,
        inputUsdUi: closeUsd,
        withdrawTokenSymbol: "USDC",
        owner: this.owner,
        slippagePercentage: "0.5",
        signer: this.sessionSigner.publicKey.toBase58(),
        sessionToken: this.sessionToken,
      });
      if (!built.transactionBase64) throw new Error("no transaction returned");
      const tx = signWithKeypair(built.transactionBase64, this.sessionSigner);
      const { signature, confirmMs } = await sendAndConfirm(this.flash.network.erRpc, tx, {
        skipPreflight: true,
      });
      return {
        ok: true,
        detail: `closed ${closeUsd === "0" ? "100%" : `$${closeUsd}`} of ${order.marketSymbol} ${side} → ${signature} (${confirmMs}ms)`,
        latencyMs: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, detail: (e as Error).message, latencyMs: Date.now() - t0 };
    }
  }

  /** Is the protected position still open? (reconcile helper) */
  async positionOpen(order: OnChainOrder): Promise<boolean> {
    const side = order.isLong ? "Long" : "Short";
    const snap = await this.flash.owner(this.owner);
    return Object.values(snap.positionMetrics).some(
      (p) => p.marketSymbol === order.marketSymbol && p.sideUi === side
    );
  }
}
