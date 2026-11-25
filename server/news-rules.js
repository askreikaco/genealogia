// Tin họ rules (pure, no DB): the Vietnam calendar day, days until a gathering, which reminders are due, and RSVP totals.
// Used by server/news.js. Reminders: 3 days and 1 day before a gathering, each sent once (post_reminders).
'use strict';
const DAY = 864e5;
const STAGES = [3, 1];
// Calendar day in Vietnam (UTC+7) as YYYY-MM-DD.
const vnDate = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);
// Whole days from one YYYY-MM-DD to another.
const daysBetween = (fromIso, toIso) => Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / DAY);
// The reminder stages that are due for a gathering `daysLeft` days away (0 = today), largest first.
const dueStages = (daysLeft) => STAGES.filter((s) => daysLeft >= 0 && daysLeft <= s);
// Totals from rows { answer, n }: people who said yes and people who said maybe (counts summed).
function summarize(rows) {
  const t = { yes: 0, maybe: 0, no: 0 };
  for (const r of rows) if (r.answer in t) t[r.answer] += Number(r.n || 0);
  return t;
}
module.exports = { DAY, STAGES, vnDate, daysBetween, dueStages, summarize };
