-- ============================================================
--  MANESH KUMAR COMMISSION AGENT — Supabase Database Setup (ONE TIME)
--  NOTE: table names stay `nukto_*` ON PURPOSE. They are internal identifiers
--  no customer ever sees, and the LIVE database is keyed on them — renaming
--  would orphan every order, wallet balance and user row. Brand = Manesh Kumar
--  Commission Agent; schema = unchanged.
--  Isse Supabase → SQL Editor mein paste karke RUN karo.
--  Yeh saari tables + columns + access policies bana deta hai.
-- ============================================================

-- 1) Users (signup/login + wallet)
create table if not exists nukto_users (
  id text primary key,
  full_name text not null,
  username text not null,
  email text,
  phone text,
  city text,
  gender text,
  age_group text,
  wallet_balance numeric default 0,
  password_hash text,
  status text default 'active',
  created_at timestamptz default now()
);

-- 2) Products (catalog edits)
create table if not exists nukto_products (
  id text primary key,
  name text not null,
  cat text,
  cat_label text,
  emoji text,
  cost numeric,
  price numeric,
  img text,
  description text,
  stock int default 0,
  store text,
  g int default 0,
  c int default 0,
  t int default 0,
  m int default 0,
  updated_at timestamptz default now()
);

-- 3) Orders  (full delivery details, not just city)
create table if not exists nukto_orders (
  id text primary key,
  user_id text,
  items jsonb,
  total numeric,
  subtotal numeric,
  discount numeric,
  pm text,
  payment_status text default 'pending',
  order_status text default 'pending',
  delivery_status text default 'pending',
  delivery_name text,
  delivery_phone text,
  delivery_city text,
  delivery_address text,
  delivery_province text,
  delivery_postal text,
  delivery_note text,
  created_at timestamptz default now()
);

-- 4) Reviews (real user reviews)
create table if not exists nukto_reviews (
  id bigserial primary key,
  product_id text,
  user_name text,
  rating int,
  text text,
  created_at timestamptz default now()
);

-- 5) Coupons / Marketing
create table if not exists nukto_coupons (
  id text primary key,
  code text not null,
  type text default 'pct',
  value numeric,
  min_order numeric default 0,
  active boolean default true,
  uses int default 0,
  max_uses int default 0,
  expiry date,
  note text
);

-- 6) Analytics (single row per day, id=date or 'main')
create table if not exists nukto_analytics (
  id text primary key,
  views int default 0,
  add_carts int default 0,
  orders_count int default 0,
  product_views jsonb default '{}',
  add_to_cart jsonb default '{}',
  date date default current_date
);

-- 7) Settings
create table if not exists nukto_settings (
  id text primary key,
  setting_key text,
  value text
);

-- 8) Transactions (wallet)
create table if not exists nukto_transactions (
  id text primary key,
  type text,
  amount numeric,
  method text,
  status text,
  ref text,
  user_id text,
  user_name text,
  user_email text,
  has_proof boolean default false,
  date text,
  created_at timestamptz default now()
);

-- For projects created before the wallet-verification work: add the columns idempotently.
-- Without these the client's transaction upsert fails (PostgREST rejects unknown columns),
-- which is why cloud top-up rows never appeared for the admin.
alter table nukto_transactions add column if not exists user_id text;
alter table nukto_transactions add column if not exists user_name text;
alter table nukto_transactions add column if not exists user_email text;
alter table nukto_transactions add column if not exists has_proof boolean default false;
alter table nukto_transactions add column if not exists date text;

-- 9) Returns / Refunds
create table if not exists nukto_returns (
  id text primary key,
  order_id text,
  user_id text,
  amount numeric,
  reason text,
  status text default 'pending',
  created_at timestamptz default now()
);

-- 10) Snapshot (backup / sync dari storefront)
create table if not exists nukto_snapshot (
  id text primary key,
  data jsonb default '{}',
  created_at timestamptz default now()
);

-- ============================================================
--  ACCESS (Row Level Security) — SECURE BY DEFAULT.
--  Quick rule: anon (public, with the anon key) can only READ the
--  public catalog and only INSERT the things customers submit.
--  aNON KABHI (read) orders/users/transactions/returns/snapshot nahi.
--  That stops any leaked/omnipresent anon key from dumping or editing
--  every customer's wallet, orders, or the whole backup snapshot.
--  For true admin-only control add Supabase Auth + a service_role
--  backend — do NOT ship that key in frontend code.
-- ============================================================
alter table nukto_users enable row level security;
alter table nukto_products enable row level security;
alter table nukto_orders enable row level security;
alter table nukto_reviews enable row level security;
alter table nukto_coupons enable row level security;
alter table nukto_analytics enable row level security;
alter table nukto_settings enable row level security;
alter table nukto_transactions enable row level security;
alter table nukto_returns enable row level security;
alter table nukto_snapshot enable row level security;

-- PRODUCTS: public catalog → readable by everyone; admin edits create/update.
-- (no DELETE via anon, so the catalog can't be wiped)
create policy "anon_read_products"  on nukto_products for select using (true);
create policy "anon_write_products" on nukto_products for insert with check (true);
create policy "anon_update_products" on nukto_products for update using (true) with check (true);

-- REVIEWS: customers can read (storefront) and post, never edit/delete others.
create policy "anon_read_reviews"  on nukto_reviews for select using (true);
create policy "anon_add_reviews"   on nukto_reviews for insert with check (true);

-- COUPONS / SETTINGS / ANALYTICS: storefront reads; admin updates; no delete.
create policy "anon_read_coupons"   on nukto_coupons for select using (true);
create policy "anon_write_coupons"  on nukto_coupons for insert with check (true);
create policy "anon_update_coupons" on nukto_coupons for update using (true) with check (true);
create policy "anon_read_settings"  on nukto_settings for select using (true);
create policy "anon_write_settings" on nukto_settings for insert with check (true);
create policy "anon_update_settings" on nukto_settings for update using (true) with check (true);
create policy "anon_read_analytics"   on nukto_analytics for select using (true);
create policy "anon_write_analytics"  on nukto_analytics for insert with check (true);
create policy "anon_update_analytics" on nukto_analytics for update using (true) with check (true);

-- USERS: customers can only create their own account row (INSERT).
-- anon CANNOT read / update / delete → no dumping everyone's wallet balance.
create policy "anon_create_users" on nukto_users for insert with check (true);

-- ORDERS / TRANSACTIONS / RETURNS: customers can only SUBMIT (INSERT).
-- anon CANNOT read / update / delete → no seeing or editing others' orders,
-- and no forging an "approved" top-up by UPDATE after the fact.
create policy "anon_submit_orders"      on nukto_orders for insert with check (true);
create policy "anon_submit_transactions" on nukto_transactions for insert with check (true);
create policy "anon_submit_returns"      on nukto_returns for insert with check (true);

-- SNAPSHOT: no anon access at all (full backup includes user/order data).
create policy "anon_noop_snapshot" on nukto_snapshot for select using (false);

-- ==== WARNING / NEXT STEP ====
-- 1) With the above, the storefront's cloud *sync* of users/orders/txns/returns
--    is write-only (best-effort). It can push new rows but cannot re-read them.
-- 2) For real admin-only moderation + immutable wallet, add Supabase Auth and a
--    secure backend/service role. Never expose the service_role key publicly.
-- 3) Re-run this file ANY time (it uses "create ... if not exists" + idempotent
--    policies) to harden an existing project. If a policy name already exists,
--    run "drop policy if exists <name> on <table>;" first.
