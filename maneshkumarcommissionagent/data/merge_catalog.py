#!/usr/bin/env python3
"""Merge this week's staged CSV parts + last week's catalog into catalog.js.

Weekly rule (owner-defined):
  - staged parts 1..N  = THIS week's list  -> live products (priced via ratio table)
  - old catalog        = LAST week's list
  - old-only products  -> kept with stock 0 + na=1  ("Not Available")
  - new-only products  -> new=1 ("New" badge)
Run after every part:  python3 data/merge_catalog.py
"""
import json, os, glob, collections
HERE = os.path.dirname(os.path.abspath(__file__))
SHOP = os.path.dirname(HERE)
old = json.load(open(os.path.join(HERE, "old_catalog_full.json"), encoding="utf-8"))
old_by_id = {p["id"]: p for p in old}

stages = sorted(glob.glob(os.path.join(HERE, "stage", "part_*.json")))
thisweek, seen = [], set()
for f in stages:
    d = json.load(open(f, encoding="utf-8"))
    for p in d["products"]:
        if p["id"] in seen:
            continue
        seen.add(p.id if False else p["id"])
        thisweek.append(p)

by_id = {p["id"]: p for p in thisweek}

# CSV parts split product families across files: attach variation rows whose
# parent lives in a DIFFERENT part (group variations across parts).
import csv, re
for f in stages:
    n = re.search(r"part_(\d+)", os.path.basename(f)).group(1)
    csvf = os.path.join(SHOP, "..", "csvfiles", "woocom_products_part_%s.csv" % n)
    if n == "1":
        csvf = glob.glob(os.path.join(SHOP, "..", "csvfiles", "woocom_products_part_1*.csv"))[0]
    if not os.path.exists(csvf):
        continue
    local_ids = set(p["id"] for p in json.load(open(f, encoding="utf-8"))["products"])
    with open(csvf, encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            if (row.get("Type") or "").strip() != "variation":
                continue
            num = re.sub(r"\.0+$", "", (row.get("Parent ID") or "").strip())
            parent = "hhc-" + num if num else ""
            if parent and parent in by_id and parent not in local_ids:
                la = (row.get("Variation Attributes") or "").strip() or "Variant"
                pr = int(float(row.get("Regular price") or 0))
                if not any(v["la"] == la for v in by_id[parent]["vars"]):
                    by_id[parent]["vars"].append({"la": la, "pr": pr})

merged = []
for p in thisweek:
    o = old_by_id.get(p["id"])
    if o:  # returning product: inherit merchandising flags from last week
        for k in ("g", "c", "t", "m", "tags", "store"):
            if not p.get(k):
                p[k] = o.get(k, p.get(k, 0 if k != "tags" else []))
    p["vars"] = [{"la": v.get("la", "Variant"), "pr": v.get("pr", 0)} for v in p.get("vars", [])]
    merged.append(p)

old_only = 0
for p in old:
    if p["id"] not in seen:
        p = dict(p)
        p["stock"] = 0
        p["na"] = 1
        merged.append(p)
        old_only += 1

out = "/* Auto-generated weekly merge (staged CSV parts + last week's catalog). Regenerate via data/merge_catalog.py. */\n"
out += "window.NUKTA_CATALOG=" + json.dumps(merged, ensure_ascii=False) + ";\n"
open(os.path.join(SHOP, "catalog.js"), "w", encoding="utf-8").write(out)

bycat = collections.Counter(p["catLabel"] for p in merged)
summary = {
    "total_products": len(merged),
    "this_week": len(thisweek),
    "old_only_not_available": old_only,
    "new_badge": sum(1 for p in merged if p.get("new") == 1),
    "with_image": sum(1 for p in merged if p.get("img")),
    "with_variants": sum(1 for p in merged if p.get("vars")),
    "staged_parts": [os.path.basename(f) for f in stages],
    "by_category": dict(bycat.most_common()),
}
json.dump(summary, open(os.path.join(SHOP, "catalog_summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("merged:", len(merged), "| this week:", len(thisweek), "| old-only (not available):", old_only,
      "| new:", summary["new_badge"], "| parts:", len(stages))
