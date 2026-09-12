-- =====================================================================
-- Reference / master data seed
--
-- Source Supabase project : mamamjohuuacxezcwgqv
-- Exported                : 2026-09-09
--
-- These are the genuine reference lists carried forward to the Mumbai
-- rebuild. All other data in the source project was test data and was
-- deliberately not exported.
--
-- Tables are ordered parents-before-children (states before cities) so
-- this file can be replayed top-to-bottom with foreign keys enforced.
-- Original id values are preserved exactly.
--
-- 8 tables / 153 rows total:
--   branches 3, departments 11, designations 17, employee_categories 2,
--   relationships 6, holiday_types 4, states 33, cities 77
-- =====================================================================


-- ===== branches (3 rows) =====
INSERT INTO public.branches (id, name, is_active, created_at) VALUES ('e05bf65b-0ef3-44bf-9a38-8b2a46cefc22', 'BR Tool Factory', false, '2026-08-04 04:35:25.640699+00');
INSERT INTO public.branches (id, name, is_active, created_at) VALUES ('b91530ce-15a1-4a7a-b78a-cf7cad611133', 'Old Factory (REF)', true, '2026-08-04 04:34:51.320039+00');
INSERT INTO public.branches (id, name, is_active, created_at) VALUES ('8c64b584-0d57-47c1-9d3c-71eb86a90879', 'Rented Factory New', false, '2026-08-04 04:35:05.769553+00');

-- ===== departments (11 rows) =====
INSERT INTO public.departments (id, name, is_active, created_at) VALUES ('8963901b-0e30-4953-99c0-35175b8fb135', 'Accounts', true, '2026-08-04 06:06:42.546617+00');
INSERT INTO public.departments (id, name, is_active, created_at) VALUES ('1d59306c-5d29-4814-98a1-dcce4c11e331', 'Admin', true, '2026-08-04 06:06:51.110501+00');
INSERT INTO public.departments (id, name, is_active, created_at) VALUES ('59463fef-faf8-489b-a1aa-55e93ff02d52', 'After Sales Service', true, '2026-08-04 06:07:17.556958+00');
INSERT INTO public.departments (id, name, is_active, created_at) VALUES ('c20213a7-e66e-4a6e-a150-f35afe131dc6', 'Designs', true, '2026-08-04 06:08:22.368383+00');
INSERT INTO public.departments (id, name, is_active, created_at) VALUES ('cb4af376-e4c2-4006-ba6b-44f994562787', 'Operations', true, '2026-08-04 06:07:10.780123+00');
INSERT INTO public.departments (id, name, is_active, created_at) VALUES ('adec17cf-1c89-4039-8e09-1f81af21bd54', 'Production', true, '2026-08-04 06:08:03.322807+00');
INSERT INTO public.departments (id, name, is_active, created_at) VALUES ('4425e42b-2889-412a-8d3c-6b49be7b1ff9', 'Purchase', true, '2026-08-04 06:07:03.862888+00');
INSERT INTO public.departments (id, name, is_active, created_at) VALUES ('fd8cca34-608d-4b34-a41e-6ab263b10100', 'Quality', true, '2026-08-04 06:08:13.836131+00');
INSERT INTO public.departments (id, name, is_active, created_at) VALUES ('20155952-3ea9-441f-be0b-31417761f02b', 'Sales', true, '2026-08-04 06:06:47.236027+00');
INSERT INTO public.departments (id, name, is_active, created_at) VALUES ('a88fe5d2-60b7-4c5a-a398-29379568683b', 'Site Installation', true, '2026-08-04 06:08:45.807503+00');
INSERT INTO public.departments (id, name, is_active, created_at) VALUES ('fe723fb4-8701-438f-b9ee-edf3f49186c8', 'Store', true, '2026-08-04 06:07:57.255059+00');

-- ===== designations (17 rows) =====
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('f9db88e6-be77-4ae6-8a2d-becb7fb96fa6', 'Adda-man', true, '2026-08-04 08:52:38.253407+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('5aa54c65-6de4-471b-84c3-8894241e7d47', 'CEO', true, '2026-08-04 08:59:11.518455+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('9052caae-38cd-47c3-8914-20026b42d9fa', 'CNC Operator', true, '2026-08-04 08:52:43.903379+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('ff3ce004-c8bb-445b-ae82-f7b9f049e6cd', 'Fitter', true, '2026-08-04 08:52:50.180538+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('cf1a95da-1337-407d-99cf-d73cff186bfc', 'General Manager', true, '2026-08-04 08:58:26.866808+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('b7feb593-6e9e-4f7d-88e3-827caffbf400', 'Helper', true, '2026-08-04 08:51:52.647276+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('6ad5acb8-6adc-461a-b023-bebbd8ef4b69', 'Jr. Forman', true, '2026-08-04 08:53:00.324776+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('6398bac8-b80e-4061-bd69-a12e5a4275e4', 'Jr. Manager', true, '2026-08-04 08:58:43.791565+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('faae39e8-5ae3-45f2-99e2-40ca186c6e7e', 'Jr. Supervisor', true, '2026-08-04 08:52:00.744397+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('09430687-b87c-49cd-938b-66f0c5ea2f15', 'Latheman', true, '2026-08-04 08:52:12.367206+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('d12940ef-d5c2-46cc-b131-7ae2d62ac901', 'Plant Head', true, '2026-08-04 08:58:55.796403+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('fd9ac972-e990-46f6-b16b-7e2052a5514d', 'Pressman', true, '2026-08-04 08:52:28.667382+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('c107949a-f302-4647-b6a6-332dba688bf9', 'Project Manager', true, '2026-08-04 08:53:42.3014+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('7f48d0c3-d7d8-4ce7-bbd9-e02bc9509334', 'Sr. Foreman', true, '2026-08-04 08:52:54.784175+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('d1fabebd-5704-473b-88a3-a322649a6c5e', 'Sr. Manager', true, '2026-08-04 08:54:50.24293+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('52763833-a5ef-46ec-aaf9-37fc538b06b9', 'Sr. Supervisor', true, '2026-08-04 08:52:06.804514+00');
INSERT INTO public.designations (id, name, is_active, created_at) VALUES ('eab6cfb9-2cbb-4529-86e0-6e943083f0ab', 'Welder', true, '2026-08-04 08:51:47.834437+00');

-- ===== employee_categories (2 rows) =====
INSERT INTO public.employee_categories (id, name, is_active, created_at) VALUES ('f0775a5c-5f1b-4c76-8bbe-34a9be712cd6', 'Staff', true, '2026-08-04 06:09:07.353842+00');
INSERT INTO public.employee_categories (id, name, is_active, created_at) VALUES ('a0e0085c-0c92-4cba-bbab-5fdccc9ed087', 'Worker (Blue Collar)', true, '2026-08-04 06:09:18.443669+00');

-- ===== relationships (6 rows) =====
INSERT INTO public.relationships (id, name, is_active, created_at) VALUES ('7645aaa4-6a59-4e03-ae9f-22ad630e632e', 'Brother', true, '2026-08-04 06:09:35.578985+00');
INSERT INTO public.relationships (id, name, is_active, created_at) VALUES ('b769a105-cca1-4971-968e-b4be86ae5f8b', 'Daughter', true, '2026-08-04 06:10:06.010195+00');
INSERT INTO public.relationships (id, name, is_active, created_at) VALUES ('fb5d1a0d-d5cc-4406-ada9-11bfb76fafa6', 'Father', true, '2026-08-04 06:09:44.977919+00');
INSERT INTO public.relationships (id, name, is_active, created_at) VALUES ('6eaaa0f5-e014-4489-8b9e-67b2f231fa8f', 'Mother', true, '2026-08-04 06:09:48.558576+00');
INSERT INTO public.relationships (id, name, is_active, created_at) VALUES ('7e10f75e-5a6e-4343-8d7f-71f0c57c6878', 'Sister', true, '2026-08-04 06:09:40.463924+00');
INSERT INTO public.relationships (id, name, is_active, created_at) VALUES ('c8d3e133-2a57-487d-aace-266f1c059ef8', 'Son', true, '2026-08-04 06:09:52.191733+00');

-- ===== holiday_types (4 rows) =====
INSERT INTO public.holiday_types (id, name, is_active, created_at) VALUES ('f206c487-5b81-4ae5-9b57-541c477fd915', 'Company Holiday', true, '2026-08-24 16:23:39.232933+00');
INSERT INTO public.holiday_types (id, name, is_active, created_at) VALUES ('35d1a684-783a-41e2-ae59-f26cd6731cce', 'Festival Holiday', true, '2026-08-24 16:23:39.232933+00');
INSERT INTO public.holiday_types (id, name, is_active, created_at) VALUES ('129fadd1-d3e4-43f7-b340-d9dc58df8a43', 'National Holiday', true, '2026-08-24 16:23:39.232933+00');
INSERT INTO public.holiday_types (id, name, is_active, created_at) VALUES ('6cbb8360-e4fb-4960-a2ed-b7c0582c6289', 'Regional Holiday', true, '2026-08-24 16:23:39.232933+00');

-- ===== states (33 rows) =====
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('264c094f-c937-451f-84bc-b779a1aa6002', 'Andhra Pradesh', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('e0bfb51b-074d-4051-bd8c-9fe3119df1a1', 'Arunachal Pradesh', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('3bd52001-15e7-4e09-91db-1847e988c4a4', 'Assam', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('77c7cf9f-59a0-4ed3-a807-8306947589e6', 'Bihar', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('9206b4f1-ad25-41ea-9d97-9dfd5c86662a', 'Chandigarh', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('201f3edc-138a-4f15-a2f4-b0a8dffe6d0e', 'Chhattisgarh', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('54b02c0d-8ddc-49e6-a4ac-b5c9aeb6268b', 'Delhi', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('ebf9163e-c1c1-45e7-80a0-f788eae60b48', 'Goa', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('9c055cc1-6ab1-44c9-b5e2-1c19b3b85f34', 'Gujarat', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('bff2c196-4192-4581-979b-5f31ca9605a7', 'Haryana', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('5074a1a8-ce3a-4097-81da-9a8ed145363a', 'Himachal Pradesh', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('5c1cc26c-2a44-4836-b746-8621f6167bac', 'Jammu and Kashmir', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('b7e53009-6f3c-4acc-8af8-80c8c16150b0', 'Jharkhand', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('d1de72d8-f1e5-470d-973e-81a71cfe6a5a', 'Karnataka', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('cd1b4d01-e079-480d-883b-d857b74a3044', 'Kerala', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('2efc78dd-f4f4-424c-9b56-aef2dcb44f96', 'Ladakh', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('6dd22f34-9867-415e-aecd-f3a659f44642', 'Madhya Pradesh', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('4aae7e09-981e-4602-b363-9ebb7d9f0d6b', 'Maharashtra', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('96fb89aa-cd02-470a-98db-94924ee1b55d', 'Manipur', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('86119069-fdfc-4f61-a0a3-0f9ce1d8c752', 'Meghalaya', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('7f896dbf-8d2c-455e-ad4c-4431f1c1424a', 'Mizoram', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('6aa29fcb-a734-4c79-b552-c02f9192f3c1', 'Nagaland', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('91c6b1cc-ff86-423d-8716-d5afb665dccd', 'Odisha', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('74f8e93f-35da-4f77-87cf-9d09c71c038b', 'Puducherry', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('447c39c5-046f-4298-88ed-0e3f269bea74', 'Punjab', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('b5cbc61c-f629-4103-b0bb-59c3a84beb70', 'Rajasthan', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('1cc4c150-d530-4f77-ace7-fd0e379fa479', 'Sikkim', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('7fa5da3d-8e9e-4db9-a81a-429ab1b5c009', 'Tamil Nadu', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('357b5aab-6bd4-4b01-ba88-5a00c9795f64', 'Telangana', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('0982a7b6-45a1-48ee-853a-6d376e7b6001', 'Tripura', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('48992234-61e5-4522-83f0-ef786aa3c373', 'Uttar Pradesh', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('d719bc34-fed5-4131-ac10-79e95095b87e', 'Uttarakhand', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.states (id, name, is_active, created_at) VALUES ('041a2ac0-46d0-4193-9390-9c10424cbadb', 'West Bengal', true, '2026-08-04 04:45:18.174919+00');

-- ===== cities (77 rows) =====
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('767f9b5f-9345-4bb2-aacd-fa3b6e8a8d9f', 'Vijayawada', '264c094f-c937-451f-84bc-b779a1aa6002', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('bc04915e-1c8a-406a-b2b9-6c8bc17b7ad1', 'Visakhapatnam', '264c094f-c937-451f-84bc-b779a1aa6002', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('43dd3046-75d4-4eba-ab4c-3a75283f6a8a', 'Itanagar', 'e0bfb51b-074d-4051-bd8c-9fe3119df1a1', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('41f750ea-a5cc-4aa5-9f8f-2c4761e7385a', 'Guwahati', '3bd52001-15e7-4e09-91db-1847e988c4a4', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('c955abce-8daf-47cd-919d-5929fa4bbd79', 'Gaya', '77c7cf9f-59a0-4ed3-a807-8306947589e6', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('26ac8351-9dbb-42f2-88aa-5cc81ae5674b', 'Patna', '77c7cf9f-59a0-4ed3-a807-8306947589e6', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('31e55bdf-e8cc-481b-be43-7434da74d884', 'Chandigarh', '9206b4f1-ad25-41ea-9d97-9dfd5c86662a', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('f016f6c7-6db9-474f-a581-10f45c811604', 'Bilaspur', '201f3edc-138a-4f15-a2f4-b0a8dffe6d0e', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('b8522b42-6411-48f4-abec-4f6074e3883f', 'Raipur', '201f3edc-138a-4f15-a2f4-b0a8dffe6d0e', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('df239da1-eee3-4a51-bacc-ef43fb12634c', 'New Delhi', '54b02c0d-8ddc-49e6-a4ac-b5c9aeb6268b', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('f9e7bfb4-2aa7-4813-866f-ef793ff1e6b1', 'Panaji', 'ebf9163e-c1c1-45e7-80a0-f788eae60b48', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('839a7571-1cd1-4d6d-a9ed-167bb2e08a47', 'Ahmedabad', '9c055cc1-6ab1-44c9-b5e2-1c19b3b85f34', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('9e4e2fdc-7c30-46ff-92d8-250d79dcb006', 'Rajkot', '9c055cc1-6ab1-44c9-b5e2-1c19b3b85f34', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('ec0e96d6-3738-4ce9-9f95-95dd9b08f1a4', 'Surat', '9c055cc1-6ab1-44c9-b5e2-1c19b3b85f34', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('2e840082-2f98-4410-ad3f-c3a820fe1bc7', 'Vadodara', '9c055cc1-6ab1-44c9-b5e2-1c19b3b85f34', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('ae1d34fc-d7de-4a8f-8b8f-7e4fb816f974', 'Ambala', 'bff2c196-4192-4581-979b-5f31ca9605a7', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('86f93d0c-fe43-4b34-a634-670a2f631809', 'Faridabad', 'bff2c196-4192-4581-979b-5f31ca9605a7', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('75a5407a-87cb-4dd2-8ddd-3a93c7af757d', 'Gurugram', 'bff2c196-4192-4581-979b-5f31ca9605a7', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('032e6e29-621c-421b-9f36-4a223b7d2695', 'Hisar', 'bff2c196-4192-4581-979b-5f31ca9605a7', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('b077b9a8-d55f-4e2b-adfa-f5d91c89016e', 'Karnal', 'bff2c196-4192-4581-979b-5f31ca9605a7', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('f357b618-f113-44ae-80c0-9d20091f0aa9', 'Panipat', 'bff2c196-4192-4581-979b-5f31ca9605a7', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('a8286682-8cc6-410c-90c2-3a19759256f6', 'Manali', '5074a1a8-ce3a-4097-81da-9a8ed145363a', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('eab235b8-4c97-4fe3-a472-4d6a62d0de45', 'Shimla', '5074a1a8-ce3a-4097-81da-9a8ed145363a', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('453d8351-3639-4a0c-8426-97a6b4ea98d2', 'Jammu', '5c1cc26c-2a44-4836-b746-8621f6167bac', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('2d70b8fb-dcfe-4c5d-a96a-335a251d32fb', 'Srinagar', '5c1cc26c-2a44-4836-b746-8621f6167bac', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('424cdd81-aa4c-4058-aea7-3a7a9080be6e', 'Jamshedpur', 'b7e53009-6f3c-4acc-8af8-80c8c16150b0', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('2a750352-f3a3-45a4-887e-cc6e2a642156', 'Ranchi', 'b7e53009-6f3c-4acc-8af8-80c8c16150b0', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('9f68dea8-712e-44d6-866c-bbe0378f744a', 'Bengaluru', 'd1de72d8-f1e5-470d-973e-81a71cfe6a5a', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('2a892d6b-77ba-497e-bdd9-1f81e5f5e9a3', 'Hubli', 'd1de72d8-f1e5-470d-973e-81a71cfe6a5a', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('86dc8391-cafa-49b0-93bb-05591f24e68a', 'Mysuru', 'd1de72d8-f1e5-470d-973e-81a71cfe6a5a', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('4568c1dd-53a0-437e-b10e-079bf9acf9be', 'Kochi', 'cd1b4d01-e079-480d-883b-d857b74a3044', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('d800ee67-5a92-4623-bf19-5d864f930d9d', 'Kozhikode', 'cd1b4d01-e079-480d-883b-d857b74a3044', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('5a5b1a99-ffa6-4826-94fb-a319f7ead428', 'Thiruvananthapuram', 'cd1b4d01-e079-480d-883b-d857b74a3044', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('ce6634bb-afce-46ef-b45a-9411bb21a683', 'Leh', '2efc78dd-f4f4-424c-9b56-aef2dcb44f96', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('2406495b-9a16-455d-8081-86af5a37629f', 'Bhopal', '6dd22f34-9867-415e-aecd-f3a659f44642', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('09cad3d5-afe9-43ef-8f5e-f99cc535f1a8', 'Gwalior', '6dd22f34-9867-415e-aecd-f3a659f44642', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('467ee662-e9c6-48b1-ba9b-f0de85b65dc9', 'Indore', '6dd22f34-9867-415e-aecd-f3a659f44642', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('66c6eb59-fa30-483d-ac94-2658a5a0f388', 'Jabalpur', '6dd22f34-9867-415e-aecd-f3a659f44642', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('27cbf038-815d-4b46-81b0-de0c83fcc653', 'Mumbai', '4aae7e09-981e-4602-b363-9ebb7d9f0d6b', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('f5e8cec4-796e-44e7-a296-3b70cc65ff65', 'Nagpur', '4aae7e09-981e-4602-b363-9ebb7d9f0d6b', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('7014b6a7-f008-4c99-8d29-611143e9e846', 'Nashik', '4aae7e09-981e-4602-b363-9ebb7d9f0d6b', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('d61a1740-e98f-4ad9-a4aa-e9c4cfd59dd0', 'Pune', '4aae7e09-981e-4602-b363-9ebb7d9f0d6b', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('b528eaf7-815f-45ef-a82f-93924a968935', 'Imphal', '96fb89aa-cd02-470a-98db-94924ee1b55d', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('994058a9-2792-419f-84f7-ebc2f3666b8f', 'Shillong', '86119069-fdfc-4f61-a0a3-0f9ce1d8c752', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('3f927b4d-35d2-45ac-b8ee-ac250acfcd00', 'Aizawl', '7f896dbf-8d2c-455e-ad4c-4431f1c1424a', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('d767bda4-2d98-47f1-84e6-a18ff90d1868', 'Kohima', '6aa29fcb-a734-4c79-b552-c02f9192f3c1', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('ffa8bda8-c4e4-41c4-b8e8-c9fec236db2a', 'Bhubaneswar', '91c6b1cc-ff86-423d-8716-d5afb665dccd', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('0e3fe4c6-0ee8-4236-9eca-b22a9a569f38', 'Cuttack', '91c6b1cc-ff86-423d-8716-d5afb665dccd', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('3afd408f-1214-44a2-bd4d-98d455cc991d', 'Puducherry', '74f8e93f-35da-4f77-87cf-9d09c71c038b', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('2f67f2a3-ac29-4ffc-b255-1a425f3b74d9', 'Amritsar', '447c39c5-046f-4298-88ed-0e3f269bea74', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('94e9776c-ed98-4f6c-a885-d171a792e191', 'Bathinda', '447c39c5-046f-4298-88ed-0e3f269bea74', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('728a4432-0f26-474c-b42f-5aa1753f0a3d', 'Jalandhar', '447c39c5-046f-4298-88ed-0e3f269bea74', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('f694e1f1-0378-4797-a6ea-4b1a03518882', 'Ludhiana', '447c39c5-046f-4298-88ed-0e3f269bea74', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('3562afc9-aade-4029-99e0-b58e2d495a34', 'Mohali', '447c39c5-046f-4298-88ed-0e3f269bea74', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('71d1a83e-fa50-452b-8aae-5dd4609fedff', 'Patiala', '447c39c5-046f-4298-88ed-0e3f269bea74', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('481ec4b4-3d53-443b-98af-c03b0476b99b', 'Jaipur', 'b5cbc61c-f629-4103-b0bb-59c3a84beb70', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('d7964378-00f3-4a55-97f0-7b3da5eb0ac3', 'Jodhpur', 'b5cbc61c-f629-4103-b0bb-59c3a84beb70', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('f25915fd-a255-409b-a5fb-961c1d2af423', 'Kota', 'b5cbc61c-f629-4103-b0bb-59c3a84beb70', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('e320b5c8-9efa-45f9-9241-85e79623437f', 'Udaipur', 'b5cbc61c-f629-4103-b0bb-59c3a84beb70', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('acd83f8d-8378-4eff-9103-1f0cb18877bd', 'Gangtok', '1cc4c150-d530-4f77-ace7-fd0e379fa479', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('99a74e08-1a34-4b66-b5e6-129c94d606d1', 'Chennai', '7fa5da3d-8e9e-4db9-a81a-429ab1b5c009', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('9365ecea-b379-4c8f-97d2-8ee5288c837f', 'Coimbatore', '7fa5da3d-8e9e-4db9-a81a-429ab1b5c009', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('78aefbee-1197-44e4-b463-fe07fbecee59', 'Madurai', '7fa5da3d-8e9e-4db9-a81a-429ab1b5c009', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('6ed5c6c8-9390-4211-a5ef-2e470350ec90', 'Hyderabad', '357b5aab-6bd4-4b01-ba88-5a00c9795f64', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('e8cfa8c9-4303-4ce4-b530-8afc7f66d72b', 'Warangal', '357b5aab-6bd4-4b01-ba88-5a00c9795f64', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('6cd41132-1ff6-460a-a5ea-d3c19da0fb85', 'Agartala', '0982a7b6-45a1-48ee-853a-6d376e7b6001', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('81230de2-7f97-4416-8a3e-9404d5796999', 'Agra', '48992234-61e5-4522-83f0-ef786aa3c373', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('c185fa76-5d8b-4ba7-a889-f3d7ae1d1c6e', 'Ghaziabad', '48992234-61e5-4522-83f0-ef786aa3c373', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('858b500e-207c-40fc-9aef-44c774003184', 'Kanpur', '48992234-61e5-4522-83f0-ef786aa3c373', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('a6ccb997-b245-490d-b912-2a06e674cf6d', 'Lucknow', '48992234-61e5-4522-83f0-ef786aa3c373', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('1ee6ef8e-8c3f-4cea-8709-ce1d300c4632', 'Noida', '48992234-61e5-4522-83f0-ef786aa3c373', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('dffbebe3-4e56-4826-80a8-7d203787a21b', 'Varanasi', '48992234-61e5-4522-83f0-ef786aa3c373', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('91f2a73a-7aee-465c-ac5b-8b59356f702d', 'Dehradun', 'd719bc34-fed5-4131-ac10-79e95095b87e', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('ca6181e8-feaf-4560-9c89-ccb632331b82', 'Haridwar', 'd719bc34-fed5-4131-ac10-79e95095b87e', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('9c67a1ca-a4fd-49a8-a74b-1344561906d3', 'Howrah', '041a2ac0-46d0-4193-9390-9c10424cbadb', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('7d52f8c4-1b2d-413d-a036-b1de49b04f06', 'Kolkata', '041a2ac0-46d0-4193-9390-9c10424cbadb', true, '2026-08-04 04:45:18.174919+00');
INSERT INTO public.cities (id, name, state_id, is_active, created_at) VALUES ('dc76913b-68c7-47ef-8301-a3e5e43e8344', 'Siliguri', '041a2ac0-46d0-4193-9390-9c10424cbadb', true, '2026-08-04 04:45:18.174919+00');
