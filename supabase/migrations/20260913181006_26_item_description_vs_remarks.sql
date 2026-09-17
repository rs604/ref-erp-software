-- ============================================================
-- 26 DESCRIPTION AND REMARKS ON AN ITEM — WHICH IS WHICH
--
-- items.description already existed, carried over in the Tokyo port
-- (migration 07). It is text and optional, so it already does what is
-- wanted: optional and multi-line. It is KEPT, not replaced.
--
-- What was actually missing is the difference between the two boxes.
-- Neither column said what it was for, and two empty text boxes sitting
-- next to each other is exactly how somebody types a vendor's internal
-- note into the field that prints on the PO. Saying it here means the
-- database itself carries the answer.
-- ============================================================

comment on column public.items.description is
  'PRINTS. The specification, shown on the PO under the item name, and what the PO screen''s Specification column reads. Optional and multi-line. Do NOT put anything here that should stay inside the firm -- for that use remarks.';

comment on column public.items.remarks is
  'NEVER PRINTS. Internal notes about the item, for our own people only. Optional and multi-line. The printed specification is description.';

comment on column public.items.name is
  'The item name, typed to the sub-group''s name pattern. The specification that prints under it on a PO is description, not part of the name.';
