#!/usr/bin/env python3
import json, re, sys
p = 'index.html'
s = open(p, encoding='utf-8').read()
orig = s

def rep(old, new, count=1):
    global s
    assert old in s, "NOT FOUND: " + old[:90]
    s = s.replace(old, new, count)

cal = json.load(open('data/calibration.json', encoding='utf-8'))
buckets, aliases = cal['buckets'], cal['aliases']
cat_def_js = ", ".join('"%s": %s' % (k, v['ratio']) for k, v in buckets.items())
cat_alias_js = ", ".join('"%s": "%s"' % (k, v) for k, v in aliases.items())

# ---------- R1: team/roles/session infra after `let admin = false;` ----------
rep("""let admin = false; // SECURITY: session-scoped only — never persisted, so a stored "nukta.admin" flag can't bypass login.""",
"""let admin = false; // SECURITY: session-scoped only — never persisted, so a stored "nukta.admin" flag can't bypass login.
/* ---- team members, roles & login session ---- */
const ROLES={
  owner:  {label:"Owner",        groups:["main","catalog","ops","finance","growth","config"], edit:true,  team:true},
  admin:  {label:"Admin",        groups:["main","catalog","ops","finance","growth","config"], edit:true,  team:true},
  editor: {label:"Editor",       groups:["main","catalog","ops","growth"],                    edit:true,  team:false},
  catalog:{label:"Catalog Manager",groups:["main","catalog"],                                 edit:true,  team:false},
  ops:    {label:"Ops Manager",  groups:["main","ops"],                                       edit:true,  team:false},
  finance:{label:"Finance Manager",groups:["main","finance"],                                 edit:true,  team:false},
  viewer: {label:"Viewer (read-only)",groups:["main","catalog","ops","finance","growth","config"],edit:false,team:false},
  visitor:{label:"Visitor",      groups:["main"],                                             edit:false, team:false},
};
let team = store.get("nukta.team", []);
let session = store.get("nukta.session", null);
if(session && ROLES[session.role]) admin = true;
function role(){ return session ? (ROLES[session.role]||ROLES.viewer) : null; }
function canGroup(g){ const r=role(); return !!r && r.groups.includes(g); }
function needEdit(){ if(session && role() && !role().edit){ toast("🔒 Aapka role '"+role().label+"' read-only hai"); return false; } return true; }
function needTeam(){ if(!session || !role() || !role().team){ toast("🔒 Sirf Owner/Admin team manage kar sakte hain"); return false; } return true; }
/* ---- market-ratio pricing engine (live-editable from Admin → Pricing) ---- */
const CAT_DEF={"""+cat_def_js+"""};
const CAT_ALIAS={"""+cat_alias_js+"""};
let catRatios = store.get("nukta.catRatios", {});
let prodRatios = store.get("nukta.prodRatios", {});
let priceGuard = store.get("nukta.priceGuard", true);
function catDefRatio(label){ const k=CAT_ALIAS[label]||label; return (k in CAT_DEF)?CAT_DEF[k]:CAT_DEF["_overall"]; }
function curCatRatio(label){ return (label in catRatios)?catRatios[label]:catDefRatio(label); }
function curProdRatio(p){ return (p.id in prodRatios)?prodRatios[p.id]:curCatRatio(p.catLabel); }
function priceFromRatio(cost,r){ const t=Math.round(cost*r*0.94); return priceGuard?Math.max(t,Math.round(cost*1.25)):t; }
function persistRatios(){ store.set("nukta.catRatios",catRatios); store.set("nukta.prodRatios",prodRatios); store.set("nukta.priceGuard",priceGuard); }""")

# ---------- R2: login/logout with team ----------
rep("""function adminLogin(){ const u=$id("a_user").value.trim(),p=$id("a_pass").value; if(!u||!p){toast("Enter username and password");return;} const h=sha256(p); if(u===ADMIN_USER && h===ADMIN_HASH){ admin=true; saveAll(); render(); toast("Admin logged in ✅"); location.hash="admin:dashboard"; } else toast("Invalid credentials ❌"); }
function adminLogout(){ admin=false; saveAll(); render(); location.hash="home"; }""",
"""function tryLogin(u,p){ const h=sha256(p);
  if(u===ADMIN_USER && h===ADMIN_HASH) return {name:u, role:"owner"};
  const m=team.find(x=>x.name.toLowerCase()===u.toLowerCase());
  if(m && m.pass===h) return {name:m.name, role:m.role};
  return null; }
function adminLogin(){ const u=$id("a_user").value.trim(),p=$id("a_pass").value; if(!u||!p){toast("Enter username and password");return;}
  const ses=tryLogin(u,p); if(!ses){ toast("Invalid credentials ❌"); return; }
  session=ses; admin=true; store.set("nukta.session",session); saveAll(); render(); toast("Welcome "+session.name+" · "+ROLES[session.role].label+" ✅"); location.hash="admin:dashboard"; }
function adminLogout(){ admin=false; session=null; store.del("nukta.session"); saveAll(); render(); location.hash="home"; }""")

rep("""<div class="auth-card" style="max-width:380px"><h2>🔐 Admin Login</h2><p class="sub">Restricted access</p>""",
"""<div class="auth-card" style="max-width:380px"><h2>🔐 Admin / Team Login</h2><p class="sub">Apna name aur password enter karein — role ke mutabiq access milega.</p>""")

# ---------- R3: layout nav filtered by role + team link + session chip ----------
rep("""function adminLayout(content,active){
  const navHelper=group=>ANAV.filter(a=>a[3]===group).map(a=>`<a class="${a[0]===active?"on":""}" href="#admin:${a[0]}">${a[1]} ${a[2]}</a>`).join("");
  return `<div class="admin-body"><aside class="aside">
    <div class="alogo"><svg class="logo-ico" viewBox="0 0 32 32" width="24" height="24" aria-hidden="true"><rect width="32" width-ok" fill="#8C1C13"/><circle cx="16" cy="16" r="4.5" fill="#E9A93C"/></svg> nukta<span>.</span>shop</div><div class="asub">ADMIN · ${PRODUCTS.length.toLocaleString()} products</div>
    <div class="sect">Overview</div>${navHelper("main")}
    <div class="sect">Catalog</div>${navHelper("catalog")}
    <div class="sect">Operations</div>${navHelper("ops")}
    <div class="sect">Finance</div>${navHelper("finance")}
    <div class="sect">Config</div>${navHelper("config")}
    <div class="sect">Session</div><a href="#" style="color:#f87171" onclick="adminLogout()">🚪 Logout</a>
  </aside><div class="main-admin">${content}</div></div>`;
}""",
"""x""") if False else None

# real R3 (exact text from file)
rep("""  const navHelper=group=>ANAV.filter(a=>a[3]===group).map(a=>`<a class="${a[0]===active?"on":""}" href="#admin:${a[0]}">${a[1]} ${a[2]}</a>`).join("");""",
"""  const navHelper=group=>ANAV.filter(a=>a[3]===group&&canGroup(group)).map(a=>`<a class="${a[0]===active?"on":""}" href="#admin:${a[0]}">${a[1]} ${a[2]}</a>`).join("");""")
rep("""<div class="asub">ADMIN · ${PRODUCTS.length.toLocaleString()} products</div>""",
"""<div class="asub">ADMIN · ${session?esc(session.name)+" · "+ROLES[session.role].label:""} · ${PRODUCTS.length.toLocaleString()} products</div>""")
rep("""    <div class="sect">Config</div>${navHelper("config")}
    <div class="sect">Session</div>""",
"""    <div class="sect">Config</div>${navHelper("config")}
    ${role()&&role().team?`<div class="sect">Team</div><a class="${active==="team"?"on":""}" href="#admin:team">🧑🤝‍ Team Members</a>`:""}
    <div class="sect">Session</div>""")

# ---------- R4: route gating ----------
rep("""function adminRoute(active){
  if(!admin) return adminLoginForm();
  switch(active){""",
"""function adminRoute(active){
  if(!session) return adminLoginForm();
  if(active==="team"){ return (role()&&role().team) ? adminTeam() : adminLayout(`<h1 style="margin-top:0">🔒 No access</h1><p class="muted">Role "${esc(role().label)}" team manage nahi kar sakta.</p>`,"team"); }
  { const g=(ANAV.find(a=>a[0]===active)||[])[3]; if(g && !canGroup(g)) return adminLayout(`<h1 style="margin-top:0">🔒 No access</h1><p class="muted">Aapka role "${esc(role().label)}" is page ki ijazat nahi deta.</p>`,active); }
  switch(active){""")
rep("""    case "settings":return adminSettings();""",
"""    case "settings":return adminSettings();
    case "team":return adminTeam();""")

# ---------- R5: new Pricing page ----------
old_pricing_start = s.index("function adminPricing(){")
old_pricing_end = s.index("function adminOrders(){")
new_pricing = '''function adminPricing(){
  const q=(adminPricing._q||"").toLowerCase(); const cf=adminPricing._cat||"all";
  let list=PRODUCTS.filter(p=>p.cost>0);
  if(cf!=="all") list=list.filter(p=>p.catLabel===cf);
  if(q) list=list.filter(p=>p.name.toLowerCase().includes(q)||p.id.toLowerCase().includes(q));
  const per=60, total=list.length, pages=Math.max(1,Math.ceil(total/per));
  const page=Math.max(1,Math.min(adminPricing._pg||1,pages));
  const slice=list.slice((page-1)*per,page*per);
  const cats={}; PRODUCTS.forEach(p=>{ if(p.cost>0) cats[p.catLabel]=(cats[p.catLabel]||0)+1; });
  const catRows=Object.keys(cats).sort((a,b)=>cats[b]-cats[a]).map(l=>`<tr>
    <td><b>${esc(l)}</b></td><td>${cats[l].toLocaleString()}</td><td class="muted">${catDefRatio(l).toFixed(2)}×</td>
    <td><input type="number" step="0.05" min="0" style="width:86px;padding:5px;border:1px solid var(--line);border-radius:8px" value="${curCatRatio(l).toFixed(2)}" onchange="setCatRatio(decodeURIComponent('${encodeURIComponent(l)}'),this.value)"></td>
    <td class="muted" style="font-size:11px">selling = cost × ratio × 0.94${priceGuard?" (min 25% margin guard)":""}</td></tr>`).join("");
  return adminLayout(`
    <h1 style="margin-top:0">Pricing & Ratios <span class="muted" style="font-size:13px">(${total.toLocaleString()} products)</span></h1>
    <div class="notice info"><b>💰 Ratio = market average ÷ aapki cost.</b> Category ka ratio badlein → us category ke sab products reprice. Product ke aakhir mein diya ratio input badlein → sirf woh product reprice. Price foran website par lagti hai.</div>
    <div class="panel" style="overflow:auto"><h3 style="margin-top:0">Category ratios</h3>
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:10px;font-size:13px"><input type="checkbox" ${priceGuard?"checked":""} onchange="togglePriceGuard(this.checked)"> Loss-guard: kahin bhi 25% margin se neeche price na lage</label>
      <table><tr><th>Category</th><th>Products</th><th>Default</th><th>Current ratio (editable)</th><th>Formula</th></tr>${catRows}</table></div>
    <div class="toolbar" style="margin-top:14px">
      <input class="input" style="max-width:240px" placeholder="🔍 Search products..." value="${esc(adminPricing._q||"")}" oninput="adminPricing._q=this.value;adminPricing._pg=1;debRender()">
      <select class="select" style="max-width:220px" onchange="adminPricing._cat=this.value;adminPricing._pg=1;render()">
        <option value="all">All categories</option>${Object.keys(cats).sort().map(l=>`<option ${cf===l?"selected":""} value="${esc(l)}">${esc(l)}</option>`).join("")}
      </select>
      <button class="btn btn-outline" onclick="applyBulkDisc()">🏷️ Bulk −10%</button>
    </div>
    <div class="panel" style="margin-top:2px;overflow:auto"><table>
      <tr><th>Product</th><th>Category</th><th>Cost</th><th>Selling Price</th><th>Stock</th><th>Source</th><th>Ratio (edit → price change)</th></tr>
      ${slice.map(p=>{const r=curProdRatio(p); const custom=(p.id in prodRatios); return `<tr>
        <td class="line-clamp2" style="max-width:260px">${p.emoji} <b>${esc(p.name)}</b><div class="muted" style="font-size:11px">${esc(p.id)}</div></td>
        <td>${esc(p.catLabel)}</td><td>${fmt(p.cost)}</td><td><b>${fmt(p.price)}</b></td>
        <td>${p.stock===0?'<span class="pill bad">Out</span>':p.stock}</td>
        <td>${custom?'<span class="pill info">custom</span>':'<span class="pill ok">category</span>'}</td>
        <td style="white-space:nowrap"><input type="number" step="0.05" min="0" style="width:78px;padding:5px;border:1px solid var(--line);border-radius:8px" value="${r.toFixed(2)}" onchange="setProdRatio('${p.id}',this.value)">
        ${custom?`<button class="pill bad" style="border:0" onclick="resetProdRatio('${p.id}')">↺</button>`:""}</td>
      </tr>`;}).join("")}
    </table></div>
    ${pages>1?`<div class="pagination"><button ${page<=1?"disabled":""} onclick="adminPricing._pg=${page-1};render()">‹ Prev</button><span class="muted" style="font-size:12px">Page ${page}/${pages}</span><button ${page>=pages?"disabled":""} onclick="adminPricing._pg=${page+1};render()">Next ›</button></div>`:""}`,"pricing");
}
function togglePriceGuard(on){ if(!needEdit())return; priceGuard=!!on; persistRatios();
  let n=0; PRODUCTS.forEach(p=>{ if(p.cost>0){ const np=priceFromRatio(p.cost,curProdRatio(p)); if(np!==p.price){p.price=np; prodEdit[p.id]=Object.assign(prodEdit[p.id]||{},{price:np}); n++;} } });
  saveAll(); render(); toast("Loss-guard "+(on?"ON":"OFF")+" — "+n+" products repriced"); }
function setProdRatio(id,val){ if(!needEdit())return; const p=prod(id); if(!p||!p.cost){toast("No cost on this product");return;}
  const r=Math.max(0,Number(val)||0); prodRatios[id]=r; p.price=priceFromRatio(p.cost,r);
  prodEdit[id]=Object.assign(prodEdit[id]||{},{price:p.price}); persistRatios(); saveAll(); render(); toast(p.name.slice(0,32)+" → "+fmt(p.price)); }
function resetProdRatio(id){ if(!needEdit())return; delete prodRatios[id]; const p=prod(id);
  if(p&&p.cost){ p.price=priceFromRatio(p.cost,curCatRatio(p.catLabel)); prodEdit[id]=Object.assign(prodEdit[id]||{},{price:p.price}); }
  persistRatios(); saveAll(); render(); toast("Ratio reset to category default"); }
function setCatRatio(label,val){ if(!needEdit())return; const r=Math.max(0,Number(val)||0); catRatios[label]=r; persistRatios();
  let n=0; PRODUCTS.forEach(p=>{ if(p.catLabel===label&&p.cost>0&&!(p.id in prodRatios)){ p.price=priceFromRatio(p.cost,r); prodEdit[p.id]=Object.assign(prodEdit[p.id]||{},{price:p.price}); n++; } });
  saveAll(); render(); toast("Category '"+label+"' ratio "+r.toFixed(2)+"× — "+n+" products repriced ✅"); }
function applyBulkDisc(){ if(!needEdit())return; PRODUCTS.forEach(p=>{ p.price=Math.round(p.price*0.9); prodEdit[p.id]=prodEdit[p.id]||{}; prodEdit[p.id].price=p.price; }); saveAll(); render(); toast("10% bulk discount applied to all products"); }

'''
s = s[:old_pricing_start] + new_pricing + s[old_pricing_end:]

# ---------- R6: extended product editor ----------
old_edit_start = s.index("function openEditProduct(id){")
old_edit_end = s.index("function addProductFresh(){")
new_edit = '''function openEditProduct(id){
  const p=id?prod(id):null;
  const fields=p?{name:p.name,price:p.price,cost:p.cost,stock:p.stock,img:p.img,desc:p.desc,cat:p.cat,catLabel:p.catLabel,emoji:p.emoji,gal:p.gal||[],vars:p.vars||[]}:{name:"",price:0,cost:0,stock:0,img:"",desc:"",cat:"gadgets",catLabel:"Gadgets",emoji:"📦",gal:[],vars:[]};
  openModal(`<h3>${p?"✏️ Edit Product":"➕ Add Product"}</h3>
    <input type="hidden" id="ep_id" value="${esc(id||"")}">
    <div class="field"><label class="label">Title / Name</label><input class="input" id="ep_name" value="${esc(fields.name)}"></div>
    <div class="grid2">
      <div class="field"><label class="label">Cost (HHC)</label><input class="input" type="number" id="ep_cost" value="${fields.cost}"></div>
      <div class="field"><label class="label">Selling Price (PKR)</label><input class="input" type="number" id="ep_price" value="${fields.price}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label class="label">Stock</label><input class="input" type="number" id="ep_stock" value="${fields.stock}"></div>
      <div class="field"><label class="label">Emoji</label><input class="input" id="ep_emoji" value="${esc(fields.emoji)}"></div>
    </div>
    <div class="field"><label class="label">Category</label><input class="input" id="ep_cat" value="${esc(fields.catLabel)}"></div>
    <div class="field"><label class="label">Media URL (image ya video .mp4)</label><input class="input" id="ep_img" value="${esc(fields.img)}"><div style="font-size:11px;color:var(--muted);margin-top:4px">${isVideoUrl(fields.img)?"ℹ️ Current media VIDEO hai — website par play button ke sath chalegi.":"Paste an image/video URL, or leave blank for emoji."}</div></div>
    <div class="field"><label class="label">Gallery (ek URL per line)</label><textarea class="textarea" id="ep_gal" style="min-height:70px">${esc(fields.gal.join("\\n"))}</textarea></div>
    ${fields.vars.length?`<div class="field"><label class="label">Variations (ek line: label | price)</label><textarea class="textarea" id="ep_vars" style="min-height:90px">${esc(fields.vars.map(v=>(v.la||v.label||"")+" | "+(v.pr!=null?v.pr:(v.price||0))).join("\\n"))}</textarea></div>`:`<input type="hidden" id="ep_vars" value="">`}
    <div class="field"><label class="label">Description</label><textarea class="textarea" id="ep_desc">${esc(fields.desc)}</textarea></div>
    <div style="display:flex;gap:10px"><button class="btn btn-emerald" style="flex:1;justify-content:center" onclick="saveEditProduct()">Save</button><button class="btn btn-outline" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button></div>
  `);
}
function saveEditProduct(){
  if(!needEdit())return;
  const id=$id("ep_id").value;
  const gal=($id("ep_gal").value||"").split("\\n").map(x=>x.trim()).filter(Boolean);
  const varsRaw=($id("ep_vars")&&$id("ep_vars").value||"").trim();
  const vars=varsRaw?varsRaw.split("\\n").map(line=>{const a=line.split("|");return {la:(a[0]||"").trim(),pr:Number(a[1])||0};}).filter(v=>v.la):null;
  const data={name:$id("ep_name").value.trim(),cost:Number($id("ep_cost").value)||0,price:Number($id("ep_price").value)||0,stock:Number($id("ep_stock").value)||0,emoji:$id("ep_emoji").value||"📦",catLabel:$id("ep_cat").value.trim(),img:$id("ep_img").value.trim(),desc:$id("ep_desc").value.trim(),gal:gal};
  if(vars) data.vars=vars;
  if(!id){
    const newId="new-"+Date.now();
    const np=Object.assign({id:newId,cat:"gadgets",catLabel:data.catLabel||"Gadgets",g:0,c:0,t:0,m:0,store:"Manual"},data);
    PRODUCTS.unshift(np);
    if(!customProducts.some(x=>x.id===newId)) customProducts.push(np);
    store.set("nukta.customProducts",customProducts);
  } else {
    const p=prod(id); Object.assign(p,data);
    prodEdit[id]=Object.assign(prodEdit[id]||{},data);
  }
  CATEGORIES=buildCategories(); saveAll(); closeModal(); toast("Product saved ✅"); render();
}
function delProduct(id){ if(!needEdit())return; const p=prod(id); if(!p)return; if(!confirm("Delete ‘"+p.name+"’?"))return; PRODUCTS=PRODUCTS.filter(x=>x.id!==id); delete prodEdit[id]; customProducts=customProducts.filter(x=>x.id!==id); if(!deletedIds.includes(id)) deletedIds.push(id); store.set("nukta.deletedIds",deletedIds); store.set("nukta.customProducts",customProducts); CATEGORIES=buildCategories(); saveAll(); render(); toast("Product deleted"); }
'''
s = s[:old_edit_start] + new_edit + s[old_edit_end:]

# ---------- R7: guards on mutators ----------
rep("function editProductField(id,field,val){", "function editProductField(id,field,val){ if(!needEdit())return;")
rep("function bulkDisc10(){ if(!adminSel.size)", "function bulkDisc10(){ if(!needEdit())return; if(!adminSel.size)")
rep("function bulkStock0(){ if(!adminSel.size)", "function bulkStock0(){ if(!needEdit())return; if(!adminSel.size)")
rep("function bulkDeleteSel(){ if(!adminSel.size)", "function bulkDeleteSel(){ if(!needEdit())return; if(!adminSel.size)")
rep("function saveCategory(){\n  const slug=$id(\"c_slug\").value;", "function saveCategory(){\n  if(!needEdit())return;\n  const slug=$id(\"c_slug\").value;")
rep("function delCategory(", "function delCategoryX__(") if False else None

# ---------- R8: team page (insert before adminOrders) ----------
team_code = '''function adminTeam(){
  return adminLayout(`
    <h1 style="margin-top:0">Team Members <span class="muted" style="font-size:13px">(${team.length} members)</span></h1>
    <div class="notice info"><b>🧑🤝‍ Roles:</b> ${Object.keys(ROLES).map(k=>`<b>${ROLES[k].label}</b>${ROLES[k].edit?"":" (read-only)"}${k==="owner"?" — full control + team":""}`).join(" · ")}.<br>Member add karein (name + password + role) — woh login par apne role ke mutabiq pages aur edits dekh sake ga.</div>
    <div class="toolbar"><button class="btn btn-emerald" onclick="openTeamModal()">➕ Add Member</button></div>
    <div class="panel" style="margin-top:2px;overflow:auto"><table>
      <tr><th>Name</th><th>Role</th><th>Access</th><th>Created</th><th style="text-align:right">Actions</th></tr>
      <tr><td><b>${esc(ADMIN_USER)}</b> <span class="pill ok">owner</span></td><td>Owner</td><td class="muted" style="font-size:11px">full control + team</td><td class="muted">—</td><td class="muted" style="text-align:right">built-in</td></tr>
      ${team.map(m=>`<tr><td><b>${esc(m.name)}</b></td>
        <td><select class="select" style="padding:5px;min-width:140px" onchange="setTeamRole('${m.id}',this.value)">${Object.keys(ROLES).map(r=>`<option ${m.role===r?"selected":""} value="${r}">${ROLES[r].label}</option>`).join("")}</select></td>
        <td class="muted" style="font-size:11px">${(ROLES[m.role]||{}).edit?"edit":"read-only"} · ${(ROLES[m.role]||{groups:[]}).groups.length} sections</td>
        <td class="muted">${esc((m.created||"").slice(0,10))}</td>
        <td style="text-align:right;white-space:nowrap"><button class="pill info" style="border:0" onclick="resetTeamPass('${m.id}')">🔑 Reset Pass</button> <button class="pill bad" style="border:0" onclick="delTeamMember('${m.id}')">🗑️ Remove</button></td></tr>`).join("")}
    </table></div>`,"team");
}
function openTeamModal(){ if(!needTeam())return;
  openModal(`<h3>➕ Add Team Member</h3>
    <div class="field"><label class="label">Name (login username)</label><input class="input" id="tm_name" placeholder="e.g. ali"></div>
    <div class="field"><label class="label">Password</label><input class="input" type="password" id="tm_pass" placeholder="min 4 characters"></div>
    <div class="field"><label class="label">Role</label><select class="select" id="tm_role">${Object.keys(ROLES).filter(r=>r!=="owner").map(r=>`<option value="${r}">${ROLES[r].label}</option>`).join("")}</select></div>
    <div style="display:flex;gap:10px"><button class="btn btn-emerald" style="flex:1;justify-content:center" onclick="saveTeamMember()">Save Member</button><button class="btn btn-outline" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button></div>`);
}
function addTeamMember(name,pass,roleKey){ if(!ROLES[roleKey]) return {ok:false,why:"bad role"};
  name=(name||"").trim(); if(!name) return {ok:false,why:"name required"};
  if((pass||"").length<4) return {ok:false,why:"password min 4 chars"};
  if(name.toLowerCase()===ADMIN_USER || team.some(m=>m.name.toLowerCase()===name.toLowerCase())) return {ok:false,why:"name already taken"};
  team.push({id:"tm-"+Date.now(),name:name,pass:sha256(pass),role:roleKey,created:new Date().toISOString()});
  store.set("nukta.team",team); return {ok:true}; }
function saveTeamMember(){ if(!needTeam())return; const r=addTeamMember($id("tm_name").value,$id("tm_pass").value,$id("tm_role").value);
  if(!r.ok){ toast(r.why); return; } closeModal(); saveAll(); render(); toast("Member added ✅ — ab woh login kar sakta hai"); }
function setTeamRole(id,roleKey){ if(!needTeam())return; const m=team.find(x=>x.id===id); if(m){ m.role=roleKey; store.set("nukta.team",team); render(); toast(m.name+" → "+ROLES[roleKey].label); } }
function resetTeamPass(id){ if(!needTeam())return; const m=team.find(x=>x.id===id); if(!m)return; const np=prompt("New password for "+m.name+":"); if(!np||np.length<4){toast("min 4 chars");return;} m.pass=sha256(np); store.set("nukta.team",team); toast("Password updated 🔑"); }
function delTeamMember(id){ if(!needTeam())return; const m=team.find(x=>x.id===id); if(!m)return; if(!confirm("Remove "+m.name+"?"))return; team=team.filter(x=>x.id!==id); store.set("nukta.team",team); saveAll(); render(); toast("Member removed"); }
'''
s = s.replace("function adminOrders(){", team_code + "function adminOrders(){", 1)

# ---------- R9: footer admin link ----------
rep("""<a href="#support">Support</a><a href="#terms">Terms &amp; Conditions</a><a href="#about">About Us</a>""",
"""<a href="#support">Support</a><a href="#terms">Terms &amp; Conditions</a><a href="#about">About Us</a>
      <a href="#admin:dashboard">🔐 Admin Panel</a>""")

# ---------- R10: export/import include new state ----------
rep("const data={settings,supabase,coupons,analytics,prodEdit,users,orders,txns,returns};",
    "const data={settings,supabase,coupons,analytics,prodEdit,users,orders,txns,returns,team,catRatios,prodRatios,priceGuard};")
rep("if(d.prodEdit) prodEdit=d.prodEdit; if(d.orders) orders=d.orders;",
    "if(d.prodEdit) prodEdit=d.prodEdit; if(d.orders) orders=d.orders; if(d.team) team=d.team; if(d.catRatios) catRatios=d.catRatios; if(d.prodRatios) prodRatios=d.prodRatios; if(d.priceGuard!=null) priceGuard=d.priceGuard;")

# saveAll: persist new stores too
rep("store.set(\"nukta.catOverrides\",catOverrides)",
    "store.set(\"nukta.catOverrides\",catOverrides),\n    store.set(\"nukta.team\",team), store.set(\"nukta.catRatios\",catRatios), store.set(\"nukta.prodRatios\",prodRatios), store.set(\"nukta.priceGuard\",priceGuard)")

open(p, 'w', encoding='utf-8').write(s)
print("edits applied. size:", len(orig), "->", len(s))
