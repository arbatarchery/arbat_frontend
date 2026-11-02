// Server-only helper. No browser imports or trust in browser user/role objects.
// Public contract: https://statetty.com/assets/buddy/modules/auth/auth-service-contract.md
const SESSION_URL = 'https://api.statetty.com/api/buddy/auth/session';
const MAX_RESPONSE_BYTES = 16384;

export class BuddyIdentityError extends Error {
  constructor() {
    super('Buddy session could not be verified');
    this.name = 'BuddyIdentityError';
  }
}

export async function verifyBuddyAccessToken(token, { fetchImpl = globalThis.fetch, timeoutMs = 5000, includeProfile = false } = {}) {
  if (typeof token !== 'string' || token.length > 8192 || !/^[A-Za-z0-9._~-]+$/.test(token)) {
    throw new BuddyIdentityError();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
    const response = await fetchImpl(SESSION_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) {
      throw new BuddyIdentityError();
    }
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new BuddyIdentityError();
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const subject = data?.user?.id;
    if (data?.ok !== true || data?.authenticated !== true || typeof subject !== 'string' || !subject.trim() || subject.length > 256) {
      throw new BuddyIdentityError();
    }
    // Roles, email and display name are not authorization input. Map issuer +
    // subject to a server-provisioned Supabase principal in a later claim service.
    return Object.freeze({ issuer: 'https://api.statetty.com', subject,...(includeProfile?{displayName:typeof data.user.name==='string'?data.user.name.trim().slice(0,200):null,verifiedEmail:typeof data.user.email==='string'?data.user.email.trim().toLowerCase().slice(0,254):null}:{}) });
  } catch {
    // Never include the bearer token, server response, or upstream exception.
    throw new BuddyIdentityError();
  } finally {
    clearTimeout(timer);
    if (reader) { try { await reader.cancel(); } catch {} }
  }
}
