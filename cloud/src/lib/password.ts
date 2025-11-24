/**
 * Password Hashing Utilities
 *
 * PBKDF2-based password hashing compatible with Cloudflare Workers.
 * These functions are used by both custom registration and Better Auth.
 */

/**
 * Hash a password using PBKDF2
 * Format: salt:hash (both base64 encoded)
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const key = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256
  );

  // Convert to base64 for storage
  const saltBase64 = btoa(String.fromCharCode(...salt));
  const hashBase64 = btoa(String.fromCharCode(...new Uint8Array(hash)));

  return `${saltBase64}:${hashBase64}`;
}

/**
 * Verify a password against a stored hash
 *
 * @param data - Object containing hash and password (Better Auth compatible signature)
 * @returns true if password matches
 */
export async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
  const { hash: storedHash, password } = data;

  const [saltBase64, hashBase64] = storedHash.split(":");
  if (!saltBase64 || !hashBase64) {
    return false;
  }

  // Decode the stored salt from base64
  const salt = Uint8Array.from(atob(saltBase64), (c) => c.charCodeAt(0));

  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const key = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256
  );

  // Convert computed hash to base64 for comparison
  const computedHashBase64 = btoa(String.fromCharCode(...new Uint8Array(hash)));

  return computedHashBase64 === hashBase64;
}
