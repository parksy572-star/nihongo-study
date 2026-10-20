-- 나만의 일본어 공부 사이트 · Supabase 초기 설정
-- Supabase 대시보드 > SQL Editor > New query 에 전체를 붙여 넣고 Run 을 누르세요.
-- 여러 번 실행해도 안전하도록 작성했습니다.

-- 1) 모든 학습 데이터를 담는 표 (단어, 한자, 문법, 면접 세션, 작문, 설정 등)
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null,               -- 'word' | 'kanji' | 'grammar' | 'preset' | 'session' | 'writing' | 'log' | 'settings' | 'test'
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists items_user_kind_idx
  on public.items (user_id, kind, updated_at desc);

-- 2) 내 데이터는 나만 읽고 쓸 수 있게 (행 단위 보안)
alter table public.items enable row level security;

drop policy if exists "items: select own" on public.items;
drop policy if exists "items: insert own" on public.items;
drop policy if exists "items: update own" on public.items;
drop policy if exists "items: delete own" on public.items;

create policy "items: select own" on public.items
  for select to authenticated using (user_id = (select auth.uid()));
create policy "items: insert own" on public.items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "items: update own" on public.items
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "items: delete own" on public.items
  for delete to authenticated using (user_id = (select auth.uid()));

-- 3) 수정 시각 자동 기록
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- 4) PC·휴대폰 실시간 동기화 (변경 사항을 바로 알림)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items'
  ) then
    alter publication supabase_realtime add table public.items;
  end if;
end $$;

-- 5) 작문 사진·면접 녹음 보관함 (비공개). 파일은 media/<내 사용자 id>/... 에만 저장 가능
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists "media: read own"   on storage.objects;
drop policy if exists "media: insert own" on storage.objects;
drop policy if exists "media: update own" on storage.objects;
drop policy if exists "media: delete own" on storage.objects;

create policy "media: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media: insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
