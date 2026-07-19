-- Cenário do teste de transbordo: fila A·101 = [ana(0), bruno(1)].
UPDATE "UnitMembership" SET call_order = 0
WHERE unit_id = '08e2be57-3c48-4ccb-8fc8-50364776c263'
  AND profile_id IN (
    SELECT p.id FROM "Profile" p JOIN "User" u ON u.id = p.user_id
    WHERE u.email = 'ana@demo.test' AND p.role = 'resident'
  );

INSERT INTO "UnitMembership" (id, profile_id, unit_id, call_order, created_at)
SELECT gen_random_uuid(), p.id, '08e2be57-3c48-4ccb-8fc8-50364776c263', 1, now()
FROM "Profile" p JOIN "User" u ON u.id = p.user_id
WHERE u.email = 'bruno@demo.test' AND p.role = 'resident'
ON CONFLICT (profile_id, unit_id) DO UPDATE SET call_order = 1;
