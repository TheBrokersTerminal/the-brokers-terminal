-- INTEL search logging
-- Tracks every broker search query so usage patterns can improve the playbooks over time.
-- Fire-and-forget inserts from search.js — no user-facing impact on write failure.

create table if not exists intel_searches (
  id          uuid        default gen_random_uuid() primary key,
  created_at  timestamptz default now(),
  query       text        not null,
  type        text,                        -- 'company' | 'concept'
  lens_key    text,                        -- active asset lens key
  section     text,                        -- 'overview' | 'pitch' | null (full)
  cache_hit   boolean     default false,   -- true = served from cache
  ticker      text                         -- exchange ticker if resolved
);

-- Fast lookups for analytics
create index if not exists intel_searches_created_at on intel_searches (created_at desc);
create index if not exists intel_searches_lens_key   on intel_searches (lens_key);
create index if not exists intel_searches_query      on intel_searches (lower(query));

-- Only the service role (Netlify functions) can write or read.
-- No public access.
alter table intel_searches enable row level security;
