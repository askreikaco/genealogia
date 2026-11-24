// ko SCAFFOLD: core direct-line terms, 1-4 generations, Seoul 표준어 wording; no regional variant. Plus degree(): 촌수 (blood and adopted/step lineage; in-laws have none here).
// reviewed:false, so the UI shows it only behind a setting.
import { directPack } from './direct.js';
export const reviewed = false;
export const term = directPack({
  up: { 1: { m: '아버지', f: '어머니', u: '부모' }, 2: { m: '할아버지', f: '할머니', u: '조부모' }, 3: { m: '증조할아버지', f: '증조할머니', u: '증조부모' }, 4: { m: '고조할아버지', f: '고조할머니', u: '고조부모' } },
  maternal: { 2: { m: '외할아버지', f: '외할머니', u: '외조부모' }, 3: { m: '외증조할아버지', f: '외증조할머니', u: '외증조부모' }, 4: { m: '외고조할아버지', f: '외고조할머니', u: '외고조부모' } },
  down: { 1: { m: '아들', f: '딸', u: '자녀' }, 2: { m: '손자', f: '손녀', u: '손자녀' }, 3: { m: '증손자', f: '증손녀', u: '증손자녀' }, 4: { m: '현손자', f: '현손녀', u: '현손자녀' } },
});
// 촌수: the number of links between the two people (parent-child = 1, siblings = 2, cousins = 4). Null for in-laws.
export function degree(d) {
  if (!d || d.kind === 'inlaw' || !d.collateralDegree) return null;
  return `${d.collateralDegree}촌`;
}
