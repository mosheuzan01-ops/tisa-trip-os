// Stage 14: the small admin screen (users and trips). This file is loaded with import() only after an approved
// admin taps "Admin" (src/js/cloud-view.js), so a regular user's phone never loads it and never sends these calls.
// The server refuses them anyway for anyone who is not an approved admin (supabase/migrations/0001_stage14_init.sql).
// What it cannot do, on purpose: make another admin (a manual SQL step for the owner) and delete a user completely
// (that needs the server-side key, so the owner does it in the Supabase dashboard: docs/BACKEND_HE.md).
import { toCloudError } from './core/cloud-api.js';
import { interpolate } from './core/i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);

export async function openAdmin({ t, client, dialog, toast, ask, selfId }) {
  const call = async (fn, args = {}) => {
    const res = await client.rpc(fn, args);
    if (res.error) throw toCloudError(res.error);
    return res.data ?? [];
  };
  const hint = $('[data-slot="cloud-admin-hint"]', dialog);
  const users = $('[data-slot="cloud-admin-users"]', dialog);
  const trips = $('[data-slot="cloud-admin-trips"]', dialog);
  if (!dialog.open) dialog.showModal();
  $('[data-close]', dialog).focus();

  const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls ?? '', textContent: text ?? '' });
  const button = (key, danger, onClick) => {
    const b = el('button', `btn btn-ghost${danger ? ' btn-danger' : ''}`, t(key));
    b.type = 'button';
    b.addEventListener('click', () => onClick(b));
    return b;
  };

  async function load() {
    hint.textContent = t('cloud.admin.loading');
    let u; let tr;
    try { [u, tr] = await Promise.all([call('admin_list_users'), call('admin_list_trips')]); } catch (err) { hint.textContent = t(`cloud.err.${err.kind}`); return; }
    hint.textContent = interpolate(t('cloud.admin.count'), { users: u.length, waiting: u.filter((x) => x.status === 'pending').length, trips: tr.length });
    users.replaceChildren(...u.map((x) => {
      const li = el('li', 'cloud-row');
      li.append(el('span', 'cloud-row-who ltr', x.email));
      if (x.display_name) li.append(el('span', 'settings-meta', x.display_name));
      if (x.phone) li.append(el('span', 'settings-meta ltr', x.phone));
      li.append(el('span', `settings-meta cloud-status-${x.status}`, x.role === 'admin' ? t('cloud.role.admin') : t(`cloud.status.${x.status}`)));
      if (x.role === 'user' && x.id !== selfId) {
        const set = (status) => async () => {
          try { await call('admin_set_status', { target: x.id, new_status: status }); toast('cloud.admin.saved'); load(); } catch (err) { toast(`cloud.err.${err.kind}`); }
        };
        if (x.status !== 'approved') li.append(button('cloud.admin.approve', false, set('approved')));
        if (x.status !== 'blocked') {
          li.append(button('cloud.admin.block', true, (b) => ask('cloud.admin.block', interpolate(t('cloud.admin.blockText'), { who: x.email }), 'cloud.admin.block', set('blocked'), b)));
        }
      }
      return li;
    }));
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
