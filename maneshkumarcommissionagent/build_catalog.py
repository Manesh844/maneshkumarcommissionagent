#!/usr/bin/env python3
"""
Manesh Kumar Commission Agent — Catalog builder
===============================================
Reads the HHC WooCommerce export CSV and produces `catalog.js` (JS array of all
products) + `catalog_summary.json`.

Pricing model:
  - `cost`        = HHC supply price (CSV "Regular price")
  - `price`       = SELLING price = cost x category markup, rounded to a nice
                    PKR value. Markup is tuned per top-level category so profit
                    margin >= 50% (>= 2x cost).
  - profit ratio, profit %, etc. are recomputed in the store.

Data quality addressed:
  - Robust category parsing: categories are comma-separated (multiple categories)
    and use "A > B" for subcategories. The first top-level category wins.
  - No-image products get a branded SVG placeholder (data URI) so the store never
    shows a blank box.
  - Gallery: every image in the CSV is kept in `gal` (additional images), used by
    the product page gallery.
  - Variants: variation rows become `vars` (label + price) on the parent product.
  - Clickable tags: `winter` / `special` baked in based on the product name.
"""
import csv, json, re, os, math, random
from collections import Counter, OrderedDict
from urllib.parse import quote

import glob as _glob
ROOT = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(ROOT)
_SRC_CANDIDATES = sorted(
    _glob.glob(os.path.join(_REPO, "uploads", "woocom_products_export*.csv"))
    + _glob.glob("/home/user/uploads/woocom_products_export*.csv")
    + _glob.glob(os.path.join(_REPO, "csvfiles", "*.csv"))
)
SRC = _SRC_CANDIDATES[0] if _SRC_CANDIDATES else os.path.join(_REPO, "uploads", "woocom_products_export.csv")
# ---- Brand (used by the generated placeholder artwork) ----
BRAND_NAME   = "Manesh Kumar Commission Agent"
BRAND_SHORT  = "MK Commission Agent"
BRAND_DOMAIN = "maneshkumarcommissionagent.dpdns.org"

OUT_JS = os.path.join(ROOT, "catalog.js")
OUT_JSON = os.path.join(ROOT, "catalog_summary.json")

# ---------- Category markup (>= 2.0 assures >= 50% margin) ----------
MARKUP = {
    "Electronics & Appliances": 2.1,
    "Gadgets":                  2.2,
    "Mobile & Accessories":     2.1,
    "Fashion & Apparel":        2.2,
    "Women":                    2.3,
    "Men":                      2.2,
    "Kids":                     2.2,
    "Health & Beauty":          2.4,
    "Beauty":                   2.4,
    "Home & Living":            2.3,
    "Kitchen":                  2.3,
    "Automotive":               2.2,
    "Books & Stationery":       2.2,
    "Books":                    2.2,
    "Toys & Games":             2.3,
    "Toys":                     2.3,
    "Pets":                     2.3,
    "Tools & DIY":              2.2,
    "Travel & Outdoor":         2.3,
    "Events & Gifting":         2.3,
    "Islamic & Cultural":       2.3,
    "Groceries":                2.0,
    "Kids Accessories":         2.2,
    "Other":                    2.2,
}
DEFAULT_MARKUP = 2.2   # floor assures >= 50%

# ---------- Top-level category display mapping ----------
CAT_MAP = [
    ("Electronics & Appliances", "📱", "Gadgets", "gadgets"),
    ("Gadgets",                  "🎧", "Gadgets", "gadgets"),
    ("Mobile & Accessories",     "📱", "Gadgets", "gadgets"),
    ("Fashion & Apparel",        "👗", "Fashion", "fashion"),
    ("Women",                    "👗", "Fashion", "fashion"),
    ("Men",                      "👔", "Fashion", "fashion"),
    ("Kids",                     "🧸", "Kids & Toys", "kids"),
    ("Kids Accessories",         "🧸", "Kids & Toys", "kids"),
    ("Baby & Kids Accessories",  "🧸", "Kids & Toys", "kids"),
    ("Dolls & Action Figures",   "🧸", "Kids & Toys", "kids"),
    ("Toys & Games",             "🧸", "Kids & Toys", "kids"),
    ("Toys",                     "🧸", "Kids & Toys", "kids"),
    ("Health & Beauty",          "💄", "Health & Beauty", "beauty"),
    ("Beauty",                   "💄", "Health & Beauty", "beauty"),
    ("Home & Living",            "🏠", "Home & Living", "home"),
    ("Kitchen",                  "🍳", "Home & Living", "home"),
    ("Automotive",               "🚗", "Automotive", "automotive"),
    ("Books & Stationery",       "📚", "Books & Stationery", "books"),
    ("Books",                    "📚", "Books & Stationery", "books"),
    ("Pets & Animals",           "🐾", "Pets", "pets"),
    ("Pets",                     "🐾", "Pets", "pets"),
    ("Tools & DIY",              "🔧", "Tools & DIY", "tools"),
    ("Travel & Outdoor",         "🎒", "Travel & Outdoor", "travel"),
    ("Events & Gifting",         "🎁", "Events & Gifting", "gifts"),
    ("Islamic & Cultural",       "🕌", "Islamic & Cultural", "islamic"),
    ("Groceries",                "🛒", "Groceries", "groceries"),
    ("Other",                    "📦", "Other", "other"),
]
CAT_BY_NAME = {}
for name, emoji, label, slug in CAT_MAP:
    CAT_BY_NAME[name] = {"emoji": emoji, "label": label, "slug": slug}

# Subcategory first-segment -> top-level category (when a CSV row starts with a
# subcategory rather than a top-level category).
SUB_MAP = {
    "Women's Fashion": "Fashion & Apparel",
    "Men's Fashion": "Fashion & Apparel",
    "Kids & Baby Wear": "Fashion & Apparel",
    "Kitchen & Dining": "Home & Living",
    "Bedding & Linen": "Home & Living",
    "Cleaning & Organization": "Home & Living",
    "Home Decor": "Home & Living",
    "Personal Care": "Health & Beauty",
    "Health & Wellness": "Health & Beauty",
    "Beauty & Cosmetics": "Health & Beauty",
    "Skincare": "Health & Beauty",
    "Haircare": "Health & Beauty",
    "Cameras & Photography": "Electronics & Appliances",
    "Home Appliances": "Electronics & Appliances",
    "Electrical Supplies": "Electronics & Appliances",
    "Mobile & Accessories": "Electronics & Appliances",
    "Oils & Lubricants": "Automotive",
    "Chemicals & Raw Materials": "Tools & DIY",
    "Educational & Creative": "Books & Stationery",
    "Pet Toys & Beds": "Pets",
    "Baking and Cooking": "Home & Living",
    "Islamic Essentials": "Islamic & Cultural",
}

# ---------- Gadget / Crazy / Trend / Must-try keyword rules ----------
GADGET_KEYS = ["earbud","headphon","bluetooth","smartwatch","smart watch","band","charger",
    "power bank","powerbank","speaker","projector","camera","webcam","mouse","keyboard",
    "drone","gimbal","fan","vacuum","translator","led","phone","tablet","earphone","gamepad"]
CRAZY_KEYS = ["spoon","gadget","funny","creativ","novelty","gift","multi","magic","mini fan",
    "bottle","warmer","neon","galaxy","star","projector","selfie","ring light","pet","kawaii"]
TREND_KEYS = ["earbud","smartwatch","smart watch","bluetooth","power bank","projector",
    "chopper","led strip","fitness","perfume","serum","sneaker","kurti","handbag","watch"]
MUSTTRY_KEYS = ["earbud","bluetooth","smartwatch","power bank","portable","mini","kitchen",
    "chopper","perfume","serum","sunscreen","massage","vacuum","fan","bottle"]
# --- Clickable tags: Winter + Special (High-Selling/Hot computed at runtime) ---
WINTER_KEYS = ["winter","wool","jacket","sweater","scarf","thermal","shawl","hoodie","cardigan",
    "muffler","coat","jersey","parka","knee warmer","lehenga"]
SPECIAL_KEYS = ["gift set","combo","special","limited","pack of"," box ","box","premium","exclusive","set of"]

# ---------- Placeholder SVG (branded, category-coloured) ----------
# slug -> [gradient start, gradient end, accent]
PLACE_COLORS = {
    "gadgets":     ["#4f8cff", "#2563eb", "#eaf2ff"],
    "fashion":     ["#f472b6", "#db2777", "#fdf2f8"],
    "kids":        ["#fbbf24", "#f59e0b", "#fffbeb"],
    "beauty":      ["#c084fc", "#a21caf", "#faf5ff"],
    "home":        ["#5eead4", "#0d9488", "#f0fdfa"],
    "automotive":  ["#f87171", "#b91c1c", "#fef2f2"],
    "books":       ["#93c5fd", "#1d4ed8", "#eff6ff"],
    "pets":        ["#fdba74", "#ea580c", "#fff7ed"],
    "tools":       ["#94a3b8", "#475569", "#f8fafc"],
    "travel":      ["#34d399", "#059669", "#ecfdf5"],
    "gifts":       ["#F7D774", "#C8921A", "#FBF0D2"],
    "islamic":     ["#6ee7b7", "#047857", "#ecfdf5"],
    "groceries":   ["#fde047", "#ca8a04", "#fefce8"],
    "other":       ["#d6d3d1", "#78716c", "#f5f5f4"],
}
def place_uri(slug, cat_label, emoji):
    c = PLACE_COLORS.get(slug, PLACE_COLORS["other"])
    g1, g2, _ = c
    label = (cat_label or BRAND_SHORT).replace("&", "&amp;")
    # a clean branded placeholder (no emoji) — a subtle gradient + a photo glyph
    glyph = ('<g fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'
             '<rect x="230" y="150" width="180" height="130" rx="14"/>'
             '<circle cx="278" cy="198" r="16"/><path d="M252 280l52-52 34 34 34-34 32 32"/></g>')
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">'
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{g1}"/><stop offset="1" stop-color="{g2}"/>'
        '</linearGradient></defs>'
        f'<rect width="640" height="480" fill="url(#g)"/>'
        '<circle cx="560" cy="60" r="120" fill="#ffffff" opacity="0.08"/>'
        '<circle cx="80" cy="440" r="90" fill="#ffffff" opacity="0.08"/>'
        + glyph +
        f'<text x="320" y="366" font-size="40" font-weight="700" text-anchor="middle" fill="#ffffff" '
        f'font-family="Segoe UI,Arial,sans-serif">{label}</text>'
        '<text x="320" y="416" font-size="22" text-anchor="middle" fill="#ffffff" opacity="0.75" '
        f'font-family="Segoe UI,Arial,sans-serif">{BRAND_DOMAIN}</text>'
        '</svg>'
    )
    return "data:image/svg+xml," + quote(svg)

def nice_price(cost, markup):
    if cost <= 0: return 0
    raw = cost * markup
    floor = cost * 2            # 50%-margin floor
    if raw < 1000:
        for t in (49, 99, 149, 199, 249, 299, 349, 399, 449, 499,
                  549, 599, 649, 699, 749, 799, 849, 899, 949, 999):
            if t >= raw and t >= floor:
                return t
        return int(math.ceil(max(raw, floor) / 100.0) * 100)
    return int(math.ceil(max(raw, floor) / 100.0) * 100)

def classify(name, cat):
    n = name.lower()
    gadget = any(k in n for k in GADGET_KEYS) or cat in ("gadgets",)
    crazy  = any(k in n for k in CRAZY_KEYS)
    trend  = any(k in n for k in TREND_KEYS)
    must   = any(k in n for k in MUSTTRY_KEYS)
    winter = any(k in n for k in WINTER_KEYS)
    special = any(k in n for k in SPECIAL_KEYS)
    return gadget, crazy, trend, must, winter, special

def topcat(catstr):
    if not catstr:
        return "Other"
    # categories are comma-separated; take the first, then its top-level before '>'
    seg = [p.strip() for p in catstr.split(",") if p.strip()]
    if not seg:
        return "Other"
    first = [p.strip() for p in seg[0].split(">") if p.strip()]
    base = first[0] if first else "Other"
    # normalise stray multi-category prefixes
    base = base.replace("Home & Living, Home & Living > Home Decor", "Home & Living")
    for name in CAT_BY_NAME:
        if base.startswith(name) or name.startswith(base):
            return name
    if base in SUB_MAP:
        return SUB_MAP[base]
    # fuzzy contains
    for k, v in SUB_MAP.items():
        if k.lower() in base.lower() or base.lower() in k.lower():
            return v
    return "Other"

def extract_specs(text):
    """Keep only useful, applicable measurements; empty products get no specs."""
    text = re.sub(r"<[^>]+>", " ", text or "")
    out = []
    def add(label, value):
        if value and not any(x["label"] == label and x["value"].lower() == value.lower() for x in out):
            out.append({"label": label, "value": value})
    vols = re.findall(r"\b(\d+(?:\.\d+)?)\s*(ml|l|litre|liter|oz)\b", text, re.I)
    if vols: add("Capacity / volume", ", ".join(f"{n} {u}" for n, u in vols[:5]))
    packs = re.findall(r"\b(?:pack|set|box)\s*(?:of)?\s*(\d+)\s*(?:pcs?|pieces?|units?)?\b", text, re.I)
    if packs: add("Pack quantity", ", ".join(f"{n} pcs" for n in packs[:5]))
    if not packs:
        pcs = re.findall(r"\b(\d+)\s*(?:pcs?|pieces?|units?)\b", text, re.I)
        if pcs: add("Quantity", ", ".join(f"{n} pcs" for n in pcs[:5]))
    weights = re.findall(r"\b(\d+(?:\.\d+)?)\s*(g|kg|gram|grams)\b", text, re.I)
    if weights: add("Weight", ", ".join(f"{n} {u}" for n, u in weights[:5]))
    return out[:6]

def merge_duplicate_products(products):
    """Mark repeated supplier rows as aliases and turn different prices into options.

    IDs remain in the export for old order/history links; the storefront hides aliases
    and resolves them to their canonical product at runtime.
    """
    groups = OrderedDict()
    for p in products:
        key = (re.sub(r"[^a-z0-9]+", " ", p["name"].lower()).strip(), p["cat"])
        groups.setdefault(key, []).append(p)
    merged = 0
    for group in groups.values():
        if len(group) < 2: continue
        canonical = next((p for p in group if p.get("vars")), group[0])
        opts, seen_opts = [], set()
        def add(label, price):
            try: price = int(round(float(price or 0)))
            except (TypeError, ValueError): price = 0
            if price <= 0: return
            key = (str(label).strip().lower(), price)
            if key not in seen_opts:
                seen_opts.add(key); opts.append({"la": str(label or f"Option {len(opts)+1}"), "pr": price})
        for v in canonical.get("vars", []): add(v.get("la", ""), v.get("pr", canonical.get("price")))
        simple = [p for p in group if not p.get("vars")]
        prices = sorted({int(round(float(p.get("price") or 0))) for p in simple if p.get("price")})
        if len(simple) > 1 and len(prices) > 1:
            for i, price in enumerate(prices, 1): add(f"Option {i}", price)
        for p in group:
            if p is canonical: continue
            p["hidden"] = True; p["merged_into"] = canonical["id"]; merged += 1
            canonical["stock"] = max(canonical.get("stock", 0), p.get("stock", 0))
            if p.get("cost", 0): canonical["cost"] = min(canonical.get("cost") or p["cost"], p["cost"])
            if p.get("img") and p["img"] != canonical.get("img"):
                canonical.setdefault("gal", []).append(p["img"])
            for v in p.get("vars", []): add(v.get("la", ""), v.get("pr", p.get("price")))
        if len(opts) > 1:
            opts.sort(key=lambda x: (x["pr"], x["la"].lower()))
            if all(re.match(r"^Option \d+$", x["la"], re.I) for x in opts):
                for i, option in enumerate(opts, 1): option["la"] = f"Option {i}"
            canonical["vars"] = opts; canonical["price"] = opts[0]["pr"]
        canonical["gal"] = list(dict.fromkeys(canonical.get("gal", [])))[:12]
    return merged

def main():
    random.seed(7)

    # ---------- load raw rows ----------
    raw_rows = []
    with open(SRC, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            raw_rows.append(row)

    products = []
    seen = set()
    by_sku = {}
    parents = {}            # parent_id -> product (for child variations)
    variations_by_parent = {}
    for row in raw_rows:
        typ = row["Type"]
        if typ == "variation":
            pid = (row.get("Parent ID") or "").strip()
            if pid:
                variations_by_parent.setdefault(pid, []).append(row)
            continue
        name = (row["Name"] or "").strip()
        if not name:
            continue
        sku = (row.get("SKU") or "").strip() or ("hhc-" + str(len(products)))
        if sku in seen:
            continue
        seen.add(sku)
        try:
            cost = float((row.get("Regular price") or "0").replace(",", "").strip())
        except ValueError:
            cost = 0
        if cost <= 0:
            cost = 0
        catstr = (row.get("Categories") or "")
        tc = topcat(catstr)
        markup = MARKUP.get(tc, DEFAULT_MARKUP)
        price = nice_price(cost, markup) if cost > 0 else 0
        basecat = CAT_BY_NAME.get(tc, CAT_BY_NAME["Other"])
        imgs = [u.strip() for u in (row.get("Images") or "").split(",") if u.strip()]
        img = imgs[0] if imgs else ""
        short = (row.get("Short description") or "").strip()
        desc = (row.get("Description") or "").strip() or short
        instock = (row.get("In stock?") or "").strip()
        # deterministic pseudo stock: stable per SKU, so the UI's "Only X left"
        # urgency stays consistent between page loads. 0 if explicitly out-of-stock.
        _s = 0
        for _ch in sku:
            _s = (_s * 31 + ord(_ch)) & 0xFFFFFFFF
        if instock in ("0", "0.00", "outofstock", "false"):
            stock = 0
        else:
            stock = max(1, 1 + (_s % 60))       # 1..60 in-stock
            if _s % 7 == 0:
                stock = 1 + (_s % 3)            # ~14% items low-stock (1..3) for urgency
        stock = int(stock)
        gadget, crazy, trend, must, winter, special = classify(name, basecat["slug"])
        pid = (row.get("ID") or "").strip()
        product = {
            "id": sku,
            "name": name,
            "cat": basecat["slug"],
            "catLabel": basecat["label"],
            "emoji": basecat["emoji"],
            "cost": cost,
            "price": price,
            "img": img if img else place_uri(basecat["slug"], basecat["label"], basecat["emoji"]),
            "gal": imgs[1:],          # additional gallery images (primary already in img)
            "desc": desc[:260],
            "specs": extract_specs(name + " " + desc),
            "stock": stock,
            "store": (row.get("Store") or "").strip(),
            "g": 1 if gadget else 0,
            "c": 1 if crazy else 0,
            "t": 1 if trend else 0,
            "m": 1 if must else 0,
            "tags": [t for t, flag in [("winter", winter), ("special", special)] if flag],
        }
        products.append(product)
        by_sku[sku] = product
        # index by the numeric WooCommerce ID embedded in the SKU (e.g. 'hhc-3764645')
        m = re.match(r"^hhc[-_]?(\d+)", sku)
        if m:
            idn = m.group(1)
            parents[idn] = product
            parents.setdefault(idn, product)

    # ---------- attach variants (from variation rows) ----------
    n_var = 0
    for pid, vrows in variations_by_parent.items():
        prod = parents.get(pid)
        if not prod:
            continue
        # use parent product SKU lookup too
        if not prod:
            continue
        variants = []
        seen_v = set()
        for vr in vrows:
            vname = (vr.get("Name") or "").strip()
            # variation attribute is usually the colour/size label
            label = (vr.get("Variation Attributes") or "").strip()
            # try to derive a concise label from the variation name
            if not label:
                tail = vname.split("-")[-1].strip() if "-" in vname else vname
                label = tail[:60]
            label = label or "Default"
            if label in seen_v:
                continue
            seen_v.add(label)
            try:
                vcost = float((vr.get("Regular price") or "0").replace(",", "").strip())
            except ValueError:
                vcost = 0
            # determine the top-level category name for this product, then its markup
            topname = next((n for n in CAT_BY_NAME if CAT_BY_NAME[n]["slug"] == prod["cat"]), "Other")
            vmarkup = MARKUP.get(topname, DEFAULT_MARKUP)
            vprice = nice_price(vcost, vmarkup) if vcost > 0 else prod["price"]
            variants.append({"la": label, "pr": vprice, "c": vcost})
        if variants:
            prod["vars"] = variants
            n_var += len(variants)
    # Consolidate repeated supplier rows without breaking their IDs/old links.
    merged_aliases = merge_duplicate_products(products)
    # ensure every product has a tags list even if empty (for consistency)
    for p in products:
        p.setdefault("tags", [])

    # stable sort by name
    products.sort(key=lambda p: p["name"].lower())

    bycat = Counter(p["catLabel"] for p in products)
    n_img = sum(1 for p in products if p["img"] and not p["img"].startswith("data:"))
    n_ph  = sum(1 for p in products if not p["img"] or p["img"].startswith("data:"))
    n_gal = sum(1 for p in products if p["gal"])
    n_varprod = sum(1 for p in products if p.get("vars"))

    js = ("/* Auto-generated from HHC WooCommerce export. "
          "DO NOT EDIT BY HAND — regenerate via build_catalog.py. */\n")
    js += "window.NUKTO_CATALOG=" + json.dumps(products, ensure_ascii=False, separators=(",", ":")) + ";\n"
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write(js)

    summary = {
        "total_products": len(products),
        "with_real_image": n_img,
        "with_placeholder": n_ph,
        "with_gallery": n_gal,
        "with_variants": n_varprod,
        "variants_total": n_var,
        "merged_aliases": merged_aliases,
        "visible_products": sum(1 for p in products if not p.get("hidden")),
        "no_price": sum(1 for p in products if p["price"] == 0),
        "by_category": dict(sorted(bycat.items(), key=lambda x: -x[1])),
        "gadgets": sum(p["g"] for p in products),
        "crazy": sum(p["c"] for p in products),
        "trending": sum(p["t"] for p in products),
        "musttry": sum(p["m"] for p in products),
        "winter": sum(1 for p in products if "winter" in p["tags"]),
        "special": sum(1 for p in products if "special" in p["tags"]),
        "avg_markup": round(sum(MARKUP.get(topcat(r.get("Categories") or ""), DEFAULT_MARKUP) for r in raw_rows if r["Type"] != "variation") / max(1, len([r for r in raw_rows if r["Type"] != "variation"])), 2),
        "min_ratio": round(min((p["price"] / p["cost"] for p in products if p["cost"] > 0 and p["price"] > 0), default=0), 2),
        "avg_ratio": round(sum(p["price"] / p["cost"] for p in products if p["cost"] > 0 and p["price"] > 0) / max(1, sum(1 for p in products if p["cost"] > 0 and p["price"] > 0)), 2),
        "below_2x": sum(1 for p in products if p["cost"] > 0 and p["price"] > 0 and (p["price"] / p["cost"]) < 2),
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    print("Products written:", len(products))
    print("With real image:", n_img, "| placeholder:", n_ph)
    print("With gallery (>=2 imgs):", n_gal, "| With variants:", n_varprod, "| variant opts:", n_var)
    print("gadgets:", summary["gadgets"], "crazy:", summary["crazy"],
          "trending:", summary["trending"], "musttry:", summary["musttry"])
    print("winter:", summary["winter"], "special:", summary["special"])
    print("\nTop categories:")
    for c, n in summary["by_category"].items():
        print(f"  {n:5}  {c}")
    print("\ncatalog.js size MB:", round(os.path.getsize(OUT_JS) / 1e6, 2))

if __name__ == "__main__":
    main()
