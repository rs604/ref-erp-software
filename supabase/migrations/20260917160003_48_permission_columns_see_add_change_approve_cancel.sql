-- ============================================================
-- 48 THE PERMISSION COLUMNS ARE THE LOCKED FIVE
--
--     See · Add · Change · Approve · Cancel
--
-- The grid was still showing View, Create, Edit, Approve, DELETE. A Delete
-- column contradicts a rule the whole system is built on: nothing is ever
-- deleted, wrong entries are cancelled, and the cancellation is itself an
-- event.
--
-- Nothing on the Delete column ever deleted anything anyway. The three
-- permissions sitting there are labelled "Change Employee Status
-- (Suspend/Mark Left)", "Deactivate Holidays" and "Suspend/Blacklist
-- Vendors". They were cancellations wearing the wrong column heading.
--
-- And with a Cancel column, purchase_request.cancel finally has a home. It
-- existed in this table but could not be granted or revoked from any screen,
-- because there was no column its action could appear in.
--
-- THE KEYS ARE NOT TOUCHED. employee_master.delete stays spelled that way,
-- because the edge functions check permissions by key and they are deployed
-- separately from this database. Renaming a key here without redeploying them
-- at the same moment would lock people out of their own screens. That rename
-- is a separate job, done in one go with the deploy.
-- ============================================================

-- ---------- (1) Delete becomes Cancel ----------
update public.permissions
   set action = 'cancel'
 where action = 'delete';

-- ---------- (2) The three Admin permissions each get their own row ----------
-- All three sat at Admin / admin / edit. The grid draws one box per sub-head
-- and action, so ticking that box granted admin.permissions alone and the
-- other two were invisible and unreachable. They are genuinely three
-- different things, so they get three sub-heads.
update public.permissions set sub_head = 'admin_permissions' where key = 'admin.permissions';
update public.permissions set sub_head = 'admin_users'       where key = 'admin.users';
update public.permissions set sub_head = 'admin_settings'    where key = 'admin.settings';
update public.permissions set sub_head = 'admin_audit'       where key = 'admin.audit';

-- ---------- (3) Nothing may share a box again ----------
-- One permission per category, sub-head and action. Had this existed, the two
-- hidden Admin permissions could never have happened.
create unique index permissions_one_per_cell_idx
  on public.permissions (category, sub_head, action);

comment on index public.permissions_one_per_cell_idx is
  'Two permissions in one cell of the grid means one of them is invisible and can never be granted. This makes that impossible to add by accident.';
