// Nhập từ danh bạ: phone and email from the phone's contacts (Contact Picker API, where the browser has it) or from a
// .vcf / .csv file. Parsing and matching run in this browser (contacts-parse.js): the phone's contacts never leave the device.
// Two uses, one dialog:
//  - a person (the person form's Liên hệ list): the chosen contact's phones and emails are handed to onPick(items) and
//    added as rows. Nothing is saved here; the person form saves with the rest.
//  - the family (Thêm > Nhập danh bạ): every contact is matched to a person by name and each match is confirmed. Only
//    the contacts still missing a phone or email get it, through store.edit (an outbox op and a history entry).
//    contact_public is never touched.
import * as S from './store.js';
import * as FZ from './fuzzy.js';
import { parseContacts, fromPicker, matchContacts } from './contacts-parse.js';
import { esc } from './model.js';
import { toast } from './ui.js';
import { listOf, itemError } from './contacts-model.js';

const pickerOk = () => typeof navigator !== 'undefined' && typeof navigator.contacts?.select === 'function';

// The list items a contact gives: every phone and email (empty ones dropped).
const itemsOf = (c) => [
  ...c.phones.filter(Boolean).map((value) => ({ type: 'phone', value })),
  ...c.emails.filter(Boolean).map((value) => ({ type: 'email', value })),
];
// Family save: a person gets the first phone and the first email only when the list has none of that type yet.
function addMissing(data, c) {
  const have = listOf(data);
  const out = [...have];
  const ok = (type, value) => value && !itemError({ type, value }); // a value the list would refuse is not added
  if (!have.some((x) => x.type === 'phone') && ok('phone', c.phones[0])) out.push({ type: 'phone', value: c.phones[0] });
  if (!have.some((x) => x.type === 'email') && ok('email', c.emails[0])) out.push({ type: 'email', value: c.emails[0] });
  return out.length > have.length ? out : null;
}
const summary = (c) => [c.phones[0], c.emails[0]].filter(Boolean).join(' · ');

// person: { id, name } + onPick(items) for the person form; null for the family import (Thêm > Nhập danh bạ).
export function openContactImport({ fam, person = null, onPick = null, done }) {
  const d = document.createElement('dialog');
  d.className = 'dlg contact-import';
  d.innerHTML = `<form method="dialog" class="form-stack">
    <h2>${person ? 'Nhập từ danh bạ' : 'Nhập danh bạ'}</h2>
    <p class="sub">${person ? `Chọn liên hệ của ${esc(person.name || 'người này')}. Điện thoại và email sẽ được thêm vào danh sách, bạn xem lại rồi bấm Lưu.` : 'Chọn liên hệ rồi xác nhận từng người khớp. Chỉ thêm điện thoại, email còn thiếu.'}</p>
    <div class="ci-body"></div>
    <p class="err" hidden></p>
    <div class="row end ci-acts"><button type="button" class="btn gh" data-cancel>Huỷ</button></div>
  </form>`;
  document.body.append(d);
  const body = d.querySelector('.ci-body');
  const acts = d.querySelector('.ci-acts');
  const err = d.querySelector('.err');
  const close = () => { if (d.open) d.close(); d.remove(); };
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) close(); }); // a tap on the scrim closes
  d.querySelector('[data-cancel]').onclick = close;
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  const busy = (on) => { d.querySelectorAll('button, input').forEach((x) => { x.disabled = on; }); };

  // Step 1: the source. The picker first where the browser has it; the file is the secondary path on every phone.
  const showSource = () => {
    body.innerHTML = `${pickerOk() ? '<button type="button" class="btn" data-pick>Chọn từ danh bạ</button>' : ''}
      <p class="sub ci-file"><label class="linkbtn">Chọn file .vcf hoặc .csv<input type="file" accept=".vcf,.csv,text/vcard,text/csv" hidden data-file></label></p>`;
    acts.innerHTML = '<button type="button" class="btn gh" data-cancel>Huỷ</button>';
    acts.querySelector('[data-cancel]').onclick = close;
    const pick = body.querySelector('[data-pick]');
    if (pick) pick.onclick = async () => {
      err.hidden = true;
      let picked;
      try { picked = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: true }); }
      catch (x) { if (x?.name !== 'AbortError') fail('Không mở được danh bạ.'); return; }
      review(() => fromPicker(picked || []));
    };
    const file = body.querySelector('[data-file]');
    if (file) file.onchange = async () => {
      const f = file.files?.[0]; if (!f) return;
      err.hidden = true;
      try { const text = await f.text(); review(() => parseContacts(text, f.name).contacts); }
      catch (x) { fail(x.message); }
    };
  };

  // Step 2: the review. Contacts are read here; the family's people are matched by name (no network).
  function review(read) {
    let contacts;
    try { contacts = read(); } catch (x) { fail(x.message); showSource(); return; }
    if (!contacts.length) { fail('Không thấy liên hệ nào có điện thoại hoặc email.'); showSource(); return; }
    if (onPick) return reviewPerson(contacts.map((c, i) => ({ ...c, i })));
    return reviewFamily(matchContacts(contacts, S.list(), FZ));
  }

  // One person: pick one contact (radio). Its numbers and emails become rows through onPick.
  function reviewPerson(list) {
    body.innerHTML = `<div class="calm-list ci-list" role="radiogroup" aria-label="Liên hệ trong danh bạ">${list.map((c, i) => `<label class="calm dense">
      <input type="radio" name="pick" value="${i}" ${i === 0 ? 'checked' : ''}>
      <span class="calm-t"><b class="calm-n">${esc(c.name || '(không tên)')}</b><span class="calm-s">${esc(summary(c) || 'Không có điện thoại, email')}</span></span></label>`).join('')}</div>`;
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'btn'; add.textContent = 'Thêm vào danh sách';
    const refresh = () => {
      const c = list[Number(body.querySelector('input[name=pick]:checked')?.value ?? 0)];
      add.disabled = !itemsOf(c).length;
    };
    body.addEventListener('change', refresh);
    acts.querySelector('[data-cancel]').after(add);
    add.onclick = () => {
      const c = list[Number(body.querySelector('input[name=pick]:checked')?.value ?? 0)];
      const items = itemsOf(c);
      if (!items.length) return;
      close();
      onPick(items);
      toast(`Đã thêm ${items.length} mục vào danh sách. Bấm Lưu để giữ lại.`);
    };
    refresh();
  }

  // The family: one row per contact. A checkbox per match; checked by default only for an exact, unique match.
  function reviewFamily(list) {
    const label = (c) => {
      const best = c.candidates[0];
      if (!best) return '<span class="calm-s">Không khớp ai. Bỏ qua.</span>';
      return `<span class="calm-s">${c.auto ? 'Khớp:' : 'Có thể là:'} <b>${esc(best.name)}</b>${summary(c) ? ' · ' + esc(summary(c)) : ''}</span>`;
    };
    body.innerHTML = `<div class="calm-list ci-list">${list.map((c) => `<label class="calm dense">
      <input type="checkbox" name="pick" value="${c.i}" ${c.auto ? 'checked' : ''} ${c.candidates.length ? '' : 'disabled'}>
      <span class="calm-t"><b class="calm-n">${esc(c.name || '(không tên)')}</b>${label(c)}</span></label>`).join('')}</div>`;
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'btn'; save.setAttribute('data-save', '');
    const count = () => body.querySelectorAll('input[name=pick]:checked').length;
    const refresh = () => { const n = count(); save.textContent = n ? `Lưu ${n} liên hệ` : 'Lưu'; save.disabled = !n; };
    body.addEventListener('change', refresh);
    acts.querySelector('[data-cancel]').after(save);
    save.onclick = async () => {
      const picks = [...body.querySelectorAll('input[name=pick]:checked')].map((x) => list[Number(x.value)]);
      busy(true); err.hidden = true;
      let saved = 0; let skipped = 0;
      try {
        for (const c of picks) {
          const pid = c.candidates[0].id;
          const next = addMissing(S.get(pid)?.data, c);
          if (!next) { skipped++; continue; }
          await S.edit(pid, { contacts: next }, fam); // sequential: a second contact for the same person sees the first one's list
          saved++;
        }
      } catch (x) { busy(false); fail(x.message || 'Không lưu được.'); return; }
      close();
      toast(`Đã lưu ${saved} liên hệ${skipped ? `, bỏ qua ${skipped} vì đã có điện thoại, email` : ''}.`);
      done?.();
    };
    refresh();
  }

  showSource();
  d.showModal();
  return d;
}
