// The shared choice row: three equal outlined buttons, the colored icon above the word, the chosen one filled.
// Used by the vote card (council.js) and the RSVP card (news-client.js). Classes and CSS are the vc-* ones in app.css.
// items: [{ word, icon, tone: 'yes' | 'no' | 'abs', on, attrs }]. icon: the caller's icon function (default: the set below).
const P = {
  calendar: '<rect x="3" y="5" width="18" height="16"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};
export const ico = (n, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true">${P[n] || ''}</svg>`;

export const choiceRow = ({ label, items, icon = ico }) => `<div class="vc-row" role="group" aria-label="${label}">${items.map((it) =>
  `<button type="button" class="vc-ch vc-ch-${it.tone}${it.on ? ' on' : ''}" ${it.attrs || ''} aria-pressed="${!!it.on}">${icon(it.icon)}<span class="vc-w">${it.word}</span></button>`).join('')}</div>`;
