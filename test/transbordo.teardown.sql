-- Desfaz o cenário: tira o bruno da unidade da ana (a dele, A·102, não é tocada).
DELETE FROM "UnitMembership"
WHERE unit_id = '08e2be57-3c48-4ccb-8fc8-50364776c263'
  AND profile_id IN (
    SELECT p.id FROM "Profile" p JOIN "User" u ON u.id = p.user_id
    WHERE u.email = 'bruno@demo.test' AND p.role = 'resident'
  );

-- Restaura a fila da ana. Sem isto, um teste que a tira da fila deixa a
-- unidade muda e quebra silenciosamente os testes seguintes.
UPDATE "UnitMembership"
SET call_order = 0, in_queue = true
WHERE unit_id = '08e2be57-3c48-4ccb-8fc8-50364776c263';
