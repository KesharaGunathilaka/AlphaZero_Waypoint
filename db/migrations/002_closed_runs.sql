-- 002: a run closed early ("Close orders now") counts as past its cutoff.
-- Booklet: "Orders received after the cutoff wait for the following run." Before this, the
-- 16:00 clock alone decided the delivery day, so a store order after an early close was
-- refused (WP163) instead of joining the next run. Safe to re-run.
SET search_path = wp, public;

CREATE OR REPLACE FUNCTION next_delivery_date(p_outlet integer, p_temp temp_class, p_from date,
                                              p_now timestamptz DEFAULT now(),
                                              p_respect_cutoff boolean DEFAULT true) RETURNS date
LANGUAGE plpgsql STABLE AS $$
DECLARE d date := p_from; dep smallint; i integer := 0;
BEGIN
  SELECT depot_id INTO dep FROM wp.outlet WHERE outlet_id = p_outlet;
  WHILE i < 60 LOOP
    IF wp.is_working_day(d)
       AND (NOT p_respect_cutoff OR (p_now < wp.run_cutoff(dep, d)
            AND NOT EXISTS (SELECT 1 FROM wp.run r WHERE r.depot_id = dep AND r.service_date = d AND r.state <> 'open'))) THEN
      RETURN d;
    END IF;
    d := d + 1; i := i + 1;
  END LOOP;
  RAISE EXCEPTION 'WP160: outlet % has no % delivery day in the next 60 days', p_outlet, p_temp USING ERRCODE = 'WP160';
END $$;

CREATE OR REPLACE FUNCTION next_open_service_date(p_depot smallint) RETURNS date
LANGUAGE plpgsql STABLE AS $$
DECLARE d date := (now() AT TIME ZONE 'Asia/Colombo')::date; i integer := 0;
BEGIN
  WHILE i < 30 LOOP
    IF wp.is_working_day(d) AND now() < wp.run_cutoff(p_depot, d)
       AND NOT EXISTS (SELECT 1 FROM wp.run r WHERE r.depot_id = p_depot AND r.service_date = d AND r.state <> 'open') THEN
      RETURN d;
    END IF;
    d := d + 1; i := i + 1;
  END LOOP;
  RAISE EXCEPTION 'WP900: no open service date in the next 30 days';
END $$;
