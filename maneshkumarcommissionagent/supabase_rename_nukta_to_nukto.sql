-- ============================================================
--  MANESH KUMAR COMMISSION AGENT — DATABASE RENAME:  nukta_*  →  nukto_*
--  NOTE: table names stay `nukto_*` ON PURPOSE. They are internal identifiers
--  no customer ever sees, and the LIVE database is keyed on them — renaming
--  would orphan every order, wallet balance and user row. Brand = Manesh Kumar
--  Commission Agent; schema = unchanged.
--
--  Ye SIRF tab chalayein jab aapki live DB me purani `nukta_*` tables
--  maujood hon. Ye pehla step hai — iske BAAD hi baaki SQL files chalein:
--     1. supabase_rename_nukta_to_nukto.sql   ← YE FILE (pehle)
--     2. supabase_rls_lockdown.sql
--     3. supabase_backend_v2.sql
--
--  ALTER TABLE ... RENAME data ko chhoota NAHI. Rows, indexes, constraints
--  sab waise ke waise rehte hain — sirf naam badalta hai. Koi data loss nahi.
--
--  SAFE TO RE-RUN: har rename se pehle check hota hai ke purani table
--  maujood hai aur nayi nahi. Agar aap pehle hi chala chuke hain to ye
--  file kuch nahi karegi (koi error nahi).
--
--  ⚠️ PEHLE BACKUP: Supabase → Database → Backups → koi recent backup
--     mojood hona chahiye. Ya Table Editor se CSV export kar lein.
-- ============================================================

begin;

-- ---------- 1) Tables rename ----------
do $$
declare
  t text;
  names text[] := array[
    'users','products','orders','reviews','coupons','analytics','settings',
    'transactions','returns','snapshot','coupon_uses','resets','sessions',
    'rate','config'
  ];
begin
  foreach t in array names loop
    if to_regclass('public.nukta_'||t) is not null
       and to_regclass('public.nukto_'||t) is null then
      execute format('alter table public.%I rename to %I', 'nukta_'||t, 'nukto_'||t);
      raise notice 'renamed nukta_% -> nukto_%', t, t;
    end if;
  end loop;
end $$;

-- ---------- 2) Indexes rename (cosmetic, taake naam confuse na karein) ----------
do $$
declare r record; newname text;
begin
  for r in
    select indexname from pg_indexes
    where schemaname = 'public' and indexname like 'nukta\_%'
  loop
    newname := 'nukto_' || substr(r.indexname, 7);
    if to_regclass('public.'||newname) is null then
      execute format('alter index public.%I rename to %I', r.indexname, newname);
    end if;
  end loop;
end $$;

-- ---------- 3) Sequences rename ----------
do $$
declare r record; newname text;
begin
  for r in
    select sequencename from pg_sequences
    where schemaname = 'public' and sequencename like 'nukta\_%'
  loop
    newname := 'nukto_' || substr(r.sequencename, 7);
    if to_regclass('public.'||newname) is null then
      execute format('alter sequence public.%I rename to %I', r.sequencename, newname);
    end if;
  end loop;
end $$;

-- ---------- 4) Purani policies drop ----------
-- Policies rename ke baad bhi nayi table par chipki rehti hain (purane naam se).
-- RLS lockdown file waise bhi sab drop karti hai, lekin yahan bhi saaf kar dete
-- hain taake beech ki state me koi `anon_all_*` open policy zinda na rahe.
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and (tablename like 'nukto\_%' or tablename like 'nukta\_%')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------- 5) Purane v1 functions hata do ----------
-- (ye waise bhi insecure thay — backend v2 ne inhe replace kiya hai)
drop function if exists reserve_stock(text,int);
drop function if exists release_stock(text,int);
drop function if exists wallet_spend(text,numeric);
drop function if exists release_order_stock(text);
drop function if exists create_password_reset(text,text);
drop function if exists consume_password_reset(text,text,text);
drop function if exists place_order_secure(jsonb);

commit;

-- ============================================================
--  VERIFY (rename ke baad chalayein)
-- ============================================================
-- A) Koi nukta_ table bachi to nahi:
--    select tablename from pg_tables where schemaname='public'
--    and tablename like 'nukta\_%';
--    Expected: 0 rows.
--
-- B) Nayi tables + row counts (data safe hai ya nahi):
--    select relname, n_live_tup from pg_stat_user_tables
--    where relname like 'nukto\_%' order by relname;
--    Expected: wahi counts jo rename se pehle thay.
--
-- C) Ab agla step: supabase_rls_lockdown.sql phir supabase_backend_v2.sql
