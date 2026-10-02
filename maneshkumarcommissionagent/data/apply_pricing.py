import json, sys, os
HERE=os.path.dirname(__file__)
D=json.load(open(os.path.join(HERE,'calibration.json'),encoding='utf-8'))
CALIB=D["buckets"]; ALIAS=D["aliases"]
DISC=0.94   # 6% below market average (5-8% band)
FLOOR=1.25  # loss guard: never below cost + 25%
def ratio_for(cat):
    key=ALIAS.get(cat,cat)
    return CALIB.get(key, CALIB["_overall"])["ratio"]
def sell(cost, cat):
    target = cost * ratio_for(cat) * DISC
    floored = target < cost*FLOOR
    return int(round(max(target, cost*FLOOR))), floored
def apply(path):
    d=json.load(open(path,encoding='utf-8'))
    fl=0
    for p in d['products']:
        p['price'],f = sell(p['cost'], p['catLabel']); fl+=f
        for v in p['vars']:
            vc=v.get('vc', v['pr'])
            v['vc']=vc
            v['pr'],vf = sell(vc, p['catLabel']); fl+=vf
    d['pricing']={"rule":"cost x bucket_ratio x 0.94, floor cost x 1.25","floored_items":fl}
    json.dump(d,open(path,'w',encoding='utf-8'),ensure_ascii=False)
    return len(d['products']), fl
if __name__=="__main__":
    for f in sys.argv[1:]:
        n,fl=apply(f); print(f,"-> products:",n,"| floored:",fl)
