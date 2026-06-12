import { FlashV2Client } from "../packages/flash-v2/src/index.ts";

const flash = new FlashV2Client();
const price = await flash.price("SOL");
const health = await flash.health();
console.log("SOL price:", price.priceUi);
console.log("health:", JSON.stringify(health));
