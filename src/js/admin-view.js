// Stage 14: the small admin screen (users and trips). This file is loaded with import() only after an approved
// admin taps "Admin" (src/js/cloud-view.js), so a regular user's phone never loads it and never sends these calls.
// The server refuses them anyway for anyone who is not an approved admin (supabase/migrations/0001_stage14_init.sql).
// What it cannot do, on purpose: make another admin (a manual SQL step for the owner) and delete a user completely
// (that needs the server-side key, and would also delete the trips that user owns: docs/BACKEND_HE.md).
// 1.1.4 (no server change): blocked users in their own closed group, "add to a trip" through the existing share_trip
// (only the admin's own trips, only an approved user, after a confirm), and the pending count for cloud-view.js.
import { toCloudError } from './core/cloud-api.js';
import { interpolate } from './core/i18n.js';
import { splitUsers, tripsToOffer } from './core/admin-users.js';

const $ = (sel, root = document) => root.querySelector(sel);

async function rpc(client, fn, args = {}) {
  let res;
  try { res = await client.rpc(fn, args); } catch (e) { throw toCloudError(e); }
  if (res?.error) throw toCloudError(res.error);
  return res?.data ?? [];
}

/** 1.1.4: the users list only (for the pending count). Admin only; the server refuses anyone else. */
export const listUsers = (client) => rpc(client, 'admin_list_users');

export async function openAdmin({ t, client, dialog, toast, ask, selfId, ownedTrips = () => [], onUsers = () => {} }) {
  const call = (fn, args) => rpc(client, fn, args);
  const hint = $('[data-slot="cloud-admin-hint"]', dialog);
  const users = $('[data-slot="cloud-admin-users"]', dialog);
  const trips = $('[data-slot="cloud-admin-trips"]', dialog);
  const blockedBox = $('[data-slot="cloud-admin-blocked"]', dialog);
  const blockedTitle = $('[data-slot="cloud-admin-blocked-title"]', dialog);
  const blockedList = $('[data-slot="cloud-admin-blocked-list"]', dialog);
  if (!dialog.open) dialog.showModal();
  $('[data-close]', dialog).focus();

  const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls ?? '', textContent: text ?? '' });
  const button = (key, danger, onClick) => {
    const b = el('button', `btn btn-ghost${danger ? ' btn-danger' : ''}`, t(key));
    b.type = 'button';
    b.addEventListener('click', () => onClick(b));
    return b;
  };

  /** "Add to a trip": a small picker inside the row; nothing is sent before the confirm. */
  function addPicker(li, x, offer, opener) {
    if ($('.cloud-add', li)) return;
    const box = el('div', 'cloud-add');
    const label = el('label', 'field');
    label.append(el('span', '', t('cloud.admin.addPick')));
    const select = document.createElement('select');
    select.name = 'trip';
    for (const tr of offer) select.append(Object.assign(document.createElement('option'), { value: tr.id, textContent: tr.name || t('cloud.trips.noName') }));
    label.append(select);
    const row = el('div', 'settings-actions');
    const yes = button('cloud.admin.add', false, (b) => {
      const trip = offer.find((tr) => tr.id === select.value);
      if (!trip) return;
      ask('cloud.admin.addToTrip', interpolate(t('cloud.admin.addText'), { who: x.email, trip: trip.name || t('cloud.trips.noName') }), 'cloud.admin.add', async () => {
        try {
          const res = await call('share_trip', { t: trip.id, friend_email: x.email });
          toast(res === 'ok' ? 'cloud.admin.added' : 'cloud.admin.addNotApproved');
          load();
        } catch (err) { toast(`cloud.err.${err.kind}`); }
      }, b);
    });
    yes.dataset.admin = 'add-yes';
    const no = button('form.cancel', false, () => { box.remove(); opener.hidden = false; opener.focus(); });
    no.dataset.admin = 'add-cancel';
    row.append(yes, no);
    box.append(label, row);
    opener.hidden = true;
    li.append(box);
    select.focus();
  }

  function userRow(x, adminTrips) {
    const li = el('li', 'cloud-row');
    li.append(el('span', 'cloud-row-who ltr', x.email));
    if (x.display_name) li.append(el('span', 'settings-meta', x.display_name));
    if (x.phone) li.append(el('span', 'settings-meta ltr', x.phone));
    li.append(el('span', `settings-meta cloud-status-${x.status}`, x.role === 'admin' ? t('cloud.role.admin') : t(`cloud.status.${x.status}`)));
    if (x.role !== 'user' || x.id === selfId) return li;
    const set = (status) => async () => {
      try { await call('admin_set_status', { target: x.id, new_status: status }); toast('cloud.admin.saved'); load(); } catch (err) { toast(`cloud.err.${err.kind}`); }
    };
    if (x.status === 'blocked') { li.append(button('cloud.admin.unblock', false, set('approved'))); return li; }
    if (x.status === 'pending') li.append(button('cloud.admin.approve', false, set('approved')));
    const offer = tripsToOffer(x, ownedTrips(), adminTrips);
    if (offer.length) {
      const add = button('cloud.admin.addToTrip', false, (b) => addPicker(li, x, offer, b));
      add.dataset.admin = 'add';
      li.append(add);
    }
    li.append(button('cloud.admin.block', true, (b) => ask('cloud.admin.block', interpolate(t('cloud.admin.blockText'), { who: x.email }), 'cloud.admin.block', set('blocked'), b)));
    if (x.status === 'pending') li.append(el('span', 'cloud-admin-note', t('cloud.admin.approveFirst')));
    return li;
  }

  async function load() {
    hint.textContent = t('cloud.admin.loading');
    let u; let tr;
    try { [u, tr] = await Promise.all([call('admin_list_users'), call('admin_list_trips')]); } catch (err) { hint.textContent = t(`cloud.err.${err.kind}`); return; }
    onUsers(u);
    hint.textContent = interpolate(t('cloud.admin.count'), { users: u.length, waiting: u.filter((x) => x.status === 'pending').length, trips: tr.length });
    const { active, blocked } = splitUsers(u);
    users.replaceChildren(...active.map((x) => userRow(x, tr)));
    blockedList.replaceChildren(...blocked.map((x) => userRow(x, tr)));
    blockedTitle.textContent = interpolate(t('cloud.admin.blocked'), { n: blocked.length });
    blockedBox.hidden = blocked.length === 0;
    trips.replaceChildren(...tr.map((x) => {
      const li = el('li', 'cloud-row');
      li.append(el('span', 'cloud-row-who', x.name || t('cloud.trips.noName')));
      li.append(el('span', 'settings-meta ltr', x.owner_email));
      for (const m of x.members ?? []) {
        if (m.role !== 'member') continue;
        const row = el('span', 'cloud-member');
        row.append(el('span', 'settings-meta ltr', m.email));
        row.append(button('cloud.members.remove', true, (b) => ask('cloud.members.remove', interpolate(t('cloud.members.removeText'), { who: m.email }), 'cloud.members.remove', async () => {
          try { await call('unshare_trip', { t: x.id, friend: m.user_id }); toast('cloud.members.removed'); load(); } catch (err) { toast(`cloud.err.${err.kind}`); }
        }, b)));
        li.append(row);
      }
      return li;
    }));
  }
  await load();
}
