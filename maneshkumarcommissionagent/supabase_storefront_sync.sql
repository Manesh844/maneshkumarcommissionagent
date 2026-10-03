-- ============================================================
--  MANESH KUMAR COMMISSION AGENT — GLOBAL STOREFRONT SYNC  (admin → all devices)
--  NOTE: table names stay `nukto_*` ON PURPOSE. They are internal identifiers
--  no customer ever sees, and the LIVE database is keyed on them — renaming
--  would orphan every order, wallet balance and user row. Brand = Manesh Kumar
--  Commission Agent; schema = unchanged.
--
--  MASLA: admin ke saare edits (price/stock/name/discount/variants,
--  categories, coupons, banner/settings) sirf admin ke browser ke
--  localStorage me save hote thay. Dusre devices/customers ko kuch
--  nazar nahi aata tha.
--
--  HAL: admin Admin → Integrations → "Global Storefront Sync" se
--  Publish karta hai → `storefront-sync` Edge Function (service_role)
--  sanitized snapshot ko public tables me likhti hai → har device
--  boot par wahi snapshot pull karta hai.
--
--  SECURITY MODEL (lockdown ke upar, usko kamzor kiye baghair):
--    * anon = sirf SELECT on products/coupons/settings (pehle jaisa).
--    * Is file ke baad nukto_products par anon SELECT sirf SAFE
--      columns tak rehta hai (cost/store kabhi readable nahi — column
--      grant, taake ghalti se likhi hui cost bhi leak na ho).
--    * cost / store / supplier info publish payload me bhejo ya na
--      bhejo — Edge Function unhe DROP karti hai (whitelist, dobara
--      client par bhi strip hota hai).
--    * Customer data (users/orders/carts/wallets/passwords), team,
--      sessions aur API keys is sync ka hissa NAHI — payload me
--      aate hi nahi, function unhe accept hi nahi karta.
--    * Publish/seed sirf ADMIN_SYNC_TOKEN se (timing-safe compare +
--      rate limit). Token sirf admin ke browser + Supabase secrets
--      me rehta hai — repo/code me KABHI NAHI.
--
--  RUN ORDER (zaruri): rename → lockdown → backend_v2 → YE FILE.
--  Agar lockdown dobara run karo to YE FILE bhi dobara run karo
--  (lockdown full-table SELECT wapas de deta hai; ye file usay
--  dobara safe columns tak mehdud karti hai).
--  Safe to re-run (idempotent).
-- ============================================================

begin;

-- ---------- 1) products: override patch + edited flag ----------
alter table nukto_products add column if not exists data   jsonb   default '{}'::jsonb;
alter table nukto_products add column if not exists edited boolean default false;
update nukto_products set data = '{}'::jsonb where data is null;
update nukto_products set edited = false      where edited is null;
-- pull sirf edited=true rows mangta hai (chhota response, fast boot)
create index if not exists nukto_products_edited_idx on nukto_products(id) where edited = true;

-- ---------- 2) anon SELECT: safe columns only (cost/store kabhi nahi) ----------
-- RLS policy (public_read_products, using=true) rehti hai; table-level
-- grant hata kar column-level grant dete hain. PostgREST explicit
-- `select=` columns mangta hai to sab normal chalta hai.
revoke all on table nukto_products from anon, authenticated;
grant select (id, name, cat, cat_label, emoji, price, img, description,
              stock, data, edited, updated_at)
  to anon, authenticated;

-- ---------- 3) place_order_secure: tombstone + variant + discount ----------
-- Neeche v2 wala function hai, sirf items-loop me 3 izafe ke sath.
-- (Baaki sab — identity, coupon race guard, wallet, config — bit-by-bit v2.)

create or replace function place_order_secure(payload jsonb, p_session_hash text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  it jsonb; pid text; qty int; prow nukto_products%rowtype;
  unit numeric; vlab text; vpr numeric; dpc numeric; -- storefront-sync
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
    -- storefront-sync: admin-deleted products stay unorderable on every device
    if coalesce((coalesce(prow.data,'{}'::jsonb)->>'deleted')::boolean, false) then raise exception 'product % not available', pid; end if;
    if not _reserve_stock(pid, qty) then raise exception 'insufficient stock for %', pid; end if;
    -- storefront-sync: variant price (label match) + admin % discount.
    -- Same math as the app cart (cartUnit/salePrice): variant price first,
    -- then discount, rounded, minimum Rs. 1. Server total always matches display.
    vlab := coalesce(it->>'v','');
    unit := prow.price;
    if vlab <> '' and jsonb_typeof(coalesce(prow.data,'{}'::jsonb)->'vars') = 'array' then
      select (elem->>'pr')::numeric into vpr from jsonb_array_elements(prow.data->'vars') as elem where coalesce(elem->>'la','') = vlab limit 1;
      if found and vpr is not null and vpr > 0 then unit := vpr; end if;
    end if;
    dpc := coalesce((coalesce(prow.data,'{}'::jsonb)->>'discount')::numeric, 0);
    if dpc < 0 then dpc := 0; end if; if dpc > 90 then dpc := 90; end if;
    if dpc > 0 then unit := greatest(1, round(unit * (1 - dpc/100))); end if;
    sub := sub + unit * qty;
    nitems := nitems + 1;
    -- issue #7 fix: snapshot server banata hai, client ka snapshot discard
    snap := snap || jsonb_build_object(
      'id', prow.id, 'name', prow.name, 'price', unit,
      'qty', qty, 'variant', vlab, 'img', prow.img, 'line_total', unit * qty);
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

-- function replace ke baad bhi client EXECUTE band rahe (defense in depth)
revoke all on function public.place_order_secure(jsonb, text) from public, anon, authenticated;

commit;

-- ============================================================
--  VERIFY (SQL Editor me ek-ek karke chalao)
-- ============================================================
-- A) Columns maujood hain:
--    select column_name, data_type from information_schema.columns
--    where table_name='nukto_products' and column_name in ('data','edited');
--    Expected: 2 rows (data=jsonb, edited=boolean).
--
-- B) anon cost/store NAHI parh sakta, safe columns parh sakta hai:
--    select grantee, column_name, privilege_type
--    from information_schema.role_column_grants
--    where table_name='nukto_products' and grantee='anon' order by 2;
--    Expected: rows for id/name/cat/cat_label/emoji/price/img/description/
--    stock/data/edited/updated_at — aur `cost` / `store` is list me NA HO.
--
-- C) place_order_secure ab bhi client se band hai:
--    select has_function_privilege('anon','public.place_order_secure(jsonb,text)','execute');
--    Expected: false.
--
-- D) Publish ke baad: edited rows dikhein:
--    select count(*) from nukto_products where edited = true;
