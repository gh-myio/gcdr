-- Corrige encoding do brandName / name do theme Sá Cavalcante
-- U+FFFD (replacement char) → á correto

UPDATE look_and_feels
SET
  name        = 'Sá Cavalcante',
  brand_name  = 'Sá Cavalcante',
  description = 'Tema institucional Sá Cavalcante — Paleta de Cores Institucional (verdes + laranja + marrom)',
  tagline     = 'Trazemos a humanidade e os negócios como proposta visual.',
  updated_at  = now()
WHERE id = '45bc4747-62fb-400a-8a15-9fa24b4a188f';

-- Verificação
SELECT id, name, brand_name, description, tagline
FROM look_and_feels
WHERE id = '45bc4747-62fb-400a-8a15-9fa24b4a188f';
