create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.data_snapshots (
  id bigint generated always as identity primary key,
  source text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.brackets (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  picks jsonb not null,
  champion_pick text not null,
  final_goalscorer_pick text,
  final_score text,
  submitted_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.leaderboard_scores (
  bracket_id bigint primary key references public.brackets(id) on delete cascade,
  points numeric not null default 0,
  rank int,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.brackets enable row level security;
alter table public.leaderboard_scores enable row level security;
alter table public.data_snapshots enable row level security;

create policy "Public leaderboard scores are readable"
  on public.leaderboard_scores for select
  using (true);

create policy "Users can read their own bracket"
  on public.brackets for select
  using (auth.uid() = user_id);

create policy "Public bracket leaderboard rows are readable"
  on public.brackets for select
  using (true);

create policy "Users can submit one bracket"
  on public.brackets for insert
  with check (auth.uid() = user_id);

create policy "Admin can correct own bracket"
  on public.brackets for update
  using (auth.uid() = user_id and lower(auth.jwt() ->> 'email') = 'amaanalizafar@gmail.com')
  with check (auth.uid() = user_id and lower(auth.jwt() ->> 'email') = 'amaanalizafar@gmail.com');

create policy "Profiles are readable"
  on public.profiles for select
  using (true);

create policy "Users can manage own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);
