-- ─────────────────────────────────────────────────────────────────
-- BLOOMBERG MESSENGER UPGRADE
-- Adds firm/position profile fields, cross-firm directory access,
-- and a chat request / accept-reject system.
-- ─────────────────────────────────────────────────────────────────

-- 1. Profile fields on the users table
alter table users add column if not exists firm_name text;
alter table users add column if not exists position  text;
alter table users add column if not exists bio       text;

-- 2. Allow any authenticated user to read basic profile info
--    (required for cross-firm directory)
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'users' and policyname = 'Users can view all profiles'
  ) then
    execute 'create policy "Users can view all profiles" on users for select using (auth.role() = ''authenticated'')';
  end if;
end $$;

-- 3. Chat requests table
create table if not exists chat_requests (
  id          uuid        default gen_random_uuid() primary key,
  created_at  timestamptz default now(),
  from_user   uuid        not null,
  to_user     uuid        not null,
  from_name   text,
  from_firm   text,
  from_pos    text,
  status      text        not null default 'pending',
  constraint  chat_requests_unique unique (from_user, to_user),
  constraint  chat_requests_status check (status in ('pending','accepted','declined'))
);

create index if not exists chat_requests_to_user   on chat_requests (to_user, status);
create index if not exists chat_requests_from_user on chat_requests (from_user);
create index if not exists chat_requests_created   on chat_requests (created_at desc);

alter table chat_requests enable row level security;

-- Senders can insert
create policy "Users can send requests" on chat_requests
  for insert with check (auth.uid() = from_user);

-- Both parties can read
create policy "Users can view their requests" on chat_requests
  for select using (auth.uid() = from_user or auth.uid() = to_user);

-- Only recipient can update status (accept/decline)
create policy "Recipients can update requests" on chat_requests
  for update using (auth.uid() = to_user);

-- Sender can withdraw a pending request
create policy "Senders can delete pending requests" on chat_requests
  for delete using (auth.uid() = from_user and status = 'pending');
