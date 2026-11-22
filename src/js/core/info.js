// Stage 11: country info and emergency (data/info/<id>.json). Pure functions, no DOM, no network.
// Every item carries one of four statuses. A value is shown as verified only with a source and the date it was checked;
// an item not verified yet keeps no value at all (nothing made up is stored), and a hidden item is never shown.
import { isIsoDate } from './trip.js';

export const INFO_STATUSES = ['verified-official', 'user-provided', 'unverified', 'hidden'];
export const NOTE_MAX = 1000;
/** No travel insurance bought yet: these stay "not verified" until checked against the policy. */
export const INSURANCE_FIELDS = ['insurance', 'preapproval', 'payment'];
const KINDS = ['phone', 'address', 'text', 'url'];
const PRIORITIES = ['high', 'normal', 'low'];
const THAI = /[฀-๿]/;
const PHONE = /^\+?\d[\d\s-]*$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasValue = (v) => (typeof v === 'string' && v.trim() !== '') || (isObj(v) && Object.values(v).some((x) => typeof x === 'string' && x.trim()));
const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const datedOk = (d, today) => isIsoDate(d) && (!isIsoDate(today) || d <= today);

/** Every item in the file with a path, for checks and for the sources table. */
export function allItems(data) {
  const out = [];
  for (const x of data?.emergency ?? []) out.push({ ...x, path: `emergency.${x.key}` });
  for (const c of data?.contacts ?? []) for (const f of c.fields ?? []) out.push({ ...f, path: `contacts.${c.key}.${f.key}` });
  for (const h of data?.hospitals?.list ?? []) for (const f of h.fields ?? []) out.push({ ...f, path: `hospitals.${h.key}.${f.key}` });
  for (const part of ['phrases', 'conduct']) for (const x of data?.[part]?.items ?? []) out.push({ ...x, path: `${part}.${x.key}` });
  return out;
}

function checkItem(it, sources, today) {
  const errs = [];
  const at = it.path ?? it.key;
  if (typeof it.key !== 'string' || !it.key) errs.push(`${at}.key`);
  if (!INFO_STATUSES.includes(it.status)) return [...errs, `${at}.status`];
  if (it.kind !== undefined && !KINDS.includes(it.kind)) errs.push(`${at}.kind`);
  if (it.status === 'verified-official') {
    if (!hasValue(it.value)) errs.push(`${at}.value`);
    if (!it.source || !isObj(sources?.[it.source])) errs.push(`${at}.source`);
    if (!datedOk(it.checkedAt, today)) errs.push(`${at}.checkedAt`);
  }
  if (it.status === 'user-provided') {
    if (!hasValue(it.value)) errs.push(`${at}.value`);
    if (!datedOk(it.checkedAt, today)) errs.push(`${at}.checkedAt`);
  }
  if (it.status === 'unverified' && (it.value ?? null) !== null) errs.push(`${at}.unverifiedValue`);
  if (it.kind === 'phone' && hasValue(it.value) && !(typeof it.value === 'string' && PHONE.test(it.value))) errs.push(`${at}.phone`);
  if (it.status !== 'verified-official' && THAI.test(JSON.stringify(it.value ?? ''))) errs.push(`${at}.thai`);
  return errs;
}

/** Problems in an info file, as short codes. Empty array = valid. `today` (YYYY-MM-DD) rules out future check dates. */
export function validateInfo(data, today) {
  if (!isObj(data)) return ['info.notObject'];
  const errs = [];
  const sources = isObj(data.sources) ? data.sources : {};
  for (const [k, s] of Object.entries(sources)) {
    if (!isObj(s) || !isHttps(s.url)) errs.push(`sources.${k}.url`);
    if (!datedOk(s?.checkedAt, today)) errs.push(`sources.${k}.checkedAt`);
  }
  if (!Array.isArray(data.emergency)) errs.push('emergency');
  if (!Array.isArray(data.contacts)) errs.push('contacts');
  if (!isObj(data.hospitals) || !Array.isArray(data.hospitals.list)) errs.push('hospitals');
  for (const h of data.hospitals?.list ?? []) if (!PRIORITIES.includes(h.priority)) errs.push(`hospitals.${h.key}.priority`);
  for (const part of ['phrases', 'conduct']) {
    const p = data[part];
    if (!isObj(p) || !INFO_STATUSES.includes(p.status) || !Array.isArray(p.items)) { errs.push(part); continue; }
    if (p.status !== 'hidden' && p.items.some((x) => x.status !== 'verified-official')) errs.push(`${part}.unsourced`);
  }
  for (const it of allItems(data)) errs.push(...checkItem(it, sources, today));
  return errs;
}

export const isShown = (it) => INFO_STATUSES.includes(it?.status) && it.status !== 'hidden';
const callable = (it) => it?.kind === 'phone' && (it.status === 'verified-official' || it.status === 'user-provided') && typeof it.value === 'string' && PHONE.test(it.value);

/** The emergency button: verified numbers only (owner, 2026-11-22). */
export const emergencyNumbers = (data) => (data?.emergency ?? []).filter((x) => x.status === 'verified-official' && callable(x));

/** tel: link for a phone that is verified or given by the user; null otherwise. */
export const telHref = (it) => (callable(it) ? `tel:${it.value.replace(/[^\d+]/g, '')}` : null);

/** Map search link from a verified address only (Latin first, then Thai). Opened only on tap (rule 5). */
export function mapLink(fields, base) {
  if (typeof base !== 'string' || !base) return null;
  const addr = ['address', 'addressTh'].map((k) => (fields ?? []).find((f) => f.key === k))
    .find((f) => f?.status === 'verified-official' && typeof f.value === 'string' && f.value.trim());
  return addr ? `${base}${encodeURIComponent(addr.value.trim())}` : null;
}

/** The source of an item as { title, url, checkedAt }, or null. */
export const sourceOf = (data, it) => (it?.source && isObj(data?.sources?.[it.source]) ? data.sources[it.source] : null);

/** The user's notes (insurance, policy, own remarks) by key; only text is kept. */
export function cleanNotes(notes) {
  if (!isObj(notes)) return {};
  return Object.fromEntries(Object.entries(notes).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.slice(0, NOTE_MAX)]));
}

/** A copy of trip.info with one note set (trimmed, capped) or removed when empty. Other fields stay. */
export function setNote(info, key, text) {
  const base = isObj(info) ? info : {};
  const notes = cleanNotes(base.notes);
  const v = typeof text === 'string' ? text.trim().slice(0, NOTE_MAX) : '';
  if (v) notes[key] = v; else delete notes[key];
  return { ...base, notes };
}

export const noteOf = (info, key) => cleanNotes(info?.notes)[key] ?? '';
