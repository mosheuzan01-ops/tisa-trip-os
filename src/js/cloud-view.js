// Stage 14: the account card in settings ("my account and trips"), sign-in, sync, sharing, moving 1.0.x data into the
// account, and the small sync pill in the top bar. The app never needs a sign-in: without config.cloud, or without a
// session, nothing here loads the Supabase library or touches the network, and the phone keeps working as in 1.0.x.
// Data rules: tisa:v1 stays the working copy; this file only adds latisa:sync:v1 and latisa:auth:v1 (through
// src/js/core/storage.js), and it never resets or replaces the app data. Admin code is not here (admin-view.js).
import { createKv, authStorage, keepCloudCopy, hasSavedSession, browserBackend, SYNC_KEY, AUTH_KEY } from './core/storage.js';
import { createCloudApi, toCloudError } from './core/cloud-api.js';
import { emptySyncState, runSync, downloadTrip, noteLocalChanges, pendingCount, unlinkAll, resendAll, markBackup, markMoveFailed, migrateTrip, singleFlight, deleteTripFromAccount } from './core/sync-engine.js';
import { interpolate } from './core/i18n.js';

const LIB = './vendor/supabase/supabase-js-2.119.2.umd.js';
const LIB_INTEGRITY = 'sha256-iBavBNmRXbuhiC1vhPC0AtxAJoBjpj2cZtJPUvNxwmM='; // = the pin in tests/stage14-vendor.test.js
const SYNC_DELAY = 2500;
const SYNC_EVERY = 5 * 60_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASS = 8;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const nowIso = () => new Date().toISOString();
const count = (v) => (Array.isArray(v) ? v.length : 0);

function loadLibrary() {
  if (globalThis.supabase?.createClient) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB;
    s.integrity = LIB_INTEGRITY;
    s.onload = () => (globalThis.supabase?.createClient ? resolve() : reject(new Error('library missing')));
    s.onerror = () => reject(new Error('Failed to fetch the library'));
    document.head.append(s);
  });
}

function tripHasData(trip) {
  return ['destinations', 'expenses', 'checklist', 'places', 'transfers', 'tasks', 'people'].some((f) => count(trip?.[f]) > 0)
    || Number.isInteger(trip?.budget?.totalMinor);
}

export function setupCloud(ctx, { wireDialog }) {
  const { t } = ctx;
  const cfg = ctx.config.cloud ?? {};
  const backend = browserBackend();
  const kv = createKv({ backend, key: SYNC_KEY });
  const cloud = {
    configured: typeof cfg.url === 'string' && /^https:\/\//.test(cfg.url) && typeof cfg.publishableKey === 'string' && cfg.publishableKey.length > 0,
    sync: kv.read() ?? emptySyncState(),
    status: 'off', // off | signed-out | expired | loading | pending | blocked | approved
    net: 'idle', // idle | syncing | offline
    api: null,
    busy: false,
    again: false,
    timer: null,
    askedMigrate: false,
    signingOut: false,
  };
  ctx.cloud = cloud;
  const save = () => kv.write(cloud.sync);

  // ---------- what other screens ask ----------
  ctx.datesLocked = () => {
    const e = cloud.sync.trips?.[ctx.state.activeTripId];
    return Boolean(e?.linked && e.role === 'member');
  };
  ctx.afterSave = () => {
    if (!cloud.configured || !Object.values(cloud.sync.trips ?? {}).some((e) => e.linked)) return;
    noteLocalChanges(cloud.sync, ctx.state, nowIso());
    save();
    schedule();
  };
  ctx.afterImport = () => {
    if (!Object.values(cloud.sync.trips ?? {}).some((e) => e.linked)) return;
    cloud.sync.restorePending = true; // nothing is sent until the user says where the restore goes
    save();
  };

  if (!cloud.configured) { cloud.status = 'off'; return cloud; }

  // ---------- dialogs: added to the page only now ----------
  const tpl = $('#tpl-cloud');
  const frag = tpl.content.cloneNode(true);
  for (const el of $$('[data-i18n]', frag)) el.textContent = t(el.dataset.i18n);
  document.body.querySelector('.app').append(frag);
  const dlg = {
    auth: $('#dlg-cloud-auth'), share: $('#dlg-cloud-share'), members: $('#dlg-cloud-members'),
    confirm: $('#dlg-cloud-confirm'), migrate: $('#dlg-cloud-migrate'), admin: $('#dlg-cloud-admin'), delete: $('#dlg-cloud-delete'),
  };
  let opener = null;
  for (const d of Object.values(dlg)) wireDialog(d, () => { if (opener?.isConnected) opener.focus(); });
  const open = (d, from) => { opener = from ?? document.activeElement; d.showModal(); };

  // ---------- client ----------
  const hasCode = /[?&]code=/.test(location.search);
  async function ensureApi() {
    if (cloud.api) return cloud.api;
    await loadLibrary();
    const client = globalThis.supabase.createClient(cfg.url, cfg.publishableKey, {
      auth: { storage: authStorage(backend), storageKey: AUTH_KEY, flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: hasCode },
    });
    cloud.client = client;
    cloud.api = createCloudApi(client);
    cloud.api.onAuth((event) => {
      if (event === 'PASSWORD_RECOVERY') openAuth('newpass');
      if (event === 'SIGNED_OUT' && !cloud.signingOut && cloud.status !== 'signed-out') { cloud.status = 'expired'; renderCloud(ctx); }
    });
    return cloud.api;
  }

  // ---------- sync ----------
  function schedule(ms = SYNC_DELAY) {
    if (cloud.status !== 'approved') return;
    clearTimeout(cloud.timer);
    cloud.timer = setTimeout(() => refresh(), ms);
  }

  async function refresh() {
    if (!cloud.api) return;
    if (cloud.busy) { cloud.again = true; return; }
    if (navigator.onLine === false) { cloud.net = 'offline'; renderCloud(ctx); return; }
    cloud.busy = true;
    cloud.net = 'syncing';
    renderPill(ctx);
    const rev = ctx.rev;
    try {
      const res = await runSync({ api: cloud.api, sync: cloud.sync, state: ctx.state, nowIso: nowIso() });
      if (ctx.rev !== rev) { cloud.again = true; return; } // something changed meanwhile: run again with it
      cloud.sync = res.sync;
      save();
      const trips = Object.entries(res.trips);
      if (trips.length || res.settings) {
        ctx.change((s) => {
          for (const [id, trip] of trips) s.trips[id] = trip;
          if (res.settings) Object.assign(s.settings, res.settings);
        }, { now: true });
      }
      cloud.status = res.status === 'restore' ? 'approved' : res.status;
      cloud.net = 'idle';
      const notice = res.notices.find((x) => ['replaced', 'datesOwnerOnly', 'deleted', 'lost', 'tooBig'].includes(x.type));
      if (notice) ctx.toast(`cloud.notice.${notice.type}`);
      offerMigrate();
    } catch (e) {
      const err = toCloudError(e);
      if (err.kind === 'auth') cloud.status = 'expired';
      cloud.net = 'offline';
    } finally {
      cloud.busy = false;
      renderCloud(ctx);
      if (cloud.again) { cloud.again = false; schedule(800); }
    }
  }
  cloud.refresh = refresh;

  // ---------- moving the trip on this phone into the account (1.1.1: two steps) ----------
  // Step 1 downloads the backup (on an iPhone: the share sheet). Step 2 starts only when the user is back and taps
  // "move now": the trip is created in the account, its records go up, and only then it is linked. The state of the
  // move is kept in latisa:sync:v1 (sync.migration), so a reload in between shows step 2 or the last failure.
  const migStatus = $('[data-slot="cloud-migrate-status"]');
  const migUpload = $('[data-cloud="migrate-upload"]');
  const migBackup = $('[data-cloud="migrate-yes"]');
  let migrating = false;
  function renderMigrate() {
    const m = cloud.sync.migration?.tripId === ctx.trip().id ? cloud.sync.migration : null;
    const backedUp = Boolean(m?.backupAt) && m.step !== 'done';
    let state = 'start';
    let text = '';
    if (migrating) { state = 'uploading'; text = t('cloud.migrate.uploading'); } else if (m?.step === 'failed') {
      state = 'failed';
      const reason = t(`cloud.err.${m.kind}`);
      text = interpolate(t(m.stage === 'records' ? 'cloud.migrate.fail.records' : 'cloud.migrate.fail.create'), { reason });
    } else if (backedUp) { state = 'ready'; text = t('cloud.migrate.ready'); }
    migStatus.dataset.state = state;
    migStatus.textContent = text;
    migStatus.hidden = !text;
    migUpload.hidden = !backedUp;
    migUpload.disabled = migrating;
    migBackup.disabled = migrating;
    migBackup.textContent = t(backedUp ? 'cloud.migrate.again' : 'cloud.migrate.yes');
    migBackup.classList.toggle('btn-ghost', backedUp);
  }
  function offerMigrate(force = false) {
    if (cloud.status !== 'approved' || cloud.sync.restorePending) return;
    const trip = ctx.trip();
    const e = cloud.sync.trips?.[trip.id];
    if (e?.linked) return;
    // Offered by itself only on the first phone (no trip in the account yet). On another phone the account's trips
    // are in "My trips", and this phone's own trip is moved only with the "Move to my account" button.
    if (!force && (cloud.askedMigrate || cloud.sync.declined?.[trip.id] || !tripHasData(trip) || (cloud.sync.cloudTrips?.length ?? 0) > 0)) return;
    cloud.askedMigrate = true;
    $('[data-slot="cloud-migrate-text"]').textContent = interpolate(t('cloud.migrate.text'), {
      name: trip.name, stops: count(trip.destinations), expenses: count(trip.expenses), items: count(trip.checklist), places: count(trip.places),
    });
    renderMigrate();
    if (!dlg.migrate.open) open(dlg.migrate, $('[data-cloud="upload"]'));
  }
  function backupStep() {
    if (migrating) return;
    keepCloudCopy(backend, ctx.storageKey); // the exact data text, once, on the phone (before anything changes it)
    ctx.downloadBackup(); // the backup file; nothing is sent to the server here
    cloud.sync = markBackup(cloud.sync, ctx.trip().id, nowIso());
    save();
    renderMigrate();
    migUpload.focus();
  }
  const runMove = singleFlight(async () => {
    const trip = ctx.trip();
    migrating = true;
    renderMigrate();
    try {
      const api = await ensureApi();
      while (cloud.busy) await new Promise((r) => setTimeout(r, 150)); // a sync in progress finishes first
      cloud.busy = true;
      let res;
      try { res = await migrateTrip({ api, sync: cloud.sync, trip, nowIso: nowIso() }); } finally { cloud.busy = false; }
      cloud.sync = res.sync;
      save();
      if (res.trip) ctx.change((s) => { s.trips[trip.id] = res.trip; }, { now: true });
      if (res.result === 'done') {
        migrating = false;
        dlg.migrate.close();
        ctx.toast('cloud.migrate.done');
        refresh();
      }
    } catch (e) {
      // ensureApi failed (the library did not load): kept as a failure of the first stage, shown in the dialog
      // (B: only this trip's dialog state; no other trip's move progress is copied onto it or lost)
      cloud.sync = markMoveFailed(cloud.sync, trip.id, toCloudError(e).kind, nowIso());
      save();
    } finally {
      migrating = false;
      renderMigrate();
      renderCloud(ctx);
    }
  });
  migBackup.addEventListener('click', backupStep);
  migUpload.addEventListener('click', () => {
    if (migrating) return; // a second tap while moving does nothing
    migUpload.disabled = true;
    runMove();
  });
  $('[data-cloud="migrate-no"]').addEventListener('click', () => {
    if (migrating) return;
    cloud.sync.declined = { ...(cloud.sync.declined ?? {}), [ctx.trip().id]: true };
    save();
    dlg.migrate.close();
    renderCloud(ctx);
  });

  // ---------- sign-in dialog ----------
  const authForm = $('[data-form="cloud-auth"]');
  const authErr = $('[data-slot="cloud-auth-error"]');
  let mode = 'signin';
  function setMode(m) {
    mode = m;
    for (const label of $$('[data-show]', authForm)) label.hidden = !label.dataset.show.split(' ').includes(m);
    for (const b of $$('[data-mode]', authForm)) b.hidden = b.dataset.mode === m || m === 'newpass' || (m === 'reset' && b.dataset.mode === 'signup');
    const titles = { signin: 'cloud.signin', signup: 'cloud.signup', reset: 'cloud.reset', newpass: 'cloud.newpass' };
    $('[data-slot="cloud-auth-title"]').textContent = t(titles[m]);
    $('[data-slot="cloud-auth-submit"]').textContent = t({ signin: 'cloud.signin', signup: 'cloud.signup', reset: 'cloud.reset.send', newpass: 'form.save' }[m]);
    $('[data-slot="cloud-auth-hint"]').textContent = t(`cloud.hint.${m}`);
    authForm.pass.autocomplete = m === 'signin' ? 'current-password' : 'new-password';
    authErr.textContent = '';
    for (const i of $$('input', authForm)) i.setAttribute('aria-invalid', 'false');
  }
  function openAuth(m, from) {
    authForm.reset();
    setMode(m);
    if (!dlg.auth.open) open(dlg.auth, from);
    ($$('label:not([hidden]) input', authForm)[0])?.focus();
  }
  for (const b of $$('[data-mode]', authForm)) b.addEventListener('click', () => { setMode(b.dataset.mode); ($$('label:not([hidden]) input', authForm)[0])?.focus(); });
  const fail = (key, input) => {
    authErr.textContent = t(key);
    if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
  };
  const siteUrl = () => `${location.origin}${location.pathname}`;
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = authForm.email.value.trim();
    const pass = authForm.pass.value;
    if (mode !== 'newpass' && !EMAIL.test(email)) { fail('cloud.err.email', authForm.email); return; }
    if ((mode === 'signin' || mode === 'signup' || mode === 'newpass') && pass.length < MIN_PASS) { fail('cloud.err.short', authForm.pass); return; }
    const submit = $('[data-slot="cloud-auth-submit"]');
    submit.disabled = true;
    authErr.textContent = '';
    try {
      const api = await ensureApi();
      if (mode === 'signin') {
        await api.signIn({ email, password: pass });
      } else if (mode === 'signup') {
        const data = await api.signUp({ email, password: pass, displayName: authForm.name.value.trim(), phone: authForm.phone.value.trim(), redirectTo: siteUrl() });
        if (!data?.session) { fail('cloud.signup.checkMail'); return; }
      } else if (mode === 'reset') {
        await api.requestReset(email, siteUrl());
        authErr.textContent = t('cloud.reset.sent');
        return;
      } else if (mode === 'newpass') {
        await api.setNewPassword(pass);
        history.replaceState(null, '', `${location.pathname}${location.hash}`);
      }
      dlg.auth.close();
      ctx.toast(mode === 'newpass' ? 'cloud.newpass.done' : mode === 'signup' ? 'cloud.signup.done' : 'cloud.signin.done');
      cloud.status = 'loading';
      cloud.askedMigrate = false;
      renderCloud(ctx);
      refresh();
    } catch (err) {
      const k = toCloudError(err);
      const msg = String(k.message);
      if (k.kind === 'offline') fail('cloud.err.offline');
      else if (/already registered|already exists/i.test(msg)) fail('cloud.err.exists', authForm.email);
      else if (/invalid login|credentials/i.test(msg)) fail('cloud.err.login', authForm.pass);
      else if (/weak|short|characters/i.test(msg)) fail('cloud.err.short', authForm.pass);
      else fail('cloud.err.bad');
    } finally { submit.disabled = false; }
  });

  // ---------- share, members, leave ----------
  const shareForm = $('[data-form="cloud-share"]');
  const shareErr = $('[data-slot="cloud-share-error"]');
  shareForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = shareForm.email.value.trim();
    if (!EMAIL.test(email)) { shareErr.textContent = t('cloud.err.email'); shareForm.email.setAttribute('aria-invalid', 'true'); shareForm.email.focus(); return; }
    try {
      const res = await cloud.api.share(ctx.trip().id, email);
      if (res === 'ok') { dlg.share.close(); ctx.toast('cloud.share.done'); return; }
      shareErr.textContent = t('cloud.share.notFound');
    } catch (err) { shareErr.textContent = t(`cloud.err.${toCloudError(err).kind}`); }
  });

  function ask(titleKey, text, yesKey, onYes, from) {
    $('[data-slot="cloud-confirm-title"]').textContent = t(titleKey);
    $('[data-slot="cloud-confirm-text"]').textContent = text;
    const yes = $('[data-slot="cloud-confirm-yes"]');
    yes.textContent = t(yesKey);
    yes.onclick = async () => { dlg.confirm.close(); await onYes(); };
    open(dlg.confirm, from);
    $('[data-close]', dlg.confirm).focus();
  }

  async function showMembers(from) {
    const list = $('[data-slot="cloud-members-list"]');
    const tripId = ctx.trip().id;
    const owner = cloud.sync.trips?.[tripId]?.role === 'owner';
    list.replaceChildren();
    $('[data-slot="cloud-members-hint"]').textContent = t(owner ? 'cloud.members.hintOwner' : 'cloud.members.hintMember');
    if (!dlg.members.open) open(dlg.members, from);
    let people;
    try { people = await cloud.api.people(tripId); } catch (err) { $('[data-slot="cloud-members-hint"]').textContent = t(`cloud.err.${toCloudError(err).kind}`); return; }
    for (const p of people) {
      const li = document.createElement('li');
      li.className = 'cloud-row';
      const who = document.createElement('span');
      who.className = 'cloud-row-who';
      who.textContent = p.display_name || p.email || t('cloud.members.someone');
      const role = document.createElement('span');
      role.className = 'settings-meta';
      role.textContent = t(p.role === 'owner' ? 'cloud.role.owner' : 'cloud.role.member');
      li.append(who, role);
      if (p.email && p.display_name) { const em = document.createElement('span'); em.className = 'settings-meta ltr'; em.textContent = p.email; li.append(em); }
      const me = p.user_id === cloud.sync.userId;
      if ((owner && p.role === 'member') || (!owner && me)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-ghost btn-danger';
        b.textContent = t(owner ? 'cloud.members.remove' : 'cloud.members.leave');
        b.addEventListener('click', () => ask(owner ? 'cloud.members.remove' : 'cloud.members.leave',
          owner ? interpolate(t('cloud.members.removeText'), { who: who.textContent }) : t('cloud.members.leaveText'),
          owner ? 'cloud.members.remove' : 'cloud.members.leave', async () => {
            try {
              if (owner) { await cloud.api.unshare(tripId, p.user_id); ctx.toast('cloud.members.removed'); showMembers(); }
              else {
                await cloud.api.leave(tripId);
                cloud.sync.trips[tripId].linked = false; // the copy on this phone stays, unlinked
                save(); dlg.members.close(); ctx.toast('cloud.members.left'); renderCloud(ctx);
              }
            } catch (err) { ctx.toast(`cloud.err.${toCloudError(err).kind}`); }
          }, b));
        li.append(b);
      }
      list.append(li);
    }
  }

  // ---------- deleting the shown trip from the account (1.1.2, owner only) ----------
  // The button only opens a dialog; nothing is deleted before "yes". Cancel, Esc and a tap outside only close it.
  // The server deletes the trip, its records and its members (0003_delete_trip.sql, owner only); this phone keeps its
  // copy, unlinked ("on this device only"). One request at a time: a double tap deletes once. A failure is shown in
  // the dialog with its reason and nothing changes on the phone.
  const delYes = $('[data-cloud="delete-yes"]');
  const delErr = $('[data-slot="cloud-delete-error"]');
  let deleting = false;
  function openDelete(from) {
    const trip = ctx.trip();
    const e = cloud.sync.trips?.[trip.id];
    if (cloud.status !== 'approved' || !e?.linked || e.role !== 'owner') return;
    dlg.delete.dataset.trip = trip.id; // the trip shown now; switching trips meanwhile does not change what is deleted
    $('[data-slot="cloud-delete-name"]').textContent = trip.name || t('cloud.trips.noName');
    $('[data-slot="cloud-delete-what"]').textContent = interpolate(t('cloud.delete.what'), {
      stops: count(trip.destinations), expenses: count(trip.expenses), items: count(trip.checklist), places: count(trip.places),
    });
    delErr.textContent = '';
    delYes.disabled = false;
    delYes.textContent = t('cloud.delete.yes');
    open(dlg.delete, from);
    $('[data-close]', dlg.delete).focus(); // the safe choice has the focus
  }
  const runDelete = singleFlight(async () => {
    const tripId = dlg.delete.dataset.trip;
    deleting = true;
    delYes.disabled = true;
    delYes.textContent = t('cloud.delete.working');
    delErr.textContent = '';
    try {
      while (cloud.busy) await new Promise((r) => setTimeout(r, 150)); // a sync in progress finishes first
      cloud.busy = true;
      let res;
      try { res = await deleteTripFromAccount({ api: await ensureApi(), sync: cloud.sync, tripId, nowIso: nowIso() }); } finally { cloud.busy = false; }
      cloud.sync = res.sync;
      save();
      deleting = false;
      if (dlg.delete.open) dlg.delete.close();
      ctx.toast('cloud.delete.done');
    } catch (err) {
      const kind = toCloudError(err).kind;
      if (kind === 'auth') cloud.status = 'expired';
      if (dlg.delete.open) delErr.textContent = t(`cloud.delete.fail.${kind}`);
      else ctx.toast(`cloud.delete.fail.${kind}`);
    } finally {
      deleting = false;
      delYes.disabled = false;
      delYes.textContent = t('cloud.delete.yes');
      renderCloud(ctx);
    }
  });
  delYes.addEventListener('click', () => {
    if (deleting) return; // a second tap while deleting does nothing
    delYes.disabled = true;
    runDelete();
  });

  // ---------- card buttons ----------
  const card = $('[data-slot="cloud-card"]');
  card.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cloud]');
    if (!b) return;
    const a = b.dataset.cloud;
    if (a === 'signin' || a === 'signup') openAuth(a, b);
    if (a === 'password') openAuth('newpass', b); // e.g. after the admin set a temporary password (docs/BACKEND_HE.md)
    if (a === 'retry') { await ensureApi().catch(() => {}); refresh(); }
    if (a === 'share') { shareForm.reset(); shareErr.textContent = ''; open(dlg.share, b); shareForm.email.focus(); }
    if (a === 'members') showMembers(b);
    if (a === 'upload') offerMigrate(true);
    if (a === 'delete') openDelete(b);
    if (a === 'admin' && cloud.sync.profile?.role === 'admin' && cloud.status === 'approved') {
      try {
        const { openAdmin } = await import('./admin-view.js');
        opener = b;
        openAdmin({ t, client: cloud.client, dialog: dlg.admin, toast: ctx.toast, ask, selfId: cloud.sync.userId });
      } catch { ctx.toast('cloud.err.offline'); }
    }
    if (a === 'signout') {
      cloud.signingOut = true;
      try { await cloud.api?.signOut(); } catch { /* offline: the session is removed from this phone below anyway */ }
      authStorage(backend).removeItem(AUTH_KEY);
      authStorage(backend).removeItem(`${AUTH_KEY}-code-verifier`);
      cloud.signingOut = false;
      cloud.sync.profile = null; // linked trips stay linked for the next sign-in; the phone keeps every trip
      save();
      cloud.status = 'signed-out';
      cloud.net = 'idle';
      ctx.toast('cloud.signout.done');
      renderCloud(ctx);
    }
    if (a === 'restore-device') { cloud.sync = unlinkAll(cloud.sync); save(); ctx.toast('cloud.restore.deviceDone'); renderCloud(ctx); }
    if (a === 'restore-cloud') { cloud.sync = resendAll(cloud.sync); save(); renderCloud(ctx); refresh(); }
  });

  // My trips: switch the trip on screen; a trip that is only in the account comes down first.
  $('[data-slot="cloud-trip-list"]').addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!id || id === ctx.state.activeTripId) return;
    if (ctx.state.trips[id]) { ctx.change((s) => { s.activeTripId = id; }, { now: true }); ctx.toast('cloud.trips.switched'); return; }
    const st = (cloud.sync.cloudTrips ?? []).find((x) => x.id === id);
    try {
      const dl = await downloadTrip({ api: cloud.api, sync: cloud.sync, serverTrip: st, nowIso: nowIso() });
      cloud.sync = dl.sync;
      save();
      ctx.change((s) => { s.trips[id] = dl.trip; s.activeTripId = id; }, { now: true });
      ctx.toast('cloud.trips.switched');
    } catch (err) {
      ctx.toast(`cloud.err.${toCloudError(err).kind}`);
      renderCloud(ctx);
    }
  });

  // ---------- when to sync ----------
  addEventListener('online', () => { if (cloud.api) refresh(); else renderCloud(ctx); });
  addEventListener('offline', () => { cloud.net = 'offline'; renderCloud(ctx); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(500); });
  setInterval(() => schedule(0), SYNC_EVERY);

  // ---------- start: no session = no library, no network ----------
  const p = cloud.sync.profile;
  if (hasSavedSession(backend) || hasCode) {
    cloud.status = p?.status ?? 'loading';
    ensureApi().then(async (api) => {
      const session = await api.session().catch(() => null);
      if (!session && !hasCode) { cloud.status = p ? 'expired' : 'signed-out'; renderCloud(ctx); return; }
      refresh();
    }).catch(() => { cloud.net = 'offline'; renderCloud(ctx); });
  } else {
    cloud.status = p ? 'expired' : 'signed-out';
  }
  return cloud;
}

// ---------- drawing ----------
function minutesAgo(iso) {
  return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
}

function syncLine(ctx) {
  const { cloud, t } = ctx;
  if (cloud.status !== 'approved') return null;
  if (cloud.net === 'syncing') return { key: 'syncing', text: t('cloud.sync.syncing') };
  const waiting = pendingCount(cloud.sync, ctx.state);
  if (cloud.net === 'offline' || navigator.onLine === false) return { key: 'offline', text: t('cloud.sync.offline') };
  if (waiting > 0) return { key: 'waiting', text: interpolate(t('cloud.sync.waiting'), { n: waiting }) };
  if (!cloud.sync.lastSyncAt) return { key: 'waiting', text: t('cloud.sync.notYet') };
  const m = minutesAgo(cloud.sync.lastSyncAt);
  return { key: 'synced', text: m < 1 ? t('cloud.sync.justNow') : interpolate(t('cloud.sync.ago'), { n: m }) };
}

export function renderPill(ctx) {
  const pill = $('[data-slot="cloud-pill"]');
  const { cloud, t } = ctx;
  if (!pill || !cloud) return;
  const shown = cloud.configured && ['approved', 'pending', 'blocked', 'expired', 'loading'].includes(cloud.status);
  pill.hidden = !shown;
  if (!shown) return;
  let key = cloud.status;
  if (cloud.status === 'approved') key = syncLine(ctx).key;
  pill.dataset.state = key;
  $('[data-slot="cloud-pill-text"]').textContent = t(`cloud.pill.${key}`);
}

export function renderCloud(ctx) {
  const { cloud, t } = ctx;
  const card = $('[data-slot="cloud-card"]');
  if (!card || !cloud) return;
  const st = cloud.status;
  const show = (a, on) => { const b = $(`[data-cloud="${a}"]`, card); if (b) b.hidden = !on; };
  const text = $('[data-slot="cloud-text"]');
  const who = $('[data-slot="cloud-who"]');
  const line = $('[data-slot="cloud-sync"]');
  const textKey = { off: 'cloud.off', 'signed-out': 'cloud.signedOut', expired: 'cloud.expired', loading: 'cloud.loading', pending: 'cloud.pending', blocked: 'cloud.blocked', approved: null }[st];
  text.hidden = !textKey;
  if (textKey) text.textContent = t(textKey);
  const email = cloud.sync.profile?.email;
  who.hidden = !(email && ['approved', 'pending', 'blocked', 'loading'].includes(st));
  if (!who.hidden) {
    const span = Object.assign(document.createElement('span'), { className: 'ltr', textContent: email });
    who.replaceChildren(`${t('cloud.who')} `, span);
  }
  const sl = syncLine(ctx);
  line.hidden = !sl;
  if (sl) line.textContent = sl.text;

  // restore choice
  $('[data-slot="cloud-restore"]').hidden = !(st === 'approved' && cloud.sync.restorePending);

  // my trips
  const tripsBox = $('[data-slot="cloud-trips"]');
  const signedIn = st === 'approved';
  const entries = cloud.sync.trips ?? {};
  const items = Object.values(ctx.state.trips).map((trip) => {
    const e = entries[trip.id];
    const suffix = e?.linked ? (e.role === 'owner' ? 'cloud.trips.mine' : 'cloud.trips.shared') : 'cloud.trips.device';
    return { id: trip.id, label: `${trip.name || t('cloud.trips.noName')} (${t(suffix)})` };
  });
  if (signedIn) {
    for (const c of cloud.sync.cloudTrips ?? []) {
      if (ctx.state.trips[c.id]) continue;
      items.push({ id: c.id, label: `${c.name || t('cloud.trips.noName')} (${t(c.role === 'owner' ? 'cloud.trips.cloudMine' : 'cloud.trips.cloudShared')})` });
    }
  }
  tripsBox.hidden = !(signedIn || items.length > 1);
  const list = $('[data-slot="cloud-trip-list"]');
  const key = JSON.stringify([items, ctx.state.activeTripId]);
  if (list.dataset.key !== key) {
    list.dataset.key = key;
    list.replaceChildren(...items.map((it) => {
      const label = document.createElement('label');
      label.className = 'choice';
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'cloud-trip', value: it.id, checked: it.id === ctx.state.activeTripId });
      const span = Object.assign(document.createElement('span'), { textContent: it.label });
      label.append(input, span);
      return label;
    }));
  }

  // buttons
  const active = entries[ctx.state.activeTripId];
  const configured = cloud.configured;
  show('signin', configured && (st === 'signed-out' || st === 'expired'));
  show('signup', configured && st === 'signed-out');
  show('retry', configured && (st === 'pending' || (st === 'approved' && cloud.net === 'offline')));
  show('share', signedIn && active?.linked && active.role === 'owner');
  show('members', signedIn && Boolean(active?.linked));
  show('upload', signedIn && !active?.linked && !cloud.sync.restorePending);
  show('delete', signedIn && Boolean(active?.linked) && active.role === 'owner' && !cloud.sync.restorePending);
  show('admin', signedIn && cloud.sync.profile?.role === 'admin');
  show('password', configured && ['approved', 'pending'].includes(st));
  show('signout', configured && ['approved', 'pending', 'blocked', 'loading', 'expired'].includes(st));
  renderPill(ctx);
}
