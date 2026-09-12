-- ===== branches (3 rows) =====
INSERT INTO public.branches (id, created_at, status, name) VALUES
  ('e05bf65b-0ef3-44bf-9a38-8b2a46cefc22', '2026-08-04 04:35:25.640699+00', 'cancelled', 'BR Tool Factory'),
  ('b91530ce-15a1-4a7a-b78a-cf7cad611133', '2026-08-04 04:34:51.320039+00', 'approved', 'Old Factory (REF)'),
  ('8c64b584-0d57-47c1-9d3c-71eb86a90879', '2026-08-04 04:35:05.769553+00', 'cancelled', 'Rented Factory New');

-- ===== departments (11 rows) =====
INSERT INTO public.departments (id, created_at, status, name) VALUES
  ('8963901b-0e30-4953-99c0-35175b8fb135', '2026-08-04 06:06:42.546617+00', 'approved', 'Accounts'),
  ('1d59306c-5d29-4814-98a1-dcce4c11e331', '2026-08-04 06:06:51.110501+00', 'approved', 'Admin'),
  ('59463fef-faf8-489b-a1aa-55e93ff02d52', '2026-08-04 06:07:17.556958+00', 'approved', 'After Sales Service'),
  ('c20213a7-e66e-4a6e-a150-f35afe131dc6', '2026-08-04 06:08:22.368383+00', 'approved', 'Designs'),
  ('cb4af376-e4c2-4006-ba6b-44f994562787', '2026-08-04 06:07:10.780123+00', 'approved', 'Operations'),
  ('adec17cf-1c89-4039-8e09-1f81af21bd54', '2026-08-04 06:08:03.322807+00', 'approved', 'Production'),
  ('4425e42b-2889-412a-8d3c-6b49be7b1ff9', '2026-08-04 06:07:03.862888+00', 'approved', 'Purchase'),
  ('fd8cca34-608d-4b34-a41e-6ab263b10100', '2026-08-04 06:08:13.836131+00', 'approved', 'Quality'),
  ('20155952-3ea9-441f-be0b-31417761f02b', '2026-08-04 06:06:47.236027+00', 'approved', 'Sales'),
  ('a88fe5d2-60b7-4c5a-a398-29379568683b', '2026-08-04 06:08:45.807503+00', 'approved', 'Site Installation'),
  ('fe723fb4-8701-438f-b9ee-edf3f49186c8', '2026-08-04 06:07:57.255059+00', 'approved', 'Store');

-- ===== designations (17 rows) =====
INSERT INTO public.designations (id, created_at, status, name) VALUES
  ('f9db88e6-be77-4ae6-8a2d-becb7fb96fa6', '2026-08-04 08:52:38.253407+00', 'approved', 'Adda-man'),
  ('5aa54c65-6de4-471b-84c3-8894241e7d47', '2026-08-04 08:59:11.518455+00', 'approved', 'CEO'),
  ('9052caae-38cd-47c3-8914-20026b42d9fa', '2026-08-04 08:52:43.903379+00', 'approved', 'CNC Operator'),
  ('ff3ce004-c8bb-445b-ae82-f7b9f049e6cd', '2026-08-04 08:52:50.180538+00', 'approved', 'Fitter'),
  ('cf1a95da-1337-407d-99cf-d73cff186bfc', '2026-08-04 08:58:26.866808+00', 'approved', 'General Manager'),
  ('b7feb593-6e9e-4f7d-88e3-827caffbf400', '2026-08-04 08:51:52.647276+00', 'approved', 'Helper'),
  ('6ad5acb8-6adc-461a-b023-bebbd8ef4b69', '2026-08-04 08:53:00.324776+00', 'approved', 'Jr. Forman'),
  ('6398bac8-b80e-4061-bd69-a12e5a4275e4', '2026-08-04 08:58:43.791565+00', 'approved', 'Jr. Manager'),
  ('faae39e8-5ae3-45f2-99e2-40ca186c6e7e', '2026-08-04 08:52:00.744397+00', 'approved', 'Jr. Supervisor'),
  ('09430687-b87c-49cd-938b-66f0c5ea2f15', '2026-08-04 08:52:12.367206+00', 'approved', 'Latheman'),
  ('d12940ef-d5c2-46cc-b131-7ae2d62ac901', '2026-08-04 08:58:55.796403+00', 'approved', 'Plant Head'),
  ('fd9ac972-e990-46f6-b16b-7e2052a5514d', '2026-08-04 08:52:28.667382+00', 'approved', 'Pressman'),
  ('c107949a-f302-4647-b6a6-332dba688bf9', '2026-08-04 08:53:42.3014+00', 'approved', 'Project Manager'),
  ('7f48d0c3-d7d8-4ce7-bbd9-e02bc9509334', '2026-08-04 08:52:54.784175+00', 'approved', 'Sr. Foreman'),
  ('d1fabebd-5704-473b-88a3-a322649a6c5e', '2026-08-04 08:54:50.24293+00', 'approved', 'Sr. Manager'),
  ('52763833-a5ef-46ec-aaf9-37fc538b06b9', '2026-08-04 08:52:06.804514+00', 'approved', 'Sr. Supervisor'),
  ('eab6cfb9-2cbb-4529-86e0-6e943083f0ab', '2026-08-04 08:51:47.834437+00', 'approved', 'Welder');

-- ===== employee_categories (2 rows) =====
INSERT INTO public.employee_categories (id, created_at, status, name) VALUES
  ('f0775a5c-5f1b-4c76-8bbe-34a9be712cd6', '2026-08-04 06:09:07.353842+00', 'approved', 'Staff'),
  ('a0e0085c-0c92-4cba-bbab-5fdccc9ed087', '2026-08-04 06:09:18.443669+00', 'approved', 'Worker (Blue Collar)');

-- ===== relationships (6 rows) =====
INSERT INTO public.relationships (id, created_at, status, name) VALUES
  ('7645aaa4-6a59-4e03-ae9f-22ad630e632e', '2026-08-04 06:09:35.578985+00', 'approved', 'Brother'),
  ('b769a105-cca1-4971-968e-b4be86ae5f8b', '2026-08-04 06:10:06.010195+00', 'approved', 'Daughter'),
  ('fb5d1a0d-d5cc-4406-ada9-11bfb76fafa6', '2026-08-04 06:09:44.977919+00', 'approved', 'Father'),
  ('6eaaa0f5-e014-4489-8b9e-67b2f231fa8f', '2026-08-04 06:09:48.558576+00', 'approved', 'Mother'),
  ('7e10f75e-5a6e-4343-8d7f-71f0c57c6878', '2026-08-04 06:09:40.463924+00', 'approved', 'Sister'),
  ('c8d3e133-2a57-487d-aace-266f1c059ef8', '2026-08-04 06:09:52.191733+00', 'approved', 'Son');

-- ===== holiday_types (4 rows) =====
INSERT INTO public.holiday_types (id, created_at, status, name) VALUES
  ('f206c487-5b81-4ae5-9b57-541c477fd915', '2026-08-24 16:23:39.232933+00', 'approved', 'Company Holiday'),
  ('35d1a684-783a-41e2-ae59-f26cd6731cce', '2026-08-24 16:23:39.232933+00', 'approved', 'Festival Holiday'),
  ('129fadd1-d3e4-43f7-b340-d9dc58df8a43', '2026-08-24 16:23:39.232933+00', 'approved', 'National Holiday'),
  ('6cbb8360-e4fb-4960-a2ed-b7c0582c6289', '2026-08-24 16:23:39.232933+00', 'approved', 'Regional Holiday');
