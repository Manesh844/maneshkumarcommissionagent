#!/usr/bin/env python3
p='index.html'
s=open(p,encoding='utf-8').read()
def rep(old,new,n=1):
    global s
    assert old in s, "NOT FOUND: "+old[:80]
    s=s.replace(old,new,n)

# ---------- 1) customer notifications (in-app + email via Brevo + WhatsApp link) ----------
rep("/* ---- activity log (who did what, when) ---- */",
"""/* ---- customer notifications (order status: in-app + Brevo email + WhatsApp) ---- */
let notifs = store.get("nukta.notifs", []);
function waLink(o,msg){ const ph=String(o.deliveryPhone||o.phone||"").replace(/\\D/g,""); const full=ph.length===10?"92"+ph.slice(1):ph; return "https://wa.me/"+full+"?text="+encodeURIComponent(msg); }
function notifyCustomer(o,msg){
  notifs.unshift({phone:String(o.deliveryPhone||o.phone||""), msg:msg, orderId:o.id, date:new Date().toISOString()});
  notifs=notifs.slice(0,300); store.set("nukta.notifs",notifs);
  const u=users.find(x=>x.phone&&String(o.phone||"").endsWith(String(x.phone).slice(-9)))||users.find(x=>x.id===o.userId);
  if(u&&u.email) sendBrevo("Nukta.Shop — Order "+o.id, "<p>"+esc(msg)+"</p>", u.email);
}
function myNotifs(){ if(!user) return []; const ph=String(user.phone||""); return notifs.filter(n=>n.phone&&ph&&String(n.phone).endsWith(ph.slice(-9))); }
/* ---- activity log (who did what, when) ---- */""")

rep('function setOrderStatus(id,s){ const o=orders.find(x=>x.id===id); if(o){ logAct("order "+id+" → "+s); o.orderStatus=s; } saveAll(); render(); toast("Order "+id+" → "+s); }',
'function setOrderStatus(id,s){ const o=orders.find(x=>x.id===id); if(o){ logAct("order "+id+" → "+s); o.orderStatus=s; notifyCustomer(o,"Salaam! Aapka order "+id+" ab '"+s+"' stage par hai. — "+settings.storeName); } saveAll(); render(); toast("Order "+id+" → "+s+" · customer notified 🔔"); }')
rep('function setDeliveryStatus(id,s){ const o=orders.find(x=>x.id===id); if(o)o.deliveryStatus=s; saveAll(); render(); toast("Delivery "+id+" → "+s); }',
'function setDeliveryStatus(id,s){ const o=orders.find(x=>x.id===id); if(o){ logAct("delivery "+id+" → "+s); o.deliveryStatus=s; notifyCustomer(o,"📦 Delivery update: order "+id+" ab '"+s+"' hai. — "+settings.storeName); } saveAll(); render(); toast("Delivery "+id+" → "+s+" · customer notified 🔔"); }')
rep('logAct("verified payment "+id); o.paymentStatus="verified";', 'logAct("verified payment "+id); o.paymentStatus="verified"; notifyCustomer(o,"✅ Payment verify ho gayi — order "+id+" process ho raha hai. — "+settings.storeName);')

# WhatsApp button on orders rows
rep("orders.map(o=>`<tr><td><b>${esc(o.id)}</b></td>",
    "orders.map(o=>`<tr><td><b>${esc(o.id)}</b> <a class=\"pill ok\" style=\"border:0;text-decoration:none\" target=\"_blank\" href=\"${waLink(o,'Salaam! Aapka order '+o.id+' ab '+o.orderStatus+' hai. — '+settings.storeName)}\" title=\"WhatsApp customer\">📲</a></td>")

# customer-side notifications panel in My Orders
rep("""    <div class="notice info" style="margin-top:10px">Sirf <b>aapke</b> orders yahan dikhte hain. Har order par <b>Track</b>, <b>Complaint</b>, <b>Return</b> aur <b>Help</b> ka button hai.</div>""",
"""    <div class="notice info" style="margin-top:10px">Sirf <b>aapke</b> orders yahan dikhte hain. Har order par <b>Track</b>, <b>Complaint</b>, <b>Return</b> aur <b>Help</b> ka button hai.</div>
    ${myNotifs().length?`<div class="panel" style="margin-top:12px"><h3 style="margin-top:0">🔔 Order Updates</h3>${myNotifs().slice(0,8).map(n=>`<div class="summary-line"><span>${esc(n.msg)}</span><b class="muted" style="font-size:11px">${esc((n.date||"").slice(5,16).replace("T"," "))}</b></div>`).join("")}</div>`:""}""")

# ---------- 2) reviews moderation ----------
rep("""  const userR = ur.map(r=>({name:r.name, rating:r.rating, date:r.date, text:r.text, verified:true, mine:true}));
  return [...userR, ...cloud, ...seeded];""",
"""  const userR = ur.map(r=>({name:r.name, rating:r.rating, date:r.date, text:r.text, verified:true, mine:true}));
  return [...userR, ...cloud, ...seeded].filter(r=>reviewMod[p.id+"|"+r.name+"|"+(r.date||"")]!=="hidden");""")
rep("/* ---- customer notifications", "let reviewMod = store.get(\"nukta.reviewMod\", {});\nfunction toggleReviewHide(key){ if(!needEdit())return; reviewMod[key]=reviewMod[key]===\"hidden\"?\"\":\"hidden\"; store.set(\"nukta.reviewMod\",reviewMod); logAct((reviewMod[key]===\"hidden\"?\"hid review \":\"unhid review \")+key); render(); }\n/* ---- customer notifications")
rep('  ["complaints","⚠️","Complaints","ops"],', '  ["complaints","⚠️","Complaints","ops"],\n  ["reviews","⭐","Reviews","ops"],')
rep('    case "complaints":return adminComplaints();', '    case "complaints":return adminComplaints();\n    case "reviews":return adminReviews();')
rep("function adminWallet(){",
"""function adminReviews(){
  const rows=[];
  Object.entries(store.get("nukta.userReviews", {})).forEach(([pid,list])=>{ (list||[]).forEach(r=>rows.push({pid:pid,name:r.name,rating:r.rating,date:r.date||"",text:r.text,src:"local"})); });
  cloudReviews.forEach(r=>rows.push({pid:r.product_id,name:r.user_name,rating:r.rating,date:(r.created_at||"").slice(0,10),text:r.text,src:"cloud"}));
  rows.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  return adminLayout(`
    <h1 style="margin-top:0">Reviews Moderation <span class="muted" style="font-size:13px">(${rows.length} customer reviews)</span></h1>
    <div class="notice info">Customer reviews yahan moderate karein — <b>Hide</b> se review storefront se hat jata hai (dobara Show kar sakte hain). Seeded demo reviews hamesha rehte hain.</div>
    <div class="panel" style="margin-top:2px;overflow:auto"><table>
      <tr><th>Product</th><th>Customer</th><th>★</th><th>Review</th><th>Date</th><th>Src</th><th style="text-align:right">Action</th></tr>
      ${rows.slice(0,120).map(r=>{const key=r.pid+"|"+r.name+"|"+r.date; const hid=reviewMod[key]==="hidden"; const pr=prod(r.pid); return `<tr style="${hid?"opacity:.45":""}">
        <td class="line-clamp2" style="max-width:200px">${pr?esc(pr.name):esc(r.pid)}</td><td><b>${esc(r.name)}</b></td><td>${r.rating}★</td>
        <td class="line-clamp2" style="max-width:260px">${esc(r.text||"")}</td><td class="muted">${esc(r.date)}</td><td><span class="pill ${r.src==="cloud"?"info":"ok"}">${r.src}</span></td>
        <td style="text-align:right"><button class="pill ${hid?"ok":"bad"}" style="border:0" onclick="toggleReviewHide('${esc(key).replace(/'/g,"\\\\'")}')">${hid?"👁 Show":" Hide"}</button></td></tr>`;}).join("")||"<tr><td colspan=7 class='muted'>Abhi koi customer review nahi.</td></tr>"}
    </table></div>`,"reviews");
}
function adminWallet(){""")

# ---------- 3) coupon start date ----------
rep("""      <div class="field"><label class="label">Expiry (optional)</label><input class="input" type="date" id="ce_exp" value="${c.expiry}"></div>""",
"""      <div class="field"><label class="label">Start Date (optional)</label><input class="input" type="date" id="ce_start" value="${c.start||""}"></div>
      <div class="field"><label class="label">Expiry (optional)</label><input class="input" type="date" id="ce_exp" value="${c.expiry}"></div>""")
rep("  c.expiry=$id(\"ce_exp\").value;", "  c.expiry=$id(\"ce_exp\").value;\n  c.start=$id(\"ce_start\").value;")
rep('  if(c.expiry && new Date(c.expiry)<new Date()){ toast("This coupon has expired"); return; }',
    '  if(c.start && new Date(c.start)>new Date()){ toast("⏳ Ye coupon abhi active nahi (start "+c.start+")"); return; }\n  if(c.expiry && new Date(c.expiry)<new Date()){ toast("This coupon has expired"); return; }')

# ---------- 4) category-wise sales report ----------
rep("""      <p class="muted" style="font-size:12px;margin-top:8px">💡 Tip: send these customers a discount coupon (Coupons) to recover their carts.</p>
    </div>`,"analytics");""",
"""      <p class="muted" style="font-size:12px;margin-top:8px">💡 Tip: send these customers a discount coupon (Coupons) to recover their carts.</p>
    </div>
    <div class="panel" style="margin-top:16px"><h3>📊 Category-wise Sales Report</h3>
      ${(function(){ const cs={}; orders.forEach(o=>(o.items||[]).forEach(it=>{ const pp=prod(it.id); const cat=pp?pp.catLabel:"Other"; const amt=(pp?pp.price:(it.price||0))*it.qty; const e=cs[cat]=cs[cat]||{n:0,rev:0,orders:new Set()}; e.n+=it.qty; e.rev+=amt; e.orders.add(o.id); }));
        const list=Object.entries(cs).sort((a,b)=>b[1].rev-a[1].rev);
        const totRev=list.reduce((a,x)=>a+x[1].rev,0);
        return list.length?`<table><tr><th>Category</th><th>Items Sold</th><th>Orders</th><th>Revenue</th><th>Share</th></tr>${list.slice(0,14).map(([cat,e])=>`<tr><td><b>${esc(cat)}</b></td><td>${e.n}</td><td>${e.orders.size}</td><td><b>${fmt(e.rev)}</b></td><td>${totRev?Math.round(100*e.rev/totRev):0}%</td></tr>`).join("")}<tr><td><b>TOTAL</b></td><td>${list.reduce((a,x)=>a+x[1].n,0)}</td><td>${orders.length}</td><td><b>${fmt(totRev)}</b></td><td>100%</td></tr></table>`:"<p class='muted'>Abhi koi sale nahi — orders aane par category-wise report yahan banegi.</p>"; })()}
    </div>`,"analytics");""")

# ---------- 5) 2FA (PIN second factor) ----------
rep("""  <div class="field"><label class="label">Password</label><input class="input" type="password" id="a_pass"></div>
  <button class="btn btn-emerald" style="width:100%;justify-content:center" onclick="adminLogin()">Login to Dashboard</button>""",
"""  <div class="field"><label class="label">Password</label><input class="input" type="password" id="a_pass"></div>
  <div class="field"><label class="label">2FA PIN (agar aapke account par set hai)</label><input class="input" type="password" id="a_pin" placeholder="••••"></div>
  <button class="btn btn-emerald" style="width:100%;justify-content:center" onclick="adminLogin()">Login to Dashboard</button>""")
rep("  const ses=tryLogin(u,p); if(!ses){ toast(\"Invalid credentials ❌\"); return; }",
"""  const ses=tryLogin(u,p); if(!ses){ toast("Invalid credentials ❌"); return; }
  const needPin = ses.role==="owner" ? (store.get("nukta.ownerPin","")) : ((team.find(m=>m.name.toLowerCase()===ses.name.toLowerCase())||{}).pin||"");
  if(needPin && sha256($id("a_pin").value||"")!==needPin){ toast("🔐 2FA PIN ghalat hai ❌"); return; }""")
rep("""    <div class="field"><label class="label">Role</label><select class="select" id="tm_role">${Object.keys(ROLES).filter(r=>r!=="owner").map(r=>`<option value="${r}">${ROLES[r].label}</option>`).join("")}</select></div>""",
"""    <div class="field"><label class="label">Role</label><select class="select" id="tm_role">${Object.keys(ROLES).filter(r=>r!=="owner").map(r=>`<option value="${r}">${ROLES[r].label}</option>`).join("")}</select></div>
    <div class="field"><label class="label">2FA PIN (optional — login par password ke sath poochha jayega)</label><input class="input" id="tm_pin" placeholder="4-6 digits"></div>""")
rep("function addTeamMember(name,pass,roleKey){ if(!ROLES[roleKey]) return {ok:false,why:\"bad role\"};",
    "function addTeamMember(name,pass,roleKey,pin){ if(!ROLES[roleKey]) return {ok:false,why:\"bad role\"};")
rep("  team.push({id:\"tm-\"+Date.now(),name:name,pass:sha256(pass),role:roleKey,created:new Date().toISOString()});",
    "  team.push({id:\"tm-\"+Date.now(),name:name,pass:sha256(pass),role:roleKey,pin:(pin||\"\")?sha256(pin):\"\",created:new Date().toISOString()});")
rep("const r=addTeamMember($id(\"tm_name\").value,$id(\"tm_pass\").value,$id(\"tm_role\").value);",
    "const r=addTeamMember($id(\"tm_name\").value,$id(\"tm_pass\").value,$id(\"tm_role\").value,$id(\"tm_pin\").value);")
rep("""<button class="pill info" style="border:0" onclick="resetTeamPass('${m.id}')">🔑 Reset Pass</button>""",
"""<button class="pill info" style="border:0" onclick="setTeamPin('${m.id}')">🔢 2FA</button> <button class="pill info" style="border:0" onclick="resetTeamPass('${m.id}')">🔑 Reset Pass</button>""")
rep("""<td class="muted" style="text-align:right">built-in</td></tr>""",
"""<td style="text-align:right"><button class="pill info" style="border:0" onclick="setOwnerPin()">🔢 Owner 2FA</button></td></tr>""")
rep("function delTeamMember(id){",
"""function setTeamPin(id){ if(!needTeam())return; const m=team.find(x=>x.id===id); if(!m)return; const np=prompt("2FA PIN for "+m.name+" (khali chhorein to remove):",""); if(np===null)return; m.pin=np?sha256(np):""; store.set("nukta.team",team); logAct((np?"set":"removed")+" 2FA for "+m.name); render(); toast(np?"2FA PIN set 🔢":"2FA removed"); }
function setOwnerPin(){ if(!needTeam())return; const np=prompt("Owner 2FA PIN (khali chhorein to remove):",""); if(np===null)return; store.set("nukta.ownerPin",np?sha256(np):""); logAct((np?"set":"removed")+" owner 2FA"); toast(np?"Owner 2FA set 🔢":"Owner 2FA removed"); }
function delTeamMember(id){""")

# ---------- 6) delivery fee editable on Delivery page ----------
rep("""    <div class="notice info"><b>Fixed delivery charge:</b> <b>${fmt(settings.deliveryFee)}</b> per order${settings.deliveryFreeAbove?` · Free above ${fmt(settings.deliveryFreeAbove)}`:""} — edit in Settings.</div>""",
"""    <div class="toolbar" style="margin-bottom:12px"><label style="font-size:13px">Delivery fee (Rs.)</label><input class="input" type="number" id="dv_fee" style="max-width:110px" value="${settings.deliveryFee}">
      <label style="font-size:13px">Free above (Rs.)</label><input class="input" type="number" id="dv_free" style="max-width:130px" value="${settings.deliveryFreeAbove||0}">
      <button class="btn btn-emerald" onclick="saveDeliveryFee()">💾 Save Delivery Fee</button></div>""")
rep("function setDeliveryStatus(id,s){",
"""function saveDeliveryFee(){ if(!needEdit())return; settings.deliveryFee=Number($id("dv_fee").value)||0; settings.deliveryFreeAbove=Number($id("dv_free").value)||0; logAct("delivery fee → Rs. "+settings.deliveryFee+" (free above "+settings.deliveryFreeAbove+")"); saveAll(); render(); toast("Delivery fee updated ✅"); }
function setDeliveryStatus(id,s){""")

open(p,'w',encoding='utf-8').write(s)
print("logic batch 2 applied")
