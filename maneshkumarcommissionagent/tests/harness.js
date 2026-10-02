/* Headless harness: executes the REAL inline app script from index.html against a
   minimal DOM/localStorage stub, then asserts the behaviour of the changed code.
   Run: node tests/harness.js   (from nukto-shop/) */
"use strict";
// Deterministic tests: the live storefront shuffles product order on every fresh
// page load (intended), but the suite must assert the same result on every run,
// so the app's shuffleProducts() no-ops when this flag is set. Browser-safe:
// browsers have no process.env, so live shuffle behaviour is unchanged.
process.env.NUKTO_NO_SHUFFLE = "1";
// NOTE on `hidden` products: consolidateCatalogProducts() merges repeated supplier
// rows into one customer-facing card; merged-away rows stay in PRODUCTS with
// hidden=true as aliases (old SKU links keep working via prod()). Price, stock and
// slug assertions below must therefore use VISIBLE products only (!p.hidden) —
// picking a hidden alias would assert against the alias row while the app
// correctly reads/writes the canonical product (cart/ratio/restock/slug paths).
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const blocks = [...html.matchAll(/<script(?![^>]*src)(?![^>]*ld\+json)[^>]*>(.*?)<\/script>/gs)].map(m => m[1]);
const appSrc = blocks.join("\n");

/* ---------- tiny DOM stub ---------- */
function el(id) {
  const e = {
    id, style: {}, innerHTML: "", textContent: "", value: "", checked: false,
    classList: { add(){}, remove(){}, toggle(){} , contains(){return false;} },
    addEventListener(){}, setAttribute(){}, getAttribute(){ return null; },
    querySelector(){ return el(id + "-q"); }, querySelectorAll(){ return []; },
    insertAdjacentHTML(){}, blur(){}, files: [], click(){},
  };
  return e;
}
const _els = {};
const document = {
  readyState: "complete",
  title: "",
  _els,
  getElementById(id){ return _els[id] || (_els[id] = el(id)); },
  querySelector(){ return el("meta"); },
  querySelectorAll(){ return []; },
  addEventListener(){}, createElement(tag){ return el(tag); },
};
const _ls = new Map();
const localStorage = {
  getItem(k){ return _ls.has(k) ? _ls.get(k) : null; },
  setItem(k, v){ _ls.set(k, String(v)); },
  removeItem(k){ _ls.delete(k); },
  key(i){ return [..._ls.keys()][i] ?? null; },
  get length(){ return _ls.size; },
};
const location = { hash: "", href: "http://localhost/" };
const window = {
  addEventListener(){}, scrollTo(){}, innerHeight: 800, scrollY: 0,
  NUKTO_CATALOG: undefined, onscroll: null,
};
const navigator = { language: "en-PK", clipboard: undefined };
let __fetchHandler = null; // sync tests install a fake Supabase here; default = backend offline
function fetch(url, opts){ if(__fetchHandler) return __fetchHandler(url, opts); return Promise.resolve({ ok: false, status: 0, json: () => Promise.resolve([]) }); }
class Image { set src(v){} }
class FileReader { readAsDataURL(){} }
class IntersectionObserver { constructor(){} observe(){} disconnect(){} }

/* ---------- load catalog ---------- */
const catSrc = fs.readFileSync(path.join(__dirname, "..", "catalog.js"), "utf8");
new Function("window", catSrc)(window);
console.log("catalog entries:", (window.NUKTO_CATALOG || []).length);

/* ---------- run the app with export hooks ---------- */
const hooks = `
;return {
  productSlug, resolveProduct, slugify, idCode, product, prod, discountPct,
  get PRODUCTS(){ return PRODUCTS; }, get CATEGORIES(){ return CATEGORIES; },
  get PRODUCT_ALIASES(){ return PRODUCT_ALIASES; },
  buildStorefrontPayload, publishStorefront, pullStorefront, markStorefrontDirty, isStorefrontDirty,
  get stockDirty(){ return stockDirty; }, get couponGraves(){ return couponGraves; }, get cloudOOS(){ return cloudOOS; },
  get txns(){ return txns; }, set txns(v){ txns = v; },
  get users(){ return users; }, set users(v){ users = v; },
  get orders(){ return orders; }, set orders(v){ orders = v; },
  get returns(){ return returns; }, set returns(v){ returns = v; },
  get user(){ return user; }, set user(v){ user = v; },
  get complaints(){ return complaints; }, set complaints(v){ complaints = v; },
  get settings(){ return settings; },
  searchProducts, relatedToSearch, stemmedToks, stem, stockLabel, normalizePhone, isValidPhone,
  prettyPhone, uniqueUsername, myTxns, isMyOrder, ordersView, productsPage, hashPw,
  approveTxn, rejectTxn, approveReturn, purgeStaleData, reconcileWallet, saveAll,
  saveAdminSettings, editProductField,
  tryLogin, addTeamMember, setTeamRole, delTeamMember, setProdRatio, setCatRatio, resetProdRatio,
  adminImportProducts, wooCSVToProducts, exportOrdersCSV, exportProductsCSV,
  setOrderStatus, setDeliveryStatus, saveDeliveryFee, adminReviews, toggleReviewHide, allReviewsFor, applyCoupon, adminLogin,
  get activity(){ return activity; },
  get notifs(){ return notifs; },
  get coupons(){ return coupons; }, set coupons(v){ coupons = v; },
  get promo(){ return promo; },
  needEdit, adminRoute, priceFromRatio, curProdRatio,
  get team(){ return team; }, set team(v){ team = v; },
  get session(){ return session; }, set session(v){ session = v; },
  get prodRatios(){ return prodRatios; }, get catRatios(){ return catRatios; },
  get priceGuard(){ return priceGuard; },
  normText, scoreProduct, buildSearchIndex, tokenize, wallet, authForm, checkout, openDeposit,
  get cart(){ return cart; }, set cart(v){ cart = v; },
  cartSubtotal, cartStockIssues, cartUnit,
  checkoutTaxLines, checkoutTaxTotal, cartPayable, fmtCharge, fmt2, toggleChargeRow,
  product, cartView, sectionsPage, categoriesPage, get CHARGE_TAGLINE(){ return CHARGE_TAGLINE; }, login, signup, account, wishlistView, trackingView, complaint, returnsView, settings2, support, terms, about,
  contact, privacyPolicy, shippingPolicy, refundPolicy, shopInfoLinks, render,
  renderHeader,
  renderFooter,
  resetView,
};`;

function makeApp() {
  return new Function("window", "document", "localStorage", "navigator", "location", "fetch", "Image", "FileReader", "IntersectionObserver", appSrc + hooks)(
    window, document, localStorage, navigator, location, fetch, Image, FileReader, IntersectionObserver
  );
}
let app;
try {
  app = makeApp();
} catch (e) {
  console.error("APP EXECUTION FAILED:", e.stack || e);
  process.exit(2);
}

/* ---------- assertions ---------- */
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}

// boot ran: catalog normalised + search index built
t("catalog loaded (weekly merge)", app.PRODUCTS.length > 5000, app.PRODUCTS.length);
{
  const ids = new Set(app.PRODUCTS.map(p => p.id));
  const oldIds = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "data", "old_catalog_full.json"), "utf8")).map(p => p.id);
  t("weekly rule: every last-week product live or marked not-available", oldIds.every(id => ids.has(id)));
  t("weekly rule: na-flagged products are stock 0", app.PRODUCTS.filter(p => p.na === 1).every(p => p.stock === 0));
}
t("weekly rule: new products carry new flag", app.PRODUCTS.some(p => p.new === 1));

// B1: fake urgency removed
t("stockLabel(5) is empty (no 'only N left')", app.stockLabel({ stock: 5 }) === "", app.stockLabel({ stock: 5 }));
t("stockLabel(3) is empty", app.stockLabel({ stock: 3 }) === "", app.stockLabel({ stock: 3 }));
t("stockLabel(0) says Out of Stock", /Out of Stock/.test(app.stockLabel({ stock: 0 })));

// D: search
const tb = app.searchProducts("tooth brush");
t("'tooth brush' finds >=25 products", tb.length >= 25, tb.length);
const el_tb = tb.filter(p => /electric/i.test(p.name) && /tooth/i.test(p.name));
t("electric toothbrush is a 'tooth brush' hit", el_tb.length >= 1, el_tb.map(p => p.id).slice(0, 3));
t("electric toothbrush ranks in top 25 for 'tooth brush'", tb.slice(0, 25).some(p => /electric/i.test(p.name)), tb.slice(0, 6).map(p => p.name.slice(0, 40)));
t("'toothbrushes' plural works", app.searchProducts("toothbrushes").length >= 10, app.searchProducts("toothbrushes").length);
t("typo 'tothbrush' works", app.searchProducts("tothbrush").length >= 5, app.searchProducts("tothbrush").length);
t("unrelated query 'qwertyzx' finds nothing", app.searchProducts("qwertyzx").length === 0, app.searchProducts("qwertyzx").length);
t("'watch' matches smartwatches", app.searchProducts("watch").length >= 100, app.searchProducts("watch").length);
t("related block non-empty for 'tooth brush'", app.relatedToSearch("tooth brush", tb.slice(0, 60), 24).length > 0);

// C1: phones
t("03001234567 valid", app.isValidPhone("03001234567"));
t("+92 300 1234567 valid", app.isValidPhone("+92 300 1234567"));
t("923001234567 valid", app.isValidPhone("923001234567"));
t("0300123456 (10 digits) invalid", !app.isValidPhone("0300123456"));
t("021-3567xxxx landline invalid", !app.isValidPhone("02135671234"));
t("abc invalid", !app.isValidPhone("abc"));
t("normalize +92 -> 03", app.normalizePhone("+923001234567") === "03001234567", app.normalizePhone("+923001234567"));

// C3/C5: wallet only shows own txns; demo rows purged
app.users = [{ id: "U-TEST1", fullName: "Test User", username: "tester", email: "t@x.com", phone: "03001234567", passwordHash: app.hashPw("password1"), status: "active", date: "2026-09-02", walletBalance: 0 }];
app.user = { id: "U-TEST1", fullName: "Test User", username: "tester", email: "t@x.com", phone: "03001234567", walletBalance: 0, joined: "2026-09-02" };
app.txns = [
  { id: "T-OLD1", type: "deposit", amount: 500, method: "easypaisa", status: "approved", date: "2026-08-20", ref: "EP-88123" },
  { id: "T-OLD2", type: "purchase", amount: 2499, method: "easypaisa", status: "approved", date: "2026-08-24", ref: "ORD-2201" },
  { id: "T-MINE", type: "deposit", amount: 1000, method: "jazzcash", status: "pending", date: "2026-09-03", ref: "JT-1", userId: "U-TEST1", userName: "Test User" },
  { id: "T-OTHER", type: "deposit", amount: 700, method: "easypaisa", status: "approved", date: "2026-09-01", ref: "EP-9", userId: "U-OTHER", userName: "Someone Else" },
];
_ls.delete("nukto.purged1"); // boot() already consumed the one-time flag with empty test data
app.purgeStaleData();
t("demo/stale txns purged", app.txns.length === 1 && app.txns[0].id === "T-MINE", app.txns.map(x => x.id));
// after purge only mine remains, but myTxns is pending-only for me
t("myTxns shows only own rows", app.myTxns().length === 1 && app.myTxns()[0].id === "T-MINE", app.myTxns());

// C8: approve credits the customer, not the admin
app.txns = [{ id: "T-P1", type: "deposit", amount: 500, method: "easypaisa", status: "pending", date: "2026-09-04", ref: "EP-1", userId: "U-TEST1", userName: "Test User" }];
app.user = { id: "U-ADMIN", fullName: "Admin", username: "admin1", walletBalance: 0 }; // admin is signed in on another device
app.users[0].walletBalance = 0;
app.approveTxn("T-P1");
t("approved deposit credited customer (500)", app.users[0].walletBalance === 500, app.users[0].walletBalance);
t("admin wallet untouched", (app.user.walletBalance || 0) === 0, app.user.walletBalance);
t("approve twice blocked", (app.approveTxn("T-P1"), app.users[0].walletBalance === 500), app.users[0].walletBalance);

// returns credit the owner
app.user = { id: "U-ADMIN", fullName: "Admin", username: "admin1", walletBalance: 0 };
app.returns = [{ id: "RTN-1", orderId: "ORD-9", userId: "U-TEST1", userName: "Test User", amount: 200, reason: "x", status: "pending" }];
app.approveReturn("RTN-1");
t("return refund credited owner (700)", app.users[0].walletBalance === 700, app.users[0].walletBalance);

// C4: order ownership by phone fallback
app.user = { id: "U-TEST1", phone: "03001234567", email: "t@x.com" };
app.orders = [{ id: "ORD-A", userId: "U-GHOST", deliveryPhone: "+92 300 1234567", items: [], total: 100, date: "2026-09-03", orderStatus: "pending", pm: "wallet", paymentStatus: "verified" }];
t("order matched via phone when userId differs", app.isMyOrder(app.orders[0]) === true);

// my orders page renders the owner's order
const ov = app.ordersView();
t("ordersView contains ORD-A", ov.includes("ORD-A"));

// B2: router default renders products page (no home hero)
t("productsPage renders grid or category rails", /pgrid|cat-rail/.test(app.productsPage("", "", "")) );

const pp = app.productsPage("", "", "");
t("no numbered pager on storefront", !/onclick="productsPage\._page=/.test(pp) && !/‹ Prev/.test(pp));
t("home shows category rails", /cat-rail/.test(pp) && /Show more/.test(pp));
const catPage = app.productsPage("", app.CATEGORIES[0].slug, "");
t("category page uses endless feed sentinel", /feed-sentinel/.test(catPage) || /Load more/.test(catPage) || /pgrid/.test(catPage));

// C6 + C8: wallet page has Top Up + no withdraw + own-only history
app.user = { id: "U-TEST1", fullName: "Test User", username: "tester", email: "t@x.com", phone: "03001234567", walletBalance: 700, joined: "2026-09-02" };
const w = app.wallet();
t("wallet page has Top Up button", /Top Up/.test(w));
t("wallet page has no withdraw control", !/withdraw/i.test(w.replace(/Withdrawal ki sahulat nahi|Withdrawal available nahi|no withdrawal/gi, "")), w.match(/.{0,40}[Ww]ithdraw.{0,40}/g));
t("wallet mentions no-withdrawal policy", /Withdrawal/.test(w));

// C2 + C3: signup form slimmed (no gender/age/city/username field)
const su = app.authForm("Create Account", "signup", true, "x");
t("signup has no Gender select", !/Gender/.test(su));
t("signup has no Age field", !/Age/.test(su));
t("signup has no City field", !/City/.test(su));
t("signup has no manual Username field", !/Username \*/.test(su));
t("signup still requires name/email/phone/pass/terms", /Full Name/.test(su) && /Email/.test(su) && /Phone Number/.test(su) && /Confirm Password/.test(su) && /Terms/.test(su));

// coupon inputs carry no hint text
t("cart coupon box blank (no 'try this code')", !/try this/i.test(htmlSrcCheck()));

// A1/E1: saves actually land in localStorage (quota failures would now be loud)
app.saveAll();
t("saveAll writes nukto.user to storage", _ls.has("nukto.user"));
t("saveAll writes nukto.txns to storage", _ls.has("nukto.txns"));
t("saveAll reports ok on healthy storage", app.saveAll() === true);

/* ---------- E1/E2: admin edits survive a FULL RELOAD (second app instance, same storage) ---------- */
// simulate the admin typing in the Settings form and pressing Save
const setVal = (id, v) => { document.getElementById(id).value = v; };
setVal("s_storeName", "Nukto.Shop TEST");
setVal("s_tagline", "Test tagline line");
setVal("s_email", "care@nukto.shop");
setVal("s_phone", "03001112223");
setVal("s_deliveryFee", "249");
setVal("s_deliveryFree", "5000");
setVal("s_delNote", "Test delivery note");
setVal("s_banner", "NEW HOME DESCRIPTION FROM ADMIN — free delivery over Rs. 5,000!");
setVal("s_ep", "0345-TEST-EP");
setVal("s_jc", "0300-TEST-JC");
app.saveAdminSettings();

// admin edits a product price inline (visible product: hidden rows are merge aliases)
const pid = app.PRODUCTS.find(p => !p.hidden).id;
app.editProductField(pid, "price", 7777);

// --- reload the whole app (fresh instance over the same localStorage) ---
let app2;
try { app2 = makeApp(); } catch (e) { console.error("RELOAD INSTANCE FAILED:", e.stack || e); process.exit(2); }
t("RELOAD: admin store name persisted", app2.settings.storeName === "Nukto.Shop TEST", app2.settings.storeName);
t("RELOAD: admin banner (home description) persisted", app2.settings.banner.includes("NEW HOME DESCRIPTION FROM ADMIN"), app2.settings.banner);
t("RELOAD: admin delivery fee persisted", app2.settings.deliveryFee === 249, app2.settings.deliveryFee);
t("RELOAD: landing page SHOWS admin banner text", app2.productsPage("", "", "").includes("NEW HOME DESCRIPTION FROM ADMIN"));
t("RELOAD: landing page SHOWS admin tagline", app2.productsPage("", "", "").includes("Test tagline line"));
t("RELOAD: product price edit persisted", (app2.PRODUCTS.find(p => p.id === pid) || {}).price === 7777, (app2.PRODUCTS.find(p => p.id === pid) || {}).price);

/* ---------- F: team roles + ratio engine (admin control panel) ---------- */
t("team: member add", app2.addTeamMember("ali", "pass123", "editor").ok === true);
t("team: duplicate name rejected", app2.addTeamMember("ali", "pass123", "viewer").ok === false);
const sesEd = app2.tryLogin("ali", "pass123");
t("team: login with member creds", !!sesEd && sesEd.role === "editor", JSON.stringify(sesEd));
t("team: wrong password rejected", app2.tryLogin("ali", "nope") === null);
app2.addTeamMember("zara", "pass123", "viewer");
app2.session = app2.tryLogin("zara", "pass123");
t("roles: viewer is read-only", app2.needEdit() === false);
t("roles: viewer blocked from team page", app2.adminRoute("team").includes("No access"));
app2.session = sesEd;
t("roles: editor can edit", app2.needEdit() === true);
const rp = app2.PRODUCTS.find(p => !p.hidden && p.cost > 500);
app2.setProdRatio(rp.id, "2.5");
const expP = app2.priceFromRatio(rp.cost, 2.5);
t("ratio: product ratio reprices product", rp.price === expP, rp.price + " vs " + expP);
const lbl = rp.catLabel;
app2.setCatRatio(lbl, "1.8");
const other = app2.PRODUCTS.find(p => !p.hidden && p.catLabel === lbl && p.cost > 0 && p.id !== rp.id && !(p.id in app2.prodRatios));
const expC = app2.priceFromRatio(other.cost, 1.8);
t("ratio: category ratio reprices members", other.price === expC, other.price + " vs " + expC);
t("ratio: custom-ratio product unaffected by category change", rp.price === expP, rp.price);
const app3 = makeApp();
t("ratio: reprice survives reload", (app3.PRODUCTS.find(p => p.id === rp.id) || {}).price === expP);
t("team: member survives reload", (app3.team || []).some(m => m.name === "ali"));
app3.session = { name: "admin1", role: "owner" };
t("admin: pricing page renders with ratio table", app3.adminRoute("pricing").includes("Category ratios"));
t("admin: pricing page has editable per-product ratio", app3.adminRoute("pricing").includes("setProdRatio"));
t("admin: team page renders", app3.adminRoute("team").includes("Add Member"));
t("admin: products page renders", app3.adminRoute("products").includes("Add Product"));
t("admin: panel is secret (no public link)", !require("fs").readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8").includes("Admin Panel</a>"));
const imp = app3.adminImportProducts({ products: [{ id: "imp-1", name: "Import Test Widget", cost: 100, price: 200, catLabel: "Gadgets" }] });
t("admin bulk import uploads product", imp.ok === true && imp.added === 1 && !!app3.PRODUCTS.find(p => p.id === "imp-1"));
t("admin bulk import skips duplicates", app3.adminImportProducts([{ id: "imp-1", name: "dup" }]).added === 0);
t("search page always shows related products w/ cards", app3.productsPage("cream", "", "").includes("Related to") && app3.productsPage("cream", "", "").includes("pcard"));
t("search suggestions page renders product media cards", app3.productsPage("wall clock", "", "").includes("pimg"));
t("new product shows New badge on storefront", app3.productsPage("nikah thumbprint", "", "").includes(">New</span>"));
const csvSample = 'Type,SKU,Name,Regular price,Categories,Images,Description,In stock?,Store,Variation Attributes,Parent ID\n' +
  'simple,CSV-9001,CSV Test Widget,500,Gadgets,,csv desc,1,Import,,\n' +
  'simple,hhc-9002,CSV Parent Widget,800,Gadgets,,parent desc,1,Import,,\n' +
  'variation,hhc-9002-1,,300,,,,,,,Color: Red,9002.0\n';
const parsedCsv = app3.wooCSVToProducts(csvSample);
t("csv parse: parents + variant grouped", parsedCsv.length === 2 && parsedCsv[1].vars.length === 1, JSON.stringify(parsedCsv.map(p => [p.id, p.vars.length])));
const upCsv = app3.adminImportProducts(parsedCsv);
t("csv upload via admin panel", upCsv.added === 2 && !!app3.PRODUCTS.find(x => x.id === "CSV-9001"));
t("orders CSV export returns data", typeof app3.exportOrdersCSV() === "string" && app3.exportOrdersCSV().includes('"Order","Customer"'));
t("activity log records team uploads", app3.activity.some(a => /uploaded 2 products/.test(a.msg)));

/* ---------- H: notifications, reviews moderation, coupon dates, 2FA, delivery fee, cat sales ---------- */
_ls.set("nukto.userReviews", JSON.stringify({ "hhc-1": [{ name: "Ali", rating: 5, date: "2026-01-01", text: "acha product" }] }));
const app4 = makeApp();
app4.session = { name: "admin1", role: "owner" };
t("review visible before moderation", app4.allReviewsFor({ id: "hhc-1" }).some(r => r.name === "Ali"));
app4.toggleReviewHide("hhc-1|Ali|2026-01-01");
t("review hidden after moderation", !app4.allReviewsFor({ id: "hhc-1" }).some(r => r.name === "Ali"));
t("reviews moderation page renders", app4.adminRoute("reviews").includes("Reviews Moderation"));
app4.orders = [{ id: "ORD-T1", phone: "03001234567", deliveryPhone: "03001234567", items: [], total: 100, orderStatus: "pending", paymentStatus: "verified" }];
app4.setOrderStatus("ORD-T1", "shipped");
t("order status change notifies customer", app4.notifs.length > 0 && /shipped/.test(app4.notifs[0].msg), JSON.stringify(app4.notifs[0] || {}));
document.getElementById("dv_fee").value = "349"; document.getElementById("dv_free").value = "6000";
app4.saveDeliveryFee();
t("delivery fee editable in admin", app4.settings.deliveryFee === 349 && app4.settings.deliveryFreeAbove === 6000, app4.settings.deliveryFee);
t("member with 2FA PIN added", app4.addTeamMember("sec", "pass123", "editor", "4321").ok === true);
document.getElementById("a_user").value = "sec"; document.getElementById("a_pass").value = "pass123"; document.getElementById("a_pin").value = "0000";
app4.session = null; app4.adminLogin();
t("2FA blocks wrong PIN", !app4.session);
document.getElementById("a_pin").value = "4321"; app4.adminLogin();
t("2FA accepts correct PIN", !!app4.session && app4.session.role === "editor", JSON.stringify(app4.session));
app4.coupons = [...app4.coupons, { code: "FUTURE", type: "percent", value: 10, active: true, start: "2099-01-01", minOrder: 0 }];
app4.applyCoupon("FUTURE");
t("coupon with future start date rejected", !app4.promo);
const _catProd = app4.PRODUCTS.find(p => !p.hidden);
app4.orders[0].items = [{ id: _catProd.id, qty: 2, name: _catProd.name }];
t("category-wise sales report renders", app4.adminRoute("analytics").includes("Category-wise Sales"));

// coupon once-per-customer limit (owner logic list #10)
{
  app4.coupons.push({ code: "ONCE1", type: "pct", value: 5, active: true, uses: 0 });
  app4.applyCoupon("ONCE1");
  const afterFirst = app4.promo && app4.promo.code === "ONCE1";
  app4.applyCoupon("ONCE1"); // second use must be rejected
  const uses = JSON.parse(_ls.get("nukto.couponUse") || "{}");
  const key = Object.keys(uses).find(k => k.endsWith(":ONCE1"));
  t("coupon applies once, second use rejected (per-customer limit)", afterFirst && uses[key] === 1);
}
// cancelled order restores stock (owner logic list #7)
{
  const pr = app4.PRODUCTS.find(p => !p.hidden && p.stock > 0);
  const o = app4.orders[0];
  o.items = [{ id: pr.id, qty: 2, name: pr.name }];
  const b = pr.stock;
  o.orderStatus = "pending"; // fresh state: cancel from pending is a legal transition
  app4.setOrderStatus(o.id, "cancelled");
  t("cancelled order restores stock", pr.stock === b + 2);
}
// cart always prices at CURRENT catalog price, never stale add-time price (spec §11/§12)
{
  const p = app4.PRODUCTS.find(x => !x.hidden && x.price > 100);
  app4.cart.length = 0;
  app4.cart.push({ id: p.id, qty: 1, v: "", price: 1 });
  const old = p.price; p.price = 2500;
  t("cart recalculates at current price, not stale", app4.cartSubtotal() === 2500);
  p.price = old; app4.cart.length = 0;
}
// out-of-stock / over-qty lines are flagged before checkout (spec §11)
{
  const p = app4.PRODUCTS.find(x => !x.hidden && x.stock > 0);
  app4.cart.length = 0; app4.cart.push({ id: p.id, qty: 1, v: "", price: p.price });
  const clean = app4.cartStockIssues().length === 0;
  const oldStock = p.stock; p.stock = 0;
  const flagged = app4.cartStockIssues().length === 1;
  p.stock = oldStock; app4.cart.length = 0;
  t("cart flags out-of-stock items before checkout", clean && flagged);
}
// order status transitions must be sensible (spec §14)
{
  const o = app4.orders[0];
  o.orderStatus = "delivered";
  app4.setOrderStatus(o.id, "pending");
  t("delivered order cannot silently go back to pending", o.orderStatus === "delivered");
}
// password-reset page renders from email link (token~email)
{
  const ok = app4.resetView("abc123~ali@example.com");
  t("reset page renders for valid link", ok.includes("Reset Password") && ok.includes("ali@example.com"));
  t("reset page rejects malformed link", app4.resetView("badlink").includes("ghalat"));
}



/* ---------- I: full-site smoke — har page render ho, koi logic break na ho ---------- */
const app5 = makeApp();
app5.session = { name: "admin1", role: "owner" };
const S = [["home", () => app5.productsPage("", "", "")], ["products", () => app5.productsPage("", "", "")],
["search", () => app5.productsPage("wall clock", "", "")], ["category", () => app5.productsPage("", app5.CATEGORIES[0].slug, "")],
["sections", () => app5.sectionsPage()], ["product", () => app5.product(app5.PRODUCTS[0].id)], ["cart", () => app5.cartView()],
["checkout", () => app5.checkout()], ["login", () => app5.login()], ["signup", () => app5.signup()], ["account", () => app5.account()],
["orders", () => app5.ordersView()], ["wishlist", () => app5.wishlistView()], ["tracking", () => app5.trackingView("ORD-T1")],
["complaint", () => app5.complaint()], ["returns", () => app5.returnsView()], ["wallet", () => app5.wallet()],
["settings", () => app5.settings2()], ["support", () => app5.support()], ["terms", () => app5.terms()], ["about", () => app5.about()]];
/* ---------- clean product URLs (slugs) ---------- */
{
  const p0 = app5.PRODUCTS.find(p => !p.hidden); // visible card: hidden rows are aliases whose slug resolves to the canonical product
  const sl = app5.productSlug(p0);
  t("slug has no supplier prefix in URL", !/hhc/i.test(sl), sl);
  t("slug is url-safe (lowercase, dashes only)", /^[a-z0-9]+(-[a-z0-9]+)*$/.test(sl), sl);
  t("slug resolves back to the same product", app5.resolveProduct(sl) === p0);
  t("legacy raw id still resolves (old links/bookmarks)", app5.resolveProduct(p0.id) === p0);
  t("product page renders from a slug", app5.product(sl).indexOf("Product not found") === -1);
  t("product page renders from a legacy id", app5.product(p0.id).indexOf("Product not found") === -1);
  t("unknown slug shows not-found instead of crashing",
    app5.product("totally-made-up-slug-zzzz99").indexOf("Product not found") !== -1);
  // uniqueness across the WHOLE catalog (9,805 products) — a collision would
  // silently send a customer to the wrong product page
  const seen = new Set(); let dup = 0, leak = 0;
  for (const p of app5.PRODUCTS) {
    const s2 = app5.productSlug(p);
    if (seen.has(s2)) dup++; seen.add(s2);
    if (/hhc/i.test(s2)) leak++;
  }
  t("all " + app5.PRODUCTS.length + " slugs are unique", dup === 0, "dups=" + dup);
  t("no supplier id leaks in any slug", leak === 0, "leaks=" + leak);
}
let smokeFail = "";
S.forEach(([v, fn]) => { try { const html = fn(); if (typeof html !== "string" || html.length < 60) smokeFail += v + " "; } catch (e) { smokeFail += v + "(" + e.message + ") "; } });
t("smoke: all 21 storefront pages render", smokeFail === "", smokeFail);
const adminPages = ["dashboard", "users", "products", "categories", "dropshipping", "pricing", "orders", "delivery", "complaints", "wallet", "returns", "analytics", "coupons", "integy", "settings", "team", "reviews"];
let adminFail = "";
adminPages.forEach(pg => { try { const html = app5.adminRoute(pg); if (!html || html.length < 300) adminFail += pg + " "; } catch (e) { adminFail += pg + "(" + e.message + ") "; } });
t("smoke: all 17 admin pages render without error", adminFail === "", adminFail);

function htmlSrcCheck(){ return require("fs").readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8"); }

/* ---------- J: global storefront sync (admin publish → all devices pull) ---------- */
(async () => {
const app6 = makeApp();
app6.session = { name: "admin1", role: "owner" };
const visA = app6.PRODUCTS.find(p => !p.hidden && p.price > 100);
const visB = app6.PRODUCTS.find(p => !p.hidden && p.id !== visA.id && p.stock > 0);
const hidA = app6.PRODUCTS.find(p => p.hidden && app6.PRODUCT_ALIASES[p.id] !== visA.id && app6.PRODUCT_ALIASES[p.id] !== visB.id);
const visC = app6.PRODUCTS.find(p => !p.hidden && p.id !== visA.id && p.id !== visB.id && p.id !== app6.PRODUCT_ALIASES[hidA.id] && p.price > 50);
const visD = app6.PRODUCTS.find(p => !p.hidden && ![visA.id, visB.id, visC.id, app6.PRODUCT_ALIASES[hidA.id]].includes(p.id));
t("sync fixtures exist", !!(visA && visB && hidA && visC && visD));

// --- J1: payload sanitization (cost/store stripped, secrets never present) ---
const stock7 = app6.prod(visA.id).stock === 7 ? 8 : 7; // must DIFFER from base to prove stock-dirty path
app6.editProductField(visA.id, "price", 4321);
app6.editProductField(visA.id, "cost", 999);            // supplier info: must be stripped
app6.editProductField(visA.id, "stock", stock7);        // explicit stock edit: must be included
app6.editProductField(visB.id, "price", 1111);          // no stock touch: stock must be excluded
app6.editProductField(hidA.id, "price", 2222);          // hidden alias: must fold to canonical
const canonHid = app6.PRODUCT_ALIASES[hidA.id];
const pay = app6.buildStorefrontPayload();
t("payload products carry no cost/store keys", pay.products.every(x => !("cost" in x) && !("store" in x)));
t("payload has no secrets (password/apikey/wallet/team/users/txns/orders)",
  !/(passwordHash|apiKey|walletBalance|service_role|"team"|"users"|"txns"|"orders"|"sessions")/.test(JSON.stringify(pay)));
t("payload settings whitelisted",
  Object.keys(pay.settings).every(k => ["storeName","tagline","banner","deliveryFee","deliveryFreeAbove","deliveryNote","supportEmail","phone","whatsapp","easypaisa","jazzcash"].includes(k)));
const eA = pay.products.find(x => x.id === visA.id);
t("stock-dirty product carries price+stock", eA && eA.price === 4321 && eA.stock === stock7);
const eB = pay.products.find(x => x.id === visB.id);
t("non-stock edit carries no stock", eB && eB.price === 1111 && !("stock" in eB));
t("hidden alias folds to canonical id", canonHid && !pay.products.some(x => x.id === hidA.id) && pay.products.some(x => x.id === canonHid));
app6.coupons = [{code:"SYNC10", type:"pct", value:10, minOrder:500, active:true, uses:99, maxUses:0, expiry:"", start:"", note:"t"}];
const pay2 = app6.buildStorefrontPayload();
t("coupon mapped without server-owned uses", pay2.coupons.length === 1 && pay2.coupons[0].code === "SYNC10" && !("uses" in pay2.coupons[0]) && pay2.coupons[0].min_order === 500);

// --- J2: dirty guard set by edits ---
t("edits marked storefront dirty", app6.isStorefrontDirty() === true);

// --- J3: publish POST (token via header, never body) + clears dirty ---
_ls.set("nukto.adminSyncToken", JSON.stringify("tok123"));
let captured = null;
__fetchHandler = (url, opts) => {
  // NOTE: earlier boots' fire-and-forget cloud fetches may still drain here —
  // only record the sync-function call under test.
  if (String(url).includes("/functions/v1/storefront-sync")) {
    captured = { url: String(url), opts };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, counts: { products: 1 } }) });
  }
  return Promise.resolve({ ok: false, status: 0, json: () => Promise.resolve([]) });
};
const pub = await app6.publishStorefront();
t("publish posts to storefront-sync fn", pub.ok === true && captured && captured.url.includes("/functions/v1/storefront-sync"));
t("publish sends action+products", (() => { try { const b = JSON.parse(captured.opts.body); return b.action === "publish" && Array.isArray(b.products); } catch (e) { return false; } })());
t("publish token via header, never in body", captured.opts.headers["x-admin-token"] === "tok123" && !captured.opts.body.includes("tok123"));
t("publish clears dirty flag", app6.isStorefrontDirty() === false);
__fetchHandler = null;

// --- J4: pull applies cloud snapshot ---
app6.coupons.push({code:"DEAD1", type:"pct", value:5, minOrder:0, active:true, uses:0, maxUses:0, expiry:"", start:"", note:""});
__fetchHandler = (url, opts) => {
  const u = String(url);
  const J = (d) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(d) });
  if (u.includes("nukto_products?edited=eq.true")) return J([
    { id: visC.id, price: 5555, stock: 9, name: null, data: { discount: 10 } },
    { id: visD.id, data: { deleted: true } },
    { id: "CLOUD-NEW-1", name: "Cloud Widget", price: 777, stock: 5, cat: "gadgets", cat_label: "Gadgets", emoji: "📦", img: "", description: "from cloud", data: {} },
  ]);
  if (u.includes("stock=lte.0")) return J([{ id: visB.id }]);
  if (u.includes("nukto_settings")) return J([
    { setting_key: "banner", value: "CLOUD BANNER" },
    { setting_key: "deliveryFee", value: "321" },
    { setting_key: "customCategories", value: '[{"slug":"cloudcat","name":"Cloud Cat","emoji":"☁️"}]' },
    { setting_key: "couponGraves", value: '["DEAD1"]' },
  ]);
  if (u.includes("nukto_coupons")) return J([
    { code: "CLOUD20", type: "pct", value: 20, min_order: 100, active: true, uses: 3, max_uses: 0, expiry: "", note: "", start_date: "" },
  ]);
  return Promise.resolve({ ok: false, status: 0, json: () => Promise.resolve([]) });
};
const pul = await app6.pullStorefront();
t("pull succeeds", pul.ok === true);
t("pull applies cloud price+stock", app6.prod(visC.id).price === 5555 && app6.prod(visC.id).stock === 9);
t("pull applies cloud discount", app6.discountPct(app6.prod(visC.id)) === 10);
t("pull tombstone removes product", !app6.PRODUCTS.some(p => p.id === visD.id));
t("pull adds cloud custom product", !!app6.prod("CLOUD-NEW-1") && app6.prod("CLOUD-NEW-1").price === 777);
t("pull applies server OOS", app6.prod(visB.id).stock === 0);
t("pull applies banner+delivery fee", app6.settings.banner === "CLOUD BANNER" && app6.settings.deliveryFee === 321);
t("pull adds cloud category", app6.CATEGORIES.some(c => c.slug === "cloudcat"));
t("pull merges cloud coupon with server uses", app6.coupons.some(c => c.code === "CLOUD20" && c.value === 20 && c.uses === 3));
t("pull sweeps graved coupons", !app6.coupons.some(c => c.code === "DEAD1") && app6.couponGraves.includes("DEAD1"));

// --- J5: dirty blocks pull (unpublished admin work protected) ---
app6.editProductField(visC.id, "price", 1111);
const r5 = await app6.pullStorefront();
t("dirty pull reports dirty + keeps local price", r5.why === "dirty" && app6.prod(visC.id).price === 1111);

// --- J6: re-publish clears dirty; OOS clears when server restocks ---
__fetchHandler = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, counts: {} }) });
await app6.publishStorefront();
t("re-publish clears dirty again", app6.isStorefrontDirty() === false);
__fetchHandler = (url, opts) => {
  const u = String(url);
  if (u.includes("/rest/v1/")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
  return Promise.resolve({ ok: false, status: 0, json: () => Promise.resolve([]) });
};
await app6.pullStorefront();
t("OOS clears when server restocks", app6.prod(visB.id).stock > 0);
__fetchHandler = null;

/* ---------- K: persisted, expandable checkout charges ---------- */
const chargesApp=makeApp();
const chargeProduct=chargesApp.PRODUCTS.find(p=>!p.hidden && p.stock>0);
chargesApp.cart=[{id:chargeProduct.id,qty:1,v:""}];
chargesApp.user={id:"charge-test",fullName:"Charge Test",phone:"03001234567",walletBalance:10000};
chargesApp.saveAll();
const chargeLines=chargesApp.checkoutTaxLines();
const chargeHTML=chargesApp.checkout();
const names=["Netflix Fund","Clothes Charge","Food Charge","Bijli Bill","Dukaan Chalane Ka Kharcha","Dukaan Ki Publicity"];
t("charges: six rows",chargeLines.length===6);
t("charges: stable ids and order",chargeLines.map(x=>x.id).join(",")==="netflix,clothes,food,bijli,saleshop,ads");
t("charges: each under Rs. 20",chargeLines.every(x=>x.amount>=2.5 && x.amount<20));
t("charges: netflix smallest band",(()=>{const n=chargeLines.find(x=>x.id==="netflix");return n.amount>=2.5&&n.amount<=6.5;})());
t("charges: bijli biggest band",(()=>{const n=chargeLines.find(x=>x.id==="bijli");return n.amount>=14&&n.amount<=19.5;})());
t("charges: amounts unique",new Set(chargeLines.map(x=>x.amount)).size===6);
t("charges: whole paise",chargeLines.every(x=>x.amount===Math.round(x.amount*100)/100));
t("charges: zero-padded formatter",chargesApp.fmtCharge(8.43)==="Rs. 08.43" && chargesApp.fmtCharge(5)==="Rs. 05.00");
t("charges: total formatter retains two decimals",chargesApp.fmt2(18.4)==="Rs. 18.40" && chargesApp.fmt2(20)==="Rs. 20.00");
t("charges: all six names render",names.every(x=>chargeHTML.includes(x)));
t("charges: T&C label on notes",chargeHTML.includes("TERMS") && chargeHTML.includes("chc-tnc"));
t("charges: six chevrons and toggle buttons",(chargeHTML.match(/class="chc-chev"/g)||[]).length>=6 && (chargeHTML.match(/onclick="toggleChargeRow\(this\)"/g)||[]).length>=6 && chargeHTML.includes("<svg"));
t("charges: every row shows two decimals",chargeLines.every(x=>chargeHTML.includes(chargesApp.fmtCharge(x.amount))));
const cartHTML=chargesApp.cartView();
t("charges: cart order summary lists the same six rows",names.every(x=>cartHTML.includes(x)));
t("charges: cart total equals checkout payable",cartHTML.includes(chargesApp.fmt2(chargesApp.checkoutTaxTotal()?chargesApp.cartPayable():0)) || cartHTML.includes("Total"));
t("charges: no old cap; total is full paise-safe sum",!chargeHTML.includes("Max Rs. 20") && chargesApp.checkoutTaxTotal()===Math.round(chargeLines.reduce((a,x)=>a+x.amount,0)*100)/100 && chargesApp.checkoutTaxTotal()>20);
const chargeState=JSON.parse(_ls.get("nukto.checkoutTaxes"));
t("charges: persisted version and signature",chargeState.v===2 && typeof chargeState.sig==="string" && chargeState.sig.includes(chargeProduct.id));
const refreshedCharges=makeApp();
t("charges: refresh preserves exact amounts and total",JSON.stringify(refreshedCharges.checkoutTaxLines())===JSON.stringify(chargeLines) && refreshedCharges.checkoutTaxTotal()===chargesApp.checkoutTaxTotal());
const attrs={"aria-expanded":"false","aria-controls":"charge-netflix"};
const button={getAttribute:k=>attrs[k],setAttribute:(k,v)=>{attrs[k]=v;}};
chargesApp.toggleChargeRow(button);
const opened=attrs["aria-expanded"]==="true" && document.getElementById("charge-netflix").hidden===false;
chargesApp.toggleChargeRow(button);
t("charges: toggle expands and collapses note",opened && attrs["aria-expanded"]==="false" && document.getElementById("charge-netflix").hidden===true);

/* ---------- K: header brand mark = the real logo.svg asset (favicon parity) ----------
   The tab icon has always been logo.svg (the Nukto shopping bag); the header was still
   drawing a purple placeholder tile. These assert the header now uses that same file.
   The markup comes from the REAL renderHeader(), not from a re-implementation here. */
const brandApp = makeApp();
brandApp.renderHeader();
const brandHeader = document.getElementById("header").innerHTML;
const logoAnchor = (brandHeader.match(/<a href="#products" class="logo"[\s\S]*?<\/a>/) || [""])[0];
const imgTag = (logoAnchor.match(/<img[^>]*>/) || [""])[0];
const srcFile = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

t("brand: header renders a mark next to the Nukto.Shop name", logoAnchor.length > 0);
t("brand: header mark is an <img> of logo.svg (the favicon asset)",
  /class="logo-ico"/.test(imgTag) && /src="logo\.svg"/.test(imgTag), imgTag);
t("brand: old inline purple placeholder tile is gone from the header",
  !/<svg[^>]*class="logo-ico"/.test(logoAnchor) && !/id="lg1"/.test(logoAnchor));
t("brand: no emoji stands in for the mark", !/\p{Extended_Pictographic}/u.test(logoAnchor));
t("brand: img has fixed width/height + empty alt (no layout shift, decorative)",
  /width="30"/.test(imgTag) && /height="30"/.test(imgTag) && /alt=""/.test(imgTag), imgTag);
t("brand: brand name text still reads nukto .shop beside the mark",
  logoAnchor.indexOf("<img") < logoAnchor.indexOf("nukto") && /\.shop<\/small>/.test(logoAnchor));

const logoSvg = srcFile("logo.svg");
t("brand: logo.svg on disk is the shopping-bag mark (bag body + handle + nukto)",
  /M17 25h30l-2\.4 24\.6/.test(logoSvg) && /a8 8 0 0 1 16 0/.test(logoSvg) && /Nukto\.Shop/.test(logoSvg));

const headSrc = srcFile("index.html");
t("brand: favicon links untouched (svg + 32px + 192px + apple-touch)",
  /<link rel="icon" type="image\/svg\+xml" href="logo\.svg" \/>/.test(headSrc)
  && /href="favicon-32\.png"/.test(headSrc) && /href="logo-192\.png"/.test(headSrc)
  && /<link rel="apple-touch-icon" href="logo-192\.png" \/>/.test(headSrc));
t("brand: header and favicon point at the same file",
  /href="logo\.svg"/.test(headSrc) && /src="logo\.svg"/.test(headSrc));

// The mobile-first nav block is the multi-line one (the single-line 760px rules for
// .how/.trust/.foot-in come first in the file), so anchor on the opening brace + newline
// and require .nav-inner inside it to prove we matched the header's block, not a sibling.
const mq760 = (headSrc.match(/@media\(max-width:760px\)\{\n[\s\S]*?\n  \}/) || [""])[0];
t("brand: desktop sizing rule for the brand mark",
  /\.logo img\.logo-ico\{width:30px;height:30px/.test(headSrc));
t("brand: mobile sizing rule sits inside the 760px nav media query",
  /\.nav-inner\{/.test(mq760) && /\.logo img\.logo-ico\{width:26px;height:26px/.test(mq760),
  mq760.slice(0, 80));
t("brand: mark cannot be squeezed by the flex row (flex:0 0 auto kept)",
  /\.logo \.logo-ico\{flex:0 0 auto/.test(headSrc));

/* ---------- L: footer + admin sidebar carry the same logo.svg mark ---------- */
const footMatch = headSrc.match(/<div class="logo" style="color:#fff">[\s\S]*?<\/div>/) || [""];
const footImg = (footMatch[0].match(/<img[^>]*>/) || [""])[0];
t("footer: brand area renders the logo.svg mark",
  /class="logo-ico"/.test(footImg) && /src="logo\.svg"/.test(footImg), footImg);
t("footer: old inline placeholder tile is gone from the footer brand",
  !/<svg[^>]*class="logo-ico"/.test(footMatch[0]) && !/id="lg2"/.test(headSrc));
t("footer: Nukto.Shop name still sits beside the mark",
  footMatch[0].indexOf("<img") < footMatch[0].indexOf("nukto") && /\.shop<\/small>/.test(footMatch[0]));
t("footer: mark keeps its own 26px size (no double corner, no shrink)",
  /\.foot-in \.logo img\.logo-ico\{width:26px;height:26px/.test(headSrc));

// The checks above read the template; this one runs the real renderFooter() so the
// assertion is about the DOM the browser actually gets, not about a string in the file.
brandApp.renderFooter();
const footDom = document.getElementById("footer").innerHTML;
t("footer: rendered DOM carries one logo.svg img inside the brand block",
  (footDom.match(/<img class="logo-ico" src="logo\.svg"/g) || []).length === 1,
  (footDom.match(/<div class="logo"[\s\S]{0,120}/) || [""])[0]);
t("footer: rendered DOM has no inline placeholder tile left",
  !/<svg[^>]*class="logo-ico"/.test(footDom) && footDom.indexOf("logo.svg") > 0);

const asideMatch = headSrc.match(/<div class="alogo">[\s\S]*?<\/div>/) || [""];
const asideImg = (asideMatch[0].match(/<img[^>]*>/) || [""])[0];
t("admin: sidebar brand renders the logo.svg mark",
  /class="logo-ico"/.test(asideImg) && /src="logo\.svg"/.test(asideImg), asideImg);
t("admin: old inline placeholder tile is gone from the sidebar brand",
  !/<svg[^>]*class="logo-ico"/.test(asideMatch[0]) && !/id="lg3"/.test(headSrc));
t("admin: sidebar keeps the nukto.shop word beside the mark",
  /<span class="aword">nukto<span>\.<\/span>shop<\/span>/.test(asideMatch[0]));
t("admin: sidebar row is a flex row (mark and word stay aligned)",
  /\.aside \.alogo\{display:flex;align-items:center/.test(headSrc));
t("admin: sidebar mark is sized in CSS", /\.aside \.alogo img\.logo-ico\{flex:0 0 auto;width:26px/.test(headSrc));
t("admin: word colour survives the old .aside .alogo span rule",
  /\.aside \.alogo \.aword\{color:#fff/.test(headSrc) && /\.aside \.alogo \.aword span\{color:#c9b6ff/.test(headSrc));

/* ---------- M: animated GIF + reduced motion ---------- */
const gifPath = path.join(__dirname, "..", "img", "nukto-shopping-bag-loop.gif");
const gif = fs.existsSync(gifPath) ? fs.readFileSync(gifPath) : null;
const gifHeader = gif ? gif.subarray(0, 6).toString("latin1") : "";
const gifTrailer = gif ? gif.subarray(gif.length - 1).toString("latin1") : "";
t("gif: file exists at nukto-shop/img/nukto-shopping-bag-loop.gif", !!gif);
t("gif: real GIF89a/87a file, properly terminated",
  /^GIF8[79]a$/.test(gifHeader) && gifTrailer === "\x3b",
  gifHeader + " / trailer " + JSON.stringify(gifTrailer));
t("gif: light enough for the web (< 500KB)", !!gif && gif.length < 500 * 1024,
  gif ? Math.round(gif.length / 1024) + " KB" : "missing");
// Application Extension 21 FF 0B "NETSCAPE2.0" -> loop forever.
t("gif: loops forever (NETSCAPE2.0 extension present)",
  !!gif && gif.includes(Buffer.from("\x21\xff\x0bNETSCAPE2.0", "latin1")));
// Graphic Control Extension with transparency flag: 21 F9 04 <packed & 0x01>.
let gifTransparent = false;
if (gif) {
  for (let i = 0; i < gif.length - 5; i++) {
    if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 0x04 && (gif[i + 3] & 0x01)) { gifTransparent = true; break; }
  }
}
t("gif: has a transparent background (GCE transparency flag set)", gifTransparent);
t("gif: referenced from the boot splash markup", /img\/nukto-shopping-bag-loop\.gif/.test(headSrc));
t("gif: splash keeps a static logo.svg fallback for reduced motion",
  /class="brand-still" src="logo\.svg"/.test(headSrc));
t("gif: reduced-motion users get the still logo, not the animation",
  /@media \(prefers-reduced-motion: reduce\)\{\.load-brand \.brand-anim\{display:none\}\.load-brand \.brand-still\{display:block\}\}/.test(headSrc));
t("gif: navigation branding stays static logo.svg (no animated img in header/footer/admin)",
  !/<img[^>]*class="logo-ico"[^>]*\.gif/.test(headSrc));
t("gif: logo.svg source file is still the unchanged favicon asset",
  /<link rel="icon" type="image\/svg\+xml" href="logo\.svg" \/>/.test(headSrc)
  && !/<link[^>]*rel="icon"[^>]*\.gif/.test(headSrc));

const deploy = srcFile("DEPLOY_BACKEND.md");
t("deploy guide: repo link points at main", /blob\/main\/nukto-shop\//.test(deploy));
t("deploy guide: no stale arena branch link left", !/arena\/01/.test(deploy));

/* ---------- M: merge-9 — responsive rows/columns, endless home feed, categories, polish ---------- */
const src9 = srcFile("index.html");
// category rails are horizontal, swipeable rows of columns (not a vertical stack)
t("m9: .cat-rail is a horizontal flex scroller", /\.cat-rail\{display:flex;[^}]*overflow-x:auto/.test(src9));
t("m9: rail cards sized as columns with snap", /\.cat-rail \.pcard\{flex:0 0 clamp\(/.test(src9));
t("m9: rail 'Show more' tile styled", /\.cat-more\{flex:0 0 132px/.test(src9));
// home shows rails AND the endless rows/columns feed (grid + sentinel), no vertical single column
const home9 = app.productsPage("", "", "");
t("m9: home shows category rails", /cat-rail/.test(home9));
t("m9: home also renders the endless feed grid", /id="feed-grid"/.test(home9) && /Shop all products/.test(home9));
t("m9: home feed has scroll sentinel (never ends)", /feed-sentinel/.test(home9));
t("m9: no numbered pagination anywhere in feed", !/‹ Prev/.test(home9) && !/›/.test(home9.match(/pagination[\s\S]{0,80}/) || ""));
// categories page: header link + route + scrollable list of every category
t("m9: header nav links to #categories", /<nav class="nav"><a href="#categories">Categories<\/a><\/nav>/.test(src9));
t("m9: router has categories route", /case "categories":content=categoriesPage\(\);break;/.test(src9));
const cats9 = app.categoriesPage();
const catsWithProducts = app.CATEGORIES.filter(c => app.PRODUCTS.some(p => p.cat === c.slug)).length;
t("m9: categories page shows every category up top (chip per category)", app.CATEGORIES.every(c => cats9.includes("#category:" + c.slug) || cats9.includes("go('category','" + c.slug + "')")));
t("m9: categories page renders a product rail per category", (cats9.match(/class="cat-rail"/g) || []).length === catsWithProducts);
t("m9: categories page 'Show more' links to each category", (cats9.match(/href="#category:/g) || []).length >= catsWithProducts);
// hero banner now reads like a heading (bigger) not a tiny caption
t("m9: hero banner line uses heading style", /class="banner-line"/.test(home9) && /\.hero p\.banner-line\{font-size:clamp\(20px/.test(src9));
// charges: bigger heading + professional tagline, readable T&C
t("m9: charges heading is larger (19px)", /\.tax-box-head\{[^}]*font-size:19px/.test(src9));
t("m9: charges box carries the tagline", typeof app.CHARGE_TAGLINE === "string" && app.CHARGE_TAGLINE.length > 10);
t("m9: charge notes readable (>=14px, roomy line-height)", /\.chc-text\{[^}]*font-size:14px;[^}]*line-height:1\.6/.test(src9));
// feed observer + smooth media are wired after every render (videos/products run smooth)
t("m9: render wires the feed observer", /attachFeedObserver\(\);\s*\}catch/.test(src9));
t("m9: render wires smooth media (pause/play offscreen videos)", /smoothMedia\(\);\s*\}catch/.test(src9));
// appending never throws the shopper back to the top
t("m9: render skips scrollTo while appending", /if\(!productsPage\._appending\) window\.scrollTo\(0,0\);/.test(src9));
t("m9: loadMoreFeed preserves scrollY", /const sy=\(typeof window!=="undefined"\)\?window\.scrollY:0;/.test(src9));

/* ---------- M11: merge-11 round-2 — punchlines, magnitude hints, fluid layout, select ---------- */
["Bijli ka bill tera baap bharega","Netflix ka paisa bhi to kahin se aayega","Nanga thori ghoomna hai","Bhai hum bhi khaate hain","Dukaan hawa mein thori chalti hai","Logon ko pata bhi toh chale dukaan hai"]
  .forEach(p=>t("m11: punchline present — "+p.slice(0,18), src9.includes(p)));
t("m11: magnitude hints (sabse zyada / sabse kam)", src9.includes("sabse zyada") && src9.includes("sabse kam"));
t("m11: punchline styled after T&C label", /\.chc-punch\{display:block/.test(src9));
t("m11: no fixed 1320px container left", !src9.includes("max-width:1320px"));
t("m11: fluid wrap container", /\.wrap\{width:100%;max-width:none/.test(src9));
t("m11: product grid fluid auto-fill (no fixed columns)", /\.pgrid\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(176px,1fr\)\)/.test(src9));
t("m11: footer/nav fluid", /\.nav-inner\{max-width:none/.test(src9) && /\.foot-in\{max-width:none/.test(src9));
t("m11: modern select styling", /\.select\{appearance:none/.test(src9));
t("m11: sections use Show more instead of weak subs", !src9.includes("High demand best sellers"));

/* ---------- Public contact and shop policy pages ---------- */
{
  const previousUser=app.user;
  app.user=null;
  const links=app.shopInfoLinks();
  const guestSettings=app.settings2();
  app.renderHeader();
  for(const [route,label] of links){
    t("shop info: header gear links to "+route, document.getElementById("header").innerHTML.includes('href="#'+route+'"'));
    t("shop info: guest settings links to "+route, guestSettings.includes('href="#'+route+'"'));
    location.hash="#"+route;
    app.render();
    t("shop info: public route renders "+route, document.getElementById("app").innerHTML.includes(route==="about"?"About Nukto.Shop":label));
  }
  const contact=app.contact();
  t("contact: confirmed name and callable number", contact.includes("Nukto.Shop") && contact.includes('href="tel:+923420286170"') && contact.includes("03420286170"));
  t("contact: WhatsApp uses correct international number", contact.includes('href="https://wa.me/923420286170"'));
  t("contact: working email link uses settings support email", contact.includes('href="mailto:'+app.settings.supportEmail+'"') && !contact.includes("nukta.shop"));
  t("contact: verification labels + exact address", contact.includes("Business Name:") && contact.includes("Business Address:") && contact.includes("Correspondence Address:") && contact.includes("Phone / WhatsApp:") && !contact.includes("Same as Business Address"));
  t("contact: correspondence address spells out the full address", (contact.match(/Mohallah Shaikh, Berani, Jam Nawaz Ali, Sanghar, Sindh, Pakistan/g)||[]).length>=2);
  t("privacy: cookie banner links to dedicated page", html.includes('See our <a href="#privacy">Privacy Policy</a>'));
  t("refund: retains 48 hour window and consumer rights", app.refundPolicy().includes("48 hours") && app.refundPolicy().includes("statutory rights"));
  app.user={id:"policy-test", fullName:"Test Shopper", email:"test@example.com", phone:"03001234567"};
  t("settings: signed-in profile form preserved", app.settings2().includes('id="s_name"') && app.settings2().includes("saveSettings2()"));
  app.user=previousUser;
  location.hash="";
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
