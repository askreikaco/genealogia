// zh-Hant SCAFFOLD: core direct-line terms, 1-4 generations, traditional-character standard wording (the Taiwan
// standard-Mandarin forms; a Hong Kong or Cantonese variant would be a separate pack). reviewed:false.
import { directPack } from './direct.js';
export const reviewed = false;
export const term = directPack({
  up: { 1: { m: '父親', f: '母親', u: '父母' }, 2: { m: '祖父', f: '祖母', u: '祖父母' }, 3: { m: '曾祖父', f: '曾祖母', u: '曾祖父母' }, 4: { m: '高祖父', f: '高祖母', u: '高祖父母' } },
  maternal: { 2: { m: '外祖父', f: '外祖母', u: '外祖父母' }, 3: { m: '外曾祖父', f: '外曾祖母', u: '外曾祖父母' }, 4: { m: '外高祖父', f: '外高祖母', u: '外高祖父母' } },
  down: { 1: { m: '兒子', f: '女兒', u: '子女' }, 2: { m: '孫子', f: '孫女', u: '孫子女' }, 3: { m: '曾孫', f: '曾孫女', u: '曾孫' }, 4: { m: '玄孫', f: '玄孫女', u: '玄孫' } },
});
