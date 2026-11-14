/**
 * Browser side of copy-trade keys. Nothing here ever leaves the browser except
 * the X25519 *public* key, which goes on-chain inside `subscribe`.
 *
 * - The follower's X25519 keypair is generated with WebCrypto and kept in
 *   localStorage, one per NEAR account.
 * - An epoch key is unwrapped as on the server (agents/app/nixo/viewing_keys.py
 *   `wrap_key`): ECDH(our private key, ephemeral public key) → SHA-256 →
 *   AES-GCM key; the blob is nonce[12] || ciphertext.
 * - Feed entries are AES-GCM with associated data `nixo-copy|trader|seq|epoch`,
 *   and each decrypted entry is checked against its public plaintext hash.
 */

type Bytes = Uint8Array<ArrayBuffer>;

const STORAGE_PREFIX = "nixo:copykeys:x25519:";
const enc = new TextEncoder();

export type FeedEntry = {
  trader: string;
  seq: number;
  epoch: number;
  ts: number;
  kind: string;
  plaintext_hash: string;
  chain_hash: string;
  nonce_b64: string;
  ciphertext_b64: string;
};

export type WrappedKey = { epoch: number; epoch_start: number; epoch_end: number; ephemeral_pub_b64: string; wrapped_b64: string };

export type StoredKeypair = { pub_b64: string; priv_jwk: JsonWebKey; created_at: number };

function fromB64(s: string): Bytes {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toB64(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function utf8(s: string): Bytes {
  const raw = enc.encode(s);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  out.set(raw);
  return out;
}

function fromHex(hex: string): Bytes {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sha256Hex(data: BufferSource): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function x25519Supported(): boolean {
  return typeof crypto !== "undefined" && Boolean(crypto.subtle);
}

/** Load this account's feed keypair, or create one. Returns the public key for `subscribe`. */
export async function getOrCreateKeypair(account: string): Promise<StoredKeypair> {
  const existing = loadKeypair(account);
  if (existing) return existing;
  let pair: CryptoKeyPair;
  try {
    pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  } catch {
    throw new Error("This browser doesn't support X25519 in WebCrypto. Use a current Chrome, Safari, Firefox or Edge.");
  }
  const kp: StoredKeypair = {
    pub_b64: toB64(await crypto.subtle.exportKey("raw", pair.publicKey)),
    priv_jwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
    created_at: Date.now(),
  };
  try {
    localStorage.setItem(STORAGE_PREFIX + account, JSON.stringify(kp));
  } catch {
    throw new Error("Couldn't save the feed key in this browser (storage blocked).");
  }
  return kp;
}

export function loadKeypair(account: string): StoredKeypair | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + account);
    return raw ? (JSON.parse(raw) as StoredKeypair) : null;
  } catch {
    return null;
  }
}

async function privateKey(kp: StoredKeypair): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", kp.priv_jwk, { name: "X25519" }, false, ["deriveBits"]);
}

/** Unwrap every epoch key; returns epoch → AES key. Keys wrapped to a different pubkey are skipped. */
export async function unwrapEpochKeys(kp: StoredKeypair, wrapped: WrappedKey[]): Promise<Map<number, CryptoKey>> {
  const priv = await privateKey(kp);
  const out = new Map<number, CryptoKey>();
  for (const w of wrapped) {
    try {
      const eph = await crypto.subtle.importKey("raw", fromB64(w.ephemeral_pub_b64), { name: "X25519" }, false, []);
      const shared = await crypto.subtle.deriveBits({ name: "X25519", public: eph } as EcdhKeyDeriveParams, priv, 256);
      const kek = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", shared), "AES-GCM", false, ["decrypt"]);
      const blob = fromB64(w.wrapped_b64);
      const dataKey = await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, 12) }, kek, blob.slice(12));
      out.set(w.epoch, await crypto.subtle.importKey("raw", dataKey, "AES-GCM", false, ["decrypt"]));
    } catch {
      // Wrapped for another browser's key (e.g. subscribed from a different device).
    }
  }
  return out;
}

export type Decrypted = { entry: FeedEntry; data: Record<string, unknown> | null; error?: string };

export async function decryptEntries(entries: FeedEntry[], keys: Map<number, CryptoKey>): Promise<Decrypted[]> {
  return Promise.all(
    entries.map(async (entry) => {
      const key = keys.get(entry.epoch);
      if (!key) return { entry, data: null };
      try {
        const raw = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: fromB64(entry.nonce_b64), additionalData: utf8(`nixo-copy|${entry.trader}|${entry.seq}|${entry.epoch}`) },
          key,
          fromB64(entry.ciphertext_b64),
        );
        if ((await sha256Hex(raw)) !== entry.plaintext_hash) return { entry, data: null, error: "hash mismatch" };
        return { entry, data: JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown> };
      } catch {
        return { entry, data: null, error: "decrypt failed" };
      }
    }),
  );
}

/** Recompute the public hash chain from genesis; true if nothing was edited, dropped or reordered. */
export async function verifyChain(entries: FeedEntry[]): Promise<boolean> {
  let head = "0".repeat(64);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i + 1) return false;
    const buf = new Uint8Array(new ArrayBuffer(64));
    buf.set(fromHex(head), 0);
    buf.set(fromHex(e.plaintext_hash), 32);
    head = await sha256Hex(buf);
    if (head !== e.chain_hash) return false;
  }
  return true;
}
