// Consent for an AI connection (design: AiConsent). One screen: family rows, one level group, a bottom bar.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// One level per choice; a level stands for its scope (write includes suggest and read on the server).
const LEVELS = [['read', 'Xem'], ['suggest', 'Xem và góp ý'], ['write', 'Sửa (theo quyền của bạn)']];

function show(id) { for (const x of ['sign', 'ask', 'msg', 'bar']) $('#' + x).classList.toggle('hide', x !== id && !(id === 'ask' && x === 'bar')); }
async function load() {
  let r; let j;
  try { r = await fetch('/api/oauth/request', { cache: 'no-store' }); j = await r.json(); }
  catch { $('#msg').textContent = 'Không kết nối được máy chủ. Thử lại.'; return show('msg'); }
  if (!r.ok) { $('#msg').textContent = j.error || 'Yêu cầu này không còn hiệu lực.'; return show('msg'); }
  $('#cname').textContent = j.client_name;
  if (!j.signed_in) return show('sign');
  show('ask');
  $('#fams').insertAdjacentHTML('beforeend', j.families.map((f, i) =>
    `<label class="row"><input type="radio" name="fam" value="${esc(f.slug)}" ${i === 0 ? 'checked' : ''}> ${esc(f.name)}</label>`).join('') || '<p class="cs-err">Bạn chưa là thành viên dòng họ nào.</p>');
  const offered = LEVELS.filter(([v]) => j.scopes.includes(v));
  $('#levels').insertAdjacentHTML('beforeend', offered.map(([v, l], i) =>
    `<label class="row"><input type="radio" name="level" value="${v}" ${i === 0 ? 'checked' : ''}> ${esc(l)}</label>`).join(''));
  if (!j.families.length) $('#ok').disabled = true;
}
async function decide(decision) {
  const fam = document.querySelector('input[name=fam]:checked')?.value;
  const level = document.querySelector('input[name=level]:checked')?.value;
  $('#err').textContent = '';
  if (decision === 'allow' && (!fam || !level)) { $('#err').textContent = 'Chọn dòng họ và quyền.'; return; }
  $('#ok').disabled = true;
  const r = await fetch('/api/oauth/consent', { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ family: fam, scopes: decision === 'allow' ? [level] : [], decision }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.redirect) { $('#err').textContent = j.error || 'Không lưu được. Thử lại.'; $('#ok').disabled = false; return; }
  location.href = j.redirect;
}
$('#ask').addEventListener('submit', (e) => { e.preventDefault(); decide('allow'); });
$('#no').addEventListener('click', () => decide('deny'));
load();
