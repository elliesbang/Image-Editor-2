const encoder = new TextEncoder();

function base64urlEncodeFromString(input) {
  let binary = '';
  const bytes = encoder.encode(input);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlEncodeBuffer(buffer) {
  let binary = '';
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecodeToUint8Array(input) {
  let normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4 !== 0) {
    normalized += '=';
  }
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signJwt(payload, secret, expiresInSeconds = 60 * 60) {
  if (!secret) {
    throw new Error('JWT secret is not configured.');
  }
  const header = { alg: 'HS256', typ: 'JWT' };
  const issuedAt = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: issuedAt,
    exp: issuedAt + expiresInSeconds,
  };
  const encodedHeader = base64urlEncodeFromString(JSON.stringify(header));
  const encodedPayload = base64urlEncodeFromString(JSON.stringify(fullPayload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(unsigned));
  const encodedSignature = base64urlEncodeBuffer(signature);
  return `${unsigned}.${encodedSignature}`;
}

export async function verifyJwt(token, secret) {
  if (!secret) {
    throw new Error('JWT secret is not configured.');
  }
  if (!token || typeof token !== 'string') {
    throw new Error('토큰이 필요합니다.');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('유효하지 않은 토큰 형식입니다.');
  }
  const [encodedHeader, encodedPayload, signature] = parts;
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const key = await importKey(secret);
  const signatureBytes = base64urlDecodeToUint8Array(signature);
  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(unsigned));
  if (!valid) {
    throw new Error('토큰 서명이 유효하지 않습니다.');
  }
  const payloadBytes = base64urlDecodeToUint8Array(encodedPayload);
  const payloadString = new TextDecoder().decode(payloadBytes);
  const payload = JSON.parse(payloadString);
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    throw new Error('토큰이 만료되었습니다.');
  }
  return payload;
}
