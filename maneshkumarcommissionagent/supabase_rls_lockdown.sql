-- ============================================================
--  MANESH KUMAR COMMISSION AGENT — RLS LOCKDOWN (authoritative)
--  NOTE: table names stay `nukto_*` ON PURPOSE. They are internal identifiers
--  no customer ever sees, and the LIVE database is keyed on them — renaming
--  would orphan every order, wallet balance and user row. Brand = Manesh Kumar
--  Commission Agent; schema = unchanged.
--  Ye file `supabase_hardened.sql` ko REPLACE karti hai. Wo file
--  deprecated hai — usme 3 real security holes thay:
--    (a) purani `anon_*` PERMISSIVE policies drop nahi hoti thin, aur
--        Postgres multiple permissive policies ko OR karta hai →
--        purani `using (true)` policy nayi tight policy ko override kar deti thi;
--    (b) `to authenticated using (true)` = har logged-in user sab ke orders
--        padh sakta tha / kisi aur ke user_id par order bana sakta tha;
--    (c) nukto_returns / nukto_snapshot / nukto_users ki open policies
--        bilkul untouched reh jati thin.
--
--  THREAT MODEL (padho, phir Run karo):
--    Ye app Supabase Auth use NAHI karti. Login custom hai
--    (nukto_users + localStorage session), aur browser har request
--    ANON key se bhejta hai. Iska matlab:
--      * `auth.uid()` HAMESHA null hai → `auth.uid() = user_id` wali
--        koi bhi policy kabhi match nahi karegi.
--      * `to authenticated` wali policies kabhi trigger hi nahi hongi.
--    Isliye ekmatr sahi model:
--        anon  = sirf PUBLIC catalog READ (products/coupons/settings/reviews)
--        baaki = 0 access; saara likhna/padhna Edge Functions se
--                (service_role key, jo sirf Supabase secrets me rehti hai).
--
--  SAFE TO RE-RUN. Idempotent. Ye script har nukto_* table par MAUJOOD
--  saari policies ko enumerate karke drop karti hai (naam guess nahi karti),
--  taake koi purani `anon_all_*` / `anon_write_*` policy chhoot na jaye.
-- ============================================================

begin;

-- ---------- 0) RLS ON everywhere + FORCE (owner par bhi lagu) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'nukto_users','nukto_products','nukto_orders','nukto_reviews',
    'nukto_coupons','nukto_analytics','nukto_settings','nukto_transactions',
    'nukto_returns','nukto_snapshot'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('alter table public.%I force  row level security', t);
    end if;
  end loop;
end $$;

-- ---------- 1) HAR maujooda policy drop karo (clean slate) ----------
-- Yehi wo step hai jo hardened.sql me missing tha. Bina iske purani
-- PERMISSIVE `true` policies zinda rehti hain aur OR ho kar sab kholti hain.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename like 'nukto\_%'
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ---------- 2) Sirf PUBLIC catalog read ----------
-- anon/authenticated ko in 4 tables par read-only. Koi insert/update/delete nahi.
create policy "public_read_products" on nukto_products
  for select to anon, authenticated using (true);

create policy "public_read_coupons" on nukto_coupons
  for select to anon, authenticated using (active = true);
  -- NOTE: sirf active coupons expose hote hain. Inactive/secret codes,
  -- max_uses aur uses ki asli validation server-side (place_order_secure) hoti hai.

create policy "public_read_settings" on nukto_settings
  for select to anon, authenticated using (true);
  -- NOTE: nukto_settings me kabhi bhi secret mat rakhna (keys/tokens/hashes).
  -- Ye publicly readable hai by design (storeName, deliveryFee, phone, tagline).

create policy "public_read_reviews" on nukto_reviews
  for select to anon, authenticated using (true);

-- ---------- 3) Baaki sab tables: ZERO client access ----------
-- nukto_users, nukto_orders, nukto_transactions, nukto_returns,
-- nukto_analytics, nukto_snapshot par jaan-boojh kar KOI policy nahi banai.
-- RLS enabled + zero policies = anon/authenticated ke liye deny-by-default
-- (select/insert/update/delete sab fail). service_role RLS bypass karta hai,
-- isliye Edge Functions normal chalti rahengi.

-- Defense in depth: grants bhi kheench lo, taake koi future policy galti se
-- table ko expose kar de to bhi PostgREST ko table-level permission na mile.
revoke all on table nukto_users        from anon, authenticated;
revoke all on table nukto_orders       from anon, authenticated;
revoke all on table nukto_transactions from anon, authenticated;
revoke all on table nukto_returns      from anon, authenticated;
revoke all on table nukto_snapshot     from anon, authenticated;
revoke all on table nukto_analytics    from anon, authenticated;

-- Read-only tables par sirf SELECT grant rehna chahiye.
revoke all    on table nukto_products from anon, authenticated;
revoke all    on table nukto_coupons  from anon, authenticated;
revoke all    on table nukto_settings from anon, authenticated;
revoke all    on table nukto_reviews  from anon, authenticated;
grant  select on table nukto_products, nukto_coupons, nukto_settings, nukto_reviews
       to anon, authenticated;

-- ---------- 4) Sequences bhi lock ----------
do $$
declare r record;
begin
  for r in select sequencename from pg_sequences
           where schemaname='public' and sequencename like 'nukto\_%'
  loop
    execute format('revoke all on sequence public.%I from anon, authenticated', r.sequencename);
  end loop;
end $$;

-- ---------- 5) RPC surface: sirf wahi functions jo safe hain ----------
-- place_order_secure / password-reset flows SECURITY DEFINER hain aur khud
-- apni validation karti hain. Baaki raw helpers ko client se chhupao.
do $$
begin
  if to_regprocedure('public.reserve_stock(text,int)') is not null then
    revoke all on function public.reserve_stock(text,int) from anon, authenticated;
  end if;
  if to_regprocedure('public.release_stock(text,int)') is not null then
    revoke all on function public.release_stock(text,int) from anon, authenticated;
  end if;
  if to_regprocedure('public.wallet_spend(text,numeric)') is not null then
    revoke all on function public.wallet_spend(text,numeric) from anon, authenticated;
  end if;
end $$;

commit;

-- ============================================================
--  VERIFY (ye 3 queries chala kar khud check karo)
-- ============================================================
-- A) Koi bhi `true`-wali open policy bachi to nahi:
--    select tablename, policyname, cmd, qual, with_check
--    from pg_policies where schemaname='public' and tablename like 'nukto\_%'
--    order by tablename;
--    Expected: sirf 4 rows (products/coupons/settings/reviews, cmd=SELECT).
--
-- B) Har nukto_* table par RLS on hai:
--    select relname, relrowsecurity, relforcerowsecurity from pg_class
--    where relname like 'nukto\_%' and relkind='r';
--    Expected: dono columns `t`.
--
-- C) anon ke paas sensitive tables par grant nahi:
--    select table_name, privilege_type from information_schema.role_table_grants
--    where grantee='anon' and table_name like 'nukto\_%' order by 1;
--    Expected: sirf SELECT on products/coupons/settings/reviews.
--
-- ============================================================
--  ISKE BAAD CLIENT ME KYA TOOTEGA (expected — ye by design hai)
-- ============================================================
--  * Browser se nukto_users / nukto_orders / nukto_transactions /
--    nukto_returns / nukto_analytics / nukto_snapshot ka direct
--    insert/select ab FAIL karega (401/permission denied).
--    App localStorage fallback par chalti rahegi (offline mode) —
--    data khoyega nahi, bas cloud sync in tables ke liye band.
--  * Order placement ka sahi rasta: place_order_secure() RPC
--    (supabase_backend.sql) — wo SECURITY DEFINER hai, server par
--    price/stock/coupon validate karti hai. Client totals kabhi trust nahi.
--  * Signup/login, wallet top-up, analytics aur admin writes ko bhi
--    Edge Functions ke peeche le jana baaki hai → TODO.md dekho.
--  * Jab tak wo functions nahi bante, admin panel cloud writes nahi
--    kar payega; ye jaan-boojh kar hai (data leak se behtar hai).
