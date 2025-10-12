const encoder = new TextEncoder()
const SALT_LENGTH = 16
const ITERATIONS = 120_000
const KEY_LENGTH = 32
const DIGEST = 'SHA-256'

function toBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function fromBase64(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function deriveKey(code, salt, iterations = ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveBits'])
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: DIGEST,
    },
    keyMaterial,
    KEY_LENGTH * 8
  )
  return new Uint8Array(derivedBits)
}

export async function hashCode(code) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const derived = await deriveKey(code, salt)
  const saltEncoded = toBase64(salt)
  const hashEncoded = toBase64(derived)
  return `bcrypt$pbkdf2$${ITERATIONS}$${saltEncoded}$${hashEncoded}`
}

export async function verifyCode(code, storedHash) {
  if (typeof storedHash !== 'string') return false
  const parts = storedHash.split('$')
  if (parts.length !== 5 || parts[0] !== 'bcrypt' || parts[1] !== 'pbkdf2') {
    return false
  }

  const iterations = Number.parseInt(parts[2], 10)
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false
  }

  const salt = fromBase64(parts[3])
  const expected = fromBase64(parts[4])
  const actual = await deriveKey(code, salt, iterations)

  if (actual.length !== expected.length) {
    return false
  }

  let mismatch = 0
  for (let i = 0; i < actual.length; i += 1) {
    mismatch |= actual[i] ^ expected[i]
  }

  return mismatch === 0
}
