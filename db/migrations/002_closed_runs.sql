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

-- The order form names the run that has just closed: the operating day before the one now offered
-- (after an early close of Tuesday, an order for Wednesday says "the Tue 6 Oct run has closed").
CREATE OR REPLACE FUNCTION order_slot(p_outlet integer, p_temp temp_class)
RETURNS TABLE (delivery_date date, cutoff_at timestamptz, closes_in interval, closed_date date,
               joins_later_run boolean, existing_order_id bigint, existing_status order_status)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
DECLARE d date; dep smallint; c date;
BEGIN
  IF NOT wp.can_see_outlet(p_outlet) THEN RETURN; END IF;
  SELECT depot_id INTO dep FROM wp.outlet WHERE outlet_id = p_outlet;
  c := wp.next_delivery_date(p_outlet, p_temp, current_date, now(), false);   -- first scheduled day, cutoff ignored
  d := wp.next_delivery_date(p_outlet, p_temp, current_date, now(), true);    -- first day still open
  delivery_date := d; cutoff_at := wp.run_cutoff(dep, d); closes_in := cutoff_at - now();
  closed_date := CASE WHEN c <> d THEN wp.previous_working_day(d) END; joins_later_run := (c <> d);
  SELECT h.order_id, h.status INTO existing_order_id, existing_status FROM wp.order_header h
   WHERE h.outlet_id = p_outlet AND h.delivery_date = d AND h.temp = p_temp AND h.deferral_count = 0 AND h.status <> 'not_delivered';
  RETURN NEXT;
END $$;
