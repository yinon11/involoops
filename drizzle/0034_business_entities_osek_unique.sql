-- One normalized business number maps to at most one issuing entity.
--
-- Existing values are normalized in place (strip spaces, dashes, dots;
-- left-pad a 1–9 digit string to 9). If that would make two rows share
-- a number, this migration stops. It does not merge them.
-- Empty and null numbers stay unset and are excluded from the index.

UPDATE "business_entities"
SET "osek_murshe" = lpad(regexp_replace("osek_murshe", '[[:space:].-]', '', 'g'), 9, '0')
WHERE "osek_murshe" IS NOT NULL
  AND regexp_replace("osek_murshe", '[[:space:].-]', '', 'g') ~ '^[0-9]{1,9}$'
  AND "osek_murshe" IS DISTINCT FROM lpad(regexp_replace("osek_murshe", '[[:space:].-]', '', 'g'), 9, '0');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "business_entities"
    WHERE "osek_murshe" IS NOT NULL
      AND btrim("osek_murshe") <> ''
    GROUP BY "osek_murshe"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate osek_murshe values exist; resolve them before adding the unique index';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "business_entities_osek_murshe_unique"
  ON "business_entities" ("osek_murshe")
  WHERE "osek_murshe" IS NOT NULL AND "osek_murshe" <> '';
