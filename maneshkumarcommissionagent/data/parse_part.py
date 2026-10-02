import csv, json, re, sys, collections
OLD_IDS=set(json.load(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'old_ids.json'),encoding='utf-8')))
path, out = sys.argv[1], sys.argv[2]
rows=list(csv.DictReader(open(path, encoding='utf-8-sig', errors='replace')))

def slug(s):
    s=re.sub(r'[^a-z0-9]+','-', (s or '').lower()).strip('-')
    return s or 'other'
EMO={'fashion':'👗','health':'💄','home':'🏠','electronics':'📱','automotive':'🚗','kids':'🧸',
     'tools':'🔧','groceries':'🛒','islamic':'🕌','travel':'🎒','pets':'🐾','books':'📚','events':'🎁'}
def emoji_for(slug):
    for k,v in EMO.items():
        if k in slug: return v
    return '📦'

parents=[r for r in rows if r['Type'] in ('simple','variable')]
varis=[r for r in rows if r['Type']=='variation']
by_parent=collections.defaultdict(list)
for v in varis:
    pid=(v['Parent ID'] or '').strip().rstrip('.').rstrip('0') if (v['Parent ID'] or '').strip().endswith('.0') else (v['Parent ID'] or '').strip()
    # Parent ID came as "3764645.0"
    pid=(v['Parent ID'] or '').strip()
    if pid.endswith('.0'): pid=pid[:-2]
    by_parent[pid].append(v)

out_products=[]
no_img=[]
for r in parents:
    sku=(r['SKU'] or '').strip()
    top=(r['Categories'] or '').split(',')[0].split('>')[0].strip()
    sl=slug(top)
    imgs=[u.strip() for u in (r['Images'] or '').split(',') if u.strip()]
    img=imgs[0] if imgs else ''
    gal=imgs[1:]
    desc=(r['Description'] or '').strip() or (r['Short description'] or '').strip()
    p_price=int(float(r['Regular price'] or 0))
    short=(r['Short description'] or '').strip()
    vs=[]
    for v in by_parent.get((r['ID'] or '').strip(), []) or by_parent.get(sku.split('-')[1] if '-' in sku else sku, []):
        vs.append({'la':(v['Variation Attributes'] or '').strip() or 'Variant', 'pr':int(float(v['Regular price'] or 0))})
    if not vs:
        # match by numeric parent id embedded in variation SKU (hhc-<parent>-<var>)
        num=(r['SKU'] or '').replace('hhc-','').split('-')[0]
        for v in varis:
            if (v['Parent ID'] or '').strip().rstrip('.0')==num or v['SKU'].startswith('hhc-'+num+'-'):
                vs.append({'la':(v['Variation Attributes'] or '').strip() or 'Variant', 'pr':int(float(v['Regular price'] or 0))})
    if p_price==0 and vs: p_price=min(v['pr'] for v in vs)
    pname=(r['Name'] or '').strip()
    if not pname:
        import re as _re
        _m=_re.search(r'Product Title\s*\n+([^\n]+)', desc)
        pname=(_m.group(1).strip() if _m else '') or ('(Untitled '+sku+')')
    p={
      'id': sku, 'name': pname, 'cat': sl, 'catLabel': top or 'Other',
      'emoji': emoji_for(sl), 'cost': p_price, 'price': p_price,
      'img': img, 'desc': desc, 'short': short,
      'stock': 60 if (r['In stock?'] or '').strip()=='1' else 0,
      'store': (r['Store'] or '').strip(), 'gal': gal, 'vars': vs, 'tags': [],
      'g':0,'c':0,'t':0,'m':0,'new':0 if sku in OLD_IDS else 1,
    }
    out_products.append(p)
    if not img: no_img.append({'id':sku,'name':p['name'],'cat':top,'price':p['price']})

json.dump({'part':sys.argv[3],'parents':len(parents),'variations':len(varis),
           'no_image_parents':no_img,'products':out_products},
          open(out,'w',encoding='utf-8'), ensure_ascii=False)
print("part", sys.argv[3], "-> parents:", len(parents), "variations:", len(varis),
      "parents listed:", len(out_products), "parents w/o image:", len(no_img))
