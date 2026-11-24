// ja SCAFFOLD: core direct-line terms, 1-4 generations, Tokyo standard wording (hyōjungo); no regional variant. reviewed:false.
import { directPack } from './direct.js';
export const reviewed = false;
export const term = directPack({
  up: { 1: { m: '父', f: '母', u: '両親' }, 2: { m: '祖父', f: '祖母', u: '祖父母' }, 3: { m: '曽祖父', f: '曽祖母', u: '曽祖父母' }, 4: { m: '高祖父', f: '高祖母', u: '高祖父母' } },
  maternal: { 2: { m: '外祖父', f: '外祖母', u: '外祖父母' }, 3: { m: '外曽祖父', f: '外曽祖母', u: '外曽祖父母' }, 4: { m: '外高祖父', f: '外高祖母', u: '外高祖父母' } },
  down: { 1: { m: '息子', f: '娘', u: '子' }, 2: { m: '孫', f: '孫', u: '孫' }, 3: { m: '曽孫', f: '曽孫', u: '曽孫' }, 4: { m: '玄孫', f: '玄孫', u: '玄孫' } },
});
