// Passkeys in the browser: WebAuthn through the vendored @simplewebauthn/browser (UMD, no CDN). Shared by the sign-in dialog
// (sign in with any passkey, no email typed) and the Account page (add one, remove one). The caller passes its own request
// function, so a stale sign-in ({ reauth: true }) reaches the page that can ask the person to confirm.
let swaPromise = null;
function loadWebAuthn() {
  if (window.SimpleWebAuthnBrowser) return Promise.resolve(window.SimpleWebAuthnBrowser);
  if (!swaPromise) swaPromise = new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = '/vendor/simplewebauthn-browser.umd.min.js';
    s.onload = () => ok(window.SimpleWebAuthnBrowser); s.onerror = () => bad(new Error('Không tải được phần vân tay.'));
    document.head.append(s);
  });
  return swaPromise;
}
// This browser can sign in with a passkey (a passkey on a phone nearby counts).
export async function canUsePasskeys() {
  try { return !!window.PublicKeyCredential && (await loadWebAuthn()).browserSupportsWebAuthn(); } catch { return false; }
}
// Adding one needs fingerprint, Face ID or Windows Hello on this device. A security key alone is not "vân tay / Face ID".
export async function canAddPasskey() {
  try { return (await canUsePasskeys()) && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}
// The browser's own cancel message is English; say it plainly once.
async function ceremony(fn) {
  try { return await fn(); } catch (e) {
    if (e && e.name === 'NotAllowedError') throw new Error('Đã hủy. Thử lại khi sẵn sàng.');
    throw e;
  }
}
// Adds a passkey to the signed-in account. post(url, body) is the page's POST helper; famQs is "?family=<slug>" or ''.
export async function addPasskey(post, famQs = '') {
  const SWA = await loadWebAuthn();
  const s = await post('/api/passkey/register/options' + famQs, {});
  const response = await ceremony(() => SWA.startRegistration({ optionsJSON: s.options }));
  await post('/api/passkey/register/verify' + famQs, { ch: s.ch, response });
}
// Signs in with any passkey of this device or nearby: the server finds the account from the passkey itself.
export async function signInWithPasskey(post) {
  const SWA = await loadWebAuthn();
  const s = await post('/api/passkey/login/options', {});
  const response = await ceremony(() => SWA.startAuthentication({ optionsJSON: s.options }));
  await post('/api/passkey/login/verify', { ch: s.ch, response });
}
