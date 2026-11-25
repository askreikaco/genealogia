// A living person as a non-member sees them: the server (core.js publicView) sends hidden_living with name null.
// Every place a name renders goes through nameOf, so the label is one string (booktext.js living2) in every view.
import { tx } from './booktext.js';

export const isHiddenLiving = (p) => !!(p && p.hidden_living);
export const nameOf = (p, lang = 'vi') => (isHiddenLiving(p) ? tx('living2', lang) : (p && p.name) || '');
