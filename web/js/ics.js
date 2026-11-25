// Calendar files (.ics). The giỗ export (app.js) and the gathering "Thêm vào lịch" (news-client.js) share these helpers.
export const icsDay = (t) => `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`;
export const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
export function icsCalendar(events) { return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//genealogia//VI\r\n${events}\r\nEND:VCALENDAR\r\n`; }
export function saveIcs(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
