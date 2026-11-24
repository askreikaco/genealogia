// "Có thể là cùng một người" on the review page (server: match-routes.js). The match job stores pairs of people in two
// trees who may be one person, with the reasons; an editor of either tree answers "Không phải" or "Đề nghị liên kết".
// A proposal goes through the normal links flow, so the other tree still decides (owner/admin of both: linked at once).
import { esc } from './model.js';
import { toast } from './ui.js';

async function getJson(url, opts) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không tải được gợi ý.');
  return j;
}
const post = (url, fam) => getJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family: fam }) });
const who = (name, yrs) => `<b>${esc(name || '(chưa có tên)')}</b>${yrs ? ` <span class="sub">(${esc(yrs)})</span>` : ''}`;

function rowHtml(s, fam, href) {
  return `<div class="rv mt-row" data-mt-row="${s.id}">
    <p><a href="${esc(href(fam, s.person))}">${who(s.name, s.years)}</a> ở cây này <span aria-hidden="true">⇄</span><span class="vh">và</span> ${who(s.other_name, s.other_years)} ở cây <b>${esc(s.other_label)}</b></p>
    <p class="sub mt-why"><span class="tag gray sm">khớp ${Math.round(s.score * 100)}%</span> ${s.reasons.map(esc).join(' · ')}</p>
    <div class="row end"><button type="button" class="btn ter sm" data-mt="dismiss" data-id="${s.id}" data-fam="${esc(fam)}">Không phải</button><button type="button" class="btn sm" data-mt="link" data-id="${s.id}" data-fam="${esc(fam)}">Đề nghị liên kết</button></div></div>`;
}
// Draws the section before `before` for the families in `fams` (nothing when nothing waits or the viewer is no
// editor there); redraws after an answer. href(fam, personId) -> the person's link.
export async function reviewSection(main, before, fams, href) {
  const lists = await Promise.all(fams.map((f) => getJson(`/api/match-suggestions?family=${encodeURIComponent(f)}`).then((j) => (j.items || []).map((s) => ({ s, f }))).catch(() => [])));
  if (!before.isConnected) return;
  const seen = new Set(); const rows = [];
  for (const { s, f } of lists.flat()) { if (seen.has(s.id)) continue; seen.add(s.id); rows.push(rowHtml(s, f, href)); }
  let box = main.querySelector('#mtpend');
  if (!box) { box = document.createElement('div'); box.id = 'mtpend'; before.parentNode.insertBefore(box, before); }
  box.innerHTML = rows.length ? `<section class="cd mt-pend"><h2>Có thể là cùng một người</h2><p class="sub">Gợi ý tự động từ tên, năm sinh, năm mất, cha mẹ, vợ chồng và nơi chốn. Không có gì được nối nếu không ai đồng ý.</p>${rows.join('')}</section>` : '';
  box.onclick = async (e) => {
    const b = e.target.closest('[data-mt]'); if (!b) return;
    b.disabled = true;
    try {
      const r = await post(`/api/match-suggestions/${b.dataset.id}/${b.dataset.mt}`, b.dataset.fam);
      toast(b.dataset.mt === 'dismiss' ? 'Đã bỏ gợi ý.' : r.status === 'accepted' ? 'Đã liên kết.' : r.status === 'exists' ? 'Hai người này đã liên kết (hoặc đang chờ).' : 'Đã gửi đề nghị liên kết. Cây kia sẽ duyệt.');
      reviewSection(main, before, fams, href);
    } catch (x) { b.disabled = false; toast(x.message); }
  };
}
