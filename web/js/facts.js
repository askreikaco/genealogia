// Thông tin facts card on the person page (one card, labelled groups). Plain ES module, no imports (unit-tested in Node).
// A group is { title, rows, basic? }; a row is [label, valueHtml]. Empty rows are dropped by the caller.
// Life basics (basic: true: Sinh, Mất) always go under the first group, "Tóm tắt". So does any other group whose only
// row repeats its header ("Sinh" over "Sinh 874"): a header that says the same thing as its one row is noise.
export const SUMMARY = 'Tóm tắt';
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
// The header repeats the row's label: same text, or a header that starts with the label ("Nơi sống & nghề" over "Nơi sống").
const repeats = (title, label) => { const t = norm(title); const l = norm(label); return !!l && (t === l || t.startsWith(l + ' ') || t.startsWith(l + ' &')); };

export function factGroups(groups) {
  const summary = []; const out = [];
  for (const g of groups) {
    const rows = (g.rows || []).filter(Boolean);
    if (!rows.length) continue;
    if (g.basic || (rows.length === 1 && repeats(g.title, rows[0][0]))) summary.push(...rows);
    else out.push({ title: g.title, rows });
  }
  return summary.length ? [{ title: SUMMARY, rows: summary }, ...out] : out;
}

// The Tóm tắt group is the card's title: the same markup as the Quan hệ section title (.relhead h2, app.css). Other groups keep
// the small uppercase label (.tgen).
export function factCardHtml(groups) {
  if (!groups.length) return '';
  const head = (g) => (g.title === SUMMARY ? `<div class="relhead"><h2>${g.title}</h2></div>` : `<div class="tgen" style="--d:0">${g.title}</div>`);
  return `<div class="cd factcard">${groups.map((g) => `<div class="fgrp">${head(g)}<dl class="facts">${g.rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>`).join('')}</div>`;
}

// The "(ngày sinh chỉ hiện khi đăng nhập)" hint: privacy applies to the living only. Not for a member, a dead person
// (or one with a death date), or a person born more than 110 years before `year`. An unreadable year still shows it.
export function bornHintShown({ born, dead, member }, year) {
  if (member || dead || !born) return false;
  const y = parseInt(String(born).match(/\d+/)?.[0] ?? '', 10);
  return Number.isNaN(y) || year - y <= 110;
}
