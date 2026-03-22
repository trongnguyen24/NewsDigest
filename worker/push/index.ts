import { Env } from '../types';

/**
 * Edge-compatible Web Push using SubtleCrypto.
 * Implements RFC 8291 (Message Encryption for Web Push) + VAPID (RFC 8292).
 */

export async function broadcastPush(env: Env, summaryText: string, digestId: string) {
   if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      console.warn("VAPID keys not configured. Skipping push notification.");
      return;
   }

   const payload = JSON.stringify({
      title: "NewsDigest",
      body: summaryText.length > 120 ? summaryText.slice(0, 117) + '...' : summaryText,
      data: { digestId }
   });

   const subscriptionsReq = await env.PUSH_SUBSCRIPTIONS.list({ prefix: "sub:" });
   
   for (const key of subscriptionsReq.keys) {
      const subJSON = await env.PUSH_SUBSCRIPTIONS.get(key.name);
      if (!subJSON) continue;
      
      try {
          const subscription = JSON.parse(subJSON);
          await sendPushNotification(subscription, payload, env);
      } catch (err: any) {
          if (err.status === 410 || err.status === 404) {
              await env.PUSH_SUBSCRIPTIONS.delete(key.name);
              console.log(`Cleaned up expired subscription: ${key.name}`);
          } else {
              console.error("Push Error:", err.message || err);
          }
      }
   }
}

// ── Core Web Push implementation ─────────────────────────

async function sendPushNotification(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  env: Env
) {
  const { endpoint, keys } = subscription;

  // Generate local ECDH keypair
  const localKeyPair = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )) as CryptoKeyPair;

  // Import subscriber's p256dh public key
  const subscriberPubKeyBytes = base64UrlDecode(keys.p256dh);
  const subscriberPubKey = await crypto.subtle.importKey(
    'raw', subscriberPubKeyBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: subscriberPubKey } as any,
    localKeyPair.privateKey,
    256
  );

  const authSecret = base64UrlDecode(keys.auth);
  const localPubKeyBytes = await crypto.subtle.exportKey('raw', localKeyPair.publicKey) as ArrayBuffer;
  const localPubKeyBuf = new Uint8Array(localPubKeyBytes);

  // RFC 8291 key derivation
  const ikm = await hkdf(
    new Uint8Array(sharedSecret),
    new Uint8Array(authSecret),
    createInfo('WebPush: info\x00', subscriberPubKeyBytes, localPubKeyBuf),
    32
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const prk = await hkdf(ikm, salt, utf8Encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdf(ikm, salt, utf8Encode('Content-Encoding: nonce\x00'), 12);

  // Encrypt payload
  const encryptionKey = await crypto.subtle.importKey(
    'raw', prk, 'AES-GCM', false, ['encrypt']
  );

  const paddedPayload = new Uint8Array([...utf8Encode(payload), 2]); // 2 = delimiter
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    encryptionKey,
    paddedPayload
  );

  // Build encrypted content coding header (RFC 8188)
  const recordSize = new ArrayBuffer(4);
  new DataView(recordSize).setUint32(0, new Uint8Array(ciphertext).length + 86);

  const body = new Uint8Array([
    ...salt,
    ...new Uint8Array(recordSize),
    1, // key ID size = 1... we use the 65-byte uncompressed public key inline
    65, // key length
    ...localPubKeyBuf,
    ...new Uint8Array(ciphertext)
  ]);

  // Build VAPID Authorization header
  const vapidHeaders = await createVapidAuth(endpoint, env);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      ...vapidHeaders
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    const error: any = new Error(`Push failed: ${response.status} ${text}`);
    error.status = response.status;
    throw error;
  }
}

// ── VAPID Auth (RFC 8292) ────────────────────────────────

async function createVapidAuth(endpoint: string, env: Env) {
  const audience = new URL(endpoint).origin;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12h

  const header = base64UrlEncode(utf8Encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = base64UrlEncode(utf8Encode(JSON.stringify({
    aud: audience,
    exp: expiry,
    sub: 'mailto:admin@newsdigest.local'
  })));

  const unsignedToken = `${header}.${payload}`;

  // Import VAPID private key
  const pubKeyBytes = base64UrlDecode(env.VAPID_PUBLIC_KEY);
  // Uncompressed public key is 65 bytes: 0x04 || x (32) || y (32)
  const xBytes = pubKeyBytes.length === 65 ? pubKeyBytes.slice(1, 33) : base64UrlDecode(env.VAPID_PUBLIC_KEY.slice(0, 43));
  const yBytes = pubKeyBytes.length === 65 ? pubKeyBytes.slice(33, 65) : base64UrlDecode(env.VAPID_PUBLIC_KEY.slice(43));
  
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256',
    d: env.VAPID_PRIVATE_KEY,
    x: base64UrlEncode(xBytes),
    y: base64UrlEncode(yBytes),
  };
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    utf8Encode(unsignedToken)
  );

  const jwt = `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`;
  const vapidPubKeyUrlSafe = env.VAPID_PUBLIC_KEY;

  return {
    'Authorization': `vapid t=${jwt}, k=${vapidPubKeyUrlSafe}`
  };
}

// ── Helpers ──────────────────────────────────────────────

function utf8Encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createInfo(type: string, clientPubKey: Uint8Array, serverPubKey: Uint8Array): Uint8Array {
  const typeBytes = utf8Encode(type);
  return new Uint8Array([
    ...typeBytes,
    0, clientPubKey.length >> 8, clientPubKey.length & 0xff,
    ...clientPubKey,
    0, serverPubKey.length >> 8, serverPubKey.length & 0xff,
    ...serverPubKey
  ]);
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', key, salt));
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoWithCounter = new Uint8Array([...info, 1]);
  const okm = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, infoWithCounter));
  return okm.slice(0, length);
}
