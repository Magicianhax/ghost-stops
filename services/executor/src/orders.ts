// Decode + interact with ghost-stops Order accounts on the ER.
import anchorPkg from "@coral-xyz/anchor";
const { AnchorProvider, BN, Program, Wallet } = anchorPkg;
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const IDL_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "idl", "ghost_stops.json");

export const STATE = { active: 0, fired: 1, executed: 2, cancelled: 3, failed: 4 } as const;
export const KIND = { trailing: 0, fixed: 1 } as const;

export interface OnChainOrder {
  pda: string;
  owner: string;
  executor: string;
  orderId: bigint;
  kind: number;
  marketSymbol: string;
  priceFeed: string;
  trailingBps: number;
  highWaterMark: bigint;
  triggerPrice: bigint;
  triggerAbove: boolean;
  sizePctBps: number;
  ocoLink: string | null;
  expiry: bigint;
  state: number;
  firedPrice: bigint;
  isLong: boolean;
}

export class OrderClient {
  readonly program: InstanceType<typeof Program>;
  readonly conn: Connection;
  private readonly signer: Keypair;

  constructor(erRpc: string, signer: Keypair) {
    this.conn = new Connection(erRpc, "confirmed");
    this.signer = signer;
    const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
    const provider = new AnchorProvider(this.conn, new Wallet(signer), { commitment: "confirmed" });
    this.program = new Program(idl, provider);
  }

  decode(pda: PublicKey, data: Buffer): OnChainOrder {
    const raw = this.program.coder.accounts.decode("order", data);
    return {
      pda: pda.toBase58(),
      owner: raw.owner.toBase58(),
      executor: raw.executor.toBase58(),
      orderId: BigInt(raw.orderId.toString()),
      kind: raw.kind,
      marketSymbol: Buffer.from(raw.marketSymbol).toString("utf8").replace(/\0+$/, ""),
      priceFeed: raw.priceFeed.toBase58(),
      trailingBps: raw.trailingBps,
      highWaterMark: BigInt(raw.highWaterMark.toString()),
      triggerPrice: BigInt(raw.triggerPrice.toString()),
      triggerAbove: raw.triggerAbove,
      sizePctBps: raw.sizePctBps,
      ocoLink: raw.ocoLink ? raw.ocoLink.toBase58() : null,
      expiry: BigInt(raw.expiry.toString()),
      state: raw.state,
      firedPrice: BigInt(raw.firedPrice.toString()),
      isLong: raw.isLong,
    };
  }

  async fetchAll(): Promise<OnChainOrder[]> {
    const accounts = await this.conn.getProgramAccounts(this.program.programId);
    const out: OnChainOrder[] = [];
    for (const { pubkey, account } of accounts) {
      try {
        out.push(this.decode(pubkey, account.data as Buffer));
      } catch {
        // non-Order accounts (IDL account etc.) — skip
      }
    }
    return out;
  }

  private async send(tx: Transaction, label: string): Promise<string> {
    tx.feePayer = this.signer.publicKey;
    tx.recentBlockhash = (await this.conn.getLatestBlockhash()).blockhash;
    tx.sign(this.signer);
    const sig = await this.conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await this.conn.confirmTransaction(sig, "confirmed");
    return sig;
  }

  async markExecuted(pda: string, success: boolean): Promise<string> {
    const tx = await this.program.methods
      .markExecuted(success)
      .accountsPartial({ signer: this.signer.publicKey, order: new PublicKey(pda) })
      .transaction();
    return this.send(tx, "mark_executed");
  }

  async cancelOrder(pda: string): Promise<string> {
    const tx = await this.program.methods
      .cancelOrder()
      .accountsPartial({ signer: this.signer.publicKey, order: new PublicKey(pda) })
      .transaction();
    return this.send(tx, "cancel_order");
  }

  async cancelTick(taskId: bigint): Promise<string> {
    const tx = await this.program.methods
      .cancelTick(new BN(taskId.toString()))
      .accountsPartial({ payer: this.signer.publicKey })
      .transaction();
    return this.send(tx, "cancel_tick");
  }

  async scheduleTick(pda: string, feed: string, taskId: bigint, intervalMs: number, iterations: number): Promise<string> {
    const tx = await this.program.methods
      .scheduleTick({
        taskId: new BN(taskId.toString()),
        intervalMs: new BN(intervalMs),
        iterations: new BN(iterations),
      })
      .accountsPartial({
        payer: this.signer.publicKey,
        order: new PublicKey(pda),
        priceFeed: new PublicKey(feed),
      })
      .transaction();
    return this.send(tx, "schedule_tick");
  }
}
