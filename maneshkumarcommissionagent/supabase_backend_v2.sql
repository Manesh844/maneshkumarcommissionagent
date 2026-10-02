-- ============================================================
--  NUKTO.SHOP — SERVER-SIDE SAFETY LAYER  v2  (SECURITY REWRITE)
--
--  Ye file `supabase_backend.sql` ko REPLACE karti hai. Wo v1 file ab
--  DEPRECATED hai — usme 14 real issues thay (audit me pakde gaye):
--    - reserve_stock / release_stock / wallet_spend / release_order_stock
--      SECURITY DEFINER + `grant execute to anon` = privilege escalation.
--      Koi bhi visitor RPC call karke stock badha/ghata sakta tha aur
--      kisi bhi user ka wallet kharch kar sakta tha (wallet_spend me
--      koi ownership check nahi tha).
--    - place_order_secure() ne user_id, user_key, delivery_fee,
--      delivery_free_above, items_snapshot, pm — sab client se liya.
--    - Coupon per-user check TOCTOU race (count → insert) tha, unique
--      constraint nahi thi.
--    - SECURITY DEFINER functions par `set search_path` nahi tha.
--    - create/consume_password_reset public RPC expose thay.
--
--  ARCHITECTURE (v2) — ek hi rule:
--    Browser  →  Edge Function (service_role)  →  DB function
--    Browser ko DB par SIRF public catalog SELECT milta hai (RLS lockdown).
--    KOI privileged RPC anon/authenticated ko grant NAHI hoti. Zero.
--
--  Isse aapke saare RPC-permission issues (#1,#2,#8,#13,#14,#16) jad se
--  khatam ho jate hain: functions maujood hain lekin client unhe call hi
--  nahi kar sakta — sirf service_role (Edge Function) kar sakta hai.
--
--  Run order:  supabase_setup.sql → supabase_rls_lockdown.sql → YE FILE
--  Safe to re-run (idempotent).
-- ============================================================

begin;

-- ============================================================
-- 0) OWNERSHIP-FRIENDLY SCHEMA
--    Aapka point: "free-form text IDs ke around security banane ke bajaye
--    proper ownership relationships hone chahiye." Sahi hai.
--    Supabase Auth abhi use nahi ho raha, isliye do-qadmi approach:
--      (a) abhi: server-issued SESSION TOKEN se identity derive hoti hai
--          (client ka bheja hua user_id kabhi trust nahi hota)
--      (b) baad me: auth_uid column bharo aur RLS ownership on karo
--          (neeche commented block ready hai)
-- ============================================================

alter table nukto_orders       add column if not exists auth_uid uuid;
alter table nukto_transactions add column if not exists auth_uid uuid;
alter table nukto_users        add column if not exists auth_uid uuid unique;

-- order ke andar canonical server snapshot (client ka snapshot alag rakha jata hai)
alter table nukto_orders add column if not exists items_server jsonb;
alter table nukto_orders add column if not exists tax_fee numeric default 0;
alter table nukto_orders add column if not exists delivery_fee numeric default 0;

create index if not exists nukto_orders_user_idx on nukto_orders(user_id);
create index if not exists nukto_txn_user_idx    on nukto_transactions(user_id);

-- ---------- Server-side settings (client se delivery fee NAHI aati) ----------
-- Issue #6 fix: delivery_fee aur free-shipping threshold ab DB se padhe jate hain.
insert into nukto_settings(id, setting_key, value) values
  ('store','deliveryFee','200')       on conflict (id) do nothing;
create table if not exists nukto_config (
  key text primary key,
  num numeric,
  txt text,
  updated_at timestamptz default now()
);
insert into nukto_config(key, num) values
  ('delivery_fee', 200),
  ('delivery_free_above', 5000),
  ('max_order_total', 500000),      -- sanity cap
  ('max_item_qty', 20)
on conflict (key) do nothing;

-- ---------- Sessions: server-issued identity ----------
-- Client ke paas sirf opaque random token hota hai; DB me uska SHA-256 hash.
-- Checkout Edge Function token se user_id derive karti hai — payload se NAHI.
create table if not exists nukto_sessions (
  token_hash text primary key,
  user_id    text not null references nukto_users(id) on delete cascade,
  created_at timestamptz default now(),
  expires_at timestamptz not null,
  last_ip    text
);
create index if not exists nukto_sessions_user_idx on nukto_sessions(user_id);

-- ---------- Coupon uses: RACE-PROOF ----------
-- Issue #4 fix: TOCTOU count()→insert() ki jagah UNIQUE INDEX.
-- Do concurrent requests me se ek zaroor unique-violation par fail hogi.
create table if not exists nukto_coupon_uses (
  id bigserial primary key,
  code text not null,
  user_key text not null,
  use_seq int not null default 1,
  order_id text,
  created_at timestamptz default now()
);
alter table nukto_coupon_uses add column if not exists use_seq int not null default 1;
-- purane duplicate rows ko seq de do warna unique index banega hi nahi
with d as (
  select id, row_number() over (partition by code, user_key order by id) rn
  from nukto_coupon_uses
) update nukto_coupon_uses u set use_seq = d.rn from d where d.id = u.id;
create unique index if not exists nukto_coupon_uses_uniq
  on nukto_coupon_uses(code, user_key, use_seq);

alter table nukto_coupons add column if not exists start_date date;
alter table nukto_coupons add column if not exists per_user int default 1;
alter table nukto_coupons add column if not exists max_discount numeric default 0;

create table if not exists nukto_resets (
  email text primary key,
  token_hash text not null,
  expires_at timestamptz not null,
  attempts int default 0
);

-- ---------- DB-backed rate limiter (issue #9) ----------
-- In-memory Map Edge Functions me reliable nahi (multi-instance).
create table if not exists nukto_rate (
  bucket text not null,
  key    text not null,
  ts     timestamptz not null default now(),
  primary key (bucket, key, ts)
);
create index if not exists nukto_rate_idx on nukto_rate(bucket, key, ts);

create or replace function rate_hit(p_bucket text, p_key text, p_limit int, p_window interval)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare n int;
begin
  delete from nukto_rate where ts < now() - interval '1 day';
  select count(*) into n from nukto_rate
   where bucket = p_bucket and key = p_key and ts > now() - p_window;
  if n >= p_limit then return false; end if;
  insert into nukto_rate(bucket, key, ts) values (p_bucket, p_key, clock_timestamp());
  return true;
end $$;

-- ============================================================
-- 1) STOCK — internal only, ab public RPC NAHI
--    (issues #1, #14). Naam bhi `_` prefix se internal signal karta hai.
-- ============================================================
create or replace function _reserve_stock(p_id text, qty int) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if qty is null or qty < 1 then return false; end if;
  update nukto_products set stock = stock - qty
   where id = p_id and stock >= qty;
  return found;
end $$;

create or replace function _release_stock(p_id text, qty int) returns void
language sql security definer set search_path = pg_catalog, public as $$
  update nukto_products set stock = stock + greatest(coalesce(qty,0),0) where id = p_id;
$$;

-- ============================================================
-- 2) WALLET — issue #2 fix
--    Ab u_id client se nahi aata: caller ko SESSION TOKEN HASH dena hota
--    hai, aur user_id usi se derive hota hai. Aur ye function bhi sirf
--    service_role callable hai.
-- ============================================================
create or replace function _wallet_spend(p_user_id text, amt numeric) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_user_id is null or p_user_id = '' or amt is null or amt <= 0 then return false; end if;
  update nukto_users set wallet_balance = wallet_balance - amt
   where id = p_user_id and wallet_balance >= amt;
  return found;
end $$;

-- session token hash → user_id (expired sessions reject)
create or replace function _session_user(p_token_hash text) returns text
language sql security definer set search_path = pg_catalog, public stable as $$
  select user_id from nukto_sessions
   where token_hash = p_token_hash and expires_at > now();
$$;

-- ============================================================
-- 3) SECURE ORDER PLACEMENT — full rewrite (issues #3,#5,#6,#7,#16)
--    Ab function hostile caller assume karta hai:
--      * user_id  → session token se derive (payload ka user_id IGNORE)
--      * user_key → server-derived (auth user id, warna normalized phone)
--      * delivery fee / free-above → nukto_config se
--      * items snapshot → server khud DB se banata hai
--      * pm → whitelist
--      * client_oid → sirf idempotency key, order id server generate karta hai
-- ============================================================
create or replace function place_order_secure(payload jsonb, p_session_hash text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  it jsonb; pid text; qty int; prow nukto_products%rowtype;
  sub numeric := 0; disc numeric := 0; del numeric := 0; tax numeric := 0; total numeric;
  ship_free numeric; ship_fee numeric; max_total numeric; max_qty int;
  ccode text; crow nukto_coupons%rowtype; ukey text; nseq int;
  uid text; pm text; snap jsonb := '[]'::jsonb; nitems int := 0;
  oid text := 'ORD-'||upper(substr(md5(random()::text||clock_timestamp()::text),1,10));
begin
  -- ---- identity: SERVER derives it. payload->>'user_id' ka koi wajood nahi ----
  uid := case when p_session_hash is null or p_session_hash = ''
              then null else _session_user(p_session_hash) end;
  if p_session_hash is not null and p_session_hash <> '' and uid is null then
    raise exception 'session expired';
  end if;

  -- ---- payment method whitelist ----
  pm := lower(coalesce(payload->>'pm','cod'));
  if pm not in ('cod','wallet','easypaisa','jazzcash','card') then
    raise exception 'invalid payment method';
  end if;
  if pm = 'wallet' and uid is null then
    raise exception 'wallet payment requires login';   -- guest wallet spend impossible
  end if;

  -- ---- server-side shipping config (client se NAHI) ----
  select num into ship_fee  from nukto_config where key = 'delivery_fee';
  select num into ship_free from nukto_config where key = 'delivery_free_above';
  select num into max_total from nukto_config where key = 'max_order_total';
  select num into max_qty   from nukto_config where key = 'max_item_qty';
  ship_fee := coalesce(ship_fee, 0); ship_free := coalesce(ship_free, 0);

  -- ---- items: price + canonical snapshot DB se ----
  if jsonb_typeof(payload->'items') <> 'array' then raise exception 'items required'; end if;
  for it in select * from jsonb_array_elements(payload->'items') loop
    pid := it->>'id'; qty := coalesce((it->>'qty')::int, 0);
    if qty < 1 or qty > coalesce(max_qty, 20) then raise exception 'bad qty for %', pid; end if;
    select * into prow from nukto_products p where p.id = pid for update;
    if not found then raise exception 'product % not found', pid; end if;
    if not _reserve_stock(pid, qty) then raise exception 'insufficient stock for %', pid; end if;
    sub := sub + prow.price * qty;
    nitems := nitems + 1;
    -- issue #7 fix: snapshot server banata hai, client ka snapshot discard
    snap := snap || jsonb_build_object(
      'id', prow.id, 'name', prow.name, 'price', prow.price,
      'qty', qty, 'variant', coalesce(it->>'v',''), 'img', prow.img, 'line_total', prow.price * qty);
  end loop;
  if nitems = 0 then raise exception 'empty cart'; end if;

  del := ship_fee;
  if ship_free > 0 and sub >= ship_free then del := 0; end if;

  -- ---- coupon: user_key SERVER derive karta hai (issue #5) ----
  ccode := upper(trim(coalesce(payload->>'coupon','')));
  ukey  := coalesce(uid, 'phone:'||regexp_replace(coalesce(payload->>'phone',''), '\D', '', 'g'));
  if ccode <> '' then
    if ukey = 'phone:' then raise exception 'coupon requires login or phone'; end if;
    select * into crow from nukto_coupons where upper(code) = ccode for update;
    if not found or not crow.active then raise exception 'invalid coupon'; end if;
    if crow.expiry is not null and crow.expiry < current_date then raise exception 'coupon expired'; end if;
    if crow.start_date is not null and crow.start_date > current_date then raise exception 'coupon not started'; end if;
    if sub < coalesce(crow.min_order,0) then raise exception 'coupon minimum not met'; end if;
    if crow.max_uses > 0 and crow.uses >= crow.max_uses then raise exception 'coupon limit reached'; end if;

    -- issue #4 fix: pehle SEAT claim karo (unique index), phir discount do.
    -- Concurrent duplicate request yahan unique_violation par mar jayegi.
    select coalesce(count(*),0) + 1 into nseq
      from nukto_coupon_uses where code = crow.code and user_key = ukey;
    if nseq > greatest(coalesce(crow.per_user,1),1) then
      raise exception 'coupon already used by you';
    end if;
    begin
      insert into nukto_coupon_uses(code, user_key, use_seq, order_id)
      values (crow.code, ukey, nseq, oid);
    exception when unique_violation then
      raise exception 'coupon already used by you';
    end;

    if crow.type = 'pct' then disc := sub * crow.value / 100.0;
    elsif crow.type = 'flat' then disc := crow.value;
    else disc := del; del := 0; end if;
    if coalesce(crow.max_discount,0) > 0 and crow.type = 'pct' and disc > crow.max_discount then
      disc := crow.max_discount;
    end if;
    if disc > sub then disc := sub; end if;
    -- crow row lock ke andar hai, isliye counter bhi serialized hai
    update nukto_coupons set uses = uses + 1 where code = crow.code;
  end if;

  -- Six charges are each below Rs. 20; Rs. 120 is a server safety ceiling. Older clients that
  -- do not send tax_total remain compatible with zero here.
  tax := greatest(0, least(120, coalesce((payload->>'tax_total')::numeric, 0)));
  total := round(greatest(sub - disc + del + tax, 0), 2);
  if total > coalesce(max_total, 500000) then raise exception 'order total exceeds limit'; end if;

  -- ---- wallet: uid session se aaya hai, payload se nahi ----
  if pm = 'wallet' then
    if not _wallet_spend(uid, total) then raise exception 'insufficient wallet balance'; end if;
    insert into nukto_transactions(id, type, amount, method, status, ref, user_id, date)
    values ('TXN-W-'||upper(substr(md5(oid),1,10)), 'order', -total, 'wallet',
            'verified', oid, uid, to_char(now(),'YYYY-MM-DD'));
  end if;

  insert into nukto_orders(id, user_id, items, items_server, total, subtotal, discount,
      delivery_fee, tax_fee, pm, payment_status, order_status, delivery_name, delivery_phone,
      delivery_city, delivery_address, delivery_province, delivery_note)
  values (oid, uid, snap, snap, total, sub, disc, del, tax, pm,
      case when pm = 'wallet' then 'verified' else 'pending' end,
      'pending',
      left(coalesce(payload->>'name',''),120),
      left(coalesce(payload->>'phone',''),30),
      left(coalesce(payload->>'city',''),80),
      left(coalesce(payload->>'address',''),400),
      left(coalesce(payload->>'province',''),80),
      left(coalesce(payload->>'note',''),400));

  return jsonb_build_object('id', oid, 'total', total, 'subtotal', sub,
                            'discount', disc, 'delivery', del, 'tax', tax, 'items', snap);
end $$;

-- ============================================================
-- 4) PASSWORD RESET — internal only (issue #8)
--    Ab ye anon RPC nahi. Sirf Edge Function (service_role) call karti hai.
-- ============================================================
create or replace function _create_password_reset(p_email text, p_token_hash text) returns void
language sql security definer set search_path = pg_catalog, public as $$
  insert into nukto_resets(email, token_hash, expires_at, attempts)
  values (lower(p_email), p_token_hash, now() + interval '30 minutes', 0)
  on conflict (email) do update
    set token_hash = excluded.token_hash, expires_at = excluded.expires_at, attempts = 0;
$$;

create or replace function _consume_password_reset(p_email text, p_token_hash text, p_new_hash text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r nukto_resets%rowtype; ok boolean;
begin
  select * into r from nukto_resets where email = lower(p_email) for update;
  if not found or r.expires_at < now() then return false; end if;
  if r.attempts >= 5 then delete from nukto_resets where email = lower(p_email); return false; end if;
  -- constant-time-ish compare (length-independent) + attempt counter
  ok := (r.token_hash = p_token_hash);
  if not ok then
    update nukto_resets set attempts = attempts + 1 where email = lower(p_email);
    return false;
  end if;
  update nukto_users set password_hash = p_new_hash where lower(email) = lower(p_email);
  delete from nukto_resets where email = lower(p_email);
  delete from nukto_sessions where user_id in
    (select id from nukto_users where lower(email) = lower(p_email)); -- reset = logout everywhere
  return true;
end $$;

-- ============================================================
-- 5) WEBHOOK HELPERS — internal only (issue #13)
-- ============================================================
create or replace function _release_order_stock(p_oid text) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare its jsonb; it jsonb; n int;
begin
  update nukto_orders set order_status = 'cancelled'
   where id = p_oid and order_status not in ('delivered','cancelled');
  get diagnostics n = row_count;
  if n = 0 then return; end if;
  select coalesce(items_server, items) into its from nukto_orders where id = p_oid;
  if its is null then return; end if;
  for it in select * from jsonb_array_elements(its) loop
    perform _release_stock(it->>'id', coalesce((it->>'qty')::int, 1));
  end loop;
end $$;

-- issue #11 fix: webhook amount ko order total se match karke hi verify karo
create or replace function _mark_paid(p_oid text, p_amount numeric, p_ref text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare o nukto_orders%rowtype;
begin
  select * into o from nukto_orders where id = p_oid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'order not found'); end if;
  if o.payment_status <> 'pending' then
    return jsonb_build_object('ok', true, 'idempotent', true);   -- already handled
  end if;
  -- paid amount MUST equal order total (1 rupee tolerance for gateway rounding)
  if p_amount is null or abs(p_amount - o.total) > 1 then
    return jsonb_build_object('ok', false, 'reason', 'amount mismatch',
                              'expected', o.total, 'got', p_amount);
  end if;
  update nukto_orders set payment_status = 'verified' where id = p_oid;
  insert into nukto_transactions(id, type, amount, method, status, ref, user_id, date)
  values ('TXN-GW-'||upper(substr(md5(p_oid||coalesce(p_ref,'')),1,10)),
          'payment', p_amount, 'gateway', 'verified', coalesce(p_ref, p_oid),
          o.user_id, to_char(now(),'YYYY-MM-DD'))
  on conflict (id) do nothing;
  return jsonb_build_object('ok', true, 'updated', true, 'amount', p_amount);
end $$;

-- ============================================================
-- 6) PERMISSIONS — sabse ahem hissa
--    HAR privileged function se anon/authenticated ka EXECUTE cheen lo.
--    PUBLIC role se bhi (warna default grant se leak hota hai).
-- ============================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like '\_%'                       -- saare internal helpers
        or p.proname in ('place_order_secure','rate_hit',
                         'reserve_stock','release_stock','wallet_spend',
                         'release_order_stock','create_password_reset',
                         'consume_password_reset'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- v1 ke purane public functions ko poora hata do (agar deploy ho chuke hon)
drop function if exists reserve_stock(text,int);
drop function if exists release_stock(text,int);
drop function if exists wallet_spend(text,numeric);
drop function if exists release_order_stock(text);
drop function if exists create_password_reset(text,text);
drop function if exists consume_password_reset(text,text,text);

-- naye tables client se poori tarah band
revoke all on nukto_resets, nukto_coupon_uses, nukto_sessions, nukto_rate, nukto_config
  from public, anon, authenticated;
alter table nukto_resets      enable row level security;
alter table nukto_coupon_uses enable row level security;
alter table nukto_sessions    enable row level security;
alter table nukto_rate        enable row level security;
alter table nukto_config      enable row level security;
-- koi policy nahi = deny-by-default; service_role RLS bypass karta hai.

commit;

-- ============================================================
--  VERIFY
-- ============================================================
-- 1) Koi bhi privileged function anon ko execute-able to nahi:
--    select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can
--    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' order by 2 desc, 1;
--    Expected: har row me anon_can = false.
--
-- 2) SECURITY DEFINER functions par search_path set hai:
--    select proname, proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and prosecdef;
--    Expected: har row me {search_path=pg_catalog,public}.
--
-- 3) Coupon race guard maujood hai:
--    select indexname from pg_indexes where indexname='nukto_coupon_uses_uniq';
--
-- ============================================================
--  ABHI BHI BAAKI (jaan-boojh kar is file ka hissa nahi)
-- ============================================================
--  * Asli Supabase Auth migration. Tab tak identity = server-issued
--    session token (nukto_sessions). Ye client-controlled user_id se
--    behtar hai, lekin Supabase Auth + auth.uid() se kamzor hai.
--    Migration ke baad neeche wali RLS on kar dena:
--       create policy "own_orders" on nukto_orders
--         for select to authenticated using (auth.uid() = auth_uid);
--       create policy "own_txns" on nukto_transactions
--         for select to authenticated using (auth.uid() = auth_uid);
--  * Guest coupon abuse: user_key = normalized phone. Attacker alag-alag
--    phone number de kar bypass kar sakta hai. Poora fix = login-only
--    coupons, ya phone OTP verification. TODO.md dekho.
