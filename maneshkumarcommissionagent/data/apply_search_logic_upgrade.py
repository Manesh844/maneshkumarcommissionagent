#!/usr/bin/env python3
p='index.html'
s=open(p,encoding='utf-8').read()
def rep(old,new,n=1):
    global s
    assert old in s, "NOT FOUND: "+old[:80]
    s=s.replace(old,new,n)

# A) New / Not-Available badges on storefront cards
rep("""  else if(p.m) tags.push('<span class="tag" style="background:#10b981">⭐ Must Try</span>');""",
"""  else if(p.m) tags.push('<span class="tag" style="background:#10b981">⭐ Must Try</span>');
  if(p.new===1 && p.stock>0) tags.push('<span class="tag" style="background:linear-gradient(90deg,#10b981,#0ea5e9)">🆕 New</span>');
  if(p.na===1) tags.push('<span class="tag" style="background:#64748b">🚫 Not Available</span>');""")

# B) related/recommendations ALWAYS on search page (with images/videos via cards)
rep("if(search && page===1 && (total<PER || !total)){","if(search && page===1){")

# C) suggestions show thumbnails (images) not just names
rep("""html+=res.slice(0,6).map(p=>`<div onclick="go('product','${p.id}')">${p.emoji} <b>${esc(p.name)}</b> <span style="float:right;color:var(--emerald-d);font-weight:700">${fmt(p.price)}</span></div>`).join("");""",
"""html+=res.slice(0,6).map(p=>`<div onclick="go('product','${p.id}')">${p.img&&!isVideoUrl(p.img)?`<img src="${esc(p.img)}" style="width:28px;height:28px;object-fit:cover;border-radius:7px;vertical-align:middle;margin-right:7px" alt="">`:p.emoji+" "}<b>${esc(p.name)}</b> <span style="float:right;color:var(--emerald-d);font-weight:700">${fmt(p.price)}</span></div>`).join("");""")

# D) CSV support in bulk import
rep('<input type="file" id="imp_file" accept=".json" onchange="impFile(this)">',
    '<input type="file" id="imp_file" accept=".json,.csv" onchange="impFile(this)">')
rep("""function impFile(inp){ const f=inp.files&&inp.files[0]; if(!f)return; const r=new FileReader(); r.onload=()=>{ const t=$id("imp_txt"); if(t) t.value=String(r.result); }; r.readAsText(f); }""",
"""function impFile(inp){ const f=inp.files&&inp.files[0]; if(!f)return; const r=new FileReader();
  r.onload=()=>{ const t=$id("imp_txt"); if(!t)return;
    if(/\\.csv$/i.test(f.name||"")){ const arr=wooCSVToProducts(String(r.result)); t.value=JSON.stringify({products:arr}); toast("📄 CSV parsed: "+arr.length+" products ready to upload"); }
    else t.value=String(r.result); };
  r.readAsText(f); }
function parseCSVRows(text){ const rows=[]; let row=[],cur="",q=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else if(c==='"') q=true;
    else if(c===","){ row.push(cur); cur=""; }
    else if(c==="\\n"){ row.push(cur); rows.push(row); row=[]; cur=""; }
    else if(c!=="\\r") cur+=c; }
  if(cur!==""||row.length){ row.push(cur); rows.push(row); }
  return rows; }
function wooCSVToProducts(text){
  const rows=parseCSVRows(text); if(rows.length<2) return [];
  const head=rows[0].map(h=>h.trim()); const ix=n=>head.indexOf(n);
  const get=(r,n)=>{ const i=ix(n); return i<0?"":(r[i]||""); };
  const parents=[],varis=[];
  rows.slice(1).forEach(r=>{
    if(r.length<2) return;
    const type=get(r,"Type").trim();
    if(type==="variation"){ varis.push(r); return; }
    const sku=get(r,"SKU").trim(); if(!sku) return;
    const imgs=get(r,"Images").split(",").map(x=>x.trim()).filter(Boolean);
    const top=(get(r,"Categories")||"").split(",")[0].split(">")[0].trim()||"Other";
    let name=get(r,"Name").trim();
    if(!name){ const m=(get(r,"Description")||"").match(/Product Title\\s*\\n+([^\\n]+)/); name=m?m[1].trim():"(Untitled "+sku+")"; }
    const cost=Number(get(r,"Regular price"))||0;
    parents.push({id:sku,name:name,catLabel:top,cost:cost,price:cost,
      stock:get(r,"In stock?").trim()==="1"?60:0,img:imgs[0]||"",gal:imgs.slice(1),
      desc:get(r,"Description").trim(),store:get(r,"Store").trim(),vars:[]});
  });
  const bySku={}; parents.forEach(pp=>bySku[pp.id]=pp);
  varis.forEach(v=>{
    const num=(get(v,"Parent ID")||"").trim().replace(/\\.0+$/,"");
    let parent=bySku["hhc-"+num]||bySku[num];
    if(!parent){ const m=(get(v,"SKU")||"").match(/^(hhc-\\d+)-/); parent=m?bySku[m[1]]:null; }
    if(parent) parent.vars.push({la:(get(v,"Variation Attributes")||"").trim()||"Variant",pr:Number(get(v,"Regular price"))||0});
  });
  parents.forEach(pp=>{ if(!pp.price&&pp.vars.length) pp.price=Math.min.apply(null,pp.vars.map(x=>x.pr)); });
  return parents;
}""")

# E) activity log infra (insert near team/roles block)
rep("/* ---- market-ratio pricing engine (live-editable from Admin → Pricing) ---- */",
"""/* ---- activity log (who did what, when) ---- */
let activity = store.get("nukta.activity", []);
function logAct(msg){ activity.unshift({t:new Date().toISOString(), who:(session?session.name:"system"), msg:msg}); activity=activity.slice(0,200); store.set("nukta.activity",activity); }
/* ---- market-ratio pricing engine (live-editable from Admin → Pricing) ---- */""")

# logAct calls in mutators
rep('store.set("nukta.session",session); saveAll(); render(); toast("Welcome "+session.name', 'store.set("nukta.session",session); logAct("logged in ("+ROLES[session.role].label+")"); saveAll(); render(); toast("Welcome "+session.name')
rep("function adminLogout(){ admin=false; session=null; store.del(\"nukta.session\");", "function adminLogout(){ logAct('logged out'); admin=false; session=null; store.del(\"nukta.session\");")
rep("  CATEGORIES=buildCategories(); saveAll(); closeModal(); toast(\"Product saved ✅\"); render();", "  logAct((id?\"edited product \":\"added product \")+ (id||\"new\")); CATEGORIES=buildCategories(); saveAll(); closeModal(); toast(\"Product saved ✅\"); render();")
rep("CATEGORIES=buildCategories(); saveAll(); render(); toast(\"Product deleted\");", "logAct(\"deleted product \"+id); CATEGORIES=buildCategories(); saveAll(); render(); toast(\"Product deleted\");")
rep("store.set(\"nukta.customProducts\",customProducts); CATEGORIES=buildCategories(); saveAll(); render();\n  return {ok:true,added:added};", "store.set(\"nukta.customProducts\",customProducts); if(added) logAct(\"uploaded \"+added+\" products via bulk import\"); CATEGORIES=buildCategories(); saveAll(); render();\n  return {ok:true,added:added};")
rep("persistRatios(); saveAll(); render(); toast(p.name.slice(0,32)+\" → \"+fmt(p.price));", "persistRatios(); logAct(\"product ratio → \"+r.toFixed(2)+\"× (\"+p.id+\")\"); saveAll(); render(); toast(p.name.slice(0,32)+\" → \"+fmt(p.price));")
rep("saveAll(); render(); toast(\"Category '\"+label+\"' ratio \"+r.toFixed(2)+\"× — \"+n+\" products repriced ✅\");", "logAct(\"category ratio '\"+label+\"' → \"+r.toFixed(2)+\"× (\"+n+\" products)\"); saveAll(); render(); toast(\"Category '\"+label+\"' ratio \"+r.toFixed(2)+\"× — \"+n+\" products repriced ✅\");")
rep("function verifyPayment(id){ const o=orders.find(x=>x.id===id); if(!o)return; o.paymentStatus=\"verified\";", "function verifyPayment(id){ const o=orders.find(x=>x.id===id); if(!o)return; logAct(\"verified payment \"+id); o.paymentStatus=\"verified\";")
rep("function setOrderStatus(id,s){ const o=orders.find(x=>x.id===id); if(o)o.orderStatus=s;", "function setOrderStatus(id,s){ const o=orders.find(x=>x.id===id); if(o){ logAct(\"order \"+id+\" → \"+s); o.orderStatus=s; }")
rep("function saveAdminSettings(){", "function saveAdminSettings(){ logAct(\"updated store settings\");")

# F) orders CSV export + generic downloadCSV (insert before adminOrders fn)
rep("function adminOrders(){",
"""function downloadCSV(name,rows){
  const csv=rows.map(r=>r.map(c=>'"'+String(c==null?"":c).replace(/"/g,'""')+'"').join(",")).join("\\n");
  if(typeof Blob==="undefined"||typeof URL==="undefined"||!URL.createObjectURL) return csv;
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download=name; a.click(); return csv;
}
function exportOrdersCSV(){
  const rows=[["Order","Customer","Phone","Address","Items","Total","Payment","Pay Status","Order Status","TID","Date"]];
  orders.forEach(o=>rows.push([o.id,o.name||"",o.phone||"",(o.address||"").replace(/\\s+/g," "),(o.items||[]).map(i=>i.qty+"x "+i.name).join("; "),o.total,o.pm,o.paymentStatus,o.orderStatus,o.payRef||"",o.date||""]));
  const csv=downloadCSV("nukta-orders.csv",rows); toast("📥 Orders CSV export ho gaya ("+(orders.length)+" orders)"); return csv;
}
function exportProductsCSV(){
  const rows=[["ID","Name","Category","Cost","Price","Stock"]];
  PRODUCTS.forEach(pp=>rows.push([pp.id,pp.name,pp.catLabel,pp.cost,pp.price,pp.stock]));
  const csv=downloadCSV("nukta-products.csv",rows); toast("📥 Products CSV exported"); return csv;
}
function adminOrders(){""")
rep("""  return adminLayout(`
    <h1 style="margin-top:0">Orders</h1>""",
"""  return adminLayout(`
    <h1 style="margin-top:0">Orders</h1>
    <div class="toolbar" style="margin-bottom:10px"><button class="btn btn-emerald" onclick="exportOrdersCSV()">📥 Export Orders CSV</button></div>""")

# G) dashboard: low-stock stat + activity panel
rep("""      <div class="stat"><div class="l">Pending Deposits</div><div class="v">${txns.filter(t=>t.type===\"deposit\"&&t.status===\"pending\").length}</div></div>
    </div>""",
"""      <div class="stat"><div class="l">Pending Deposits</div><div class="v">${txns.filter(t=>t.type===\"deposit\"&&t.status===\"pending\").length}</div></div>
      <div class="stat"><div class="l">Low Stock (≤10)</div><div class="v" style="color:${PRODUCTS.filter(p=>p.stock>0&&p.stock<=10).length?'#b45309':'inherit'}">${PRODUCTS.filter(p=>p.stock>0&&p.stock<=10).length}</div></div>
      <div class="stat"><div class="l">Out of Stock</div><div class="v">${PRODUCTS.filter(p=>p.stock===0).length}</div></div>
    </div>
    ${PRODUCTS.filter(p=>p.stock>0&&p.stock<=10).length?`<div class="notice warn" style="margin-top:14px"><b>⚠️ Low-stock alert:</b> ${PRODUCTS.filter(p=>p.stock>0&&p.stock<=10).slice(0,6).map(p=>esc(p.name.slice(0,34))+" ("+p.stock+")").join(" · ")}${PRODUCTS.filter(p=>p.stock>0&&p.stock<=10).length>6?" …":""}</div>`:""}""")
rep("""    </div>`,"dashboard");""",
"""      <div class="panel" style="margin-top:20px"><h3 style="margin-top:0">🕘 Recent Activity (team log)</h3>
        ${activity.length?`<table><tr><th>When</th><th>Who</th><th>Action</th></tr>${activity.slice(0,12).map(a=>`<tr><td class="muted" style="white-space:nowrap">${esc((a.t||"").replace("T"," ").slice(0,16))}</td><td><b>${esc(a.who)}</b></td><td>${esc(a.msg)}</td></tr>`).join("")}</table>`:"<p class='muted'>Abhi koi activity nahi.</p>"}
      </div>
    </div>`,"dashboard");""")

open(p,'w',encoding='utf-8').write(s)
print("search+logic upgrade applied")
