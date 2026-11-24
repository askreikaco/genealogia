// zh-Hans SCAFFOLD: core direct-line terms, 1-4 generations, Putonghua (Beijing standard) wording; no regional variant.
// reviewed:false, so the UI shows it only behind a setting.
import { directPack } from './direct.js';
export const reviewed = false;
export const term = directPack({
  up: { 1: { m: '父亲', f: '母亲', u: '父母' }, 2: { m: '祖父', f: '祖母', u: '祖父母' }, 3: { m: '曾祖父', f: '曾祖母', u: '曾祖父母' }, 4: { m: '高祖父', f: '高祖母', u: '高祖父母' } },
  maternal: { 2: { m: '外祖父', f: '外祖母', u: '外祖父母' }, 3: { m: '外曾祖父', f: '外曾祖母', u: '外曾祖父母' }, 4: { m: '外高祖父', f: '外高祖母', u: '外高祖父母' } },
  down: { 1: { m: '儿子', f: '女儿', u: '子女' }, 2: { m: '孙子', f: '孙女', u: '孙子女' }, 3: { m: '曾孙', f: '曾孙女', u: '曾孙' }, 4: { m: '玄孙', f: '玄孙女', u: '玄孙' } },
});
