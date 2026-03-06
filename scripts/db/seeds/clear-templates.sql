-- Clear all templates
DO $$
DECLARE v_count INT;
BEGIN
  DELETE FROM templates;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % template(s)', v_count;
END $$;
