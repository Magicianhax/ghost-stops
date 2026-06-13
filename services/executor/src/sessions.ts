// Session store: owner wallet → Flash session key the executor may trade with.
// A session is a SCOPED capability (one program, expiring, revocable, cannot
// withdraw) — holding it server-side is its designed use. Persisted so an
// executor restart keeps protecting positions.
import { Keypair } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface OwnerSession {
  signer: Keypair;
  sessionToken: string;
  validUntil: number;
}

interface StoredSession {
  owner: string;
  secretKey: number[];
  sessionToken: string;
  validUntil: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, OwnerSession>();

  constructor(private readonly file: string, legacyFile = ".session.json") {
    if (existsSync(this.file)) {
      for (const s of JSON.parse(readFileSync(this.file, "utf8")) as StoredSession[]) {
        this.sessions.set(s.owner, {
          signer: Keypair.fromSecretKey(Uint8Array.from(s.secretKey)),
          sessionToken: s.sessionToken,
          validUntil: s.validUntil,
        });
      }
    } else if (existsSync(legacyFile)) {
      // Seed from the probe-B single-session file (owner = executor wallet).
      const s = JSON.parse(readFileSync(legacyFile, "utf8"));
      const signer = Keypair.fromSecretKey(Uint8Array.from(s.secretKey));
      if (process.env.PRIVATE_KEY) {
        // legacy file has no owner field — it was always the executor's own wallet
        const owner = process.env.GHOST_OWNER;
        if (owner) {
          this.sessions.set(owner, { signer, sessionToken: s.sessionToken, validUntil: s.validUntil });
        }
      }
    }
  }

  set(owner: string, secretKey: number[], sessionToken: string, validUntil: number): void {
    this.sessions.set(owner, {
      signer: Keypair.fromSecretKey(Uint8Array.from(secretKey)),
      sessionToken,
      validUntil,
    });
    this.persist();
  }

  /** Valid (non-expired, with 60s margin) session for an owner, or null. */
  get(owner: string): OwnerSession | null {
    const s = this.sessions.get(owner);
    if (!s) return null;
    if (s.validUntil < Date.now() / 1000 + 60) return null;
    return s;
  }

  owners(): string[] {
    return [...this.sessions.keys()];
  }

  private persist(): void {
    const out: StoredSession[] = [...this.sessions.entries()].map(([owner, s]) => ({
      owner,
      secretKey: Array.from(s.signer.secretKey),
      sessionToken: s.sessionToken,
      validUntil: s.validUntil,
    }));
    writeFileSync(this.file, JSON.stringify(out));
  }
}
