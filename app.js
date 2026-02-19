
const STORAGE_KEY="house-layout-viewer:v5";
let APP=null, ACTIVE=null, HOUSE=null;

const state={ ppi:3, visibleFloors:new Set(), visibleTypes:new Set(), visibleLabels:{}, selected:null, selectedSnapshot:null, view:{scale:1,tx:0,ty:0} };
const drag={active:false, kind:null, roomId:null, itemId:null, svg:null, startPt:null, startNW:null, startRect:null, fixedPt:null, raf:false};
const pan={active:false, startX:0, startY:0, startTx:0, startTy:0};

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

function cssColorToHex(v){
  if(!v) return null;
  v=String(v).trim();
  if(/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  // try browser parsing for css color names
  const s=new Option().style;
  s.color=v;
  if(!s.color) return null;
  // computed rgb(...) form
  const tmp=document.createElement("div");
  tmp.style.color=v;
  document.body.appendChild(tmp);
  const cs=getComputedStyle(tmp).color;
  document.body.removeChild(tmp);
  const m=cs.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if(!m) return null;
  const r=parseInt(m[1],10), g=parseInt(m[2],10), b=parseInt(m[3],10);
  return rgbToHex({r,g,b}).toLowerCase();
}
function isValidCssColorToken(v){
  if(!v) return false;
  v=String(v).trim();
  if(/^#[0-9a-fA-F]{6}$/.test(v)) return true;
  if(/^[a-zA-Z]+$/.test(v) && cssColorToHex(v)) return true;
  return false;
}
function genDefaultStyle(idx){ const hue=(idx*0.17)%1; const line=rgbToHex(hsvToRgb(hue,0.55,0.95));
  return {strokeWidth:3, defaultLineColor:line, defaultCornerColor:line, defaultFillColor:"#ffffff", defaultFillAlpha:0.05, defaultWIn:48, defaultHIn:48, defaultHeightIn:96}; };

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

function oppositeCorner(c){ return c==="NW"?"SE":c==="SE"?"NW":c==="NE"?"SW":"NE"; }
function setStatus(msg){ const el=document.getElementById("storageStatus"); if(el) el.textContent=msg; }
function saveApp(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(APP)); setStatus("Storage: saved"); } catch { setStatus("Storage: failed to save"); } }
function loadApp(){ try{ const raw=localStorage.getItem(STORAGE_KEY); if(!raw) return null; const parsed=JSON.parse(raw);
    if(!parsed||!Array.isArray(parsed.structures)||parsed.structures.length===0) return null; return parsed; } catch { return null; } }

function applyDefaultsToObj(o){
  const st=ACTIVE.types[o.type] || (ACTIVE.types[o.type]=genDefaultStyle(Object.keys(ACTIVE.types).length));
  if(o.lineColor==null) o.lineColor=st.defaultLineColor;
  if(o.cornerColor==null) o.cornerColor=st.defaultCornerColor;
  if(o.fillColor==null) o.fillColor=st.defaultFillColor;
  if(o.fillAlpha==null) o.fillAlpha=st.defaultFillAlpha;
  if(!Number.isFinite(o.strokeWidth)) o.strokeWidth=st.strokeWidth;
}
function ensureTypeExists(type){
  if(ACTIVE.types[type]) return;
  const idx=Object.keys(ACTIVE.types).length;
  ACTIVE.types[type]=genDefaultStyle(idx);
  if(!ACTIVE.typeOrder.includes(type)) ACTIVE.typeOrder.push(type);
  state.visibleTypes.add(type);
  state.visibleLabels[type]=false;
}

function seedApp(){
  const id=guid();
  const types={
    "Room":{strokeWidth:6,defaultLineColor:"#cfd6e6",defaultCornerColor:"#55d6be",defaultFillColor:"#ffffff",defaultFillAlpha:0.03,defaultWIn:180,defaultHIn:140,defaultHeightIn:96},
    "Door":{strokeWidth:5,defaultLineColor:"#ffcd6a",defaultCornerColor:"#ffcd6a",defaultFillColor:"#ffcd6a",defaultFillAlpha:0.05,defaultWIn:36,defaultHIn:6,defaultHeightIn:80},
    "Window":{strokeWidth:4,defaultLineColor:"#6aa6ff",defaultCornerColor:"#6aa6ff",defaultFillColor:"#6aa6ff",defaultFillAlpha:0.05,defaultWIn:48,defaultHIn:6,defaultHeightIn:48},
    "Opening":{strokeWidth:4,defaultLineColor:"#c46aff",defaultCornerColor:"#c46aff",defaultFillColor:"#c46aff",defaultFillAlpha:0.05,defaultWIn:36,defaultHIn:6,defaultHeightIn:80},
    "Outlet":{strokeWidth:3,defaultLineColor:"#6aff9f",defaultCornerColor:"#6aff9f",defaultFillColor:"#6aff9f",defaultFillAlpha:0.05,defaultWIn:6,defaultHIn:6,defaultHeightIn:18},
    "Light":{strokeWidth:3,defaultLineColor:"#ffffff",defaultCornerColor:"#ffffff",defaultFillColor:"#ffffff",defaultFillAlpha:0.06,defaultWIn:8,defaultHIn:8,defaultHeightIn:96}
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
  for(const f of house.floors){ for(const r of f.rooms){ r.lineColor=types.Room.defaultLineColor; r.cornerColor=types.Room.defaultCornerColor; r.fillColor=types.Room.defaultFillColor; r.fillAlpha=types.Room.defaultFillAlpha;
      for(const it of r.items){ if(!types[it.type]) types[it.type]=genDefaultStyle(Object.keys(types).length);
        const st=types[it.type]; it.lineColor=st.defaultLineColor; it.cornerColor=st.defaultCornerColor; it.fillColor=st.defaultFillColor; it.fillAlpha=st.defaultFillAlpha; } } }
  return {version:5, activeId:id, structures:[{id,name:"My House",house,types,typeOrder}]};
}

function setActiveStructure(id){
  APP.activeId=id;
  ACTIVE=APP.structures.find(s=>s.id===id) || APP.structures[0];
  APP.activeId=ACTIVE.id;
  HOUSE=ACTIVE.house;

  if(!ACTIVE.types) ACTIVE.types={"Room":genDefaultStyle(0)};
  if(!ACTIVE.typeOrder) ACTIVE.typeOrder=["Room",...Object.keys(ACTIVE.types).filter(t=>t!=="Room")];
  if(!ACTIVE.typeOrder.includes("Room")) ACTIVE.typeOrder.unshift("Room");
  for(const t of ACTIVE.typeOrder) ensureTypeExists(t);

  state.visibleFloors=new Set(HOUSE.floors.map(f=>f.id));
  state.visibleTypes=new Set(ACTIVE.typeOrder.filter(t=>t!=="Room"));
  state.visibleLabels=Object.fromEntries(ACTIVE.typeOrder.map(t=>[t, t==="Room"]));
  state.selected=null; state.selectedSnapshot=null;

  buildAll(); render(); saveApp();
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
  {key:"cornerColor",label:"Corner Color",kind:"color"},
  {key:"lineColor",label:"Line Color",kind:"color"},
  {key:"fillColor",label:"Fill Color",kind:"color"},
  {key:"fillAlpha",label:"Fill Opacity (0..1)",kind:"number",step:"0.01"}
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
  {key:"cornerColor",label:"Corner Color",kind:"color"},
  {key:"lineColor",label:"Line Color",kind:"color"},
  {key:"fillColor",label:"Fill Color",kind:"color"},
  {key:"fillAlpha",label:"Fill Opacity (0..1)",kind:"number",step:"0.01"}
];

function buildSelectedForm(){
  const header=document.getElementById("selHeader");
  const wrap=document.getElementById("selForm");
  wrap.innerHTML="";
  if(!state.selected){ header.textContent="(none)"; wrap.innerHTML='<div class="subtle" style="grid-column:1/-1;">Click a room or item to edit its parameters.</div>'; return; }

  let obj=null, floorName="", roomName="";
  if(state.selected.kind==="room"){
    const res=findRoom(state.selected.roomId); if(!res) return;
    obj=res.room; floorName=res.floor.name; header.textContent=`${floorName} \u00b7 Room`;
  } else {
    const res=findItem(state.selected.itemId); if(!res) return;
    obj=res.item; floorName=res.floor.name; roomName=res.room.name; header.textContent=`${floorName} \u00b7 ${roomName} \u00b7 ${obj.type}`;
  }

  const fields = state.selected.kind==="room" ? ROOM_FIELDS : ITEM_FIELDS;
  for(const f of fields){
    const box=document.createElement("div"); box.className="field";
    const lab=document.createElement("label"); lab.textContent=f.label;
    if(f.kind==="color"){
      const v=obj?.[f.key]??"";
      const row=document.createElement("div"); row.className="colorRow";
      const txt=document.createElement("input"); txt.type="text"; txt.id=`sel_${f.key}`; txt.placeholder="#rrggbb or css name";
      const pick=document.createElement("input"); pick.type="color"; pick.id=`sel_${f.key}_picker`;
      txt.value=v;
      const hx=cssColorToHex(v); if(hx) pick.value=hx;
      pick.addEventListener("input",()=>{txt.value=pick.value.toLowerCase();});
      txt.addEventListener("input",()=>{ const h=cssColorToHex(txt.value); if(h) pick.value=h; });
      row.appendChild(txt); row.appendChild(pick);
      box.appendChild(lab); box.appendChild(row);
      wrap.appendChild(box);
      continue;
    }
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
    if(["xIn","yIn","wIn","hIn","heightIn","fillAlpha"].includes(f.key) && v!=="" && Number.isFinite(+v)){
      const step=(f.step?parseFloat(f.step):0.5);
      v=String(step===0.01?Math.round(+v*100)/100:roundHalf(+v));
    }
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
      if(f.kind==="number"){ const num=parseFloat(v); if(Number.isFinite(num)) room[f.key]=num; }
      else if(f.kind==="color"){ if(isValidCssColorToken(v)) room[f.key]=v.trim(); }
      else { room[f.key]=v; } }
    applyDefaultsToObj(room);
  } else {
    const res=findItem(state.selected.itemId); if(!res) return; const it=res.item;
    for(const f of ITEM_FIELDS){ const v=document.getElementById(`sel_${f.key}`)?.value; if(v==null) continue;
      if(f.kind==="number"){ const num=parseFloat(v); if(Number.isFinite(num)) it[f.key]=num; }
      else if(f.kind==="color"){ if(isValidCssColorToken(v)) it[f.key]=v.trim(); }
      else { it[f.key]=v; } }
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
    // Place copy's NW corner at center of original
    const origNW=normalizeRectAbs(res.room);
    const cx=origNW.xIn+res.room.wIn/2; const cy=origNW.yIn+res.room.hIn/2;
    copy.corner="NW"; copy.xIn=cx; copy.yIn=cy;
    res.floor.rooms.push(copy);
    setSelected({kind:"room", floorId:res.floor.id, roomId:copy.id});
  } else {
    const res=findItem(state.selected.itemId); if(!res) return;
    const copy=JSON.parse(JSON.stringify(res.item)); copy.id=guid(); copy.name=(copy.name||copy.type)+" (Copy)"; copy.roomId=res.room.id;
    // Place copy's NW corner at center of original (relative to room)
    const origRel=normalizeRectRelToRoomPrimary(res.item, res.room);
    const cx=origRel.xIn+res.item.wIn/2; const cy=origRel.yIn+res.item.hIn/2;
    copy.corner="NW"; copy.xIn=cx; copy.yIn=cy;
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
    const nameBox=document.createElement("input"); nameBox.type="text"; nameBox.value=floor.name;
    nameBox.dataset.floorId=floor.id;
    const del=document.createElement("button"); del.type="button"; del.className="btn icon"; del.title="Delete floor"; del.innerHTML="&#128465;";
    del.addEventListener("click",(ev)=>{ev.preventDefault(); ev.stopPropagation(); deleteFloor(floor.id);});
    const iconWrap=document.createElement("div"); iconWrap.className="row"; iconWrap.style.gap="8px";
    const up=document.createElement("button");
    up.type="button";
    up.className="btn icon";
    up.title="Move floor up";
    up.innerHTML="&#9650;";
    up.addEventListener("click",(ev)=>{ev.preventDefault(); ev.stopPropagation(); moveFloor(floor.id,-1);});
    const dn=document.createElement("button");
    dn.type="button";
    dn.className="btn icon";
    dn.title="Move floor down";
    dn.innerHTML="&#9660;";
    dn.addEventListener("click",(ev)=>{ev.preventDefault(); ev.stopPropagation(); moveFloor(floor.id, 1);});
    iconWrap.appendChild(up);
    iconWrap.appendChild(dn);
    iconWrap.appendChild(del);
    row.appendChild(cb); row.appendChild(nameBox); row.appendChild(iconWrap); wrap.appendChild(row);
  }
  updateFloorSummary();
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
    const up=document.createElement("button"); up.type="button"; up.className="btn icon"; up.title="Move up"; up.innerHTML="&#9650;";
    const dn=document.createElement("button"); dn.type="button"; dn.className="btn icon"; dn.title="Move down"; dn.innerHTML="&#9660;";
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

function deleteType(type){
  if(type==="Room"){ alert("Cannot delete the Room type."); return; }
  const count=HOUSE.floors.reduce((acc,f)=>acc+f.rooms.reduce((a,r)=>a+r.items.filter(it=>it.type===type).length,0),0);
  if(!confirm(`Delete type "${type}"?\n\nThis will permanently remove ${count} item(s) of this type from all rooms. This cannot be undone.`)) return;
  for(const f of HOUSE.floors){ for(const r of f.rooms){ r.items=r.items.filter(it=>it.type!==type); } }
  delete ACTIVE.types[type];
  const idx=ACTIVE.typeOrder.indexOf(type); if(idx>=0) ACTIVE.typeOrder.splice(idx,1);
  state.visibleTypes.delete(type); delete state.visibleLabels[type];
  if(state.selected && state.selected.kind==="item"){ const res=findItem(state.selected.itemId); if(!res){ state.selected=null; state.selectedSnapshot=null; } }
  buildAll(); render(); saveApp();
}

function buildConfigForm(){
  const wrap=document.getElementById("cfgForm"); wrap.innerHTML="";
  for(const t of ACTIVE.typeOrder){
    const st=ACTIVE.types[t];
    const id=cssId(t);
    const block=document.createElement("div"); block.className="cfgBlock";

    // ── Header ──────────────────────────────────────────────────────────────
    const head=document.createElement("div"); head.className="cfgHead";

    // Clickable swatch → overlaid hidden color picker
    const swWrap=document.createElement("span"); swWrap.className="cfgSwatchWrap"; swWrap.title="Click to change swatch color";
    const sw=document.createElement("span"); sw.className="swatch cfgSwatch"; sw.style.background=st.defaultLineColor;
    const swPick=document.createElement("input"); swPick.type="color"; swPick.className="cfgSwatchPicker";
    const hxSw=cssColorToHex(st.defaultLineColor); if(hxSw) swPick.value=hxSw;
    swPick.addEventListener("input",()=>{
      st.defaultLineColor=swPick.value.toLowerCase();
      sw.style.background=st.defaultLineColor;
      const lineInp=document.getElementById(`cfg_${id}_defaultLineColor`); if(lineInp) lineInp.value=st.defaultLineColor;
      const linePick=document.getElementById(`cfg_${id}_defaultLineColor_picker`); if(linePick) linePick.value=st.defaultLineColor;
      buildTypeToggles(); buildLabelToggles(); renderCounts(); saveApp();
    });
    swWrap.appendChild(sw); swWrap.appendChild(swPick);

    const headLeft=document.createElement("div"); headLeft.className="row"; headLeft.style.gap="10px";
    const titleEl=document.createElement("div"); titleEl.style.fontWeight="700"; titleEl.style.fontSize="13px"; titleEl.textContent=t;
    headLeft.appendChild(swWrap); headLeft.appendChild(titleEl);

    const headRight=document.createElement("div"); headRight.className="row"; headRight.style.gap="6px";
    const arrow=document.createElement("span"); arrow.className="cfgArrow"; arrow.innerHTML="&#9654;";

    if(t!=="Room"){
      const delBtn=document.createElement("button"); delBtn.type="button"; delBtn.className="btn icon cfgDelBtn"; delBtn.title=`Delete type "${t}"`; delBtn.innerHTML="&#128465;";
      delBtn.addEventListener("click",(ev)=>{ ev.preventDefault(); ev.stopPropagation(); deleteType(t); });
      headRight.appendChild(delBtn);
    }
    headRight.appendChild(arrow);
    head.appendChild(headLeft); head.appendChild(headRight);

    // ── Body (collapsed by default) ─────────────────────────────────────────
    const body=document.createElement("div"); body.className="cfgBody"; body.style.display="none";

    head.addEventListener("click",(ev)=>{
      if(swWrap.contains(ev.target)) return;
      const open=body.style.display!=="none";
      body.style.display=open?"none":"block";
      arrow.style.transform=open?"":"rotate(90deg)";
    });

    if(t!=="Room"){
      const nm=document.createElement("div"); nm.className="field"; nm.style.marginBottom="8px";
      nm.innerHTML=`<label>Type Name</label><input id="cfg_${id}_name" value="${escapeXml(t)}" />`;
      body.appendChild(nm);
    }

    const grid=document.createElement("div"); grid.className="grid2";

    const makeColor=(label, key)=>{
      const f=document.createElement("div"); f.className="field";
      const lab=document.createElement("label"); lab.textContent=label;
      const row=document.createElement("div"); row.className="colorRow";
      const txt=document.createElement("input"); txt.type="text"; txt.id=`cfg_${id}_${key}`; txt.placeholder="#rrggbb or css name";
      const pick=document.createElement("input"); pick.type="color"; pick.id=`cfg_${id}_${key}_picker`;
      txt.value=st[key]; const hx=cssColorToHex(st[key]); if(hx) pick.value=hx;
      pick.addEventListener("input",()=>{txt.value=pick.value.toLowerCase();});
      txt.addEventListener("input",()=>{const h=cssColorToHex(txt.value); if(h) pick.value=h;});
      row.appendChild(txt); row.appendChild(pick);
      f.appendChild(lab); f.appendChild(row);
      return f;
    };

    grid.appendChild(makeColor("Default Line Color","defaultLineColor"));

    const swf=document.createElement("div"); swf.className="field";
    swf.innerHTML=`<label>Stroke width (px)</label><input id="cfg_${id}_width" type="number" step="1" value="${escapeXml(st.strokeWidth)}" />`;
    grid.appendChild(swf);

    grid.appendChild(makeColor("Default Corner Color","defaultCornerColor"));
    grid.appendChild(makeColor("Default Fill Color","defaultFillColor"));

    const fa=document.createElement("div"); fa.className="field";
    fa.innerHTML=`<label>Default Fill Opacity (0..1)</label><input id="cfg_${id}_fillAlpha" type="number" step="0.01" value="${escapeXml(st.defaultFillAlpha ?? 1)}" />`;
    grid.appendChild(fa);

    const defW=document.createElement("div"); defW.className="field";
    defW.innerHTML=`<label>Default Width (in)</label><input id="cfg_${id}_defW" type="number" step="0.5" value="${escapeXml(st.defaultWIn ?? 0)}" />`;
    grid.appendChild(defW);

    const defH=document.createElement("div"); defH.className="field";
    defH.innerHTML=`<label>Default Length (in)</label><input id="cfg_${id}_defH" type="number" step="0.5" value="${escapeXml(st.defaultHIn ?? 0)}" />`;
    grid.appendChild(defH);

    const defZ=document.createElement("div"); defZ.className="field";
    defZ.innerHTML=`<label>Default Height (in)</label><input id="cfg_${id}_defZ" type="number" step="0.5" value="${escapeXml(st.defaultHeightIn ?? 0)}" />`;
    grid.appendChild(defZ);

    body.appendChild(grid);
    block.appendChild(head);
    block.appendChild(body);
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
    const st=ACTIVE.types[t] || (ACTIVE.types[t]=genDefaultStyle(Object.keys(ACTIVE.types).length));

    const line=document.getElementById(`cfg_${id}_defaultLineColor`)?.value;
    const corner=document.getElementById(`cfg_${id}_defaultCornerColor`)?.value;
    const fill=document.getElementById(`cfg_${id}_defaultFillColor`)?.value;
    const width=parseInt(document.getElementById(`cfg_${id}_width`)?.value,10);
    const fillAlpha=parseFloat(document.getElementById(`cfg_${id}_fillAlpha`)?.value);
    const defW=parseFloat(document.getElementById(`cfg_${id}_defW`)?.value);
    const defH=parseFloat(document.getElementById(`cfg_${id}_defH`)?.value);
    const defZ=parseFloat(document.getElementById(`cfg_${id}_defZ`)?.value);

    if(typeof line==="string" && isValidCssColorToken(line)) st.defaultLineColor=line.trim();
    if(typeof corner==="string" && isValidCssColorToken(corner)) st.defaultCornerColor=corner.trim();
    if(typeof fill==="string" && isValidCssColorToken(fill)) st.defaultFillColor=fill.trim();
    if(Number.isFinite(width) && width>0) st.strokeWidth=width;
    if(Number.isFinite(fillAlpha)) st.defaultFillAlpha=clamp(fillAlpha,0,1);
    if(Number.isFinite(defW)) st.defaultWIn=defW;
    if(Number.isFinite(defH)) st.defaultHIn=defH;
    if(Number.isFinite(defZ)) st.defaultHeightIn=defZ;
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
    const st=ACTIVE.types["Room"]||genDefaultStyle(0);
    const r={id:guid(),type:"Room",floorId:floor.id,name:"Room",description:"",corner:"NW",xIn:20,yIn:20,wIn:st.defaultWIn??144,hIn:st.defaultHIn??120,heightIn:st.defaultHeightIn??96,items:[]};
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
  const st=ACTIVE.types[type]||genDefaultStyle(Object.keys(ACTIVE.types).length);
  const it={id:guid(),type,roomId:res.room.id,name:type,description:"",corner:"NW",xIn:12,yIn:12,wIn:st.defaultWIn??24,hIn:st.defaultHIn??24,heightIn:st.defaultHeightIn??48};
  applyDefaultsToObj(it);
  res.room.items.push(it);
  setSelected({kind:"item", floorId:res.floor.id, roomId:res.room.id, itemId:it.id});
  buildAll(); render(); saveApp();
}

// --- Exporters ---
const EXPORTERS=[];
window.registerExporter=function(exp){
  if(!exp || !exp.id) return;
  const idx=EXPORTERS.findIndex(e=>e.id===exp.id);
  if(idx>=0) EXPORTERS[idx]=exp; else EXPORTERS.push(exp);
  refreshExportFormatSelect();
};
function refreshExportFormatSelect(){
  const sel=document.getElementById("exportFormat");
  if(!sel) return;
  const cur=sel.value;
  sel.innerHTML="";
  for(const e of EXPORTERS){
    const o=document.createElement("option"); o.value=e.id; o.textContent=e.name||e.id;
    sel.appendChild(o);
  }
  if(cur && EXPORTERS.some(e=>e.id===cur)) sel.value=cur;
  else if(EXPORTERS[0]) sel.value=EXPORTERS[0].id;
}
function exportAll(){
  const fmt=document.getElementById("exportFormat")?.value || "json";
  const visibleOnly=!!document.getElementById("exportVisibleOnly")?.checked;
  const exp=EXPORTERS.find(e=>e.id===fmt) || EXPORTERS[0];
  if(!exp){ alert("No exporters registered."); return; }
  const ctx={APP,ACTIVE,HOUSE,state,helpers:{clamp,roundHalf,formatFeetInches,normalizeRectAbs,normalizeRectRelToRoomPrimary,itemAbsRect,markerAbsPos}};
  let out="";
  try{ out=exp.export(ctx,{visibleOnly}) ?? ""; } catch(e){ out=`Export failed: ${e?.message||e}`; }
  document.getElementById("ExportImportArea").value=String(out);
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
  const wrap=document.getElementById("canvasWrap");
  wrap.innerHTML="";
  const inner=document.createElement("div"); inner.id="canvasInner";
  inner.style.transform=`translate(${state.view.tx}px, ${state.view.ty}px) scale(${state.view.scale})`;
  inner.style.transformOrigin="0 0";
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
      rect.setAttribute("fill-opacity", String(room.fillAlpha ?? st.defaultFillAlpha ?? 1));
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
      rect.addEventListener("mousedown",onDown);
      marker.addEventListener("mousedown",(ev)=>{ev.preventDefault(); ev.stopPropagation(); onClick(ev);
        drag.active=true; drag.kind="room-resize"; drag.roomId=room.id; drag.itemId=null; drag.svg=svg;
        drag.startPt=svgPoint(svg, ev.clientX, ev.clientY);
        const rnw=normalizeRectAbs(room);
        const moving=markerAbsPos(rnw, room, room.corner);
        const opp=oppositeCorner(room.corner);
        const fixed=markerAbsPos(rnw, room, opp);
        drag.startRect={nw:rnw, wIn:room.wIn, hIn:room.hIn, corner:room.corner, moving, fixed}; drag.fixedPt=fixed;
      });

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
          rect.setAttribute("fill-opacity", String(it.fillAlpha ?? st.defaultFillAlpha ?? 1));
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
          rect.addEventListener("mousedown",onDown);
          marker.addEventListener("mousedown",(ev)=>{ev.preventDefault(); ev.stopPropagation(); onClick(ev);
            drag.active=true; drag.kind="item-resize"; drag.roomId=room.id; drag.itemId=it.id; drag.svg=svg;
            drag.startPt=svgPoint(svg, ev.clientX, ev.clientY);
            const moving=markerAbsPos(abs, it, it.corner);
            const opp=oppositeCorner(it.corner);
            const fixed=markerAbsPos(abs, it, opp);
            drag.startRect={wIn:it.wIn, hIn:it.hIn, corner:it.corner, moving, fixed}; drag.fixedPt=fixed;
          });

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
    block.appendChild(header); block.appendChild(svg); inner.appendChild(block);
  }
  wrap.appendChild(inner);
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
  refreshExportFormatSelect();
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

  // Keyboard shortcuts: Delete = delete selected, Insert = duplicate selected
  document.addEventListener("keydown",(ev)=>{
    const tag=(ev.target?.tagName||"").toLowerCase();
    const editable=tag==="input"||tag==="textarea"||tag==="select"||ev.target?.isContentEditable;
    if(editable) return;
    if(ev.key==="Delete"){ ev.preventDefault(); deleteSelected(); }
    else if(ev.key==="Insert"){ ev.preventDefault(); duplicateSelected(); }
  });

  document.getElementById("newFloor").addEventListener("change",()=>populateNewItemSelectors());
  document.getElementById("newType").addEventListener("change",()=>populateNewItemSelectors());
  document.getElementById("addNew").addEventListener("click",(e)=>{e.preventDefault(); addNew();});

  document.getElementById("showAllFloors").addEventListener("click",(e)=>{e.preventDefault(); state.visibleFloors=new Set(HOUSE.floors.map(f=>f.id)); buildFloorToggles(); render(); saveApp();});
  document.getElementById("hideAllFloors").addEventListener("click",(e)=>{e.preventDefault(); state.visibleFloors=new Set(); buildFloorToggles(); render(); saveApp();});
  document.getElementById("addFloor").addEventListener("click",(e)=>{e.preventDefault(); addFloor();});
  document.getElementById("saveFloorNames").addEventListener("click",(e)=>{e.preventDefault();
    document.querySelectorAll("#floorToggles input[type=text]").forEach(inp=>{
      if(!inp.dataset.floorId) return;
      const floor=findFloor(inp.dataset.floorId); if(floor) floor.name=inp.value||"(unnamed floor)";
    });
    buildAll(); render(); saveApp();
  });

  document.getElementById("cfgReset").addEventListener("click",(e)=>{e.preventDefault(); resetConfig();});
  document.getElementById("cfgSave").addEventListener("click",(e)=>{e.preventDefault(); saveConfig();});
  document.getElementById("addType").addEventListener("click",(e)=>{e.preventDefault(); addType();});

  document.getElementById("exportBtn").addEventListener("click",(e)=>{e.preventDefault(); exportAll();});
  document.getElementById("importBtn").addEventListener("click",(e)=>{e.preventDefault(); importAll();});

  initPanZoom();

  window.addEventListener("mousemove",(ev)=>{
    if(!drag.active) return;
    const p=svgPoint(drag.svg, ev.clientX, ev.clientY);
    const dxIn=(p.x-drag.startPt.x)/state.ppi;
    const dyIn=(p.y-drag.startPt.y)/state.ppi;
    if(drag.kind==="room-resize"){
      const res=findRoom(drag.roomId); if(!res) return;
      const fixed=drag.startRect.fixed; const moving0=drag.startRect.moving;
      const moving={xIn:moving0.xIn+dxIn, yIn:moving0.yIn+dyIn};
      const x0=Math.min(fixed.xIn, moving.xIn); const y0=Math.min(fixed.yIn, moving.yIn);
      const w=Math.max(1, Math.abs(fixed.xIn-moving.xIn)); const h=Math.max(1, Math.abs(fixed.yIn-moving.yIn));
      res.room.wIn=roundHalf(w); res.room.hIn=roundHalf(h);
      setRoomFromNW(res.room, x0, y0);
      buildSelectedForm();
    } else if(drag.kind==="item-resize"){
      const res=findItem(drag.itemId); if(!res) return;
      const fixed=drag.startRect.fixed; const moving0=drag.startRect.moving;
      const moving={xIn:moving0.xIn+dxIn, yIn:moving0.yIn+dyIn};
      const x0=Math.min(fixed.xIn, moving.xIn); const y0=Math.min(fixed.yIn, moving.yIn);
      const w=Math.max(1, Math.abs(fixed.xIn-moving.xIn)); const h=Math.max(1, Math.abs(fixed.yIn-moving.yIn));
      res.item.wIn=roundHalf(w); res.item.hIn=roundHalf(h);
      const roomNW=normalizeRectAbs(res.room);
      setItemFromNW_Rel(res.item, res.room, x0-roomNW.xIn, y0-roomNW.yIn);
      buildSelectedForm();
    } else if(drag.kind==="room"){
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


function migrateColorsAndDefaults(app){
  try{
    for(const s of app.structures||[]){
      if(!s.types) continue;
      for(const [k,st] of Object.entries(s.types)){
        // migrate default fill rgba -> color + alpha
        if(typeof st.defaultFillColor==="string"){
          const m=st.defaultFillColor.match(/^rgba\((\d+),(\d+),(\d+),([0-9.]+)\)$/i);
          if(m){
            const r=parseInt(m[1],10), g=parseInt(m[2],10), b=parseInt(m[3],10), a=parseFloat(m[4]);
            st.defaultFillColor=rgbToHex({r,g,b}).toLowerCase();
            st.defaultFillAlpha=clamp(a,0,1);
          }
        }
        if(st.defaultFillAlpha==null) st.defaultFillAlpha=1;
        if(st.defaultWIn==null) st.defaultWIn=48;
        if(st.defaultHIn==null) st.defaultHIn=48;
        if(st.defaultHeightIn==null) st.defaultHeightIn=96;
      }
      for(const f of s.house?.floors||[]){
        for(const r of f.rooms||[]){
          if(typeof r.fillColor==="string"){
            const m=r.fillColor.match(/^rgba\((\d+),(\d+),(\d+),([0-9.]+)\)$/i);
            if(m){ r.fillAlpha=clamp(parseFloat(m[4]),0,1); r.fillColor=rgbToHex({r:+m[1],g:+m[2],b:+m[3]}).toLowerCase(); }
          }
          if(r.fillAlpha==null) r.fillAlpha=1;
          for(const it of r.items||[]){
            if(typeof it.fillColor==="string"){
              const m=it.fillColor.match(/^rgba\((\d+),(\d+),(\d+),([0-9.]+)\)$/i);
              if(m){ it.fillAlpha=clamp(parseFloat(m[4]),0,1); it.fillColor=rgbToHex({r:+m[1],g:+m[2],b:+m[3]}).toLowerCase(); }
            }
            if(it.fillAlpha==null) it.fillAlpha=1;
          }
        }
      }
    }
  }catch{}
  return app;
}

async function loadSeedFromServer(){
  try{
    const res=await fetch("default.json",{cache:"no-store"});
    if(res.ok){
      const j=await res.json();
      return j;
    }
  }catch{}
  return seedApp(); // fallback
}
async function initApp(forceSeed=false){
  APP = (!forceSeed ? loadApp() : null);
  if(!APP){ APP = await loadSeedFromServer(); }
  APP = migrateColorsAndDefaults(APP);
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
(async()=>{await initApp(false);})();
function initPanZoom(){
  const wrap=document.getElementById("canvasWrap");
  if(!wrap || wrap.__pz) return;
  wrap.__pz=true;

  wrap.addEventListener("wheel",(ev)=>{
    ev.preventDefault(); // always zoom when pointer is over the canvas
    const rect=wrap.getBoundingClientRect();
    const mx=ev.clientX-rect.left;
    const my=ev.clientY-rect.top;
    const old=state.view.scale;
    const delta=-ev.deltaY;
    const factor=delta>0?1.08:0.92;
    const ns=clamp(old*factor,0.2,5);
    const wx=(mx-state.view.tx)/old;
    const wy=(my-state.view.ty)/old;
    state.view.scale=ns;
    state.view.tx=mx-wx*ns;
    state.view.ty=my-wy*ns;
    render();
  }, {passive:false});

  wrap.addEventListener("contextmenu",(ev)=>{ if(pan.active||ev.button===2) ev.preventDefault(); });
  wrap.addEventListener("mousedown",(ev)=>{
    // Pan with right-drag anywhere on the canvas (objects or background)
    if(ev.button===2){
      ev.preventDefault();
      pan.active=true; pan.startX=ev.clientX; pan.startY=ev.clientY; pan.startTx=state.view.tx; pan.startTy=state.view.ty;
    }
  });
  window.addEventListener("mousemove",(ev)=>{
    if(!pan.active) return;
    state.view.tx=pan.startTx+(ev.clientX-pan.startX);
    state.view.ty=pan.startTy+(ev.clientY-pan.startY);
    render();
  });
  window.addEventListener("mouseup",()=>{pan.active=false;});
}

