-- Images on order lines and invoices.
--
-- coffee_products stored `image_filename` + `image_extension` but not the public path,
-- and the path cannot be rebuilt from those: it needs a collection segment
-- ("images/Capsules/Vertuo/Barista Creation/Bianco Forte.webp") that the catalogue does
-- not hold. popular_products_cache had real paths but is unreadable by
-- filspresso_backend_svc and covers 20 of 100 products, so it is not a catalogue.
--
-- The authoritative source is src/data/coffee.generated.json, which is generated from the
-- capsule library and carries the full public path for all 100 products. It is already
-- copied into the backend image as bootstrap-data/coffee.generated.json.
--
-- IDEMPOTENT for the column. The backfill is a separate one-off script
-- (data/backfill-coffee-image-paths.py) because it needs the generated JSON and must run
-- after the column exists; re-running it is harmless.

ALTER TABLE coffee_products ADD COLUMN IF NOT EXISTS image_path VARCHAR(512);

-- machine_products already stores the full path in `image`, which is why order lines for
-- machines had an image and capsules did not. No change needed there.

-- Guard against a value that is not a same-origin asset path. Order lines and invoices
-- render this, so an absolute URL or a traversal here would let a catalogue row point
-- the app at an arbitrary host.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'coffee_products'::regclass
       AND conname = 'coffee_products_image_path_chk'
  ) THEN
    ALTER TABLE coffee_products ADD CONSTRAINT coffee_products_image_path_chk
      CHECK (
        image_path IS NULL
        OR (
          char_length(image_path) <= 512
          AND image_path !~* '^[a-z][a-z0-9+.-]*:'
          AND image_path !~* '^//'
          AND image_path !~ '\.\.'
        )
      );
  END IF;
END $$;