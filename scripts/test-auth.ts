// Verify the executor's sign-in auth: valid signature → token; requests
// without a token → 401; forged/stale messages → 403.
import nacl from "tweetnacl";
import { loadWallet } from "./lib/wallet.ts";

const API = "http://localhost:8787";
const kp = loadWallet();
const owner = kp.publicKey.toBase58();

const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};

const message = [
  "Ghost Stops — sign-in",
  "",
  `wallet: ${owner}`,
  `issued: ${new Date().toISOString()}`,
  "",
  "This signature verifies wallet ownership for this session.",
  "It is free and does NOT send a transaction.",
].join("\n");
const signature = Array.from(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));

// 1. valid sign-in
const ok = await post("/auth", { owner, message, signature });
console.log(`valid sign-in → ${ok.status}`, ok.json.token ? "(token issued)" : ok.json);
if (ok.status !== 200) throw new Error("expected 200");

// 1b. replay the SAME signature → 403 (replay guard)
const replay = await post("/auth", { owner, message, signature });
console.log(`replay same signature → ${replay.status} (${replay.json.error})`);
if (replay.status !== 403) throw new Error("expected 403 on replay");

// 2. orders without token → 401
const noToken = await post("/orders", { owner, market: "SOL", kind: "trailing", trailingBps: 50, isLong: true });
console.log(`orders without token → ${noToken.status} (${noToken.json.error})`);
if (noToken.status !== 401) throw new Error("expected 401");

// 3. forged owner (signature by us, message claims another wallet) → 403
const forged = await post("/auth", {
  owner: "9Zu64drGZjYsPAPz8cN7buzPob4LsZvcD5g7htLyZQcj",
  message,
  signature,
});
console.log(`forged owner → ${forged.status} (${forged.json.error})`);
if (forged.status !== 403) throw new Error("expected 403");

// 4. stale message → 403
const oldMsg = message.replace(/^issued: .+$/m, "issued: 2026-06-01T00:00:00.000Z");
const stale = await post("/auth", {
  owner,
  message: oldMsg,
  signature: Array.from(nacl.sign.detached(new TextEncoder().encode(oldMsg), kp.secretKey)),
});
console.log(`stale message → ${stale.status} (${stale.json.error})`);
if (stale.status !== 403) throw new Error("expected 403");

console.log("AUTH TESTS PASS");
