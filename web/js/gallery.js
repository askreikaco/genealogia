// Gallery per person (G1): rules shared by the page and the server (server/gallery.js imports this file).
// A person has up to GALLERY_MAX photos; each has an optional caption and year; one is the profile photo
// (persons.data.photo mirrors it). Photos are the event photos' store: http(s) links or uploads (/api/photos/<24 hex>).
import { GAL_VI } from './gallery-vi.js';

export const GALLERY_MAX = 20;
export const CAPTION_MAX = 200;
export const GALLERY_YEAR_MIN = 1800;

export function validGalleryUrl(u) {
  return typeof u === 'string' && u.length <= 2000 && (/^https?:\/\//i.test(u) || /^\/api\/photos\/[0-9a-f]{24}$/.test(u));
}

// The editor's values: { value: { caption, year } } or { error }. year '' or null means no year.
export function cleanGalleryInput(input, now = new Date().getFullYear()) {
  const b = input && typeof input === 'object' ? input : {};
  const caption = String(b.caption ?? '').trim();
  if (caption.length > CAPTION_MAX) return { error: GAL_VI.caption_long };
  let year = b.year;
  if (year === '' || year === null || year === undefined) year = null;
  else {
    year = typeof year === 'string' ? Number(year.trim()) : year;
    if (!Number.isInteger(year) || year < GALLERY_YEAR_MIN || year > now) return { error: GAL_VI.year_bad };
  }
  return { value: { caption, year } };
}
