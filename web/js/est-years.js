// Estimated years shown where a birth (or a death, when known dead or deceased by rule) year is missing: "≈ 1880–1910 ·
// ước tính" (GEDCOM EST / Ancestry "abt."). Pure (no DOM, no store): the engine result of estimate-graph.js per person.
// Shown only when the range is at most SHOW_MAX_WIDTH years, never for a conflict, never for a hidden living person.
// Never written to the data and never exported (GEDCOM and the book show the stored years only).
import { SHOW_MAX_WIDTH } from './estimate-graph.js';
import { NEEDS_VI } from './needs-vi.js';

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// "1880" or "1880–1910" (a single year when the range is one year wide).
export const estRange = (lo, hi) => (lo === hi ? String(lo) : `${lo}–${hi}`);

// The basis lines a reader sees: one short line each, without the lifespan defaults (they are not evidence).
const LIFESPAN_LINE = /^(sống tối đa 100 năm|đến hôm nay|quy tắc: sinh hơn 110 năm)/;
export const shownBasis = (list) => (list || []).filter((t) => !LIFESPAN_LINE.test(t));

// The estimates to show for one person: [{ kind: 'born'|'died', lo, hi, range, basis }]. d: the stored person data,
// e: the engine's result for this person (estimateFamily / estimateFamilyCached). [] when nothing is shown.
export function estItems(d, e) {
  if (!d || !e || d.hidden_living || e.conflict) return [];
  const ok = (r) => !!r && r[1] - r[0] <= SHOW_MAX_WIDTH;
  const out = [];
  if (!e.bornKnown && ok(e.born)) out.push({ kind: 'born', lo: e.born[0], hi: e.born[1], range: estRange(e.born[0], e.born[1]), basis: shownBasis(e.bornBasis) });
  // a death year is shown only when another rule bounds it (relatives, own events, notes, age at death): never from the
  // lifespan default alone (the 100-year limit, the "110 years" rule). Without that evidence the C1 item covers it.
  if (!e.diedKnown && (e.dead || e.ruleDead) && e.diedEvidence && ok(e.died)) out.push({ kind: 'died', lo: e.died[0], hi: e.died[1], range: estRange(e.died[0], e.died[1]), basis: shownBasis(e.diedBasis) });
  return out;
}

// The short text of one estimate: "≈ 1880–1910", "mất ≈ 1950", and "sinh ≈ …" when a death year is written too (so the
// reader knows which year it is). hasOther: the person has a stored year of the other kind.
export function estLabel(item, hasOther = false) {
  const pre = item.kind === 'died' ? `${NEEDS_VI.est_died_prefix} ` : hasOther ? `${NEEDS_VI.est_born_prefix} ` : '';
  return `${pre}≈ ${item.range}`;
}

// Plain text for a list line or an SVG label: "≈ 1880–1910 · ước tính" ('' when none).
export function estPlain(items, hasOther = false) {
  return items.map((it) => `${estLabel(it, hasOther)} · ${NEEDS_VI.est_label}`).join(' · ');
}

// HTML for a list row or a profile: the muted range, then "ước tính" with the basis as the tooltip (title). The
// profile adds a tap-to-open basis (tip: true) through the DS infoTip, given by the caller, so this file stays DOM-free.
export function estHtml(items, { hasOther = false } = {}) {
  return items.map((it) => `<span class="est-yr">${escHtml(estLabel(it, hasOther))} · <span class="est-tag" title="${escHtml(NEEDS_VI.basis + ': ' + it.basis.join('; '))}">${escHtml(NEEDS_VI.est_label)}</span></span>`).join(' · ');
}

// The basis as one sentence for a tooltip or an infoTip: "Dựa trên: …".
export const basisText = (it) => `${NEEDS_VI.basis}: ${it.basis.join('; ')}.`;
