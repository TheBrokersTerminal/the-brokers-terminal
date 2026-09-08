-- Gold COT Reports table
-- Run this once in Supabase SQL editor: Dashboard → SQL Editor → New Query

CREATE TABLE IF NOT EXISTS public.gold_cot_reports (
    report_date             DATE    PRIMARY KEY,
    open_interest           INT     NOT NULL,
    managed_money_long      INT     NOT NULL,
    managed_money_short     INT     NOT NULL,
    managed_money_net       INT     GENERATED ALWAYS AS (managed_money_long - managed_money_short) STORED,
    producer_long           INT     NOT NULL,
    producer_short          INT     NOT NULL,
    producer_net            INT     GENERATED ALWAYS AS (producer_long - producer_short) STORED,
    swap_long               INT     NOT NULL,
    swap_short              INT     NOT NULL,
    swap_net                INT     GENERATED ALWAYS AS (swap_long - swap_short) STORED,
    created_at              TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- Allow the service role (Netlify function) to read and upsert
ALTER TABLE public.gold_cot_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.gold_cot_reports
    FOR ALL USING (auth.role() = 'service_role');

-- Public read for the terminal (anon key can read)
CREATE POLICY "anon_read" ON public.gold_cot_reports
    FOR SELECT USING (true);
