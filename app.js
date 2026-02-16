
const STORAGE_KEY="house-layout-viewer:v11";
let APP=null, ACTIVE=null, HOUSE=null;


// --- Exporter registry (exporters/export_*.js register via registerExporter) ---
const EXPORTERS=new Map(); // id -> exporter

window.registerExporter = function registerExporter(exp){
  if(!exp || typeof exp.id!=="string" || !exp.id.trim()) throw new Error("Exporter must have an id");
  if(typeof exp.name!=="string" || !exp.name.trim()) exp.name=exp.id;
  if(typeof exp.export!=="function") throw new Error("Exporter must implement export(ctx, opts)");
  EXPORTERS.set(exp.id, exp);
  // if UI already exists, refresh formats
  try{ populateExportFormats(); } catch {}
};

function listExporters(){ return Array.from(EXPORTERS.values()); }
function getExporter(id){ return EXPORTERS.get(id) || null; }

const state={ ppi:3, visibleFloors:new Set(), visibleTypes:new Set(), visibleLabels:{}, selected:null, selectedSnapshot:null, pendingFloorNames:new Map() };
const drag={active:false, kind:null, roomId:null, itemId:null, svg:null, startPt:null, startNW:null, raf:false};

const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const inToPx=(inch)=>inch*state.ppi;

function guid(){ if(typeof crypto!=="undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0;const v=c==="x"?r:(r&0x3|0x8);return v.toString(16);}); }
function escapeXml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;"); }
function roundHalf(n){ return Math.round(n*2)/2; }
function formatFeetInches(totalIn){ const inches=Math.round(totalIn); const ft=Math.floor(inches/12); const rem=inches%12;
  if(ft<=0) return `${rem}"`; if(rem===0) return `${ft}'`; return `${ft}'${rem}"`; }

function hsvToRgb(h,s,v){ let r,g,b; let i=Math.floor(h*6); let f=h*6-i; let p=v*(1-s); let q=v*(1-f*s); let t=v*(1-(1-f)*s);
  switch(i%6){case 0:r=v,g=t,b=p;break;case 1:r=q,g=v,b=p;break;case 2:r=p,g=v,b=t;break;case 3:r=p,g=q,b=v;break;case 4:r=t,g=p,b=v;break;case 5:r=v,g=p,b=q;break;}
  return {r:Math.round(r*255),g:Math.round(g*255),b:Math.round(b*255)}; }
function rgbToHex({r,g,b}){ return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`; }
function genDefaultStyle(idx){ const hue=(idx*0.17)%1; const line=rgbToHex(hsvToRgb(hue,0.55,0.95)); return {strokeWidth:3, defaultLineColor:line, defaultCornerColor:line, defaultFillColor:"rgba(255,255,255,0.05)"}; }

function normalizeRectAbs(obj){ const {xIn,yIn,wIn,hIn,corner}=obj; let x=xIn,y=yIn;
  if(corner==="NE") x=xIn-wIn; else if(corner==="SW") y=yIn-hIn; else if(corner==="SE"){x=xIn-wIn;y=yIn-hIn;}
  return {xIn:x,yIn:y,wIn,hIn}; }

function normalizeRectRelToRoomPrimary(item, room){
  const {wIn,hIn}=item; let x=item.xIn, y=item.yIn;
  if(room.corner==="NE"){ x = room.wIn - x; } else if(room.corner==="SW"){ y = room.hIn - y; } else if(room.corner==="SE"){ x = room.wIn - x; y = room.hIn - y; }
  if(item.corner==="NE"){ x = x - wIn; } else if(item.corner==="SW"){ y = y - hIn; } else if(item.corner==="SE"){ x = x - wIn; y = y - hIn; }
  return {xIn:x,yIn:y,wIn,hIn};
}
function itemAbsRect(item, room){
  const roomNW=normalizeRectAbs(room);
  const r=normalizeRectRelToRoomPrimary(item, room);
  return {xIn:roomNW.xIn+r.xIn, yIn:roomNW.yIn+r.yIn, wIn:r.wIn, hIn:r.hIn};
}
function markerAbsPos(objNW, obj, corner){
  const x=objNW.xIn, y=objNW.yIn, w=obj.wIn, h=obj.hIn;
  const cx=(corner==="NE"||corner==="SE")?(x+w):x;
  const cy=(corner==="SW"||corner==="SE")?(y+h):y;
  return {xIn:cx,yIn:cy};
}

function setStatus(msg){ const el=document.getElementById("storageStatus"); if(el) el.textContent=msg; }
function saveApp(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(APP)); setStatus("Storage: saved"); } catch { setStatus("Storage: failed to save"); } }
function loadApp(){ try{ const raw=localStorage.getItem(STORAGE_KEY); if(!raw) return null; const parsed=JSON.parse(raw);
    if(!parsed||!Array.isArray(parsed.structures)||parsed.structures.length===0) return null; return parsed; } catch { return null; } }

function applyDefaultsToObj(o){
  const st=ACTIVE.types[o.type] || (ACTIVE.types[o.type]=genDefaultStyle(Object.keys(ACTIVE.types).length));
  // style defaults
  if(o.lineColor==null) o.lineColor=st.defaultLineColor;
  if(o.cornerColor==null) o.cornerColor=st.defaultCornerColor;
  if(o.fillColor==null) o.fillColor=st.defaultFillColor;
  if(!Number.isFinite(o.strokeWidth)) o.strokeWidth=st.strokeWidth;

  // dimension defaults (inches): width=wIn, length=hIn, height=heightIn
  const fallback = defaultDimsForType(o.type);
  if(!Number.isFinite(o.wIn)) o.wIn = Number.isFinite(st.defaultWIn) ? st.defaultWIn : fallback.wIn;
  if(!Number.isFinite(o.hIn)) o.hIn = Number.isFinite(st.defaultHIn) ? st.defaultHIn : fallback.hIn;
  if(!Number.isFinite(o.heightIn)) o.heightIn = Number.isFinite(st.defaultHeightIn) ? st.defaultHeightIn : fallback.heightIn;
}
function ensureTypeExists(type){
  if(ACTIVE.types[type]) return;
  const idx=Object.keys(ACTIVE.types).length;
  ACTIVE.types[type]=genDefaultStyle(idx);
  // dimension defaults
  const d=defaultDimsForType(type);
  ACTIVE.types[type].defaultWIn=d.wIn;
  ACTIVE.types[type].defaultHIn=d.hIn;
  ACTIVE.types[type].defaultHeightIn=d.heightIn;

  if(!ACTIVE.typeOrder.includes(type)) ACTIVE.typeOrder.push(type);
  state.visibleTypes.add(type);
  state.visibleLabels[type]=false;
}

function defaultDimsForType(type){
  // Conservative, practical defaults. Users can override per-type in Configuration.
  switch(type){
    case "Room": return {wIn:144, hIn:120, heightIn:96};
    case "Door": return {wIn:36, hIn:6, heightIn:80};
    case "Window": return {wIn:48, hIn:6, heightIn:48};
    case "Opening": return {wIn:36, hIn:6, heightIn:80};
    case "Outlet": return {wIn:6, hIn:6, heightIn:18};
    case "Light": return {wIn:8, hIn:8, heightIn:96};
    default: return {wIn:24, hIn:24, heightIn:48};
  }
}

function ensureTypeDefaults(type){
  ensureTypeExists(type);
  const st=ACTIVE.types[type];
  const d=defaultDimsForType(type);
  if(!Number.isFinite(st.defaultWIn)) st.defaultWIn=d.wIn;
  if(!Number.isFinite(st.defaultHIn)) st.defaultHIn=d.hIn;
  if(!Number.isFinite(st.defaultHeightIn)) st.defaultHeightIn=d.heightIn;
}

function ensureAllTypeDefaults(){
  for(const t of ACTIVE.typeOrder) ensureTypeDefaults(t);
}

function seedApp(){
  const id=guid();
  const types={
    "Room":{strokeWidth:6,defaultLineColor:"#cfd6e6",defaultCornerColor:"#55d6be",defaultFillColor:"rgba(255,255,255,0.03)",defaultWIn:144,defaultHIn:120,defaultHeightIn:96},
    "Door":{strokeWidth:5,defaultLineColor:"#ffcd6a",defaultCornerColor:"#ffcd6a",defaultFillColor:"rgba(255,205,106,0.05)",defaultWIn:36,defaultHIn:6,defaultHeightIn:80},
    "Window":{strokeWidth:4,defaultLineColor:"#6aa6ff",defaultCornerColor:"#6aa6ff",defaultFillColor:"rgba(106,166,255,0.05)",defaultWIn:48,defaultHIn:6,defaultHeightIn:48},
    "Opening":{strokeWidth:4,defaultLineColor:"#c46aff",defaultCornerColor:"#c46aff",defaultFillColor:"rgba(196,106,255,0.05)",defaultWIn:36,defaultHIn:6,defaultHeightIn:80},
    "Outlet":{strokeWidth:3,defaultLineColor:"#6aff9f",defaultCornerColor:"#6aff9f",defaultFillColor:"rgba(106,255,159,0.05)",defaultWIn:6,defaultHIn:6,defaultHeightIn:18},
    "Light":{strokeWidth:3,defaultLineColor:"#ffffff",defaultCornerColor:"#ffffff",defaultFillColor:"rgba(255,255,255,0.06)",defaultWIn:8,defaultHIn:8,defaultHeightIn:96}
  };
  const typeOrder=["Room","Door","Window","Opening","Outlet","Light"];
  const house={floors:[
    {id:"f1",name:"First Floor",rooms:[
      {id:"r1",type:"Room",floorId:"f1",name:"Living Room",description:"Main living area.",corner:"NW",xIn:20,yIn:20,wIn:180,hIn:140,heightIn:96,
        items:[
          {id:"i1",type:"Door",roomId:"r1",name:"Front Door",description:"Main entry door.",corner:"NW",xIn:10,yIn:130,wIn:36,hIn:6,heightIn:80},
          {id:"i2",type:"Window",roomId:"r1",name:"Window",description:"Living room window.",corner:"NW",xIn:50,yIn:0,wIn:48,hIn:6,heightIn:48},
          {id:"i3",type:"Outlet",roomId:"r1",name:"Outlet",description:"North wall outlet.",corner:"NW",xIn:15,yIn:15,wIn:6,hIn:6,heightIn:18},
          {id:"i4",type:"Light",roomId:"r1",name:"Ceiling Light",description:"Main ceiling fixture.",corner:"NW",xIn:85,yIn:70,wIn:8,hIn:8,heightIn:96}
        ]},
      {id:"r2",type:"Room",floorId:"f1",name:"Kitchen",description:"Kitchen and dining.",corner:"NW",xIn:210,yIn:20,wIn:170,hIn:110,heightIn:96,items:[]}
    ]},
    {id:"f2",name:"Second Floor",rooms:[
      {id:"r3",type:"Room",floorId:"f2",name:"Bedroom",description:"Primary bedroom.",corner:"NW",xIn:20,yIn:20,wIn:170,hIn:130,heightIn:96,
        items:[
          {id:"i5",type:"Window",roomId:"r3",name:"Window",description:"Bedroom window.",corner:"NW",xIn:40,yIn:0,wIn:48,hIn:6,heightIn:48},
          {id:"i6",type:"Outlet",roomId:"r3",name:"Outlet",description:"Bedside outlet.",corner:"NW",xIn:20,yIn:115,wIn:6,hIn:6,heightIn:18}
        ]}
    ]}
  ]};
  // default colors
  for(const f of house.floors){ for(const r of f.rooms){ r.lineColor=types.Room.defaultLineColor; r.cornerColor=types.Room.defaultCornerColor; r.fillColor=types.Room.defaultFillColor;
      for(const it of r.items){ if(!types[it.type]) types[it.type]=genDefaultStyle(Object.keys(types).length);
        const st=types[it.type]; it.lineColor=st.defaultLineColor; it.cornerColor=st.defaultCornerColor; it.fillColor=st.defaultFillColor; } } }
  return {version:5, activeId:id, structures:[{id,name:"My House",house,types,typeOrder}]};
}

function setActiveStructure(id){
  APP.activeId=id;
  ACTIVE=APP.structures.find(s=>s.id===id) || APP.structures[0];
  APP.activeId=ACTIVE.id;
  HOUSE=ACTIVE.house;
  ensureAllTypeDefaults();

  if(!ACTIVE.types) ACTIVE.types={"Room":genDefaultStyle(0)};
  if(!ACTIVE.typeOrder) ACTIVE.typeOrder=["Room",...Object.keys(ACTIVE.types).filter(t=>t!=="Room")];
  if(!ACTIVE.typeOrder.includes("Room")) ACTIVE.typeOrder.unshift("Room");
  for(const t of ACTIVE.typeOrder) ensureTypeExists(t);
  ensureAllTypeDefaults();

  state.visibleFloors=new Set(HOUSE.floors.map(f=>f.id));
  state.visibleTypes=new Set(ACTIVE.typeOrder.filter(t=>t!=="Room"));
  state.visibleLabels=Object.fromEntries(ACTIVE.typeOrder.map(t=>[t, t==="Room"]));
  state.selected=null; state.selectedSnapshot=null;

  buildAll(); render(); saveApp();
  populateExportFormats();
}

function buildStructureUI(){
  const sel=document.getElementById("structureSelect");
  const name=document.getElementById("structureName");
  sel.innerHTML="";
  for(const s of APP.structures){ const o=document.createElement("option"); o.value=s.id; o.textContent=s.name; sel.appendChild(o); }
  sel.value=ACTIVE.id; name.value=ACTIVE.name;
}
function newStructure(){ const id=guid(); const seeded=seedApp(); const struct=seeded.structures[0]; struct.id=id; struct.name="New Structure"; APP.structures.push(struct); setActiveStructure(id); }
function deleteStructure(){ if(APP.structures.length<=1){ alert("There must always be at least one structure."); return; }
  if(!confirm(`Delete structure "${ACTIVE.name}"?`)) return;
  const idx=APP.structures.findIndex(s=>s.id===ACTIVE.id); if(idx>=0) APP.structures.splice(idx,1); setActiveStructure(APP.structures[0].id); saveApp(); }
function resetStorage(){ if(!confirm("Reset stored data? This cannot be undone.")) return; localStorage.removeItem(STORAGE_KEY); APP=null; initApp(true); }

function findFloor(floorId){ return HOUSE.floors.find(f=>f.id===floorId)||null; }
function findRoom(roomId){ for(const f of HOUSE.floors){ const r=f.rooms.find(x=>x.id===roomId); if(r) return {floor:f, room:r}; } return null; }
function findItem(itemId){ for(const f of HOUSE.floors){ for(const r of f.rooms){ const it=r.items.find(x=>x.id===itemId); if(it) return {floor:f, room:r, item:it}; } } return null; }

const ROOM_FIELDS=[
  {key:"name",label:"Name",kind:"text"},
  {key:"description",label:"Description",kind:"textarea"},
  {key:"corner",label:"Corner",kind:"select",options:["NW","NE","SW","SE"]},
  {key:"xIn",label:"X Coordinate (in)",kind:"number"},
  {key:"yIn",label:"Y Coordinate (in)",kind:"number"},
  {key:"wIn",label:"Width (in)",kind:"number"},
  {key:"hIn",label:"Length (in)",kind:"number"},
  {key:"heightIn",label:"Height (in)",kind:"number"},
  {key:"cornerColor",label:"Corner Color",kind:"text"},
  {key:"lineColor",label:"Line Color",kind:"text"},
  {key:"fillColor",label:"Fill Color",kind:"text"}
];
const ITEM_FIELDS=[
  {key:"type",label:"Type",kind:"selectDynamic"},
  {key:"name",label:"Name",kind:"text"},
  {key:"description",label:"Description",kind:"textarea"},
  {key:"corner",label:"Corner",kind:"select",options:["NW","NE","SW","SE"]},
  {key:"xIn",label:"X Coordinate (in)",kind:"number"},
  {key:"yIn",label:"Y Coordinate (in)",kind:"number"},
  {key:"wIn",label:"Width (in)",kind:"number"},
  {key:"hIn",label:"Length (in)",kind:"number"},
  {key:"heightIn",label:"Height (in)",kind:"number"},
  {key:"cornerColor",label:"Corner Color",kind:"text"},
  {key:"lineColor",label:"Line Color",kind:"text"},
  {key:"fillColor",label:"Fill Color",kind:"text"}
];

function buildSelectedForm(){
  const header=document.getElementById("selHeader");
  const wrap=document.getElementById("selForm");
  wrap.innerHTML="";
  if(!state.selected){ header.textContent="(none)"; wrap.innerHTML='<div class="subtle" style="grid-column:1/-1;">Click a room or item to edit its parameters.</div>'; return; }

  let obj=null, floorName="", roomName="";
  if(state.selected.kind==="room"){
    const res=findRoom(state.selected.roomId); if(!res) return;
    obj=res.room; floorName=res.floor.name; header.textContent=`${floorName} · Room`;
  } else {
    const res=findItem(state.selected.itemId); if(!res) return;
    obj=res.item; floorName=res.floor.name; roomName=res.room.name; header.textContent=`${floorName} · ${roomName} · ${obj.type}`;
  }

  const fields = state.selected.kind==="room" ? ROOM_FIELDS : ITEM_FIELDS;
  for(const f of fields){
    const box=document.createElement("div"); box.className="field";
    const lab=document.createElement("label"); lab.textContent=f.label;
    let input;
    if(f.kind==="textarea"){ input=document.createElement("textarea"); }
    else if(f.kind==="select"){
      input=document.createElement("select"); for(const opt of f.options){ const o=document.createElement("option"); o.value=opt; o.textContent=opt; input.appendChild(o); }
    } else if(f.kind==="selectDynamic"){
      input=document.createElement("select");
      for(const opt of ACTIVE.typeOrder.filter(t=>t!=="Room")){ const o=document.createElement("option"); o.value=opt; o.textContent=opt; input.appendChild(o); }
    } else {
      input=document.createElement("input"); input.type=f.kind==="number"?"number":"text"; if(f.kind==="number") input.step="0.5";
    }
    input.id=`sel_${f.key}`;
    let v=obj?.[f.key]??"";
    if(["xIn","yIn","wIn","hIn","heightIn"].includes(f.key) && v!=="" && Number.isFinite(+v)) v=String(roundHalf(+v));
    input.value=v;
    box.appendChild(lab); box.appendChild(input);
    wrap.appendChild(box);
  }
  state.selectedSnapshot=JSON.parse(JSON.stringify(obj));
}

function setSelected(sel){ state.selected=sel; buildSelectedForm(); render(); }

function resetSelectedForm(){
  if(!state.selectedSnapshot||!state.selected) return;
  if(state.selected.kind==="room"){ const res=findRoom(state.selected.roomId); if(!res) return; Object.assign(res.room, JSON.parse(JSON.stringify(state.selectedSnapshot))); }
  else { const res=findItem(state.selected.itemId); if(!res) return; Object.assign(res.item, JSON.parse(JSON.stringify(state.selectedSnapshot))); }
  buildSelectedForm(); render(); saveApp();
}
function saveSelectedForm(){
  if(!state.selected) return;
  if(state.selected.kind==="room"){
    const res=findRoom(state.selected.roomId); if(!res) return; const room=res.room;
    for(const f of ROOM_FIELDS){ const v=document.getElementById(`sel_${f.key}`)?.value; if(v==null) continue;
      if(f.kind==="number"){ const num=parseFloat(v); if(Number.isFinite(num)) room[f.key]=num; } else { room[f.key]=v; } }
    applyDefaultsToObj(room);
  } else {
    const res=findItem(state.selected.itemId); if(!res) return; const it=res.item;
    for(const f of ITEM_FIELDS){ const v=document.getElementById(`sel_${f.key}`)?.value; if(v==null) continue;
      if(f.kind==="number"){ const num=parseFloat(v); if(Number.isFinite(num)) it[f.key]=num; } else { it[f.key]=v; } }
    ensureTypeExists(it.type);
    applyDefaultsToObj(it);
  }
  buildAll(); render(); saveApp();
}
function duplicateSelected(){
  if(!state.selected) return;
  if(state.selected.kind==="room"){
    const res=findRoom(state.selected.roomId); if(!res) return;
    const copy=JSON.parse(JSON.stringify(res.room)); copy.id=guid(); copy.name=(copy.name||"Room")+" (Copy)";
    copy.items=(copy.items||[]).map(it=>{ const c=JSON.parse(JSON.stringify(it)); c.id=guid(); c.roomId=copy.id; return c; });
    res.floor.rooms.push(copy);
    setSelected({kind:"room", floorId:res.floor.id, roomId:copy.id});
  } else {
    const res=findItem(state.selected.itemId); if(!res) return;
    const copy=JSON.parse(JSON.stringify(res.item)); copy.id=guid(); copy.name=(copy.name||copy.type)+" (Copy)"; copy.roomId=res.room.id;
    res.room.items.push(copy);
    setSelected({kind:"item", floorId:res.floor.id, roomId:res.room.id, itemId:copy.id});
  }
  buildAll(); render(); saveApp();
}
function deleteSelected(){
  if(!state.selected){ alert("No selection."); return; }
  if(state.selected.kind==="room"){
    const res=findRoom(state.selected.roomId); if(!res) return;
    if(!confirm(`Delete room "${res.room.name}" (and all items inside)?`)) return;
    res.floor.rooms=res.floor.rooms.filter(r=>r.id!==res.room.id);
  } else {
    const res=findItem(state.selected.itemId); if(!res) return;
    if(!confirm(`Delete item "${res.item.name||res.item.type}"?`)) return;
    res.room.items=res.room.items.filter(i=>i.id!==res.item.id);
  }
  state.selected=null; state.selectedSnapshot=null;
  buildAll(); render(); saveApp();
}

function updateFloorSummary(){
  const visible=HOUSE.floors.filter(f=>state.visibleFloors.has(f.id)).length;
  const el=document.getElementById("floorSummary"); if(el) el.textContent=`${visible}/${HOUSE.floors.length}`;
}
function addFloor(){ const id=guid(); HOUSE.floors.push({id,name:"New Floor",rooms:[]}); state.visibleFloors.add(id); buildAll(); render(); saveApp(); }

function moveFloor(floorId, delta){
  const idx=HOUSE.floors.findIndex(f=>f.id===floorId);
  if(idx<0) return;
  const tgt=clamp(idx+delta,0,HOUSE.floors.length-1);
  if(tgt===idx) return;
  const [f]=HOUSE.floors.splice(idx,1);
  HOUSE.floors.splice(tgt,0,f);
  buildAll(); render(); saveApp();
}
function deleteFloor(floorId){
  const idx=HOUSE.floors.findIndex(f=>f.id===floorId);
  if(idx<0){ alert("Floor not found."); return; }
  if(HOUSE.floors.length<=1){ alert("There must always be at least one floor."); return; }
  const floor=HOUSE.floors[idx];
  if(!confirm(`Delete floor "${floor.name}"?

This deletes ${floor.rooms.length} room(s) and all nested items.`)) return;
  if(state.selected){
    const floorOfSel=(state.selected.kind==="room")?findRoom(state.selected.roomId)?.floor:findItem(state.selected.itemId)?.floor;
    if(floorOfSel && floorOfSel.id===floorId){ state.selected=null; state.selectedSnapshot=null; }
  }
  HOUSE.floors.splice(idx,1); state.visibleFloors.delete(floorId);
  if(state.visibleFloors.size===0 && HOUSE.floors[0]) state.visibleFloors.add(HOUSE.floors[0].id);
  buildAll(); render(); saveApp();
}
function buildFloorToggles(){
  const wrap=document.getElementById("floorToggles"); wrap.innerHTML="";
  for(const floor of HOUSE.floors){
    const row=document.createElement("div"); row.className="floorRow";
    const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=state.visibleFloors.has(floor.id);
    cb.addEventListener("change",()=>{cb.checked?state.visibleFloors.add(floor.id):state.visibleFloors.delete(floor.id); updateFloorSummary(); render(); saveApp();});

    const nameBox=document.createElement("input"); nameBox.type="text";
    nameBox.value = state.pendingFloorNames.has(floor.id) ? state.pendingFloorNames.get(floor.id) : floor.name;
    nameBox.addEventListener("input",()=>{
      state.pendingFloorNames.set(floor.id, nameBox.value);
      nameBox.style.outline="2px solid rgba(106,166,255,.45)";
      nameBox.style.outlineOffset="1px";
    });

    const del=document.createElement("button"); del.type="button"; del.className="btn icon"; del.title="Delete floor"; del.textContent="🗑";
    del.addEventListener("click",(ev)=>{ev.preventDefault(); ev.stopPropagation(); deleteFloor(floor.id);});

    const iconWrap=document.createElement("div"); iconWrap.className="row"; iconWrap.style.gap="8px";
    const up=document.createElement("button");
    up.type="button";
    up.className="btn icon";
    up.title="Move floor up";
    up.textContent="▲";
    up.addEventListener("click",(ev)=>{ev.preventDefault(); ev.stopPropagation(); moveFloor(floor.id,-1);});
    const dn=document.createElement("button");
    dn.type="button";
    dn.className="btn icon";
    dn.title="Move floor down";
    dn.textContent="▼";
    dn.addEventListener("click",(ev)=>{ev.preventDefault(); ev.stopPropagation(); moveFloor(floor.id, 1);});
    iconWrap.appendChild(up);
    iconWrap.appendChild(dn);
    iconWrap.appendChild(del);

    row.appendChild(cb); row.appendChild(nameBox); row.appendChild(iconWrap); wrap.appendChild(row);
  }
  updateFloorSummary();
}
function saveAllFloorNames(){
  if(state.pendingFloorNames.size===0){ return; }
  for(const floor of HOUSE.floors){
    if(!state.pendingFloorNames.has(floor.id)) continue;
    const v=(state.pendingFloorNames.get(floor.id)||"").trim();
    floor.name = v ? v : "(unnamed floor)";
  }
  state.pendingFloorNames.clear();
  buildAll(); render(); saveApp();
}

function isTypeVisible(t){ return t==="Room"?true:state.visibleTypes.has(t); }
function isLabelVisible(t){ return !!state.visibleLabels[t]; }
function moveType(type,delta){
  const arr=ACTIVE.typeOrder; const idx=arr.indexOf(type); if(idx<0) return;
  const tgt=clamp(idx+delta,1,arr.length-1); if(tgt===idx) return;
  arr.splice(idx,1); arr.splice(tgt,0,type);
  buildAll(); render(); saveApp();
}
function buildTypeToggles(){
  const wrap=document.getElementById("typeToggles"); wrap.innerHTML="";
  const displayOrder=[...ACTIVE.typeOrder].filter(t=>t!=="Room").reverse();
  for(const t of displayOrder){
    const st=ACTIVE.types[t];
    const row=document.createElement("div"); row.className="checkbox"; row.style.justifyContent="space-between";
    const left=document.createElement("div"); left.className="row";
    const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=state.visibleTypes.has(t);
    cb.addEventListener("change",()=>{cb.checked?state.visibleTypes.add(t):state.visibleTypes.delete(t); render(); saveApp();});
    const sw=document.createElement("span"); sw.className="swatch"; sw.style.background=st.defaultLineColor;
    const txt=document.createElement("div"); txt.innerHTML=`<div style="font-weight:700;">${escapeXml(t)}</div>`;
    left.appendChild(cb); left.appendChild(sw); left.appendChild(txt);
    const right=document.createElement("div"); right.className="row"; right.style.gap="6px";
    const up=document.createElement("button"); up.type="button"; up.className="btn icon"; up.title="Move up"; up.textContent="▲";
    const dn=document.createElement("button"); dn.type="button"; dn.className="btn icon"; dn.title="Move down"; dn.textContent="▼";
    up.addEventListener("click",(ev)=>{ev.preventDefault(); ev.stopPropagation(); moveType(t, 1);});
    dn.addEventListener("click",(ev)=>{ev.preventDefault(); ev.stopPropagation(); moveType(t,-1);});
    right.appendChild(up); right.appendChild(dn);
    row.appendChild(left); row.appendChild(right);
    wrap.appendChild(row);
  }
}
function buildLabelToggles(){
  const wrap=document.getElementById("labelToggles"); wrap.innerHTML="";
  for(const t of ACTIVE.typeOrder){
    const st=ACTIVE.types[t];
    const lbl=document.createElement("label"); lbl.className="checkbox";
    const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=isLabelVisible(t);
    cb.addEventListener("change",()=>{state.visibleLabels[t]=cb.checked; render(); saveApp();});
    const sw=document.createElement("span"); sw.className="swatch"; sw.style.background=st.defaultLineColor;
    const txt=document.createElement("div"); txt.innerHTML=`<div style="font-weight:700;">${escapeXml(t)}</div>`;
    lbl.appendChild(cb); lbl.appendChild(sw); lbl.appendChild(txt);
    wrap.appendChild(lbl);
  }
}
function renderCounts(){
  const counts={}; for(const t of ACTIVE.typeOrder) counts[t]=0;
  for(const f of HOUSE.floors){ for(const r of f.rooms){ counts.Room=(counts.Room||0)+1; for(const it of r.items){ counts[it.type]=(counts[it.type]||0)+1; } } }
  const wrap=document.getElementById("counts"); wrap.innerHTML="";
  for(const t of ACTIVE.typeOrder){
    const div=document.createElement("div");
    div.style.display="inline-flex"; div.style.gap="8px"; div.style.alignItems="center";
    div.style.padding="4px 10px"; div.style.borderRadius="999px"; div.style.border="1px solid var(--border)";
    div.style.background="rgba(255,255,255,.03)"; div.style.color="var(--muted)"; div.style.fontSize="12px"; div.style.margin="0 6px 6px 0";
    const st=ACTIVE.types[t]||{};
    const sw=st.defaultLineColor||"#ffffff";
    div.innerHTML=`<span class="swatch" style="background:${escapeXml(sw)}"></span><strong style="color:var(--text);font-weight:700;">${escapeXml(t)}</strong> ${counts[t]??0}`;
    wrap.appendChild(div);
  }
}

function cssId(s){ return s.replace(/[^a-zA-Z0-9_]/g,"_"); }
function buildConfigForm(){
  const wrap=document.getElementById("cfgForm"); wrap.innerHTML="";
  for(const t of ACTIVE.typeOrder){
    const st=ACTIVE.types[t];
    const id=cssId(t);
    const block=document.createElement("div"); block.className="field"; block.style.padding="10px";
    block.innerHTML=`
      <div class="row" style="justify-content:flex-start;gap:10px;margin-bottom:8px;">
        <span class="swatch" style="background:${escapeXml(st.defaultLineColor)}"></span>
        <div style="font-weight:700;font-size:13px;">${escapeXml(t)}</div>
      </div>
      ${t==="Room" ? "" : `<div class="field" style="margin-bottom:8px;"><label>Type Name</label><input id="cfg_${id}_name" value="${escapeXml(t)}" /></div>`}
      <div class="grid2">
        <div class="field"><label>Default Line Color</label><input id="cfg_${id}_line" value="${escapeXml(st.defaultLineColor)}" /></div>
        <div class="field"><label>Stroke width (px)</label><input id="cfg_${id}_width" type="number" step="1" value="${escapeXml(st.strokeWidth)}" /></div>
        <div class="field"><label>Default Corner Color</label><input id="cfg_${id}_corner" value="${escapeXml(st.defaultCornerColor)}" /></div>
        <div class="field"><label>Default Fill Color</label><input id="cfg_${id}_fill" value="${escapeXml(st.defaultFillColor)}" /></div>
      </div>
      <div class="grid3" style="margin-top:8px;">
        <div class="field"><label>Default Width (in)</label><input id="cfg_${id}_dw" type="number" step="0.5" value="${escapeXml(st.defaultWIn)}" /></div>
        <div class="field"><label>Default Length (in)</label><input id="cfg_${id}_dl" type="number" step="0.5" value="${escapeXml(st.defaultHIn)}" /></div>
        <div class="field"><label>Default Height (in)</label><input id="cfg_${id}_dh" type="number" step="0.5" value="${escapeXml(st.defaultHeightIn)}" /></div>
      </div>`;
    wrap.appendChild(block);
  }
}
function resetConfig(){
  const seeded=seedApp().structures[0];
  ACTIVE.types=seeded.types; ACTIVE.typeOrder=seeded.typeOrder;
  state.visibleTypes=new Set(ACTIVE.typeOrder.filter(t=>t!=="Room"));
  state.visibleLabels=Object.fromEntries(ACTIVE.typeOrder.map(t=>[t, t==="Room"]));
  buildAll(); render(); saveApp();
}
function saveConfig(){
  // structure name saved with configuration
  const sn=document.getElementById("structureName")?.value;
  if(typeof sn==="string" && sn.trim()) ACTIVE.name=sn.trim();

  // Handle type renames (non-Room)
  const desiredMap=new Map(); // old -> new
  const used=new Set();
  for(const t of ACTIVE.typeOrder){
    if(t==="Room") continue;
    const id=cssId(t);
    const v=document.getElementById(`cfg_${id}_name`)?.value;
    const newName=(typeof v==="string" ? v.trim() : t);
    if(!newName){ alert("Type Name cannot be empty."); return; }
    desiredMap.set(t,newName);
    if(used.has(newName)){ alert("Duplicate type name: "+newName); return; }
    used.add(newName);
  }

  // Apply renames
  for(const [oldName,newName] of desiredMap.entries()){
    if(oldName===newName) continue;
    // prevent collisions with existing names outside rename set
    if(ACTIVE.typeOrder.includes(newName) && !desiredMap.has(newName)){ alert("Type name already exists: "+newName); return; }
    // move style
    ACTIVE.types[newName]=ACTIVE.types[oldName];
    delete ACTIVE.types[oldName];
    // update typeOrder
    const idx=ACTIVE.typeOrder.indexOf(oldName);
    if(idx>=0) ACTIVE.typeOrder[idx]=newName;
    // update state toggles keys
    if(state.visibleTypes.has(oldName)){ state.visibleTypes.delete(oldName); state.visibleTypes.add(newName); }
    if(state.visibleLabels[oldName]!==undefined){ state.visibleLabels[newName]=state.visibleLabels[oldName]; delete state.visibleLabels[oldName]; }
    // update items
    for(const f of HOUSE.floors){
      for(const r of f.rooms){
        for(const it of r.items){
          if(it.type===oldName) it.type=newName;
        }
      }
    }
  }

  // Apply style edits
  for(const t of ACTIVE.typeOrder){
    const id=cssId(t);
    const line=document.getElementById(`cfg_${id}_line`)?.value;
    const width=parseInt(document.getElementById(`cfg_${id}_width`)?.value,10);
    const corner=document.getElementById(`cfg_${id}_corner`)?.value;
    const fill=document.getElementById(`cfg_${id}_fill`)?.value;
    const dw=parseFloat(document.getElementById(`cfg_${id}_dw`)?.value);
    const dl=parseFloat(document.getElementById(`cfg_${id}_dl`)?.value);
    const dh=parseFloat(document.getElementById(`cfg_${id}_dh`)?.value);
    const st=ACTIVE.types[t] || (ACTIVE.types[t]=genDefaultStyle(Object.keys(ACTIVE.types).length));
    if(typeof line==="string" && line) st.defaultLineColor=line;
    if(Number.isFinite(width) && width>0) st.strokeWidth=width;
    if(typeof corner==="string" && corner) st.defaultCornerColor=corner;
    if(typeof fill==="string" && fill) st.defaultFillColor=fill;
    if(Number.isFinite(dw) && dw>0) st.defaultWIn=dw;
    if(Number.isFinite(dl) && dl>0) st.defaultHIn=dl;
    if(Number.isFinite(dh) && dh>0) st.defaultHeightIn=dh;
  }

  buildAll(); render(); saveApp();
}
function addType(){
  const raw=document.getElementById("newTypeName")?.value||"";
  const name=raw.trim();
  if(!name){ alert("Enter a type name."); return; }
  if(ACTIVE.typeOrder.includes(name)){ alert("That type already exists."); return; }
  const idx=Object.keys(ACTIVE.types).length;
  ACTIVE.types[name]=genDefaultStyle(idx);
  const d=defaultDimsForType(name);
  ACTIVE.types[name].defaultWIn=d.wIn;
  ACTIVE.types[name].defaultHIn=d.hIn;
  ACTIVE.types[name].defaultHeightIn=d.heightIn;
  ACTIVE.typeOrder.push(name);
  state.visibleTypes.add(name);
  state.visibleLabels[name]=false;
  document.getElementById("newTypeName").value="";
  buildAll(); render(); saveApp();
}

function populateNewItemSelectors(){
  const typeSel=document.getElementById("newType");
  const floorSel=document.getElementById("newFloor");
  const roomSel=document.getElementById("newRoom");
  const floorField=document.getElementById("newFloorField");
  const roomField=document.getElementById("newRoomField");
  if(!typeSel||!floorSel||!roomSel) return;

  const keepType=typeSel.value;
  typeSel.innerHTML="";
  for(const t of ACTIVE.typeOrder){
    const o=document.createElement("option"); o.value=t; o.textContent=t; typeSel.appendChild(o);
  }
  typeSel.value = keepType || "Room";

  // Determine selected floor/room from current selection
  let selFloorId=null, selRoomId=null;
  if(state.selected?.kind==="room"){
    selRoomId=state.selected.roomId;
    selFloorId=state.selected.floorId;
  } else if(state.selected?.kind==="item"){
    selRoomId=state.selected.roomId;
    selFloorId=state.selected.floorId;
  }

  const keepFloor=floorSel.value;
  floorSel.innerHTML="";
  for(const f of HOUSE.floors){
    const o=document.createElement("option"); o.value=f.id; o.textContent=f.name; floorSel.appendChild(o);
  }
  floorSel.value = (selFloorId && HOUSE.floors.some(f=>f.id===selFloorId)) ? selFloorId : (keepFloor || (HOUSE.floors[0]?.id||""));

  const floor=findFloor(floorSel.value);
  roomSel.innerHTML="";
  for(const r of (floor?.rooms||[])){
    const o=document.createElement("option"); o.value=r.id; o.textContent=r.name||"Room"; roomSel.appendChild(o);
  }

  const roomIds=(floor?.rooms||[]).map(r=>r.id);
  if(selRoomId && roomIds.includes(selRoomId)) roomSel.value=selRoomId;
  else if(roomSel.value && roomIds.includes(roomSel.value)) {}
  else roomSel.value = roomIds[0] || "";

  // Toggle dropdown visibility based on type selection
  const t=typeSel.value;
  if(t==="Room"){
    if(floorField) floorField.style.display="";
    if(roomField) roomField.style.display="none";
  } else {
    if(floorField) floorField.style.display="none";
    if(roomField) roomField.style.display="";
  }
}

function addNew(){
  const type=document.getElementById("newType")?.value;
  const floorId=document.getElementById("newFloor")?.value;
  const roomId=document.getElementById("newRoom")?.value;
  if(!type) return;
  ensureTypeExists(type);
  if(type==="Room"){
    const floor=findFloor(floorId); if(!floor) return;
    const r={id:guid(),type:"Room",floorId:floor.id,name:"Room",description:"",corner:"NW",xIn:20,yIn:20,wIn:NaN,hIn:NaN,heightIn:NaN,items:[]};
    applyDefaultsToObj(r);
    floor.rooms.push(r);
    state.visibleFloors.add(floor.id);
    setSelected({kind:"room", floorId:floor.id, roomId:r.id});
    buildAll(); render(); saveApp();
    return;
  }
  let targetRoomId=null;
  if(state.selected?.kind==="room") targetRoomId=state.selected.roomId;
  else if(state.selected?.kind==="item") targetRoomId=state.selected.roomId;
  if(!targetRoomId) targetRoomId=roomId;
  if(!targetRoomId){ alert("Select a room first (or choose a room)."); return; }
  const res=findRoom(targetRoomId); if(!res){ alert("Room not found."); return; }
  const it={id:guid(),type,roomId:res.room.id,name:type,description:"",corner:"NW",xIn:12,yIn:12,wIn:NaN,hIn:NaN,heightIn:NaN};
  applyDefaultsToObj(it);
  res.room.items.push(it);
  setSelected({kind:"item", floorId:res.floor.id, roomId:res.room.id, itemId:it.id});
  buildAll(); render(); saveApp();
}

function populateExportFormats(){
  const sel=document.getElementById("exportFormat");
  if(!sel) return;
  const keep=sel.value;
  sel.innerHTML="";
  const exporters=listExporters();
  if(exporters.length===0){
    const o=document.createElement("option"); o.value="json"; o.textContent="JSON (app format)"; sel.appendChild(o);
    sel.value="json";
    return;
  }
  for(const ex of exporters){
    const o=document.createElement("option"); o.value=ex.id; o.textContent=ex.name; sel.appendChild(o);
  }
  if(keep && exporters.some(e=>e.id===keep)) sel.value=keep;
}

function exportAll(){
  const area=document.getElementById("ExportImportArea");
  const fmt=document.getElementById("exportFormat")?.value || "json";
  const visibleOnly=!!document.getElementById("exportVisibleOnly")?.checked;
  const ctx={APP, ACTIVE, HOUSE, state, helpers:{escapeXml, formatFeetInches, normalizeRectAbs}};
  const ex=getExporter(fmt);
  try{
    area.value = ex ? ex.export(ctx,{visibleOnly}) : JSON.stringify(APP,null,2);
  } catch(e){
    console.error(e);
    alert("Export failed: "+(e?.message||e));
  }
}
function importAll(){
  const raw=document.getElementById("ExportImportArea").value; if(!raw.trim()) return;
  let parsed; try{parsed=JSON.parse(raw);}catch{alert("Invalid JSON");return;}
  if(!parsed||!Array.isArray(parsed.structures)||parsed.structures.length===0){alert("Invalid payload: expected {structures:[...]}");return;}
  APP=parsed; if(!APP.activeId) APP.activeId=APP.structures[0].id; setActiveStructure(APP.activeId);
}

function computeFloorBoundsIn(floor){
  let maxX=0,maxY=0; const pad=20;
  for(const r of floor.rooms){ const rr=normalizeRectAbs(r); maxX=Math.max(maxX,rr.xIn+rr.wIn); maxY=Math.max(maxY,rr.yIn+rr.hIn); }
  return {width:maxX+pad,height:maxY+pad};
}

function svgPoint(svg,clientX,clientY){
  const pt=svg.createSVGPoint(); pt.x=clientX; pt.y=clientY;
  const ctm=svg.getScreenCTM(); return ctm?pt.matrixTransform(ctm.inverse()):{x:0,y:0};
}

function setRoomFromNW(room,nwX,nwY){
  if(room.corner==="NW"){ room.xIn=nwX; room.yIn=nwY; }
  else if(room.corner==="NE"){ room.xIn=nwX+room.wIn; room.yIn=nwY; }
  else if(room.corner==="SW"){ room.xIn=nwX; room.yIn=nwY+room.hIn; }
  else { room.xIn=nwX+room.wIn; room.yIn=nwY+room.hIn; }
}
function setItemFromNW_Rel(item, room, itemNWx, itemNWy){
  let x=itemNWx, y=itemNWy;
  if(item.corner==="NE"){ x=x+item.wIn; } else if(item.corner==="SW"){ y=y+item.hIn; } else if(item.corner==="SE"){ x=x+item.wIn; y=y+item.hIn; }
  if(room.corner==="NE"){ x = room.wIn - x; } else if(room.corner==="SW"){ y = room.hIn - y; } else if(room.corner==="SE"){ x=room.wIn-x; y=room.hIn-y; }
  item.xIn=x; item.yIn=y;
}
function updateSelectedXYInputs(obj){
  const xi=document.getElementById("sel_xIn"); const yi=document.getElementById("sel_yIn");
  if(xi) xi.value=String(roundHalf(obj.xIn));
  if(yi) yi.value=String(roundHalf(obj.yIn));
}

function render(){
  renderCounts();
  const wrap=document.getElementById("canvasWrap"); wrap.innerHTML="";
  for(const floor of HOUSE.floors){
    if(!state.visibleFloors.has(floor.id)) continue;
    const bounds=computeFloorBoundsIn(floor);
    const widthPx=inToPx(bounds.width), heightPx=inToPx(bounds.height);

    const block=document.createElement("div"); block.className="floorBlock";
    const header=document.createElement("div"); header.className="floorHeader";
    header.innerHTML=`<div class="floorName">${escapeXml(floor.name)}</div><div class="meta">${escapeXml(formatFeetInches(bounds.width))} × ${escapeXml(formatFeetInches(bounds.height))}</div>`;

    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.classList.add("floorSvg");
    svg.setAttribute("viewBox",`0 0 ${widthPx} ${heightPx}`);
    svg.setAttribute("width",widthPx); svg.setAttribute("height",heightPx);

    // Rooms
    for(const room of floor.rooms){
      applyDefaultsToObj(room);
      const rr=normalizeRectAbs(room);
      const x=inToPx(rr.xIn), y=inToPx(rr.yIn), w=inToPx(rr.wIn), h=inToPx(rr.hIn);
      const st=ACTIVE.types.Room;
      const g=document.createElementNS("http://www.w3.org/2000/svg","g");
      const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
      rect.setAttribute("x",x); rect.setAttribute("y",y); rect.setAttribute("width",w); rect.setAttribute("height",h);
      rect.setAttribute("fill",room.fillColor||st.defaultFillColor);
      rect.setAttribute("stroke",room.lineColor||st.defaultLineColor);
      rect.setAttribute("stroke-width",st.strokeWidth);
      rect.classList.add("selectable");
      if(state.selected?.kind==="room" && state.selected.roomId===room.id) rect.classList.add("selected-stroke");

      const markerSize=clamp(inToPx(4),6,18);
      const mpos=markerAbsPos(rr, room, room.corner);
      const marker=document.createElementNS("http://www.w3.org/2000/svg","rect");
      marker.setAttribute("x",inToPx(mpos.xIn)-markerSize/2);
      marker.setAttribute("y",inToPx(mpos.yIn)-markerSize/2);
      marker.setAttribute("width",markerSize); marker.setAttribute("height",markerSize);
      marker.setAttribute("fill",room.cornerColor||st.defaultCornerColor);
      marker.setAttribute("stroke","rgba(0,0,0,0.45)"); marker.setAttribute("stroke-width",1);
      marker.classList.add("selectable");

      const onClick=(ev)=>{ev.stopPropagation(); setSelected({kind:"room", floorId:floor.id, roomId:room.id}); populateNewItemSelectors();};
      const onDown=(ev)=>{ev.preventDefault(); ev.stopPropagation(); onClick(ev);
        drag.active=true; drag.kind="room"; drag.roomId=room.id; drag.itemId=null; drag.svg=svg;
        drag.startPt=svgPoint(svg, ev.clientX, ev.clientY); drag.startNW={xIn:rr.xIn,yIn:rr.yIn}; };
      rect.addEventListener("click",onClick); marker.addEventListener("click",onClick);
      rect.addEventListener("mousedown",onDown); marker.addEventListener("mousedown",onDown);

      g.appendChild(rect); g.appendChild(marker);

      if(isLabelVisible("Room") && room.name){
        const t=document.createElementNS("http://www.w3.org/2000/svg","text");
        t.setAttribute("x",x+w/2); t.setAttribute("y",y+h/2); t.setAttribute("class","roomLabel");
        const t1=document.createElementNS("http://www.w3.org/2000/svg","tspan"); t1.setAttribute("x",x+w/2); t1.textContent=room.name;
        const t2=document.createElementNS("http://www.w3.org/2000/svg","tspan"); t2.setAttribute("x",x+w/2); t2.setAttribute("dy","14");
        t2.textContent=`(${formatFeetInches(room.wIn)} × ${formatFeetInches(room.hIn)})`;
        t.appendChild(t1); t.appendChild(t2);
        g.appendChild(t);
      }
      svg.appendChild(g);
    }

    // Other types
    for(const type of ACTIVE.typeOrder){
      if(type==="Room" || !isTypeVisible(type)) continue;
      for(const room of floor.rooms){
        for(const it of room.items.filter(i=>i.type===type)){
          ensureTypeExists(it.type);
          applyDefaultsToObj(it);
          const abs=itemAbsRect(it, room);
          const x=inToPx(abs.xIn), y=inToPx(abs.yIn), w=inToPx(abs.wIn), h=inToPx(abs.hIn);
          const st=ACTIVE.types[type];

          const g=document.createElementNS("http://www.w3.org/2000/svg","g");
          const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
          rect.setAttribute("x",x); rect.setAttribute("y",y); rect.setAttribute("width",w); rect.setAttribute("height",h);
          rect.setAttribute("fill",it.fillColor||st.defaultFillColor);
          rect.setAttribute("stroke",it.lineColor||st.defaultLineColor);
          rect.setAttribute("stroke-width",st.strokeWidth);
          rect.classList.add("selectable");
          if(state.selected?.kind==="item" && state.selected.itemId===it.id) rect.classList.add("selected-stroke");

          const markerSize=clamp(inToPx(4),6,18);
          const mpos=markerAbsPos(abs, it, it.corner);
          const marker=document.createElementNS("http://www.w3.org/2000/svg","rect");
          marker.setAttribute("x",inToPx(mpos.xIn)-markerSize/2);
          marker.setAttribute("y",inToPx(mpos.yIn)-markerSize/2);
          marker.setAttribute("width",markerSize); marker.setAttribute("height",markerSize);
          marker.setAttribute("fill",it.cornerColor||st.defaultCornerColor);
          marker.setAttribute("stroke","rgba(0,0,0,0.45)"); marker.setAttribute("stroke-width",1);
          marker.classList.add("selectable");

          const onClick=(ev)=>{ev.stopPropagation(); setSelected({kind:"item", floorId:floor.id, roomId:room.id, itemId:it.id}); populateNewItemSelectors();};
          const onDown=(ev)=>{ev.preventDefault(); ev.stopPropagation(); onClick(ev);
            drag.active=true; drag.kind="item"; drag.roomId=room.id; drag.itemId=it.id; drag.svg=svg;
            drag.startPt=svgPoint(svg, ev.clientX, ev.clientY);
            const rel=normalizeRectRelToRoomPrimary(it, room);
            drag.startNW={xIn:rel.xIn,yIn:rel.yIn}; };
          rect.addEventListener("click",onClick); marker.addEventListener("click",onClick);
          rect.addEventListener("mousedown",onDown); marker.addEventListener("mousedown",onDown);

          g.appendChild(rect); g.appendChild(marker);

          if(isLabelVisible(type) && it.name){
            const t=document.createElementNS("http://www.w3.org/2000/svg","text");
            t.setAttribute("x",x+w+inToPx(3)); t.setAttribute("y",y); t.setAttribute("class","itemLabel");
            const t1=document.createElementNS("http://www.w3.org/2000/svg","tspan"); t1.setAttribute("x",x+w+inToPx(3)); t1.textContent=it.name;
            const t2=document.createElementNS("http://www.w3.org/2000/svg","tspan"); t2.setAttribute("x",x+w+inToPx(3)); t2.setAttribute("dy","13");
            t2.textContent=`(${formatFeetInches(it.wIn)} × ${formatFeetInches(it.hIn)})`;
            t.appendChild(t1); t.appendChild(t2);
            g.appendChild(t);
          }
          svg.appendChild(g);
        }
      }
    }

    svg.addEventListener("click",()=>setSelected(null));
    block.appendChild(header); block.appendChild(svg); wrap.appendChild(block);
  }
  updateFloorSummary();
}

function buildAll(){
  buildStructureUI();
  buildSelectedForm();
  populateNewItemSelectors();
  buildFloorToggles();
  buildTypeToggles();
  buildLabelToggles();
  buildConfigForm();
}

function wire(){
  document.getElementById("navToggle").addEventListener("click",(e)=>{e.preventDefault(); document.body.classList.toggle("navCollapsed");});
  const ppi=document.getElementById("ppi"); const ppiValue=document.getElementById("ppiValue");
  ppi.addEventListener("input",()=>{state.ppi=parseInt(ppi.value,10); ppiValue.textContent=String(state.ppi); render(); saveApp();});

  document.getElementById("structureSelect").addEventListener("change",(e)=>setActiveStructure(e.target.value));
  document.getElementById("structureNew").addEventListener("click",(e)=>{e.preventDefault(); newStructure();});
  document.getElementById("structureDelete").addEventListener("click",(e)=>{e.preventDefault(); deleteStructure();});
  document.getElementById("storageReset").addEventListener("click",(e)=>{e.preventDefault(); resetStorage();});

  document.getElementById("clearSel").addEventListener("click",(e)=>{e.preventDefault(); setSelected(null);});
  document.getElementById("selReset").addEventListener("click",(e)=>{e.preventDefault(); resetSelectedForm();});
  document.getElementById("selSave").addEventListener("click",(e)=>{e.preventDefault(); saveSelectedForm();});
  document.getElementById("selDuplicate").addEventListener("click",(e)=>{e.preventDefault(); duplicateSelected();});
  document.getElementById("selDelete").addEventListener("click",(e)=>{e.preventDefault(); deleteSelected();});

  document.getElementById("newFloor").addEventListener("change",()=>populateNewItemSelectors());
  document.getElementById("newType").addEventListener("change",()=>populateNewItemSelectors());
  document.getElementById("addNew").addEventListener("click",(e)=>{e.preventDefault(); addNew();});

  document.getElementById("showAllFloors").addEventListener("click",(e)=>{e.preventDefault(); state.visibleFloors=new Set(HOUSE.floors.map(f=>f.id)); buildFloorToggles(); render(); saveApp();});
  document.getElementById("hideAllFloors").addEventListener("click",(e)=>{e.preventDefault(); state.visibleFloors=new Set(); buildFloorToggles(); render(); saveApp();});
  document.getElementById("addFloor").addEventListener("click",(e)=>{e.preventDefault(); addFloor();});
  const saveFloorsBtn=document.getElementById("saveFloorNames");
  if(saveFloorsBtn) saveFloorsBtn.addEventListener("click",(e)=>{e.preventDefault(); saveAllFloorNames();});

  document.getElementById("cfgReset").addEventListener("click",(e)=>{e.preventDefault(); resetConfig();});
  document.getElementById("cfgSave").addEventListener("click",(e)=>{e.preventDefault(); saveConfig();});
  document.getElementById("addType").addEventListener("click",(e)=>{e.preventDefault(); addType();});

  document.getElementById("exportBtn").addEventListener("click",(e)=>{e.preventDefault(); exportAll();});
  document.getElementById("importBtn").addEventListener("click",(e)=>{e.preventDefault(); importAll();});

  window.addEventListener("mousemove",(ev)=>{
    if(!drag.active) return;
    const p=svgPoint(drag.svg, ev.clientX, ev.clientY);
    const dxIn=(p.x-drag.startPt.x)/state.ppi;
    const dyIn=(p.y-drag.startPt.y)/state.ppi;
    if(drag.kind==="room"){
      const res=findRoom(drag.roomId); if(!res) return;
      const rr=normalizeRectAbs(res.room);
      const nwX=drag.startNW.xIn+dxIn;
      const nwY=drag.startNW.yIn+dyIn;
      setRoomFromNW(res.room,nwX,nwY);
      updateSelectedXYInputs(res.room);
    } else {
      const res=findItem(drag.itemId); if(!res) return;
      const nwX=drag.startNW.xIn+dxIn;
      const nwY=drag.startNW.yIn+dyIn;
      setItemFromNW_Rel(res.item,res.room,nwX,nwY);
      updateSelectedXYInputs(res.item);
    }
    if(!drag.raf){
      drag.raf=true;
      requestAnimationFrame(()=>{drag.raf=false; render(); saveApp();});
    }
  });
  window.addEventListener("mouseup",()=>{drag.active=false; drag.kind=null; drag.roomId=null; drag.itemId=null; drag.svg=null;});
}

function initApp(forceSeed=false){
  APP = (!forceSeed ? loadApp() : null) || seedApp();
  const activeId=APP.activeId || APP.structures[0].id;
  ACTIVE=APP.structures.find(s=>s.id===activeId) || APP.structures[0];
  APP.activeId=ACTIVE.id;
  HOUSE=ACTIVE.house;
  if(!ACTIVE.types) ACTIVE.types={"Room":genDefaultStyle(0)};
  if(!ACTIVE.typeOrder) ACTIVE.typeOrder=["Room",...Object.keys(ACTIVE.types).filter(t=>t!=="Room")];
  if(!ACTIVE.typeOrder.includes("Room")) ACTIVE.typeOrder.unshift("Room");
  for(const t of ACTIVE.typeOrder) ensureTypeExists(t);
  state.visibleFloors=new Set(HOUSE.floors.map(f=>f.id));
  state.visibleTypes=new Set(ACTIVE.typeOrder.filter(t=>t!=="Room"));
  state.visibleLabels=Object.fromEntries(ACTIVE.typeOrder.map(t=>[t, t==="Room"]));
  buildAll(); render(); saveApp();
}

wire();
initApp(false);
