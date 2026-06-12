// Did the close ACTUALLY settle at oracle, or at the -10% band the quote showed?
// Deposited 15 USDC, opened+closed $11 @ ~same price. If the ledger holds
// ~14.9x → fills/settles at oracle (band is display-only). If ~13.9 → real 10% haircut.
import { loadWallet } from "./lib/wallet.ts";
import { FlashV2Client } from "../packages/flash-v2/src/index.ts";

const kp = loadWallet();
const owner = kp.publicKey.toBase58();
const flash = new FlashV2Client();

const snap = await flash.owner(owner);
console.log("basket:", snap.basketPubkey);
console.log("positions:", Object.keys(snap.positionMetrics).length);

if (snap.basketPubkey) {
  const raw = await flash.rawBasket(snap.basketPubkey);
  console.log(JSON.stringify(raw, null, 2).slice(0, 4000));
}
