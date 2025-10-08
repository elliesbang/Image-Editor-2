const CODE_TTL_MS = 5 * 60 * 1000;

const codeStore = globalThis.__ELLIESBANG_CF_CODE_STORE__ || new Map();
if (!globalThis.__ELLIESBANG_CF_CODE_STORE__) {
  globalThis.__ELLIESBANG_CF_CODE_STORE__ = codeStore;
}

const usedEmailStore = globalThis.__ELLIESBANG_CF_USED_EMAILS__ || new Set();
if (!globalThis.__ELLIESBANG_CF_USED_EMAILS__) {
  globalThis.__ELLIESBANG_CF_USED_EMAILS__ = usedEmailStore;
}

export function createVerificationCode(email, code) {
  const expiresAt = Date.now() + CODE_TTL_MS;
  codeStore.set(email.toLowerCase(), { code, expiresAt });
}

export function getVerificationEntry(email) {
  const entry = codeStore.get(email.toLowerCase());
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    codeStore.delete(email.toLowerCase());
    return null;
  }
  return entry;
}

export function consumeVerificationCode(email) {
  codeStore.delete(email.toLowerCase());
}

export function isEmailUsed(email) {
  return usedEmailStore.has(email.toLowerCase());
}

export function markEmailUsed(email) {
  usedEmailStore.add(email.toLowerCase());
}

export function resetVerificationCode(email) {
  codeStore.delete(email.toLowerCase());
}

export function clearExpiredEntries() {
  const now = Date.now();
  for (const [email, entry] of codeStore.entries()) {
    if (entry.expiresAt <= now) {
      codeStore.delete(email);
    }
  }
}
