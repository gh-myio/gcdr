-- Clear all themes (look_and_feels)
DO $$
DECLARE v_count INT;
BEGIN
  DELETE FROM look_and_feels;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % theme(s)', v_count;
END $$;
