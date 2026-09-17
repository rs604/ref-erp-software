-- ============================================================
-- 49 THE THREE KEYS THAT STILL SAID "DELETE"
--
-- Migration 48 moved the grid's Delete column to Cancel, because nothing in
-- this ERP is ever deleted -- a wrong entry is cancelled, and the
-- cancellation is itself an event. The permission KEYS were deliberately
-- left alone in 48, because the edge functions check by key and deploy
-- separately: renaming here first would have told people they had no
-- permission on screens that are theirs.
--
-- DO NOT RUN THIS UNTIL _shared/auth.ts ACCEPTS BOTH SPELLINGS AND
-- hr-actions AND hrms-actions HAVE BEEN DEPLOYED WITH IT.
--
-- The order that leaves no window:
--   1. deploy hr-actions and hrms-actions   (either spelling accepted)
--   2. run this migration                   (the keys move)
--   3. deploy both again                    (only the new spelling)
--
-- The two RLS policies that name these keys are changed in the same
-- transaction as the keys themselves, so the database is never briefly
-- inconsistent with itself.
-- ============================================================

-- ---------- (1) the keys ----------
update public.permissions set key = 'employee_master.cancel' where key = 'employee_master.delete';
update public.permissions set key = 'holidays.cancel'        where key = 'holidays.delete';
update public.permissions set key = 'vendor_master.cancel'   where key = 'vendor_master.delete';

-- ---------- (2) the two policies that name them ----------
-- Grants live in party_permissions and point at permissions.id, not at the
-- text, so nobody loses anything here. These two policies spell the key out
-- in their own text and would silently stop matching.
drop policy if exists holidays_update on public.holidays;
create policy holidays_update on public.holidays
  for update
  using      (has_permission('holidays.edit') or has_permission('holidays.cancel'))
  with check (has_permission('holidays.edit') or has_permission('holidays.cancel'));

drop policy if exists vendor_details_update on public.vendor_details;
create policy vendor_details_update on public.vendor_details
  for update
  using      (has_permission('vendor_master.edit')
              or has_permission('vendor_master.approve')
              or has_permission('vendor_master.cancel'))
  with check (has_permission('vendor_master.edit')
              or has_permission('vendor_master.approve')
              or has_permission('vendor_master.cancel'));

-- ---------- (3) it cannot come back ----------
-- Migration 48 made two permissions sharing one box impossible. This does the
-- same for the word itself: nothing in this table may claim to delete.
alter table public.permissions
  add constraint permissions_nothing_is_deleted
  check (action <> 'delete' and key not like '%.delete');

comment on constraint permissions_nothing_is_deleted on public.permissions is
  'Nothing in this ERP is deleted; wrong entries are cancelled and the cancellation is an event. A permission that claims otherwise is refused at the door rather than found later on a screen.';
