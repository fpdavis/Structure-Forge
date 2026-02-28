
const STORAGE_KEY="house-layout-viewer:v6";

// Persistence
const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000;
let APP=null, ACTIVE=null, HOUSE=null;

const DEFAULT_UI={
  ppi:3,
  units:"imperial", // label mode only (no conversion)
  grid:{
    enabled:false,
    mode:"off", // off | under | over
    style:"line", // line | dot
    minorStep:12,
    showMinor:true,
    minorColor:"#ffffff",
    majorColor:"#ffffff",
    minorOpacity:0.18,
    majorOpacity:0.40,
    snapEnabled:false
  }
};

const state={
  ppi:DEFAULT_UI.ppi,
  units:DEFAULT_UI.units,
  grid:JSON.parse(JSON.stringify(DEFAULT_UI.grid)),
  dirty:false,
  lastSavedAt:0,
  autoSaveTimer:null,
  visibleFloors:new Set(),
  visibleTypes:new Set(),
  visibleLabels:{},
  selected:null,
  selectedSnapshot:null,
  view:{scale:1,tx:0,ty:0}
};
const drag={active:false, kind:null, floorId:null, roomId:null, itemId:null, startClientX:0, startClientY:0, startNW:null, startRect:null, fixedPt:null, raf:false, preState:null, preSelected:null, moved:false};
const pan={active:false, startX:0, startY:0, startTx:0, startTy:0};

// ── Nudge configuration (inches) ─────────────────────────────────────────────
const NUDGE_NORMAL_IN = 1;   // Arrow key nudge – normal step
const NUDGE_SHIFT_IN  = 12;  // Arrow key nudge – shift step (1 foot)

// ── Undo / Redo history ───────────────────────────────────────────────────────
// Push-after model: pushHistory() is called AFTER every mutation so that
// stack[index] always equals the current live state.
// Undo: decrement index → restore previous snapshot (one action back).
// Redo: increment index → restore next snapshot.
const history={stack:[], index:-1, maxSize:50};

// ── Copy / Cut / Paste clipboard (in-app) ───────────────────────────────────
// Note: This does NOT integrate with the OS clipboard. It mirrors the
// familiar shortcuts for in-app object operations.
const clipboard={ kind:null, data:null, source:{floorId:null, roomId:null} };

// ── View configuration ──────────────────────────────────────────────────────
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 5;
const ZOOM_TO_FIT_PAD_PX = 24;

// ── Area / perimeter helpers ───────────────────────────────────────────────
const IN2_PER_FT2 = 144;
function formatSqFt(areaIn2){
  const ft2=areaIn2/IN2_PER_FT2;
  const s=ft2.toFixed(1);
  return s.endsWith(".0") ? s.slice(0,-2) : s;
}
function roomAreaIn2(room){ return Math.max(0,(room.wIn||0)*(room.hIn||0)); }
function roomPerimIn(room){ return Math.max(0, 2*((room.wIn||0)+(room.hIn||0))); }
function floorTotals(floor){
  let areaIn2=0, perimIn=0;
  for(const r of (floor.rooms||[])){
    areaIn2 += roomAreaIn2(r);
    perimIn += roomPerimIn(r);
  }
  return {areaIn2, perimIn};
}

function pushHistory(){
  history.stack = history.stack.slice(0, history.index+1);
  history.stack.push({
    house: JSON.parse(JSON.stringify(HOUSE)),
    selected: state.selected ? JSON.parse(JSON.stringify(state.selected)) : null
  });
  if(history.stack.length > history.maxSize) history.stack.shift();
  history.index = history.stack.length - 1;
}

function _applyHistorySnap(snap){
  ACTIVE.house = JSON.parse(JSON.stringify(snap.house));
  HOUSE = ACTIVE.house;
  state.selected = snap.selected ? JSON.parse(JSON.stringify(snap.selected)) : null;
  state.selectedSnapshot = null;
  buildAll(); render();
  markDirty();
}

function undoHistory(){
  if(history.index <= 0) return;
  history.index--;
  _applyHistorySnap(history.stack[history.index]);
}

function redoHistory(){
  if(history.index >= history.stack.length-1) return;
  history.index++;
  _applyHistorySnap(history.stack[history.index]);
}

const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const inToPx=(inch)=>inch*state.ppi;

function guid(){
  if(typeof crypto!=="undefined" && crypto.getRandomValues){
    return Array.from(crypto.getRandomValues(new Uint8Array(4)), b=>b.toString(16).padStart(2,"0")).join("");
  }
  return Math.floor(Math.random()*0xffffffff).toString(16).padStart(8,"0");
}
function escapeXml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;"); }
function roundHalf(n){ return Math.round(n*2)/2; }
function formatFeetInches(totalIn){ const inches=Math.round(totalIn); const ft=Math.floor(inches/12); const rem=inches%12;
  if(ft<=0) return `${rem}"`; if(rem===0) return `${ft}'`; return `${ft}'${rem}"`; }

function _trimZeros(s){ return String(s).replace(/\.0+$/,"" ).replace(/(\.\d*?)0+$/,"$1"); }
function formatMetricLabel(v){
  const n=Number(v||0);
  if(n<1000) return `${_trimZeros(n.toFixed(1))}mm`;
  if(n<9999) return `${_trimZeros((n/10).toFixed(1))}cm`;
  return `${_trimZeros((n/1000).toFixed(2))}m`;
}
function formatLinear(v){
  return state.units==="metric" ? formatMetricLabel(v) : formatFeetInches(v);
}
function inputUnitLabel(){ return state.units==="metric" ? "mm" : "in"; }
function snapToGridIn(valueIn){
  const step=Number(state.grid.minorStep||0);
  if(!(step>0)) return valueIn;
  return Math.round(valueIn/step)*step;
}

function _snapshotViewConfiguration(){
  return {
    units: state.units,
    scale: state.ppi,
    showGrid: !!(state.grid.mode && state.grid.mode!=="off"),
    gridMode: String(state.grid.mode||"off"),
    showMinor: !!state.grid.showMinor,
    gridSize: Number(state.grid.minorStep),
    gridType: String(state.grid.style||"line"),
    minorColor: String(state.grid.minorColor||"#ffffff"),
    majorColor: String(state.grid.majorColor||"#ffffff"),
    minorOpacity: Number(state.grid.minorOpacity),
    majorOpacity: Number(state.grid.majorOpacity),
    snapEnabled: !!state.grid.snapEnabled
  };
}

function _applyViewConfiguration(cfg){
  if(!cfg) return;
  if(cfg.units==="imperial"||cfg.units==="metric") state.units=cfg.units;
  if(Number.isFinite(cfg.scale)) state.ppi=clamp(Math.round(cfg.scale),1,10);
  if(typeof cfg.gridMode==="string" && ["off","under","over"].includes(cfg.gridMode)){
    state.grid.mode=cfg.gridMode;
  } else if(cfg.showGrid!=null){
    state.grid.mode=cfg.showGrid ? "under" : "off";
  }
  state.grid.enabled = state.grid.mode!=="off";
  if(cfg.showMinor!=null) state.grid.showMinor=!!cfg.showMinor;
  if(Number.isFinite(cfg.gridSize)) state.grid.minorStep=Number(cfg.gridSize);
  if(typeof cfg.gridType==="string") state.grid.style=cfg.gridType;
  if(typeof cfg.minorColor==="string") state.grid.minorColor=cfg.minorColor;
  if(typeof cfg.majorColor==="string") state.grid.majorColor=cfg.majorColor;
  if(Number.isFinite(cfg.minorOpacity)) state.grid.minorOpacity=clamp(Number(cfg.minorOpacity),0,1);
  if(Number.isFinite(cfg.majorOpacity)) state.grid.majorOpacity=clamp(Number(cfg.majorOpacity),0,1);
  if(cfg.snapEnabled!=null) state.grid.snapEnabled=!!cfg.snapEnabled;
}

function _applyViewConfigurationFromActive(){
  const cfg = ACTIVE?.viewConfiguration || APP?.defaultConfiguration || null;
  _applyViewConfiguration(cfg);
  rebuildGridSizeOptions();
  syncViewPanelUI();
}

function saveViewDefaults(){
  APP.defaultConfiguration=_snapshotViewConfiguration();
  markDirty();
}

function _commitViewConfiguration(){
  if(ACTIVE) ACTIVE.viewConfiguration=_snapshotViewConfiguration();
  markDirty();
}

function loadViewDefaults(){
  if(!APP.defaultConfiguration) return;
  _applyViewConfiguration(APP.defaultConfiguration);
  if(ACTIVE) ACTIVE.viewConfiguration=_snapshotViewConfiguration();
  rebuildGridSizeOptions();
  syncViewPanelUI();
  buildSelectedForm();
  buildConfigForm();
  render();
  markDirty();
}

const GRID_SIZES_IMPERIAL=[
  {v:3,  label:'3" — Trim & molding detail'},
  {v:4,  label:'4" — Architectural base module'},
  {v:6,  label:'6" — Half-foot / tile & cabinet'},
  {v:8,  label:'8" — Brick & CMU block coursing'},
  {v:12, label:'12" — One foot / floor tile'},
  {v:16, label:'16" — Standard stud spacing'},
  {v:18, label:'18" — Upper cabinet depth'},
  {v:24, label:'24" — Alternate stud / 2 feet'},
  {v:30, label:'30" — Door & appliance width'},
  {v:36, label:'36" — Three feet / countertop'},
  {v:48, label:'48" — Panel / plywood sheet'},
  {v:96, label:'96" — Eight feet / full sheet'}
];

const GRID_SIZES_METRIC=[
  {v:10,   label:'10mm — Fine detail'},
  {v:50,   label:'50mm — Half-module'},
  {v:100,  label:'100mm — Fine detail / base module'},
  {v:200,  label:'200mm — Half-stud reference'},
  {v:400,  label:'400mm — Stud spacing (heavy/UK)'},
  {v:600,  label:'600mm — Stud spacing (standard EU)'},
  {v:625,  label:'625mm — Precise DIN module'},
  {v:1200, label:'1200mm — Sheet goods width'},
  {v:2400, label:'2400mm — Sheet goods height'}
];

function gridOptions(){
  return state.units==="metric" ? GRID_SIZES_METRIC : GRID_SIZES_IMPERIAL;
}
function gridMajorMultiple(minor){
  const opts=gridOptions().map(o=>o.v);
  if(opts.includes(minor*4)) return 4;
  if(opts.includes(minor*5)) return 5;
  return 5;
}

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

const RESIZE_CORNERS=["NW","NE","SW","SE"];
const RESIZE_EDGES=["N","E","S","W"];
function oppositeCorner(c){ return c==="NW"?"SE":c==="SE"?"NW":c==="NE"?"SW":"NE"; }
function cursorForCorner(c){
  if(c==="NW"||c==="SE") return "nwse-resize";
  return "nesw-resize";
}
function cursorForEdge(e){ return (e==="N"||e==="S") ? "ns-resize" : "ew-resize"; }
function setStatus(msg){ const el=document.getElementById("storageStatus"); if(el) el.textContent=msg; }

function _fmtTime(d){
  const hh=String(d.getHours()).padStart(2,"0");
  const mm=String(d.getMinutes()).padStart(2,"0");
  return `${hh}:${mm}`;
}

function markDirty(){
  state.dirty=true;
  setStatus("Storage: pending");
}

function saveNow(){
  try{
    if(!APP) return;

    if(!APP.defaultConfiguration) APP.defaultConfiguration=_snapshotViewConfiguration();
    if(ACTIVE) ACTIVE.viewConfiguration=_snapshotViewConfiguration();

    localStorage.setItem(STORAGE_KEY, JSON.stringify(APP));
    state.dirty=false;
    state.lastSavedAt=Date.now();
    setStatus(`Storage: saved ${_fmtTime(new Date(state.lastSavedAt))}`);
  } catch {
    setStatus("Storage: failed to save");
  }
}

function startAutoSave(){
  if(state.autoSaveTimer) return;
  state.autoSaveTimer=setInterval(()=>{ if(state.dirty) saveNow(); }, AUTO_SAVE_INTERVAL_MS);
}
/**
 * Re-inflate all fields that the v6 JSON exporter strips for compactness.
 * Safe to call on both old (pre-v6) and v6+ payloads — already-present values
 * are never overwritten.
 *
 * Handles:
 *  - types: list [{name,…}] → object {"TypeName":{…}}  (fixes first-load style bug)
 *  - rooms:  corner default "NW", type "Room", floorId from containment
 *  - items:  corner default "NW", roomId from containment,
 *            name default = type,
 *            wIn/hIn/heightIn restored from type defaults when absent
 */
function _hydrateStructure(s){
  if(!s || s._hydrated) return;

  // --- Normalise types: list → keyed object ---
  if(Array.isArray(s.types)){
    const obj={};
    for(const t of s.types){ if(t&&t.name){ const {name,...rest}=t; obj[name]=rest; } }
    s.types=obj;
  }
  const td=s.types||{};

  for(const floor of (s.house?.floors||[])){
    for(const room of (floor.rooms||[])){
      if(!room.corner)  room.corner  = "NW";
      if(!room.type)    room.type    = "Room";
      if(!room.floorId) room.floorId = floor.id;
      for(const item of (room.items||[])){
        if(!item.corner)  item.corner  = "NW";
        if(!item.roomId)  item.roomId  = room.id;
        if(!item.name)    item.name    = item.type;
        // Restore dimension defaults from type config
        const st=td[item.type]||{};
        if(item.wIn      == null && st.defaultWIn      != null) item.wIn      = st.defaultWIn;
        if(item.hIn      == null && st.defaultHIn      != null) item.hIn      = st.defaultHIn;
        if(item.heightIn == null && st.defaultHeightIn != null) item.heightIn = st.defaultHeightIn;
      }
    }
  }
  s._hydrated=true;
}

function hydrateApp(parsed, activeId){
  // Only inflate the active structure to avoid unnecessary memory expansion.
  const structures=(parsed.structures||[]);
  const id = activeId || parsed.activeId || structures[0]?.id;
  const active = structures.find(x=>x.id===id) || structures[0];
  if(active) _hydrateStructure(active);
  return parsed;
}

function loadApp(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    const parsed=JSON.parse(raw);
    if(!parsed||!Array.isArray(parsed.structures)||parsed.structures.length===0) return null;
    const activeId=parsed.activeId || parsed.structures[0].id;
    return hydrateApp(parsed, activeId);
  } catch { return null; }
}

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
  return {schemaVersion:6, activeId:id, structures:[{id,name:"My House",house,types,typeOrder}]};
}

function setActiveStructure(id){
  APP.activeId=id;
  ACTIVE=APP.structures.find(s=>s.id===id) || APP.structures[0];
  _hydrateStructure(ACTIVE);
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

  _applyViewConfigurationFromActive();

  buildAll(); render();
}

function buildStructureUI(){
  const sel=document.getElementById("structureSelect");
  const name=document.getElementById("structureName");
  sel.innerHTML="";
  for(const s of APP.structures){ const o=document.createElement("option"); o.value=s.id; o.textContent=s.name; sel.appendChild(o); }
  sel.value=ACTIVE.id; name.value=ACTIVE.name;
}
function newStructure(){ const id=guid(); const seeded=seedApp(); const struct=seeded.structures[0]; struct.id=id; struct.name="New Structure"; APP.structures.push(struct); setActiveStructure(id); markDirty(); }
function deleteStructure(){ if(APP.structures.length<=1){ alert("There must always be at least one structure."); return; }
  if(!confirm(`Delete structure "${ACTIVE.name}"?`)) return;
  const idx=APP.structures.findIndex(s=>s.id===ACTIVE.id); if(idx>=0) APP.structures.splice(idx,1); setActiveStructure(APP.structures[0].id); markDirty(); }
function resetStorage(){ if(!confirm("Reset stored data? This cannot be undone.")) return; localStorage.removeItem(STORAGE_KEY); APP=null; initApp(true); }

function findFloor(floorId){ return HOUSE.floors.find(f=>f.id===floorId)||null; }
function findRoom(roomId){ for(const f of HOUSE.floors){ const r=f.rooms.find(x=>x.id===roomId); if(r) return {floor:f, room:r}; } return null; }
function findItem(itemId){ for(const f of HOUSE.floors){ for(const r of f.rooms){ const it=r.items.find(x=>x.id===itemId); if(it) return {floor:f, room:r, item:it}; } } return null; }
function findRoomOnFloorAtAbsPoint(floorId, xIn, yIn, excludeRoomId=null){
  const floor=findFloor(floorId);
  if(!floor) return null;
  for(let i=(floor.rooms||[]).length-1;i>=0;i--){
    const room=floor.rooms[i];
    if(excludeRoomId && room.id===excludeRoomId) continue;
    const rr=normalizeRectAbs(room);
    if(xIn>=rr.xIn && xIn<=rr.xIn+rr.wIn && yIn>=rr.yIn && yIn<=rr.yIn+rr.hIn){
      return {floor, room};
    }
  }
  return null;
}

function reassignItemToRoom(itemId, targetRoomId){
  const src=findItem(itemId);
  const dst=findRoom(targetRoomId);
  if(!src || !dst) return false;
  if(src.room.id===dst.room.id) return false;

  const abs=itemAbsRect(src.item, src.room);
  src.room.items=src.room.items.filter(it=>it.id!==src.item.id);

  src.item.roomId=dst.room.id;
  const dstNW=normalizeRectAbs(dst.room);
  setItemFromNW_Rel(src.item, dst.room, abs.xIn-dstNW.xIn, abs.yIn-dstNW.yIn);
  dst.room.items.push(src.item);

  state.selected={kind:"item", floorId:dst.floor.id, roomId:dst.room.id, itemId:src.item.id};
  return true;
}

const ROOM_FIELDS=[
  {key:"name",label:"Name",kind:"text"},
  {key:"description",label:"Description",kind:"textarea"},
  {key:"corner",label:"Corner",kind:"select",options:["NW","NE","SW","SE"]},
  {key:"xIn",label:"X Coordinate",unit:true,kind:"number"},
  {key:"yIn",label:"Y Coordinate",unit:true,kind:"number"},
  {key:"wIn",label:"Width",unit:true,kind:"number"},
  {key:"hIn",label:"Length",unit:true,kind:"number"},
  {key:"heightIn",label:"Height",unit:true,kind:"number"},
  {key:"cornerColor",label:"Corner Color",kind:"color"},
  {key:"lineColor",label:"Line Color",kind:"color"},
  {key:"fillColor",label:"Fill Color",kind:"color"},
  {key:"fillAlpha",label:"Fill Opacity",kind:"range",min:"0",max:"1",step:"0.01"}
];
const ITEM_FIELDS=[
  {key:"type",label:"Type",kind:"selectDynamic"},
  {key:"name",label:"Name",kind:"text"},
  {key:"description",label:"Description",kind:"textarea"},
  {key:"corner",label:"Corner",kind:"select",options:["NW","NE","SW","SE"]},
  {key:"xIn",label:"X Coordinate",unit:true,kind:"number"},
  {key:"yIn",label:"Y Coordinate",unit:true,kind:"number"},
  {key:"wIn",label:"Width",unit:true,kind:"number"},
  {key:"hIn",label:"Length",unit:true,kind:"number"},
  {key:"heightIn",label:"Height",unit:true,kind:"number"},
  {key:"cornerColor",label:"Corner Color",kind:"color"},
  {key:"lineColor",label:"Line Color",kind:"color"},
  {key:"fillColor",label:"Fill Color",kind:"color"},
  {key:"fillAlpha",label:"Fill Opacity",kind:"range",min:"0",max:"1",step:"0.01"}
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

  if(state.selected.kind==="item"){
    const currentItem=findItem(state.selected.itemId);
    if(currentItem){
      const roomField=document.createElement("div"); roomField.className="field";
      const roomLabel=document.createElement("label"); roomLabel.textContent="Room";
      const roomSelect=document.createElement("select"); roomSelect.id="sel_roomId";
      for(const floor of HOUSE.floors){
        const group=document.createElement("optgroup");
        group.label=floor.name;
        for(const room of (floor.rooms||[])){
          const option=document.createElement("option");
          option.value=room.id;
          option.textContent=room.name||"Room";
          group.appendChild(option);
        }
        if(group.children.length) roomSelect.appendChild(group);
      }
      roomSelect.value=currentItem.room.id;
      roomSelect.addEventListener("change",()=>{
        if(reassignItemToRoom(state.selected.itemId, roomSelect.value)){
          buildAll();
          render();
          markDirty();
          pushHistory();
        }
      });
      roomField.appendChild(roomLabel);
      roomField.appendChild(roomSelect);
      wrap.appendChild(roomField);
    }
  }

  for(const f of fields){
    const box=document.createElement("div"); box.className="field";
    const lab=document.createElement("label");
    lab.textContent = f.unit ? `${f.label} (${inputUnitLabel()})` : f.label;
    if(f.kind==="color"){
      const v=obj?.[f.key]??"";
      const row=document.createElement("div"); row.className="colorRow";
      const txt=document.createElement("input"); txt.type="text"; txt.id=`sel_${f.key}`; txt.placeholder="#rrggbb or css name";
      const pick=document.createElement("input"); pick.type="color"; pick.id=`sel_${f.key}_picker`;
      txt.value=v;
      const hx=cssColorToHex(v); if(hx) pick.value=hx;
      pick.addEventListener("input",()=>{txt.value=pick.value.toLowerCase();});
      txt.addEventListener("input",()=>{ const h=cssColorToHex(txt.value); if(h) pick.value=h; });
      txt.addEventListener("change",()=>{
        if(isValidCssColorToken(txt.value)){
          obj[f.key]=txt.value.trim();
          buildAll();
          render();
          markDirty();
          pushHistory();
        }
      });
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
      input=document.createElement("input");
      if(f.kind==="number"){
        input.type="number";
        input.step=f.step||"0.5";
      } else if(f.kind==="range"){
        input.type="range";
        input.min=f.min||"0";
        input.max=f.max||"1";
        input.step=f.step||"0.01";
        input.classList.add("sf-rangeFull");
      } else {
        input.type="text";
      }
    }
    input.id=`sel_${f.key}`;
    let v=obj?.[f.key]??"";
    // For select fields, fall back to first option rather than leaving blank
    if((f.kind==="select"||f.kind==="selectDynamic") && v==="" && input.options.length) v=input.options[0].value;
    if(["xIn","yIn","wIn","hIn","heightIn","fillAlpha"].includes(f.key) && v!=="" && Number.isFinite(+v)){
      const step=(f.step?parseFloat(f.step):0.5);
      v=String(step===0.01?Math.round(+v*100)/100:roundHalf(+v));
    }
    input.value=v;

    const commitValue=(isLive)=>{
      const raw=input.value;
      if(f.kind==="number" || f.kind==="range"){
        const num=parseFloat(raw);
        if(Number.isFinite(num)) obj[f.key]=num;
      } else {
        obj[f.key]=raw;
      }
      if(state.selected.kind==="room") applyDefaultsToObj(obj);
      else { ensureTypeExists(obj.type); applyDefaultsToObj(obj); }
      if(!isLive) buildAll();
      render();
      markDirty();
      if(!isLive) pushHistory();
    };

    if(f.kind==="range"){
      input.addEventListener("input",()=>commitValue(true));
      input.addEventListener("change",()=>commitValue(false));
    } else {
      input.addEventListener("change",()=>commitValue(false));
    }

    box.appendChild(lab); box.appendChild(input);
    wrap.appendChild(box);
  }

  if(state.selected.kind==="room"){
    const areaIn2=roomAreaIn2(obj);
    const perimIn=roomPerimIn(obj);
    const calc=document.createElement("div");
    calc.className="field";
    calc.style.gridColumn="1/-1";
    calc.innerHTML=`<div class="subtle">Area: <strong style="color:var(--text);">${escapeXml(formatSqFt(areaIn2))} ft²</strong> (${escapeXml(Math.round(areaIn2).toString())} in²) &nbsp;·&nbsp; Perimeter: <strong style="color:var(--text);">${escapeXml(formatLinear(perimIn))}</strong> (${escapeXml(Math.round(perimIn).toString())} ${escapeXml(inputUnitLabel())})</div>`;
    wrap.appendChild(calc);
  }
  state.selectedSnapshot=null;
}

function setSelected(sel){ state.selected=sel; buildSelectedForm(); render(); }

// Selected edits live-commit; no explicit Save/Reset/Clear controls.

function copySelected(){
  if(!state.selected){ clipboard.kind=null; clipboard.data=null; clipboard.source={floorId:null,roomId:null}; return; }
  if(state.selected.kind==="room"){
    const res=findRoom(state.selected.roomId); if(!res) return;
    clipboard.kind="room";
    clipboard.data=JSON.parse(JSON.stringify(res.room));
    clipboard.source={floorId:res.floor.id, roomId:res.room.id};
  } else {
    const res=findItem(state.selected.itemId); if(!res) return;
    // Store an item snapshot plus its NW-relative position within the source room.
    clipboard.kind="item";
    clipboard.data={
      item: JSON.parse(JSON.stringify(res.item)),
      relNW: normalizeRectRelToRoomPrimary(res.item, res.room)
    };
    clipboard.source={floorId:res.floor.id, roomId:res.room.id};
  }
}

function cutSelected(){
  if(!state.selected) return;
  copySelected();
  if(state.selected.kind==="room"){
    const res=findRoom(state.selected.roomId); if(!res) return;
    res.floor.rooms=res.floor.rooms.filter(r=>r.id!==res.room.id);
  } else {
    const res=findItem(state.selected.itemId); if(!res) return;
    res.room.items=res.room.items.filter(i=>i.id!==res.item.id);
  }
  state.selected=null; state.selectedSnapshot=null;
  buildAll(); render();
  markDirty();
  pushHistory();
}

function pasteClipboard(){
  if(!clipboard.kind || !clipboard.data) return;

  // Determine paste target context
  let targetFloorId=null;
  let targetRoomId=null;
  if(state.selected?.kind==="room"){ targetFloorId=state.selected.floorId; targetRoomId=state.selected.roomId; }
  else if(state.selected?.kind==="item"){ targetFloorId=state.selected.floorId; targetRoomId=state.selected.roomId; }
  else {
    // No selection: fall back to clipboard source
    targetFloorId=clipboard.source.floorId;
    targetRoomId=clipboard.source.roomId;
  }

  if(clipboard.kind==="room"){
    // Room paste behaves like Duplicate.
    const floor=findFloor(targetFloorId) || findFloor(clipboard.source.floorId);
    if(!floor){ alert("Select a floor or room first."); return; }
    const src=clipboard.data;
    const copy=JSON.parse(JSON.stringify(src));
    copy.id=guid();
    copy.name=(copy.name||"Room")+" (Copy)";
    copy.items=(copy.items||[]).map(it=>{ const c=JSON.parse(JSON.stringify(it)); c.id=guid(); c.roomId=copy.id; return c; });
    const origNW=normalizeRectAbs(src);
    const cx=origNW.xIn+src.wIn/2; const cy=origNW.yIn+src.hIn/2;
    copy.corner="NW"; copy.xIn=cx; copy.yIn=cy;
    copy.floorId=floor.id;
    floor.rooms.push(copy);
    setSelected({kind:"room", floorId:floor.id, roomId:copy.id});
  } else {
    // Item paste: paste into selected room or the room that owns the selected item.
    if(!targetRoomId){ alert("Select a room first (or select an item inside a room)."); return; }
    const res=findRoom(targetRoomId); if(!res){ alert("Room not found."); return; }
    const srcItem=clipboard.data.item;
    const copy=JSON.parse(JSON.stringify(srcItem));
    copy.id=guid();
    copy.roomId=res.room.id;
    copy.name=(copy.name||copy.type)+" (Copy)";
    // Place copy's NW corner at center of the source item (relative to target room).
    const origRel=clipboard.data.relNW;
    const cx=origRel.xIn+(srcItem.wIn||0)/2;
    const cy=origRel.yIn+(srcItem.hIn||0)/2;
    copy.corner="NW";
    setItemFromNW_Rel(copy, res.room, cx, cy);
    ensureTypeExists(copy.type);
    applyDefaultsToObj(copy);
    res.room.items.push(copy);
    setSelected({kind:"item", floorId:res.floor.id, roomId:res.room.id, itemId:copy.id});
  }

  buildAll(); render();
  markDirty();
  pushHistory();
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
  buildAll(); render();
  markDirty();
  pushHistory();
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
  buildAll(); render();
  markDirty();
  pushHistory();
}

function updateFloorSummary(){
  const visible=HOUSE.floors.filter(f=>state.visibleFloors.has(f.id)).length;
  const el=document.getElementById("floorSummary"); if(el) el.textContent=`${visible}/${HOUSE.floors.length}`;
}
function addFloor(){ const id=guid(); HOUSE.floors.push({id,name:"New Floor",rooms:[]}); state.visibleFloors.add(id); buildAll(); render(); markDirty(); pushHistory(); }

function moveFloor(floorId, delta){
  const idx=HOUSE.floors.findIndex(f=>f.id===floorId);
  if(idx<0) return;
  const tgt=clamp(idx+delta,0,HOUSE.floors.length-1);
  if(tgt===idx) return;
  const [f]=HOUSE.floors.splice(idx,1);
  HOUSE.floors.splice(tgt,0,f);
  buildAll(); render();
  markDirty();
  pushHistory();
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
  buildAll(); render();
  markDirty();
  pushHistory();
}
function buildFloorToggles(){
  const wrap=document.getElementById("floorToggles"); wrap.innerHTML="";
  for(const floor of HOUSE.floors){
    const row=document.createElement("div"); row.className="floorRow";
    const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=state.visibleFloors.has(floor.id);
    cb.addEventListener("change",()=>{cb.checked?state.visibleFloors.add(floor.id):state.visibleFloors.delete(floor.id); updateFloorSummary(); render();});
    const nameBox=document.createElement("input"); nameBox.type="text"; nameBox.value=floor.name;
    nameBox.dataset.floorId=floor.id;
    nameBox.addEventListener("change",()=>{
      floor.name=nameBox.value||"(unnamed floor)";
      updateFloorSummary();
      buildAll();
      render();
      markDirty();
    });
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
  buildAll(); render();
}
function buildTypeToggles(){
  const wrap=document.getElementById("typeToggles"); wrap.innerHTML="";
  const displayOrder=[...ACTIVE.typeOrder].filter(t=>t!=="Room").reverse();
  for(const t of displayOrder){
    const st=ACTIVE.types[t];
    const row=document.createElement("div"); row.className="checkbox"; row.style.justifyContent="space-between";
    const left=document.createElement("div"); left.className="row";
    const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=state.visibleTypes.has(t);
    cb.addEventListener("change",()=>{cb.checked?state.visibleTypes.add(t):state.visibleTypes.delete(t); render();});
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
    cb.addEventListener("change",()=>{state.visibleLabels[t]=cb.checked; render();});
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
  buildAll(); render();
  markDirty();
  pushHistory();
}

function renameType(oldName,newName){
  if(oldName===newName) return true;
  if(!newName) return false;
  if(oldName==="Room" || newName==="Room") return false;
  if(ACTIVE.typeOrder.includes(newName) || ACTIVE.types[newName]) return false;

  // move style
  ACTIVE.types[newName]=ACTIVE.types[oldName];
  delete ACTIVE.types[oldName];

  const idx=ACTIVE.typeOrder.indexOf(oldName);
  if(idx>=0) ACTIVE.typeOrder[idx]=newName;

  if(state.visibleTypes.has(oldName)){ state.visibleTypes.delete(oldName); state.visibleTypes.add(newName); }
  if(state.visibleLabels[oldName]!==undefined){ state.visibleLabels[newName]=state.visibleLabels[oldName]; delete state.visibleLabels[oldName]; }

  for(const f of HOUSE.floors){
    for(const r of f.rooms){
      for(const it of r.items){
        if(it.type===oldName) it.type=newName;
      }
    }
  }
  return true;
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
      buildTypeToggles(); buildLabelToggles(); renderCounts();
      markDirty();
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
    fa.innerHTML=`<label>Default Fill Opacity</label><input id="cfg_${id}_fillAlpha" type="range" min="0" max="1" step="0.01" value="${escapeXml(st.defaultFillAlpha ?? 1)}" class="sf-rangeFull" />`;
    grid.appendChild(fa);

    const defW=document.createElement("div"); defW.className="field";
    defW.innerHTML=`<label>Default Width (${escapeXml(inputUnitLabel())})</label><input id="cfg_${id}_defW" type="number" step="0.5" value="${escapeXml(st.defaultWIn ?? 0)}" />`;
    grid.appendChild(defW);

    const defH=document.createElement("div"); defH.className="field";
    defH.innerHTML=`<label>Default Length (${escapeXml(inputUnitLabel())})</label><input id="cfg_${id}_defH" type="number" step="0.5" value="${escapeXml(st.defaultHIn ?? 0)}" />`;
    grid.appendChild(defH);

    const defZ=document.createElement("div"); defZ.className="field";
    defZ.innerHTML=`<label>Default Height (${escapeXml(inputUnitLabel())})</label><input id="cfg_${id}_defZ" type="number" step="0.5" value="${escapeXml(st.defaultHeightIn ?? 0)}" />`;
    grid.appendChild(defZ);

    body.appendChild(grid);
    block.appendChild(head);
    block.appendChild(body);
    wrap.appendChild(block);

    // Live-commit changes (no explicit Save button)
    const applyStyle=()=>{ buildTypeToggles(); buildLabelToggles(); renderCounts(); render(); markDirty(); };
    const lineTxt=document.getElementById(`cfg_${id}_defaultLineColor`);
    const cornerTxt=document.getElementById(`cfg_${id}_defaultCornerColor`);
    const fillTxt=document.getElementById(`cfg_${id}_defaultFillColor`);
    const widthInp=document.getElementById(`cfg_${id}_width`);
    const faInp=document.getElementById(`cfg_${id}_fillAlpha`);
    const defWInp=document.getElementById(`cfg_${id}_defW`);
    const defHInp=document.getElementById(`cfg_${id}_defH`);
    const defZInp=document.getElementById(`cfg_${id}_defZ`);

    lineTxt?.addEventListener("change",()=>{ if(isValidCssColorToken(lineTxt.value)) st.defaultLineColor=lineTxt.value.trim(); applyStyle(); });
    cornerTxt?.addEventListener("change",()=>{ if(isValidCssColorToken(cornerTxt.value)) st.defaultCornerColor=cornerTxt.value.trim(); applyStyle(); });
    fillTxt?.addEventListener("change",()=>{ if(isValidCssColorToken(fillTxt.value)) st.defaultFillColor=fillTxt.value.trim(); applyStyle(); });
    widthInp?.addEventListener("change",()=>{ const v=parseInt(widthInp.value,10); if(Number.isFinite(v)) st.strokeWidth=v; applyStyle(); });
    faInp?.addEventListener("input",()=>{ const v=parseFloat(faInp.value); if(Number.isFinite(v)) st.defaultFillAlpha=clamp(v,0,1); render(); markDirty(); });
    defWInp?.addEventListener("change",()=>{ const v=parseFloat(defWInp.value); if(Number.isFinite(v)) st.defaultWIn=v; markDirty(); });
    defHInp?.addEventListener("change",()=>{ const v=parseFloat(defHInp.value); if(Number.isFinite(v)) st.defaultHIn=v; markDirty(); });
    defZInp?.addEventListener("change",()=>{ const v=parseFloat(defZInp.value); if(Number.isFinite(v)) st.defaultHeightIn=v; markDirty(); });

    if(t!=="Room"){
      const nameInp=document.getElementById(`cfg_${id}_name`);
      const oldType=t;
      nameInp?.addEventListener("change",()=>{
        const next=(nameInp.value||"").trim();
        if(!next){ nameInp.value=oldType; return; }
        if(!renameType(oldType,next)) { nameInp.value=oldType; return; }
        buildAll();
        buildConfigForm();
        buildSelectedForm();
        render();
        markDirty();
        pushHistory();
      });
    }
  }
}
function resetConfig(){
  const seeded=seedApp().structures[0];
  ACTIVE.types=seeded.types; ACTIVE.typeOrder=seeded.typeOrder;
  state.visibleTypes=new Set(ACTIVE.typeOrder.filter(t=>t!=="Room"));
  state.visibleLabels=Object.fromEntries(ACTIVE.typeOrder.map(t=>[t, t==="Room"]));
  buildAll(); render();
  markDirty();
  pushHistory();
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

  buildAll(); render();
  markDirty();
  pushHistory();
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
  buildAll(); render();
  markDirty();
  pushHistory();
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
    buildAll(); render();
    markDirty();
    pushHistory();
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
  buildAll(); render();
  markDirty();
  pushHistory();
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
// File extension / MIME map per exporter id
const EXPORTER_FILE_META={
  json:{ext:"sf-plan.json", mime:"application/json"},
  text:{ext:"sf-plan.txt",  mime:"text/plain"},
  svg: {ext:"sf-plan.svg",  mime:"image/svg+xml"},
  dxf: {ext:"sf-plan.dxf",  mime:"application/dxf"},
  logo:{ext:"sf-plan.logo.txt", mime:"text/plain"}
};
function exportAll(){
  const fmt=document.getElementById("exportFormat")?.value || "json";
  const visibleOnly=!!document.getElementById("exportVisibleOnly")?.checked;
  const exp=EXPORTERS.find(e=>e.id===fmt) || EXPORTERS[0];
  if(!exp){ alert("No exporters registered."); return; }
  const ctx={APP,ACTIVE,HOUSE,state,helpers:{clamp,roundHalf,formatFeetInches,normalizeRectAbs,normalizeRectRelToRoomPrimary,itemAbsRect,markerAbsPos}};
  let out="";
  try{ out=exp.export(ctx,{visibleOnly}) ?? ""; } catch(e){ alert(`Export failed: ${e?.message||e}`); return; }
  // Build a safe filename from the active structure name
  const structName=(ACTIVE?.name||"structure").replace(/[^a-zA-Z0-9_\-]/g,"_");
  const meta=EXPORTER_FILE_META[fmt]||{ext:`sf-plan.${fmt}`,mime:"text/plain"};
  const filename=`${structName}.${meta.ext}`;
  const blob=new Blob([out],{type:meta.mime});
  const blobUrl=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=blobUrl; a.download=filename;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(blobUrl); a.remove(); },1500);
  _setExportImportHint(`Saved: ${filename}`,4000);
}
function importAll(){
  // Trigger the hidden file picker
  document.getElementById("importFileInput").click();
}
function importFromFile(file){
  if(!file) return;
  const reader=new FileReader();
  reader.onload=function(ev){
    const raw=ev.target.result; if(!raw.trim()) return;
    let parsed; try{parsed=JSON.parse(raw);}catch{ alert("Invalid JSON – not a valid .sf-plan.json file."); return; }
    // Strip export-only metadata before hydrating
    const {application:_a, url:_u, dateTime:_d, ...rest}=parsed;
    if(!rest||!Array.isArray(rest.structures)||rest.structures.length===0){ alert("Invalid payload: expected {structures:[...]}"); return; }
    APP=hydrateApp(rest); if(!APP.activeId) APP.activeId=APP.structures[0].id; setActiveStructure(APP.activeId);
    _setExportImportHint(`Opened: ${file.name}`,4000);
  };
  reader.readAsText(file);
}
function _setExportImportHint(msg,ms){
  const h=document.getElementById("exportImportHint"); if(!h) return;
  h.textContent=msg; clearTimeout(h._t); h._t=setTimeout(()=>{ h.textContent=""; },ms);
}

function computeFloorBoundsIn(floor){
  // Bounds are used for rendering the SVG viewport. Keep a consistent padding
  // around the structure, but do NOT let absolute placement offsets inflate
  // the displayed width/height in the floor title bar.
  const padIn=20;
  let minX=0, minY=0, maxX=0, maxY=0;
  let has=false;
  for(const r of (floor.rooms||[])){
    const rr=normalizeRectAbs(r);
    const x1=rr.xIn, y1=rr.yIn;
    const x2=rr.xIn+rr.wIn, y2=rr.yIn+rr.hIn;
    if(!has){ minX=x1; minY=y1; maxX=x2; maxY=y2; has=true; }
    else {
      minX=Math.min(minX,x1); minY=Math.min(minY,y1);
      maxX=Math.max(maxX,x2); maxY=Math.max(maxY,y2);
    }
  }
  const spanW=has ? Math.max(0, maxX-minX) : 0;
  const spanH=has ? Math.max(0, maxY-minY) : 0;
  return {
    // Render-space width/height (includes padding and shifts negatives into view)
    width: spanW + padIn*2,
    height: spanH + padIn*2,
    // Render-space offsets (inches) applied to all draw coordinates
    offsetXIn: has ? (-minX + padIn) : padIn,
    offsetYIn: has ? (-minY + padIn) : padIn,
    // Structure span (no padding, no placement offset)
    spanW,
    spanH
  };
}

function computeHouseViewportIn(floors){
  const padIn=20;
  let maxSpanW=0, maxSpanH=0;
  for(const f of (floors||[])){
    const b=computeFloorBoundsIn(f);
    maxSpanW=Math.max(maxSpanW, b.spanW||0);
    maxSpanH=Math.max(maxSpanH, b.spanH||0);
  }
  return {
    padIn,
    width: maxSpanW + padIn*2,
    height: maxSpanH + padIn*2
  };
}

function svgPoint(svg,clientX,clientY){
  const pt=svg.createSVGPoint(); pt.x=clientX; pt.y=clientY;
  const ctm=svg.getScreenCTM(); return ctm?pt.matrixTransform(ctm.inverse()):{x:0,y:0};
}

// Find the currently-live SVG element for the active drag floor.
// render() destroys and recreates all SVGs, so we must query the DOM
// each time rather than holding a stale reference.
function findDragSvg(){
  if(!drag.floorId) return null;
  return document.querySelector(`svg.floorSvg[data-floor-id="${drag.floorId}"]`);
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

function zoomToFit(){
  const wrap=document.getElementById("canvasWrap");
  if(!wrap) return;
  // Reset view first so we measure the untransformed layout
  state.view.scale=1; state.view.tx=0; state.view.ty=0;
  render();
  requestAnimationFrame(()=>{
    const inner=document.getElementById("canvasInner");
    if(!inner) return;
    const wr=wrap.getBoundingClientRect();
    const ir=inner.getBoundingClientRect();
    const availW=Math.max(1, wr.width - ZOOM_TO_FIT_PAD_PX);
    const availH=Math.max(1, wr.height - ZOOM_TO_FIT_PAD_PX);
    const s=clamp(Math.min(availW/Math.max(1,ir.width), availH/Math.max(1,ir.height)), ZOOM_MIN, ZOOM_MAX);
    state.view.scale=s;
    state.view.tx=(wr.width - ir.width*s)/2;
    state.view.ty=(wr.height - ir.height*s)/2;
    render();
  });
}

function zoomToSelection(){
  const wrap=document.getElementById("canvasWrap");
  if(!wrap || !state.selected) return;
  // Reset view first so we can measure reliably
  state.view.scale=1; state.view.tx=0; state.view.ty=0;
  render();
  requestAnimationFrame(()=>{
    const inner=document.getElementById("canvasInner");
    if(!inner) return;
    const target=document.querySelector(".selected-stroke");
    if(!target) return;

    const wr=wrap.getBoundingClientRect();
    const ir=inner.getBoundingClientRect();
    const br=target.getBoundingClientRect();

    const availW=Math.max(1, wr.width - ZOOM_TO_FIT_PAD_PX);
    const availH=Math.max(1, wr.height - ZOOM_TO_FIT_PAD_PX);
    const s=clamp(Math.min(availW/Math.max(1,br.width), availH/Math.max(1,br.height)), ZOOM_MIN, ZOOM_MAX);

    const cx=((br.left+br.right)/2) - ir.left;
    const cy=((br.top+br.bottom)/2) - ir.top;
    state.view.scale=s;
    state.view.tx=(wr.width/2) - (cx*s);
    state.view.ty=(wr.height/2) - (cy*s);
    render();
  });
}

function zoomToFitWidth(){
  const wrap=document.getElementById("canvasWrap");
  if(!wrap) return;
  state.view.scale=1; state.view.tx=0; state.view.ty=0;
  render();
  requestAnimationFrame(()=>{
    const inner=document.getElementById("canvasInner");
    if(!inner) return;
    const wr=wrap.getBoundingClientRect();
    const ir=inner.getBoundingClientRect();
    const availW=Math.max(1, wr.width - ZOOM_TO_FIT_PAD_PX);
    const s=clamp(availW/Math.max(1,ir.width), ZOOM_MIN, ZOOM_MAX);
    state.view.scale=s;
    state.view.tx=(wr.width - ir.width*s)/2;
    state.view.ty=ZOOM_TO_FIT_PAD_PX/2;
    render();
  });
}

function zoomToFitHeight(){
  const wrap=document.getElementById("canvasWrap");
  if(!wrap) return;
  state.view.scale=1; state.view.tx=0; state.view.ty=0;
  render();
  requestAnimationFrame(()=>{
    const inner=document.getElementById("canvasInner");
    if(!inner) return;
    const wr=wrap.getBoundingClientRect();
    const ir=inner.getBoundingClientRect();
    const availH=Math.max(1, wr.height - ZOOM_TO_FIT_PAD_PX);
    const s=clamp(availH/Math.max(1,ir.height), ZOOM_MIN, ZOOM_MAX);
    state.view.scale=s;
    state.view.tx=ZOOM_TO_FIT_PAD_PX/2;
    state.view.ty=(wr.height - ir.height*s)/2;
    render();
  });
}

function buildGridGroup(widthPx,heightPx,oxIn,oyIn){
  const minorIn=Number(state.grid.minorStep||0);
  if(!(minorIn>0)) return null;
  const majorMul=gridMajorMultiple(minorIn);
  const majorIn=minorIn*majorMul;

  const minorStepPx=inToPx(minorIn);
  const majorStepPx=inToPx(majorIn);
  if(!(minorStepPx>0) || !(majorStepPx>0)) return null;

  const oxPx=inToPx(oxIn||0);
  const oyPx=inToPx(oyIn||0);
  const x0Minor=((oxPx%minorStepPx)+minorStepPx)%minorStepPx;
  const y0Minor=((oyPx%minorStepPx)+minorStepPx)%minorStepPx;
  const x0Major=((oxPx%majorStepPx)+majorStepPx)%majorStepPx;
  const y0Major=((oyPx%majorStepPx)+majorStepPx)%majorStepPx;

  const g=document.createElementNS("http://www.w3.org/2000/svg","g");
  g.setAttribute("class","gridLayer");
  const minorColor=state.grid.minorColor||"#ffffff";
  const majorColor=state.grid.majorColor||"#ffffff";
  const minorOpacity=clamp(Number(state.grid.minorOpacity),0,1);
  const majorOpacity=clamp(Number(state.grid.majorOpacity),0,1);

  const addLine=(x1,y1,x2,y2,color,op)=>{
    const ln=document.createElementNS("http://www.w3.org/2000/svg","line");
    ln.setAttribute("x1",x1); ln.setAttribute("y1",y1);
    ln.setAttribute("x2",x2); ln.setAttribute("y2",y2);
    ln.setAttribute("stroke",color);
    ln.setAttribute("stroke-opacity",String(op));
    ln.setAttribute("stroke-width","1");
    g.appendChild(ln);
  };
  const addDot=(x,y,r,color,op)=>{
    const c=document.createElementNS("http://www.w3.org/2000/svg","circle");
    c.setAttribute("cx",x); c.setAttribute("cy",y);
    c.setAttribute("r",r);
    c.setAttribute("fill",color);
    c.setAttribute("fill-opacity",String(op));
    g.appendChild(c);
  };

  if(state.grid.style==="dot"){
    const rMinor=1;
    const rMajor=1.6;

    // Major dots (always)
    for(let x=x0Major; x<=widthPx+0.001; x+=majorStepPx){
      for(let y=y0Major; y<=heightPx+0.001; y+=majorStepPx){
        addDot(x,y,rMajor,majorColor,majorOpacity);
      }
    }

    // Minor dots (optional)
    if(state.grid.showMinor){
      for(let x=x0Minor; x<=widthPx+0.001; x+=minorStepPx){
        for(let y=y0Minor; y<=heightPx+0.001; y+=minorStepPx){
          // Skip dots that land exactly on a major intersection
          const isMajorX=Math.abs(((x-x0Major)%majorStepPx+majorStepPx)%majorStepPx) < 0.001;
          const isMajorY=Math.abs(((y-y0Major)%majorStepPx+majorStepPx)%majorStepPx) < 0.001;
          if(isMajorX && isMajorY) continue;
          addDot(x,y,rMinor,minorColor,minorOpacity);
        }
      }
    }
  } else {
    // Major lines (always)
    for(let x=x0Major; x<=widthPx+0.001; x+=majorStepPx) addLine(x,0,x,heightPx,majorColor,majorOpacity);
    for(let y=y0Major; y<=heightPx+0.001; y+=majorStepPx) addLine(0,y,widthPx,y,majorColor,majorOpacity);

    // Minor lines (optional)
    if(state.grid.showMinor){
      for(let x=x0Minor; x<=widthPx+0.001; x+=minorStepPx){
        const isMajor=Math.abs(((x-x0Major)%majorStepPx+majorStepPx)%majorStepPx) < 0.001;
        if(isMajor) continue;
        addLine(x,0,x,heightPx,minorColor,minorOpacity);
      }
      for(let y=y0Minor; y<=heightPx+0.001; y+=minorStepPx){
        const isMajor=Math.abs(((y-y0Major)%majorStepPx+majorStepPx)%majorStepPx) < 0.001;
        if(isMajor) continue;
        addLine(0,y,widthPx,y,minorColor,minorOpacity);
      }
    }
  }
  return g;
}

function render(){
  renderCounts();
  const wrap=document.getElementById("canvasWrap");
  wrap.innerHTML="";
  const inner=document.createElement("div"); inner.id="canvasInner";
  inner.style.transform=`translate(${state.view.tx}px, ${state.view.ty}px) scale(${state.view.scale})`;
  inner.style.transformOrigin="0 0";

  const viewport=computeHouseViewportIn(HOUSE.floors);
  const vpWidthPx=inToPx(viewport.width);
  const vpHeightPx=inToPx(viewport.height);

  for(const floor of HOUSE.floors){
    if(!state.visibleFloors.has(floor.id)) continue;
    const bounds=computeFloorBoundsIn(floor);
    const ox=bounds.offsetXIn||0, oy=bounds.offsetYIn||0;
    const fx=(xIn)=>inToPx((xIn||0)+ox);
    const fy=(yIn)=>inToPx((yIn||0)+oy);
    const widthPx=vpWidthPx, heightPx=vpHeightPx;

    const block=document.createElement("div"); block.className="floorBlock";
    const header=document.createElement("div"); header.className="floorHeader";
    const totals=floorTotals(floor);
    header.innerHTML=`<div class="floorName">${escapeXml(floor.name)}</div><div class="meta">${escapeXml(formatLinear(bounds.spanW ?? bounds.width))} × ${escapeXml(formatLinear(bounds.spanH ?? bounds.height))} · Area ${escapeXml(formatSqFt(totals.areaIn2))} ft² · Perim ${escapeXml(formatLinear(totals.perimIn))}</div>`;

    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.classList.add("floorSvg");
    svg.dataset.floorId=floor.id;
    svg.setAttribute("viewBox",`0 0 ${widthPx} ${heightPx}`);
    svg.setAttribute("width",widthPx); svg.setAttribute("height",heightPx);

    // Grid (configurable layer)
    const gridGroup = state.grid.mode==="off" ? null : buildGridGroup(widthPx,heightPx,ox,oy);
    if(gridGroup && state.grid.mode==="under") svg.appendChild(gridGroup);
    // Label group — appended last so labels always render above all objects
    const labelGroup=document.createElementNS("http://www.w3.org/2000/svg","g");
    labelGroup.setAttribute("class","labelLayer");

    // Rooms
    for(const room of floor.rooms){
      applyDefaultsToObj(room);
      const rr=normalizeRectAbs(room);
      const x=fx(rr.xIn), y=fy(rr.yIn), w=inToPx(rr.wIn), h=inToPx(rr.hIn);
      const st=ACTIVE.types.Room;
      const g=document.createElementNS("http://www.w3.org/2000/svg","g");
      const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
      rect.setAttribute("x",x); rect.setAttribute("y",y); rect.setAttribute("width",w); rect.setAttribute("height",h);
      rect.setAttribute("fill",room.fillColor||st.defaultFillColor);
      rect.setAttribute("fill-opacity", String(room.fillAlpha ?? st.defaultFillAlpha ?? 1));
      rect.setAttribute("stroke",room.lineColor||st.defaultLineColor);
      rect.setAttribute("stroke-width",st.strokeWidth);
      rect.classList.add("selectable");
      const roomSelected=state.selected?.kind==="room" && state.selected.roomId===room.id;
      if(roomSelected) rect.classList.add("selected-stroke");

      const markerSize=clamp(inToPx(4),6,18);
      const mpos=markerAbsPos(rr, room, room.corner);
      const marker=document.createElementNS("http://www.w3.org/2000/svg","rect");
      marker.setAttribute("x",fx(mpos.xIn)-markerSize/2);
      marker.setAttribute("y",fy(mpos.yIn)-markerSize/2);
      marker.setAttribute("width",markerSize); marker.setAttribute("height",markerSize);
      marker.setAttribute("fill",room.cornerColor||st.defaultCornerColor);
      marker.setAttribute("stroke","rgba(0,0,0,0.45)"); marker.setAttribute("stroke-width",1);
      marker.classList.add("selectable");

      const onClick=(ev)=>{ev.stopPropagation(); setSelected({kind:"room", floorId:floor.id, roomId:room.id}); populateNewItemSelectors();};
      const onDown=(ev)=>{if(ev.button!==0) return; ev.preventDefault(); ev.stopPropagation(); onClick(ev);
        drag.active=true; drag.kind="room"; drag.floorId=floor.id; drag.roomId=room.id; drag.itemId=null;
        drag.startClientX=ev.clientX; drag.startClientY=ev.clientY; drag.startNW={xIn:rr.xIn,yIn:rr.yIn};
        drag.preState=JSON.parse(JSON.stringify(HOUSE)); drag.preSelected=state.selected?JSON.parse(JSON.stringify(state.selected)):null; drag.moved=false; };
      const beginRoomResize=(handleCorner,ev)=>{if(ev.button!==0) return; ev.preventDefault(); ev.stopPropagation(); onClick(ev);
        drag.active=true; drag.kind="room-resize"; drag.floorId=floor.id; drag.roomId=room.id; drag.itemId=null;
        drag.startClientX=ev.clientX; drag.startClientY=ev.clientY;
        const rnw=normalizeRectAbs(room);
        const moving=markerAbsPos(rnw, room, handleCorner);
        const opp=oppositeCorner(handleCorner);
        const fixed=markerAbsPos(rnw, room, opp);
        drag.startRect={nw:rnw, wIn:room.wIn, hIn:room.hIn, corner:handleCorner, moving, fixed}; drag.fixedPt=fixed;
        drag.preState=JSON.parse(JSON.stringify(HOUSE)); drag.preSelected=state.selected?JSON.parse(JSON.stringify(state.selected)):null; drag.moved=false;
      };
      rect.addEventListener("click",onClick); marker.addEventListener("click",onClick);
      rect.addEventListener("mousedown",onDown);

      g.appendChild(rect); g.appendChild(marker);
      if(roomSelected){
        const beginRoomEdgeResize=(edge,ev)=>{if(ev.button!==0) return; ev.preventDefault(); ev.stopPropagation(); onClick(ev);
          drag.active=true; drag.kind="room-edge-resize"; drag.floorId=floor.id; drag.roomId=room.id; drag.itemId=null;
          drag.startClientX=ev.clientX; drag.startClientY=ev.clientY;
          drag.startRect={xIn:rr.xIn,yIn:rr.yIn,wIn:room.wIn,hIn:room.hIn,edge};
          drag.preState=JSON.parse(JSON.stringify(HOUSE)); drag.preSelected=state.selected?JSON.parse(JSON.stringify(state.selected)):null; drag.moved=false;
        };
        const edgePad=markerSize*1.4;
        const mkEdge=(edge,x1,y1,x2,y2)=>{
          const e=document.createElementNS("http://www.w3.org/2000/svg","line");
          e.setAttribute("x1",x1); e.setAttribute("y1",y1); e.setAttribute("x2",x2); e.setAttribute("y2",y2);
          e.setAttribute("stroke","rgba(255,255,255,0.001)");
          e.setAttribute("stroke-width",edgePad);
          e.classList.add("selectable");
          e.style.cursor=cursorForEdge(edge);
          e.addEventListener("click",onClick);
          e.addEventListener("mousedown",(ev)=>beginRoomEdgeResize(edge,ev));
          g.appendChild(e);
        };
        mkEdge("N",x,y,x+w,y);
        mkEdge("S",x,y+h,x+w,y+h);
        mkEdge("W",x,y,x,y+h);
        mkEdge("E",x+w,y,x+w,y+h);
      }

      if(roomSelected){
        for(const handleCorner of RESIZE_CORNERS){
          const hpos=markerAbsPos(rr, room, handleCorner);
          const handle=document.createElementNS("http://www.w3.org/2000/svg","rect");
          handle.setAttribute("x",fx(hpos.xIn)-markerSize/2);
          handle.setAttribute("y",fy(hpos.yIn)-markerSize/2);
          handle.setAttribute("width",markerSize); handle.setAttribute("height",markerSize);
          handle.setAttribute("fill","#ffffff");
          handle.setAttribute("stroke",room.lineColor||st.defaultLineColor);
          handle.setAttribute("stroke-width",1.5);
          handle.classList.add("selectable");
          handle.style.cursor=cursorForCorner(handleCorner);
          handle.addEventListener("click",onClick);
          handle.addEventListener("mousedown",(ev)=>beginRoomResize(handleCorner,ev));
          g.appendChild(handle);
        }
      }

      if(isLabelVisible("Room") && room.name){
        const t=document.createElementNS("http://www.w3.org/2000/svg","text");
        t.setAttribute("x",x+w/2); t.setAttribute("y",y+h/2); t.setAttribute("class","roomLabel");
        const t1=document.createElementNS("http://www.w3.org/2000/svg","tspan"); t1.setAttribute("x",x+w/2); t1.textContent=room.name;
        const t2=document.createElementNS("http://www.w3.org/2000/svg","tspan"); t2.setAttribute("x",x+w/2); t2.setAttribute("dy","14");
        t2.textContent=`(${formatLinear(room.wIn)} × ${formatLinear(room.hIn)})`;
        t.appendChild(t1); t.appendChild(t2);
        labelGroup.appendChild(t);
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
          const x=fx(abs.xIn), y=fy(abs.yIn), w=inToPx(abs.wIn), h=inToPx(abs.hIn);
          const st=ACTIVE.types[type];

          const g=document.createElementNS("http://www.w3.org/2000/svg","g");
          const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
          rect.setAttribute("x",x); rect.setAttribute("y",y); rect.setAttribute("width",w); rect.setAttribute("height",h);
          rect.setAttribute("fill",it.fillColor||st.defaultFillColor);
          rect.setAttribute("fill-opacity", String(it.fillAlpha ?? st.defaultFillAlpha ?? 1));
          rect.setAttribute("stroke",it.lineColor||st.defaultLineColor);
          rect.setAttribute("stroke-width",st.strokeWidth);
          rect.classList.add("selectable");
          const itemSelected=state.selected?.kind==="item" && state.selected.itemId===it.id;
          if(itemSelected) rect.classList.add("selected-stroke");

          const markerSize=clamp(inToPx(4),6,18);
          const mpos=markerAbsPos(abs, it, it.corner);
          const marker=document.createElementNS("http://www.w3.org/2000/svg","rect");
          marker.setAttribute("x",fx(mpos.xIn)-markerSize/2);
          marker.setAttribute("y",fy(mpos.yIn)-markerSize/2);
          marker.setAttribute("width",markerSize); marker.setAttribute("height",markerSize);
          marker.setAttribute("fill",it.cornerColor||st.defaultCornerColor);
          marker.setAttribute("stroke","rgba(0,0,0,0.45)"); marker.setAttribute("stroke-width",1);
          marker.classList.add("selectable");

          const onClick=(ev)=>{ev.stopPropagation(); setSelected({kind:"item", floorId:floor.id, roomId:room.id, itemId:it.id}); populateNewItemSelectors();};
          const onDown=(ev)=>{if(ev.button!==0) return; ev.preventDefault(); ev.stopPropagation(); onClick(ev);
            drag.active=true; drag.kind="item"; drag.floorId=floor.id; drag.roomId=room.id; drag.itemId=it.id;
            drag.startClientX=ev.clientX; drag.startClientY=ev.clientY;
            const rel=normalizeRectRelToRoomPrimary(it, room);
            drag.startNW={xIn:rel.xIn,yIn:rel.yIn};
            drag.preState=JSON.parse(JSON.stringify(HOUSE)); drag.preSelected=state.selected?JSON.parse(JSON.stringify(state.selected)):null; drag.moved=false; };
          const beginItemResize=(handleCorner,ev)=>{if(ev.button!==0) return; ev.preventDefault(); ev.stopPropagation(); onClick(ev);
            drag.active=true; drag.kind="item-resize"; drag.floorId=floor.id; drag.roomId=room.id; drag.itemId=it.id;
            drag.startClientX=ev.clientX; drag.startClientY=ev.clientY;
            const moving=markerAbsPos(abs, it, handleCorner);
            const opp=oppositeCorner(handleCorner);
            const fixed=markerAbsPos(abs, it, opp);
            drag.startRect={wIn:it.wIn, hIn:it.hIn, corner:handleCorner, moving, fixed}; drag.fixedPt=fixed;
            drag.preState=JSON.parse(JSON.stringify(HOUSE)); drag.preSelected=state.selected?JSON.parse(JSON.stringify(state.selected)):null; drag.moved=false;
          };
          rect.addEventListener("click",onClick); marker.addEventListener("click",onClick);
          rect.addEventListener("mousedown",onDown);

          g.appendChild(rect); g.appendChild(marker);
          if(itemSelected){
            const beginItemEdgeResize=(edge,ev)=>{if(ev.button!==0) return; ev.preventDefault(); ev.stopPropagation(); onClick(ev);
              drag.active=true; drag.kind="item-edge-resize"; drag.floorId=floor.id; drag.roomId=room.id; drag.itemId=it.id;
              drag.startClientX=ev.clientX; drag.startClientY=ev.clientY;
              drag.startRect={xIn:abs.xIn,yIn:abs.yIn,wIn:it.wIn,hIn:it.hIn,edge};
              drag.preState=JSON.parse(JSON.stringify(HOUSE)); drag.preSelected=state.selected?JSON.parse(JSON.stringify(state.selected)):null; drag.moved=false;
            };
            const edgePad=markerSize*1.4;
            const mkEdge=(edge,x1,y1,x2,y2)=>{
              const e=document.createElementNS("http://www.w3.org/2000/svg","line");
              e.setAttribute("x1",x1); e.setAttribute("y1",y1); e.setAttribute("x2",x2); e.setAttribute("y2",y2);
              e.setAttribute("stroke","rgba(255,255,255,0.001)");
              e.setAttribute("stroke-width",edgePad);
              e.classList.add("selectable");
              e.style.cursor=cursorForEdge(edge);
              e.addEventListener("click",onClick);
              e.addEventListener("mousedown",(ev)=>beginItemEdgeResize(edge,ev));
              g.appendChild(e);
            };
            mkEdge("N",x,y,x+w,y);
            mkEdge("S",x,y+h,x+w,y+h);
            mkEdge("W",x,y,x,y+h);
            mkEdge("E",x+w,y,x+w,y+h);
          }

          if(itemSelected){
            for(const handleCorner of RESIZE_CORNERS){
              const hpos=markerAbsPos(abs, it, handleCorner);
              const handle=document.createElementNS("http://www.w3.org/2000/svg","rect");
              handle.setAttribute("x",fx(hpos.xIn)-markerSize/2);
              handle.setAttribute("y",fy(hpos.yIn)-markerSize/2);
              handle.setAttribute("width",markerSize); handle.setAttribute("height",markerSize);
              handle.setAttribute("fill","#ffffff");
              handle.setAttribute("stroke",it.lineColor||st.defaultLineColor);
              handle.setAttribute("stroke-width",1.5);
              handle.classList.add("selectable");
              handle.style.cursor=cursorForCorner(handleCorner);
              handle.addEventListener("click",onClick);
              handle.addEventListener("mousedown",(ev)=>beginItemResize(handleCorner,ev));
              g.appendChild(handle);
            }
          }

          if(isLabelVisible(type) && it.name){
            const t=document.createElementNS("http://www.w3.org/2000/svg","text");
            t.setAttribute("x",x+w+inToPx(3)); t.setAttribute("y",y); t.setAttribute("class","itemLabel");
            const t1=document.createElementNS("http://www.w3.org/2000/svg","tspan"); t1.setAttribute("x",x+w+inToPx(3)); t1.textContent=it.name;
            const t2=document.createElementNS("http://www.w3.org/2000/svg","tspan"); t2.setAttribute("x",x+w+inToPx(3)); t2.setAttribute("dy","13");
            t2.textContent=`(${formatLinear(it.wIn)} × ${formatLinear(it.hIn)})`;
            t.appendChild(t1); t.appendChild(t2);
            labelGroup.appendChild(t);
          }
          svg.appendChild(g);
        }
      }
    }

    if(gridGroup && state.grid.mode==="over") svg.appendChild(gridGroup);
    svg.addEventListener("click",()=>setSelected(null));
    svg.appendChild(labelGroup);
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
  syncViewPanelUI();
}

function rebuildGridSizeOptions(){
  const sel=document.getElementById("gridSize");
  if(!sel) return;
  const opts=gridOptions();
  sel.innerHTML="";
  for(const o of opts){
    const op=document.createElement("option");
    op.value=String(o.v);
    op.textContent=o.label;
    sel.appendChild(op);
  }
  // Ensure current selection is valid
  const values=opts.map(o=>o.v);
  if(!values.includes(Number(state.grid.minorStep))) state.grid.minorStep=values[0]||DEFAULT_UI.grid.minorStep;
  sel.value=String(state.grid.minorStep);
}

function syncViewPanelUI(){
  const ppi=document.getElementById("ppi");
  const ppiValue=document.getElementById("ppiValue");
  if(ppi){ ppi.value=String(state.ppi); }
  if(ppiValue){ ppiValue.textContent=String(state.ppi); }
  const uImp=document.getElementById("unitsImperial");
  const uMet=document.getElementById("unitsMetric");
  if(uImp) uImp.checked = state.units==="imperial";
  if(uMet) uMet.checked = state.units==="metric";
  const gmSel=document.getElementById("gridMode");
  if(gmSel) gmSel.value=state.grid.mode||"off";
  const gs=document.getElementById("gridStyle");
  if(gs) gs.value=state.grid.style;
  rebuildGridSizeOptions();
  const gm=document.getElementById("gridShowMinor");
  if(gm) gm.checked=!!state.grid.showMinor;
  const gmc=document.getElementById("gridMinorColor");
  const gmcPick=document.getElementById("gridMinorColorPicker");
  if(gmc) gmc.value=state.grid.minorColor||"#ffffff";
  const gmcHex=cssColorToHex(state.grid.minorColor||"#ffffff");
  if(gmcPick && gmcHex) gmcPick.value=gmcHex;
  const gMaj=document.getElementById("gridMajorColor");
  const gMajPick=document.getElementById("gridMajorColorPicker");
  if(gMaj) gMaj.value=state.grid.majorColor||"#ffffff";
  const gMajHex=cssColorToHex(state.grid.majorColor||"#ffffff");
  if(gMajPick && gMajHex) gMajPick.value=gMajHex;
  const gmo=document.getElementById("gridMinorOpacity");
  if(gmo) gmo.value=String(state.grid.minorOpacity ?? DEFAULT_UI.grid.minorOpacity);
  const gMajo=document.getElementById("gridMajorOpacity");
  if(gMajo) gMajo.value=String(state.grid.majorOpacity ?? DEFAULT_UI.grid.majorOpacity);
  const gsnap=document.getElementById("gridSnapEnabled");
  if(gsnap) gsnap.checked=!!state.grid.snapEnabled;
}

function cycleGridSize(dir){
  const opts=gridOptions().map(o=>o.v);
  if(!opts.length) return;
  const cur=Number(state.grid.minorStep);
  let idx=opts.indexOf(cur);
  if(idx<0){
    // choose closest
    let best=0, bestD=Infinity;
    for(let i=0;i<opts.length;i++){ const d=Math.abs(opts[i]-cur); if(d<bestD){bestD=d; best=i;} }
    idx=best;
  }
  idx=clamp(idx+dir,0,opts.length-1);
  state.grid.minorStep=opts[idx];
  syncViewPanelUI();
  render();
  _commitViewConfiguration();
}

function wire(){
  document.getElementById("navToggle").addEventListener("click",(e)=>{e.preventDefault(); document.body.classList.toggle("navCollapsed");});
  const ppi=document.getElementById("ppi"); const ppiValue=document.getElementById("ppiValue");
  ppi.addEventListener("input",()=>{state.ppi=parseInt(ppi.value,10); ppiValue.textContent=String(state.ppi); render(); _commitViewConfiguration();});

  // ── Units (label mode only) ───────────────────────────────────────────
  const uImp=document.getElementById("unitsImperial");
  const uMet=document.getElementById("unitsMetric");
  function applyUnits(u){
    state.units=u;
    // Rebuild labels that contain unit text and refresh grid options
    rebuildGridSizeOptions();
    buildSelectedForm();
    buildConfigForm();
    render();
    _commitViewConfiguration();
  }
  uImp?.addEventListener("change",()=>{ if(uImp.checked) applyUnits("imperial"); });
  uMet?.addEventListener("change",()=>{ if(uMet.checked) applyUnits("metric"); });

  // ── Grid UI ───────────────────────────────────────────────────────────
  const applyGridMode=(mode)=>{
    state.grid.mode=["off","under","over"].includes(mode)?mode:"off";
    state.grid.enabled=state.grid.mode!=="off";
    render();
    _commitViewConfiguration();
  };
  document.getElementById("gridMode")?.addEventListener("change",(ev)=>{ applyGridMode(String(ev.target.value||"off")); });
  document.getElementById("gridStyle")?.addEventListener("change",(ev)=>{ state.grid.style=String(ev.target.value||"line"); render(); _commitViewConfiguration(); });
  document.getElementById("gridShowMinor")?.addEventListener("change",(ev)=>{ state.grid.showMinor=!!ev.target.checked; render(); _commitViewConfiguration(); });

  const wireGridColor=(textId,pickerId,key)=>{
    const txt=document.getElementById(textId);
    const pick=document.getElementById(pickerId);
    if(!txt||!pick) return;
    const read=()=>state.grid[key]||"#ffffff";
    const syncPickerFromText=()=>{ const h=cssColorToHex(txt.value); if(h) pick.value=h; };
    txt.value=read();
    syncPickerFromText();
    pick.addEventListener("input",()=>{ txt.value=pick.value.toLowerCase(); state.grid[key]=txt.value; render(); _commitViewConfiguration(); });
    txt.addEventListener("input",syncPickerFromText);
    txt.addEventListener("change",()=>{
      if(isValidCssColorToken(txt.value)){
        state.grid[key]=txt.value.trim();
        render();
        _commitViewConfiguration();
      } else {
        txt.value=read();
        syncPickerFromText();
      }
    });
  };
  wireGridColor("gridMinorColor","gridMinorColorPicker","minorColor");
  wireGridColor("gridMajorColor","gridMajorColorPicker","majorColor");
  document.getElementById("gridMinorOpacity")?.addEventListener("input",(ev)=>{ state.grid.minorOpacity=clamp(parseFloat(ev.target.value),0,1); render(); _commitViewConfiguration(); });
  document.getElementById("gridMajorOpacity")?.addEventListener("input",(ev)=>{ state.grid.majorOpacity=clamp(parseFloat(ev.target.value),0,1); render(); _commitViewConfiguration(); });
  document.getElementById("gridSnapEnabled")?.addEventListener("change",(ev)=>{ state.grid.snapEnabled=!!ev.target.checked; _commitViewConfiguration(); });
  document.getElementById("gridSize")?.addEventListener("change",(ev)=>{ state.grid.minorStep=parseFloat(ev.target.value); render(); _commitViewConfiguration(); });

  document.getElementById("viewSaveDefault")?.addEventListener("click",(e)=>{e.preventDefault(); saveViewDefaults();});
  document.getElementById("viewLoadDefault")?.addEventListener("click",(e)=>{e.preventDefault(); loadViewDefaults();});

  document.getElementById("structureSelect").addEventListener("change",(e)=>setActiveStructure(e.target.value));
  document.getElementById("structureNew").addEventListener("click",(e)=>{e.preventDefault(); newStructure();});
  document.getElementById("structureDelete").addEventListener("click",(e)=>{e.preventDefault(); deleteStructure();});
  document.getElementById("storageReset").addEventListener("click",(e)=>{e.preventDefault(); resetStorage();});

  document.getElementById("structureName")?.addEventListener("change",(e)=>{
    const v=String(e.target.value||"").trim();
    if(!v) { e.target.value=ACTIVE.name; return; }
    ACTIVE.name=v;
    buildStructureUI();
    markDirty();
  });

  // Selected edits live-commit; keep only duplicate/delete controls.
  document.getElementById("selDuplicate").addEventListener("click",(e)=>{e.preventDefault(); duplicateSelected();});
  document.getElementById("selDelete").addEventListener("click",(e)=>{e.preventDefault(); deleteSelected();});

  // Keyboard shortcuts
  document.addEventListener("keydown",(ev)=>{
    // ── Esc: abort an in-progress drag and revert ──────────────────────────
    if(ev.key==="Escape"){
      if(drag.active && drag.preState){
        ev.preventDefault();
        ACTIVE.house=JSON.parse(JSON.stringify(drag.preState));
        HOUSE=ACTIVE.house;
        drag.active=false; drag.kind=null; drag.floorId=null; drag.roomId=null; drag.itemId=null;
        drag.preState=null; drag.moved=false;
        state.selected=drag.preSelected?JSON.parse(JSON.stringify(drag.preSelected)):null;
        drag.preSelected=null;
        state.selectedSnapshot=null;
        buildAll(); render();
        markDirty();
      }
      return;
    }

    // ── Ctrl / Cmd shortcuts (undo / redo) ────────────────────────────────
    if(ev.ctrlKey||ev.metaKey){
      if(ev.key==="z"||ev.key==="Z"){ ev.preventDefault(); if(ev.shiftKey) redoHistory(); else undoHistory(); return; }
      if(ev.key==="y"||ev.key==="Y"){ ev.preventDefault(); redoHistory(); return; }
    }

    // Remaining shortcuts must not fire when focus is in a form field
    const tag=(ev.target?.tagName||"").toLowerCase();
    const editable=tag==="input"||tag==="textarea"||tag==="select"||ev.target?.isContentEditable;
    if(editable) return;

    // ── Open / Save / Print ─────────────────────────────────────────
    if(ev.ctrlKey||ev.metaKey){
      const k=String(ev.key||"");
      if(k==="o"||k==="O"){ ev.preventDefault();
        const sel=document.getElementById("exportFormat");
        if(sel && sel.value!=="json"){ sel.value="json"; sel.dispatchEvent(new Event("change")); }
        importAll();
        return;
      }
      if(k==="s"||k==="S"){ ev.preventDefault();
        const sel=document.getElementById("exportFormat");
        if(sel && sel.value!=="json"){ sel.value="json"; sel.dispatchEvent(new Event("change")); }
        exportAll();
        return;
      }
      if(k==="p"||k==="P"){ ev.preventDefault();
        document.body.classList.add("navCollapsed");
        setTimeout(()=>window.print(),0);
        return;
      }
    }

    // ── Copy / Cut / Paste ────────────────────────────────────────────────
    if(ev.ctrlKey||ev.metaKey){
      const k=String(ev.key||"");
      if(k==="c"||k==="C"||k==="Insert"){ ev.preventDefault(); copySelected(); return; }
      if(k==="x"||k==="X"){ ev.preventDefault(); cutSelected(); return; }
      if(k==="v"||k==="V"){ ev.preventDefault(); pasteClipboard(); return; }
      if(k==="d"||k==="D"){ ev.preventDefault(); duplicateSelected(); return; }
    }
    if(ev.shiftKey && ev.key==="Insert"){ ev.preventDefault(); pasteClipboard(); return; }

    // ── Zoom to Fit ───────────────────────────────────────────────────────
    if(ev.shiftKey && (ev.code==="Digit1" || ev.key==="!")){
      ev.preventDefault();
      zoomToFit();
      return;
    }

    // ── Grid shortcuts ────────────────────────────────────────────────────
    if(ev.shiftKey && (ev.key==="g"||ev.key==="G"||ev.key==="'"||ev.key==='"')){
      ev.preventDefault();
      const order=["off","under","over"];
      const cur=order.indexOf(state.grid.mode||"off");
      const next=order[(cur+1+order.length)%order.length];
      state.grid.mode=next;
      state.grid.enabled=next!=="off";
      syncViewPanelUI();
      render();
      _commitViewConfiguration();
      return;
    }
    if(ev.shiftKey && (ev.key==="="||ev.key==="+")){
      ev.preventDefault();
      cycleGridSize(1);
      return;
    }
    if(ev.shiftKey && (ev.key==="-"||ev.key==="_")){
      ev.preventDefault();
      cycleGridSize(-1);
      return;
    }

    // ── Zoom to Selection / Fit Width / Fit Height ────────────────────────
    if(ev.shiftKey && (ev.code==="Digit2" || ev.key==="@")){
      ev.preventDefault();
      zoomToSelection();
      return;
    }
    if(ev.shiftKey && (ev.code==="Digit3" || ev.key==="#")){
      ev.preventDefault();
      zoomToFitWidth();
      return;
    }
    if(ev.shiftKey && (ev.code==="Digit4" || ev.key==="$")){
      ev.preventDefault();
      zoomToFitHeight();
      return;
    }
    if(ev.shiftKey && ev.key==="n"||ev.key==="N"){ 
	  ev.preventDefault();
	  newStructure();
	  return; 
	}
	
    // ── Delete / Insert ───────────────────────────────────────────────────
    if(ev.key==="Delete"){ ev.preventDefault(); deleteSelected(); return; }
    if(ev.key==="Insert"){ ev.preventDefault(); duplicateSelected(); return; }

    // ── Arrow-key nudge ───────────────────────────────────────────────────
    const arrows=["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"];
    if(arrows.includes(ev.key)){
      if(!state.selected) return;
      ev.preventDefault();
      const step=ev.shiftKey?NUDGE_SHIFT_IN:NUDGE_NORMAL_IN;
      const dx=ev.key==="ArrowLeft"?-step:ev.key==="ArrowRight"?step:0;
      const dy=ev.key==="ArrowUp"?-step:ev.key==="ArrowDown"?step:0;
      if(state.selected.kind==="room"){
        const res=findRoom(state.selected.roomId); if(!res) return;
        const rr=normalizeRectAbs(res.room);
        setRoomFromNW(res.room, rr.xIn+dx, rr.yIn+dy);
      } else {
        const res=findItem(state.selected.itemId); if(!res) return;
        const rel=normalizeRectRelToRoomPrimary(res.item, res.room);
        setItemFromNW_Rel(res.item, res.room, rel.xIn+dx, rel.yIn+dy);
      }
      buildSelectedForm(); render();
      markDirty();
      pushHistory();
    }
  });

  document.getElementById("newFloor").addEventListener("change",()=>populateNewItemSelectors());
  document.getElementById("newType").addEventListener("change",()=>populateNewItemSelectors());
  document.getElementById("addNew").addEventListener("click",(e)=>{e.preventDefault(); addNew();});

  document.getElementById("showAllFloors").addEventListener("click",(e)=>{e.preventDefault(); state.visibleFloors=new Set(HOUSE.floors.map(f=>f.id)); buildFloorToggles(); render();});
  document.getElementById("hideAllFloors").addEventListener("click",(e)=>{e.preventDefault(); state.visibleFloors=new Set(); buildFloorToggles(); render();});
  document.getElementById("addFloor").addEventListener("click",(e)=>{e.preventDefault(); addFloor();});

  // Floors/configuration commit changes immediately; no explicit Save/Reset buttons.
  document.getElementById("addType").addEventListener("click",(e)=>{e.preventDefault(); addType();});

  document.getElementById("exportBtn").addEventListener("click",(e)=>{e.preventDefault(); saveNow(); exportAll();});
  document.getElementById("importBtn").addEventListener("click",(e)=>{e.preventDefault(); importAll();});
  // Wire hidden file input for open-file import
  document.getElementById("importFileInput").addEventListener("change",function(){
    if(this.files && this.files[0]){ importFromFile(this.files[0]); }
    this.value=""; // Reset so same file can be re-opened
  });
  // Show/hide Import button based on selected format (only JSON is importable)
  function updateImportBtnVisibility(){
    const fmt=document.getElementById("exportFormat")?.value||"json";
    const btn=document.getElementById("importBtn");
    if(btn) btn.style.display=(fmt==="json")?"":"none";
  }
  document.getElementById("exportFormat")?.addEventListener("change", updateImportBtnVisibility);
  updateImportBtnVisibility();

  initPanZoom();

  window.addEventListener("mousemove",(ev)=>{
    if(!drag.active) return;
    drag.moved=true;
    // Always query the live SVG — render() destroys and recreates the DOM each
    // frame, so any reference stored at mousedown is stale after the first RAF.
    // Using svgPoint on the *same* live element for both the start and current
    // client positions guarantees the delta is correct even when the viewBox
    // dimensions or the CSS display scale change during a drag.
    const liveSvg=findDragSvg();
    if(!liveSvg) return;
    const cur=svgPoint(liveSvg, ev.clientX, ev.clientY);
    const start=svgPoint(liveSvg, drag.startClientX, drag.startClientY);
    const snapEnabled=!!state.grid.snapEnabled !== !!ev.shiftKey;
    const dxRaw=(cur.x-start.x)/state.ppi;
    const dyRaw=(cur.y-start.y)/state.ppi;
    let dxIn=dxRaw, dyIn=dyRaw;
    if(snapEnabled && drag.startNW){
      dxIn=snapToGridIn(drag.startNW.xIn+dxRaw)-drag.startNW.xIn;
      dyIn=snapToGridIn(drag.startNW.yIn+dyRaw)-drag.startNW.yIn;
    }
    if(drag.kind==="room-resize"){
      const res=findRoom(drag.roomId); if(!res) return;
      const fixed=drag.startRect.fixed; const moving0=drag.startRect.moving;
      const moving={xIn:snapEnabled ? snapToGridIn(moving0.xIn+dxRaw) : (moving0.xIn+dxIn), yIn:snapEnabled ? snapToGridIn(moving0.yIn+dyRaw) : (moving0.yIn+dyIn)};
      const x0=Math.min(fixed.xIn, moving.xIn); const y0=Math.min(fixed.yIn, moving.yIn);
      const w=Math.max(1, Math.abs(fixed.xIn-moving.xIn)); const h=Math.max(1, Math.abs(fixed.yIn-moving.yIn));
      res.room.wIn=roundHalf(w); res.room.hIn=roundHalf(h);
      setRoomFromNW(res.room, x0, y0);
      buildSelectedForm();
    } else if(drag.kind==="room-edge-resize"){
      const res=findRoom(drag.roomId); if(!res) return;
      const sr=drag.startRect; const edge=sr.edge;
      let x=sr.xIn, y=sr.yIn, w=sr.wIn, h=sr.hIn;
      const right0=sr.xIn+sr.wIn, bot0=sr.yIn+sr.hIn;
      if(edge==="N"){
        const ny=snapEnabled ? snapToGridIn(sr.yIn+dyRaw) : (sr.yIn+dyRaw);
        y=Math.min(ny, bot0-1); h=Math.max(1, bot0-y);
      } else if(edge==="S"){
        const by=snapEnabled ? snapToGridIn(bot0+dyRaw) : (bot0+dyRaw);
        y=sr.yIn; h=Math.max(1, by-y);
      } else if(edge==="W"){
        const nx=snapEnabled ? snapToGridIn(sr.xIn+dxRaw) : (sr.xIn+dxRaw);
        x=Math.min(nx, right0-1); w=Math.max(1, right0-x);
      } else if(edge==="E"){
        const rx=snapEnabled ? snapToGridIn(right0+dxRaw) : (right0+dxRaw);
        x=sr.xIn; w=Math.max(1, rx-x);
      }
      res.room.wIn=roundHalf(w); res.room.hIn=roundHalf(h);
      setRoomFromNW(res.room, x, y);
      buildSelectedForm();
    } else if(drag.kind==="item-resize"){
      const res=findItem(drag.itemId); if(!res) return;
      const fixed=drag.startRect.fixed; const moving0=drag.startRect.moving;
      const moving={xIn:snapEnabled ? snapToGridIn(moving0.xIn+dxRaw) : (moving0.xIn+dxIn), yIn:snapEnabled ? snapToGridIn(moving0.yIn+dyRaw) : (moving0.yIn+dyIn)};
      const x0=Math.min(fixed.xIn, moving.xIn); const y0=Math.min(fixed.yIn, moving.yIn);
      const w=Math.max(1, Math.abs(fixed.xIn-moving.xIn)); const h=Math.max(1, Math.abs(fixed.yIn-moving.yIn));
      res.item.wIn=roundHalf(w); res.item.hIn=roundHalf(h);
      const roomNW=normalizeRectAbs(res.room);
      setItemFromNW_Rel(res.item, res.room, x0-roomNW.xIn, y0-roomNW.yIn);
      buildSelectedForm();
    } else if(drag.kind==="item-edge-resize"){
      const res=findItem(drag.itemId); if(!res) return;
      const sr=drag.startRect; const edge=sr.edge;
      let x=sr.xIn, y=sr.yIn, w=sr.wIn, h=sr.hIn;
      const right0=sr.xIn+sr.wIn, bot0=sr.yIn+sr.hIn;
      if(edge==="N"){
        const ny=snapEnabled ? snapToGridIn(sr.yIn+dyRaw) : (sr.yIn+dyRaw);
        y=Math.min(ny, bot0-1); h=Math.max(1, bot0-y);
      } else if(edge==="S"){
        const by=snapEnabled ? snapToGridIn(bot0+dyRaw) : (bot0+dyRaw);
        y=sr.yIn; h=Math.max(1, by-y);
      } else if(edge==="W"){
        const nx=snapEnabled ? snapToGridIn(sr.xIn+dxRaw) : (sr.xIn+dxRaw);
        x=Math.min(nx, right0-1); w=Math.max(1, right0-x);
      } else if(edge==="E"){
        const rx=snapEnabled ? snapToGridIn(right0+dxRaw) : (right0+dxRaw);
        x=sr.xIn; w=Math.max(1, rx-x);
      }
      res.item.wIn=roundHalf(w); res.item.hIn=roundHalf(h);
      const roomNW=normalizeRectAbs(res.room);
      setItemFromNW_Rel(res.item, res.room, x-roomNW.xIn, y-roomNW.yIn);
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
      requestAnimationFrame(()=>{drag.raf=false; render();});
    }
  });
  window.addEventListener("mouseup",()=>{
    if(drag.active && drag.moved && drag.kind==="item"){
      const res=findItem(drag.itemId);
      if(res){
        const abs=itemAbsRect(res.item, res.room);
        const dropTarget=findRoomOnFloorAtAbsPoint(res.floor.id, abs.xIn+abs.wIn/2, abs.yIn+abs.hIn/2, res.room.id);
        if(dropTarget) reassignItemToRoom(res.item.id, dropTarget.room.id);
      }
    }
    if(drag.active && drag.moved){ pushHistory(); }
    drag.active=false; drag.kind=null; drag.floorId=null; drag.roomId=null; drag.itemId=null;
    drag.preState=null; drag.preSelected=null; drag.moved=false;
  });
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
  if(!APP){ APP = hydrateApp(await loadSeedFromServer()); }
  APP = migrateColorsAndDefaults(APP);
  const activeId=APP.activeId || APP.structures[0].id;
  ACTIVE=APP.structures.find(s=>s.id===activeId) || APP.structures[0];
  APP.activeId=ACTIVE.id;
  HOUSE=ACTIVE.house;

  // Restore view defaults (back-compat with legacy APP.ui)
  if(!APP.defaultConfiguration){
    const ui={...DEFAULT_UI, ...(APP.ui||{})};
    APP.defaultConfiguration={
      units: (ui.units==="metric") ? "metric" : "imperial",
      scale: clamp(parseInt(ui.ppi,10)||DEFAULT_UI.ppi, 1, 10),
      showGrid: !!(ui.grid||{}).enabled,
      gridMode: (ui.grid||{}).enabled ? "under" : "off",
      showMinor: (ui.grid||{}).showMinor ?? DEFAULT_UI.grid.showMinor,
      gridSize: (ui.grid||{}).minorStep ?? DEFAULT_UI.grid.minorStep,
      gridType: (ui.grid||{}).style ?? DEFAULT_UI.grid.style,
      minorColor: (ui.grid||{}).minorColor ?? DEFAULT_UI.grid.minorColor,
      majorColor: (ui.grid||{}).majorColor ?? DEFAULT_UI.grid.majorColor,
      minorOpacity: (ui.grid||{}).minorOpacity ?? DEFAULT_UI.grid.minorOpacity,
      majorOpacity: (ui.grid||{}).majorOpacity ?? DEFAULT_UI.grid.majorOpacity,
      snapEnabled: (ui.grid||{}).snapEnabled ?? DEFAULT_UI.grid.snapEnabled
    };
  }

  _applyViewConfigurationFromActive();

  if(!ACTIVE.types) ACTIVE.types={"Room":genDefaultStyle(0)};
  if(!ACTIVE.typeOrder) ACTIVE.typeOrder=["Room",...Object.keys(ACTIVE.types).filter(t=>t!=="Room")];
  if(!ACTIVE.typeOrder.includes("Room")) ACTIVE.typeOrder.unshift("Room");
  for(const t of ACTIVE.typeOrder) ensureTypeExists(t);
  state.visibleFloors=new Set(HOUSE.floors.map(f=>f.id));
  state.visibleTypes=new Set(ACTIVE.typeOrder.filter(t=>t!=="Room"));
  state.visibleLabels=Object.fromEntries(ACTIVE.typeOrder.map(t=>[t, t==="Room"]));
  buildAll(); render();
  setStatus(state.dirty?"Storage: pending":"Storage: up to date");
  startAutoSave();
  // Seed the initial undo-history snapshot
  history.stack=[]; history.index=-1;
  pushHistory();
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
    const ns=clamp(old*factor,ZOOM_MIN,ZOOM_MAX);
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
