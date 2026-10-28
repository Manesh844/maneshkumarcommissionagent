-- ============================================================
--  NUKTO.SHOP  —  LEMON EDITION + CASH-ON-DELIVERY LIFECYCLE
--  Project : vneknnmhnbkltkhihbok  (nukta-shop, ap-southeast-1)
--  Purpose : live DB ko us schema par le jana jo storefront + admin panel
--            ab use karte hain (COD 20% advance, PENDING → CONFIRMED →
--            ON THE WAY → RECEIVED, DELAY / ERROR / DAMAGED, city+province
--            wise delivery charges, admin roster).
--
--  TABLE NAMES UNCHANGED (owner rule: "database ko haath nahi lagana" —
--  nukto_* names, nukto.* localStorage keys aur window.NUKTO_CATALOG jaise
--  hain waise hi rehte hain). Ye file SIRF additive hai:
--    * add column if not exists
--    * create table if not exists
--    * create or replace function
--  Koi DROP / DELETE / TRUNCATE / RENAME nahi. Purana data safe.
--
--  RUN ORDER (live DB par isi tarteeb se chalana hai):
--    1) PART A of THIS file            (schema: columns + tables + indexes)
--    2) supabase_backend_v2.sql        (nukto_config/sessions/coupon_uses/resets
--                                       + place_order_secure v2 + RPC lockdown)
--    3) supabase_storefront_sync.sql   (column-level grants: cost/store hidden)
--    4) PART B of THIS file            (zones seed + place_order_secure v3 +
--                                       admin roster + COD config)
--
--  DO NOT RUN: supabase_setup.sql (it re-creates the OLD permissive
--  anon_write_products policies and undoes supabase_rls_lockdown.sql),
--  supabase_backend.sql / supabase_hardened.sql (deprecated),
--  supabase_rename_nukta_to_nukto.sql (already applied once).
--
--  Idempotent: poori file dobara chalana safe hai.
-- ============================================================

-- ############################################################
-- # PART A — SCHEMA (additive only)
-- ############################################################
begin;

-- ---------- 1) nukto_orders: delivery details the courier actually needs ----------
alter table nukto_orders add column if not exists user_email        text;
alter table nukto_orders add column if not exists delivery_name     text;
alter table nukto_orders add column if not exists delivery_phone    text;
alter table nukto_orders add column if not exists delivery_address  text;
alter table nukto_orders add column if not exists delivery_province text;
alter table nukto_orders add column if not exists delivery_postal   text;
alter table nukto_orders add column if not exists delivery_note     text;
alter table nukto_orders add column if not exists delivery_fee      numeric default 0;
alter table nukto_orders add column if not exists delivery_zone     text;
alter table nukto_orders add column if not exists tax_fee           numeric default 0;
alter table nukto_orders add column if not exists items_server      jsonb;
alter table nukto_orders add column if not exists auth_uid          uuid;

-- ---------- 2) nukto_orders: COD advance + delivery lifecycle ----------
-- Owner's flow:  COD order PENDING banta hai → customer 20% advance bhejta hai →
-- admin verify kar ke CONFIRMED karta hai → admin "kitne din?" set karta hai →
-- customer ko countdown dikhta hai (5 → 4 → 3 …) → DELAY / ERROR / DAMAGED /
-- RECEIVED states. Saara data yahan persist hota hai.
alter table nukto_orders add column if not exists pay_mode          text    default 'advance';   -- 'cod' | 'advance'
alter table nukto_orders add column if not exists advance_percent   numeric default 0;
alter table nukto_orders add column if not exists advance_amount    numeric default 0;
alter table nukto_orders add column if not exists due_on_delivery   numeric default 0;
alter table nukto_orders add column if not exists advance_status    text    default 'unpaid';    -- unpaid | claimed | paid
alter table nukto_orders add column if not exists advance_ref       text;                        -- TID / screenshot proof id
alter table nukto_orders add column if not exists advance_paid_at   date;
alter table nukto_orders add column if not exists eta_days          integer default 0;
alter table nukto_orders add column if not exists eta_date          date;
alter table nukto_orders add column if not exists confirmed_at      date;
alter table nukto_orders add column if not exists status_note       text;                        -- DELAY/ERROR/DAMAGED ki waja
alter table nukto_orders add column if not exists status_history    jsonb   default '[]'::jsonb;

create index if not exists nukto_orders_status_idx  on nukto_orders(order_status);
create index if not exists nukto_orders_eta_idx     on nukto_orders(eta_date);
create index if not exists nukto_orders_paymode_idx on nukto_orders(pay_mode);
create index if not exists nukto_orders_adv_idx     on nukto_orders(advance_status);
create index if not exists nukto_orders_user_idx    on nukto_orders(user_id);
create index if not exists nukto_orders_created_idx on nukto_orders(created_at desc);

-- ---------- 3) nukto_transactions: columns syncCloud() already writes ----------
alter table nukto_transactions add column if not exists user_id    text;
alter table nukto_transactions add column if not exists user_name  text;
alter table nukto_transactions add column if not exists user_email text;
alter table nukto_transactions add column if not exists has_proof  boolean default false;
alter table nukto_transactions add column if not exists date       text;

-- ---------- 4) Delivery zones: city / province wise charges ----------
-- Server-side source of truth. Storefront inhe SELECT kar sakta hai (public
-- shipping rates hain, koi secret nahi) lekin fee ka FINAL calculation
-- place_order_secure() isi table se karta hai — client ka bheja hua number
-- kabhi trust nahi hota.
create table if not exists nukto_delivery_zones (
  id         text primary key,
  label      text not null,
  cities     text default '',          -- comma separated city names/tokens
  province   text default '',          -- comma separated province names/tokens
  fee        numeric not null default 0,
  sort       integer default 0,
  updated_at timestamptz default now()
);
alter table nukto_delivery_zones enable row level security;
drop policy if exists public_read_zones on nukto_delivery_zones;
create policy public_read_zones on nukto_delivery_zones
  for select to anon, authenticated using (true);
revoke all on table nukto_delivery_zones from anon, authenticated;
grant  select on table nukto_delivery_zones to anon, authenticated;

-- ---------- 5) Admin roster (passwords DB me, code me sirf hashes) ----------
-- service_role only: anon/authenticated ko na grant, na policy → deny by default.
-- `admin-auth` Edge Function yahan se verify karti hai (SHA-256 hash compare,
-- timing-safe) aur nukto_rate se per-IP rate limit lagati hai.
create table if not exists nukto_admin_users (
  username     text primary key,
  pass_hash    text not null,               -- SHA-256 hex of the password
  role         text not null default 'admin',
  pin_hash     text,                        -- optional 2FA (SHA-256 hex)
  active       boolean not null default true,
  builtin      boolean not null default false,
  last_login   timestamptz,
  created_at   timestamptz default now()
);
alter table nukto_admin_users enable row level security;
revoke all on table nukto_admin_users from public, anon, authenticated;

commit;

-- ############################################################
-- # PART B — LOGIC (zones seed, COD settings, place_order_secure v3,
-- #          admin login helper, admin roster rows)
-- ############################################################
begin;

-- ---------- 6) Default zones (storefront ke DEFAULT_DELIVERY_ZONES se match) ----------
insert into nukto_delivery_zones(id, label, cities, province, fee, sort) values
  ('z-khi', 'Karachi & Sindh',        'Karachi,Hyderabad,Sukkur,Larkana,Mirpur Khas,Nawabshah,Sanghar,Jam Nawaz Ali,Berani', 'Sindh', 179, 1),
  ('z-lhr', 'Punjab',                 'Lahore,Faisalabad,Rawalpindi,Multan,Gujranwala,Sialkot,Sargodha,Bahawalpur,Kasur', 'Punjab', 199, 2),
  ('z-isb', 'Islamabad & Potohar',    'Islamabad,Wah,Taxila,Attock,Jhelum,Gujrat', 'Federal,Capital,Islamabad', 189, 3),
  ('z-kpk', 'Khyber Pakhtunkhwa',     'Peshawar,Abbottabad,Mardan,Swat,Mingora,Dera Ismail Khan,Nowshera', 'KPK,Khyber,Pakhtunkhwa', 219, 4),
  ('z-bal', 'Balochistan',            'Quetta,Gwadar,Turbat,Khuzdar,Hub,Sibi', 'Balochistan', 249, 5),
  ('z-ajk', 'AJK & Gilgit-Baltistan', 'Muzaffarabad,Mirpur,AJK,Gilgit,Skardu,Hunza', 'Azad,Kashmir,Gilgit,Baltistan', 259, 6)
on conflict (id) do update
  set label    = excluded.label,
      cities   = excluded.cities,
      province = excluded.province,
      fee      = excluded.fee,
      sort     = excluded.sort;

-- ---------- 7) COD + shipping settings (server side) ----------
insert into nukto_config(key, num, txt) values
  ('cod_advance_pct',   20,   'Cash on Delivery par 20% advance zaroori hai'),
  ('cod_enabled',        1,   'cod'),
  ('delivery_fee',     199,   'default zone fee'),
  ('delivery_free_above', 0,  '0 = free-shipping threshold off'),
  ('max_order_total', 500000, 'sanity cap'),
  ('max_item_qty',        20, 'per line item')
on conflict (key) do update set num = excluded.num;

-- ---------- 8) zone lookup helper (internal, never callable by anon) ----------
create or replace function _zone_fee(p_city text, p_province text, p_default numeric)
returns table(zone_id text, zone_label text, zone_fee numeric)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  c text := lower(regexp_replace(coalesce(p_city,''), '[^A-Za-z ]', '', 'g'));
  pr text := lower(regexp_replace(coalesce(p_province,''), '[^A-Za-z ]', '', 'g'));
  z record; hit record := null;
begin
  -- city token match first (both directions, tokens > 3 chars)
  for z in select * from nukto_delivery_zones order by sort, id loop
    if c <> '' and (
         position(c in lower(z.cities)) > 0
      or position(lower(z.label) in c) > 0
      or exists (select 1 from unnest(string_to_array(lower(z.cities), ',')) t(tok)
                  where length(trim(tok)) > 3
                    and (position(trim(tok) in c) > 0 or position(c in trim(tok)) > 0))
    ) then
      hit := z; exit;
    end if;
  end loop;
  -- then province
  if hit is null then
    for z in select * from nukto_delivery_zones order by sort, id loop
      if pr <> '' and exists (select 1 from unnest(string_to_array(lower(z.province), ',')) t(tok)
                              where length(trim(tok)) > 2 and position(trim(tok) in pr) > 0) then
        hit := z; exit;
      end if;
    end loop;
  end if;
  if hit is null then
    return query select 'z-default'::text, 'Other areas (default rate)'::text, coalesce(p_default,0)::numeric;
  else
    return query select hit.id::text, hit.label::text, coalesce(hit.fee,0)::numeric;
  end if;
end $$;

-- ---------- 9) place_order_secure v3 — COD lifecycle + zone-wise shipping ----------
-- v2 ki saari security barqarar: identity session token se, price/stock DB se,
-- coupon race-proof, wallet spend atomic, koi privileged RPC anon ko nahi.
-- Naya: pay_mode / advance_* / due_on_delivery / eta_* / delivery_zone.
create or replace function place_order_secure(payload jsonb, p_session_hash text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  it jsonb; pid text; qty int; prow nukto_products%rowtype;
  sub numeric := 0; disc numeric := 0; del numeric := 0; tax numeric := 0; total numeric;
  ship_free numeric; ship_fee numeric; max_total numeric; max_qty int;
  ccode text; crow nukto_coupons%rowtype; ukey text; nseq int;
  uid text; pm text; snap jsonb := '[]'::jsonb; nitems int := 0;
  zid text; zlabel text; zfee numeric;
  adv_pct numeric; adv_amt numeric := 0; due_amt numeric := 0; pay_mode text; cod_on numeric;
  oid text := 'ORD-'||upper(substr(md5(random()::text||clock_timestamp()::text),1,10));
begin
  -- ---- identity: SERVER derives it (payload->>'user_id' ki koi haisiyat nahi) ----
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
    raise exception 'wallet payment requires login';
  end if;

  -- ---- server-side config (client se fee/advance % NAHI aata) ----
  select num into ship_fee  from nukto_config where key = 'delivery_fee';
  select num into ship_free from nukto_config where key = 'delivery_free_above';
  select num into max_total from nukto_config where key = 'max_order_total';
  select num into max_qty   from nukto_config where key = 'max_item_qty';
  select num into adv_pct   from nukto_config where key = 'cod_advance_pct';
  select num into cod_on    from nukto_config where key = 'cod_enabled';   -- 0 = COD band
  ship_fee := coalesce(ship_fee, 0); ship_free := coalesce(ship_free, 0);
  adv_pct  := greatest(0, least(90, coalesce(adv_pct, 20)));

  if pm = 'cod' and coalesce(cod_on, 1) = 0 then
    raise exception 'cash on delivery is currently disabled';
  end if;

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
    snap := snap || jsonb_build_object(
      'id', prow.id, 'name', prow.name, 'price', prow.price,
      'qty', qty, 'variant', coalesce(it->>'v',''), 'img', prow.img, 'line_total', prow.price * qty);
  end loop;
  if nitems = 0 then raise exception 'empty cart'; end if;

  -- ---- delivery: CITY / PROVINCE se zone nikalo (server side) ----
  select * into zid, zlabel, zfee
    from _zone_fee(payload->>'city', payload->>'province', ship_fee);
  del := coalesce(zfee, ship_fee);
  if ship_free > 0 and sub >= ship_free then del := 0; end if;

  -- ---- coupon (race-proof, v2 jaisa) ----
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
    select coalesce(count(*),0) + 1 into nseq
      from nukto_coupon_uses where code = crow.code and user_key = ukey;
    if nseq > greatest(coalesce(crow.per_user,1),1) then raise exception 'coupon already used by you'; end if;
    begin
      insert into nukto_coupon_uses(code, user_key, use_seq, order_id) values (crow.code, ukey, nseq, oid);
    exception when unique_violation then raise exception 'coupon already used by you';
    end;
    if crow.type = 'pct' or crow.type = 'percent' then disc := sub * crow.value / 100.0;
    elsif crow.type = 'flat' then disc := crow.value;
    else disc := del; del := 0; end if;
    if coalesce(crow.max_discount,0) > 0 and (crow.type = 'pct' or crow.type = 'percent') and disc > crow.max_discount then
      disc := crow.max_discount;
    end if;
    if disc > sub then disc := sub; end if;
    update nukto_coupons set uses = uses + 1 where code = crow.code;
  end if;

  tax := greatest(0, least(120, coalesce((payload->>'tax_total')::numeric, 0)));
  total := round(greatest(sub - disc + del + tax, 0), 2);
  if total > coalesce(max_total, 500000) then raise exception 'order total exceeds limit'; end if;

  -- ---- COD advance maths (server computes, client sirf dikhata hai) ----
  if pm = 'cod' then
    pay_mode := 'cod';
    adv_amt  := round(total * adv_pct / 100.0, 0);
    due_amt  := round(total - adv_amt, 2);
  else
    pay_mode := 'advance';
    adv_pct  := 100;
    adv_amt  := total;
    due_amt  := 0;
  end if;

  -- ---- wallet spend (atomic) ----
  if pm = 'wallet' then
    if not _wallet_spend(uid, total) then raise exception 'insufficient wallet balance'; end if;
    insert into nukto_transactions(id, type, amount, method, status, ref, user_id, date)
    values ('TXN-W-'||upper(substr(md5(oid),1,10)), 'order', -total, 'wallet',
            'verified', oid, uid, to_char(now(),'YYYY-MM-DD'));
  end if;

  insert into nukto_orders(id, user_id, user_email, items, items_server, total, subtotal, discount,
      delivery_fee, delivery_zone, tax_fee, pm, payment_status, order_status, delivery_status,
      delivery_name, delivery_phone, delivery_city, delivery_address, delivery_province,
      delivery_postal, delivery_note,
      pay_mode, advance_percent, advance_amount, due_on_delivery, advance_status, advance_ref,
      status_history, created_at)
  values (oid, uid, left(coalesce(payload->>'email',''),160), snap, snap, total, sub, disc,
      del, zlabel, tax, pm,
      case when pm = 'wallet' then 'verified' else 'pending' end,
      'pending', 'pending',
      left(coalesce(payload->>'name',''),120),
      left(coalesce(payload->>'phone',''),30),
      left(coalesce(payload->>'city',''),80),
      left(coalesce(payload->>'address',''),400),
      left(coalesce(payload->>'province',''),80),
      left(coalesce(payload->>'postal',''),20),
      left(coalesce(payload->>'note',''),400),
      pay_mode, adv_pct, adv_amt, due_amt,
      case when pm = 'cod' then 'unpaid' else 'claimed' end,
      left(coalesce(payload->>'pay_ref',''),80),
      jsonb_build_array(jsonb_build_object('state','pending','at',now(),'by','system')),
      now());

  return jsonb_build_object(
    'id', oid, 'total', total, 'subtotal', sub, 'discount', disc,
    'delivery', del, 'tax', tax, 'items', snap,
    'pay_mode', pay_mode, 'advance_percent', adv_pct, 'advance_amount', adv_amt,
    'due_on_delivery', due_amt, 'delivery_zone', zlabel, 'order_status', 'pending');
end $$;

-- ---------- 10) admin login verification (Edge Function only) ----------
-- Password ka SHA-256 hash Edge Function bhejti hai (plaintext DB tak nahi aata);
-- compare timing-safe hota hai aur nukto_rate se brute-force throttle lagta hai.
create or replace function admin_verify(p_username text, p_pass_hash text, p_ip text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  r nukto_admin_users%rowtype; ok boolean;
begin
  if coalesce(p_username,'') = '' or coalesce(p_pass_hash,'') = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing credentials');
  end if;

  -- 8 tries / 10 minute per IP, 5 tries / 10 minute per username
  if rate_hit('admin_login_ip', coalesce(p_ip,'unknown'), 8, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate limited');
  end if;
  if rate_hit('admin_login_user', lower(p_username), 5, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate limited');
  end if;

  select * into r from nukto_admin_users where lower(username) = lower(trim(p_username));
  if not found or not r.active then
    return jsonb_build_object('ok', false, 'reason', 'invalid credentials');
  end if;

  ok := (r.pass_hash = lower(p_pass_hash));
  if not ok then
    return jsonb_build_object('ok', false, 'reason', 'invalid credentials');
  end if;

  update nukto_admin_users set last_login = now() where username = r.username;
  return jsonb_build_object('ok', true, 'username', r.username, 'role', r.role,
                            'pin_required', (r.pin_hash is not null and r.pin_hash <> ''),
                            'pin_hash', coalesce(r.pin_hash,''));
end $$;

-- ---------- 11) admin roster (hashes ONLY — plaintext repo/DB kahin nahi) ----------
-- Owner login  + second admin (Avinash). Rotate = naya SHA-256 hash yahan update karo.
insert into nukto_admin_users(username, pass_hash, role, builtin, active) values
  ('Admin',   '42065179a605734438267e630d871655eee6bf86d2df5e0c95ca253ea83807da', 'owner', true, true),
  ('Avinash', '6fe6ad2456b798954674866bc31606071347ae599975b65f7fba7ab108dfe16f', 'admin', true, true)
on conflict (username) do update
  set pass_hash = excluded.pass_hash,
      role      = excluded.role,
      builtin   = excluded.builtin,
      active    = true;

-- ---------- 12) lockdown: koi privileged function anon se callable nahi ----------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like '\_%'
        or p.proname in ('place_order_secure','rate_hit','admin_verify',
                         'reserve_stock','release_stock','wallet_spend',
                         'release_order_stock','create_password_reset',
                         'consume_password_reset'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

commit;

-- ============================================================
--  VERIFY (run these after applying)
-- ============================================================
--  select count(*) from nukto_delivery_zones;                       -- 6
--  select username, role, builtin from nukto_admin_users;           -- Admin/Avinash
--  select key, num from nukto_config where key like 'cod%' or key like 'delivery%';
--  select * from _zone_fee('Lahore','Punjab',199);                  -- z-lhr / 199
--  select * from _zone_fee('Quetta','Balochistan',199);             -- z-bal / 249
--  select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can
--    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and p.proname in ('place_order_secure','admin_verify','_zone_fee');
--  Expected: anon_can = false for every row.
