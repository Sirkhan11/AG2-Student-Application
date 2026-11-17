import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Sealing the Blackboard cookies (AES-256-GCM, so the browser can neither read nor change them),
// and the random values the sign-in needs: the state (against forged callbacks) and the PKCE
// verifier and challenge (RFC 7636, so a stolen code is useless). Server only.

/** Bound into every sealed value, so a value sealed for something else can't be passed off as one. */
const PURPOSE = Buffer.from('ag2-blackboard-v1');

/** @param {Buffer} bytes */
const base64url = (bytes) => bytes.toString('base64url');

/**
 * Encrypts and signs a value for a cookie: base64url of IV (12 bytes), ciphertext and tag (16 bytes).
 * @param {unknown} value anything JSON can hold
 * @param {Buffer} key 32 bytes
 */
export function seal(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(PURPOSE);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return base64url(Buffer.concat([iv, body, cipher.getAuthTag()]));
}

/**
 * The value, or null if it was changed, sealed with another key, or isn't a sealed value at all.
 * @param {string | undefined | null} sealed
 * @param {Buffer} key
 * @returns {any}
 */
export function unseal(sealed, key) {
  if (!sealed) return null;
  try {
    const bytes = Buffer.from(sealed, 'base64url');
    if (bytes.length < 12 + 16 + 1) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(PURPOSE);
    decipher.setAuthTag(bytes.subarray(bytes.length - 16));
    const plain = Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    return null;
  }
}

/** A random value for the sign-in's state. */
export const newState = () => base64url(randomBytes(16));

/** A PKCE code verifier: 43 characters from A-Z, a-z, 0-9, "-" and "_". */
export const newVerifier = () => base64url(randomBytes(32));

/** The PKCE code challenge for a verifier (S256: base64url of its SHA-256). @param {string} verifier */
export const challengeFor = (verifier) => base64url(createHash('sha256').update(verifier, 'ascii').digest());
