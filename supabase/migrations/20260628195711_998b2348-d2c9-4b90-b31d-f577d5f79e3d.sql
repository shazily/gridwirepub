DELETE FROM public.alerts a USING public.alerts b
WHERE a.ctid < b.ctid AND a.org_id = b.org_id AND a.event_type = b.event_type;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_org_event_unique UNIQUE (org_id, event_type);