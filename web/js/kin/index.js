// Kinship terms. term(desc, {locale, region, layer, deceased}) with the fallback chain locale -> en.
// desc comes from kinPath() (engine.js) or lineDesc(). Region: 'bac' = the national standard (default), 'nam' = Southern wording.
import * as vi from './packs/vi.js';
import * as en from './packs/en.js';
import * as zhHans from './packs/zh-Hans.js';
import * as zhHant from './packs/zh-Hant.js';
import * as ja from './packs/ja.js';
import * as ko from './packs/ko.js';

export { kinPath, lineDesc } from './engine.js';

const PACKS = { vi, en, 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko };
export const KIN_REGION_KEY = 'kinRegion'; // per-user pref 'Cách gọi': 'chuan' (default, standard = 'bac' names) | 'nam'

// The region to use, from the user's own choice only: 'nam' gives Southern wording; anything else (no choice, 'chuan',
// or an unknown value) gives the national standard, 'bac'. No family default, no locale rule.
export function resolveRegion(pref) {
  return pref === 'nam' ? 'nam' : 'bac';
}

export function term(desc, opts = {}) {
  if (!desc) return '';
  const { locale = 'vi', region = 'bac', layer = 'everyday', deceased = false } = opts;
  for (const loc of [...new Set([locale, 'en'])]) {
    const pack = PACKS[loc];
    if (!pack) continue;
    const t = pack.term(desc, { region, layer, deceased });
    if (t) return t;
  }
  return '';
}

export function reviewed(locale) { return !!PACKS[locale]?.reviewed; }
export function degree(desc, locale = 'ko') { return PACKS[locale]?.degree ? PACKS[locale].degree(desc) : null; }
