/**
 * PrintFarm Cloud - Cryptographic Helpers
 *
 * Utility functions for encryption, hashing, and secure random generation
 * using the Web Crypto API available in Cloudflare Workers.
 */

import { nanoid } from "nanoid";

// =============================================================================
// ID GENERATION
// =============================================================================

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Generate a short random ID using nanoid
 * Default length is 21 characters
 */
export function generateId(length = 21): string {
  return nanoid(length);
}

/**
 * Generate a short alphanumeric ID (URL-safe)
 */
export function generateShortId(): string {
  return nanoid(12);
}

/**
 * Generate a secure random hex string
 */
export function generateHex(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// =============================================================================
// PASSWORD HASHING (PBKDF2)
// =============================================================================

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const HASH_LENGTH = 32;

/**
 * Hash a password using PBKDF2-SHA256
 * Returns format: $pbkdf2$iterations$salt$hash (all base64)
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  // Generate random salt
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);

  // Import password as key
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // Derive hash
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    HASH_LENGTH * 8
  );

  // Encode to base64
  const saltBase64 = btoa(String.fromCharCode(...salt));
  const hashBase64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

  return `$pbkdf2$${PBKDF2_ITERATIONS}$${saltBase64}$${hashBase64}`;
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  try {
    // Parse the hash string
    const parts = hash.split("$");
    if (parts.length !== 5 || parts[1] !== "pbkdf2") {
      return false;
    }

    const iterationsStr = parts[2];
    const saltStr = parts[3];
    const hashStr = parts[4];

    if (!iterationsStr || !saltStr || !hashStr) {
      return false;
    }

    const iterations = parseInt(iterationsStr, 10);
    const salt = Uint8Array.from(atob(saltStr), (c) => c.charCodeAt(0));
    const storedHash = Uint8Array.from(atob(hashStr), (c) => c.charCodeAt(0));

    // Derive hash with same parameters
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      passwordBuffer,
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const derivedBuffer = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      storedHash.length * 8
    );

    const derivedHash = new Uint8Array(derivedBuffer);

    // Constant-time comparison
    return timingSafeEqual(derivedHash, storedHash);
  } catch {
    return false;
  }
}

// =============================================================================
// AES-256-GCM ENCRYPTION
// =============================================================================

const AES_KEY_LENGTH = 256;
const AES_IV_LENGTH = 12;
const AES_TAG_LENGTH = 128;

/**
 * Encrypt data using AES-256-GCM
 * Returns format: iv$ciphertext (both base64)
 */
export async function encryptAES256GCM(
  plaintext: string,
  password: string
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // Derive key from password
  const key = await deriveAESKey(password);

  // Generate random IV
  const iv = new Uint8Array(AES_IV_LENGTH);
  crypto.getRandomValues(iv);

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
      tagLength: AES_TAG_LENGTH,
    },
    key,
    data
  );

  // Encode to base64
  const ivBase64 = btoa(String.fromCharCode(...iv));
  const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

  return `${ivBase64}$${ciphertextBase64}`;
}

/**
 * Decrypt data using AES-256-GCM
 */
export async function decryptAES256GCM(
  encrypted: string,
  password: string
): Promise<string> {
  const parts = encrypted.split("$");
  if (parts.length !== 2) {
    throw new Error("Invalid encrypted data format");
  }

  const ivPart = parts[0];
  const ciphertextPart = parts[1];

  if (!ivPart || !ciphertextPart) {
    throw new Error("Invalid encrypted data format");
  }

  const iv = Uint8Array.from(atob(ivPart), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ciphertextPart), (c) => c.charCodeAt(0));

  // Derive key from password
  const key = await deriveAESKey(password);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
      tagLength: AES_TAG_LENGTH,
    },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * Derive an AES key from a password using PBKDF2
 */
async function deriveAESKey(password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  // Use a fixed salt for key derivation (this is ok because the password/secret is unique)
  const salt = encoder.encode("printfarm-aes-salt-v1");

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: AES_KEY_LENGTH,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

// =============================================================================
// HMAC HELPERS
// =============================================================================

/**
 * Generate HMAC-SHA256 signature
 */
export async function generateHMAC(
  message: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, msgData);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Verify HMAC-SHA256 signature
 */
export async function verifyHMAC(
  message: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const msgData = encoder.encode(message);
    const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));

    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    return crypto.subtle.verify("HMAC", key, sigBytes, msgData);
  } catch {
    return false;
  }
}

/**
 * Generate a hub authentication signature
 * Used for ESP32 hub to authenticate with the cloud
 */
export async function generateHubSignature(
  hubId: string,
  timestamp: number,
  secret: string
): Promise<string> {
  const message = `${hubId}:${timestamp}`;
  return generateHMAC(message, secret);
}

/**
 * Verify a hub authentication signature
 */
export async function verifyHubSignature(
  hubId: string,
  timestamp: number,
  signature: string,
  secret: string,
  maxAge = 300 // 5 minutes
): Promise<boolean> {
  // Check timestamp is not too old
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > maxAge) {
    return false;
  }

  const message = `${hubId}:${timestamp}`;
  return verifyHMAC(message, signature, secret);
}

// =============================================================================
// SHA-256 HASHING
// =============================================================================

/**
 * Generate SHA-256 hash of data
 */
export async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/**
 * Generate SHA-256 hash as hex string
 */
export async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Constant-time comparison of two byte arrays
 * Prevents timing attacks
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    const aVal = a[i];
    const bVal = b[i];
    if (aVal !== undefined && bVal !== undefined) {
      result |= aVal ^ bVal;
    }
  }

  return result === 0;
}

/**
 * Generate a secure random token for sessions/API keys
 */
export function generateSecureToken(length = 32): string {
  return generateHex(length);
}

/**
 * Generate an API key with prefix
 * Format: prefix_base64random
 */
export function generateApiKey(prefix = "pk"): string {
  const random = generateHex(24);
  return `${prefix}_${random}`;
}
