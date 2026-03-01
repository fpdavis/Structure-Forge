
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
  view:{scale:1,tx:0,ty:0,showRuler:false,showRulerHighlight:true}
};
const drag={active:false, kind:null, floorId:null, roomId:null, itemId:null, itemIds:null, startItems:null, startClientX:0, startClientY:0, startNW:null, startRect:null, fixedPt:null, raf:false, preState:null, preSelected:null, moved:false, skipClickSelect:false};
const pan={active:false, startX:0, startY:0, startTx:0, startTy:0};
const lasso={active:false, additive:false, bypassGroupExpand:false, startX:0, startY:0, boxEl:null, baseSelection:[]};
const contextMenu={el:null, target:null};

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
    snapEnabled: !!state.grid.snapEnabled,
    showRuler: !!state.view.showRuler,
    showRulerHighlight: !!state.view.showRulerHighlight
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
  state.view.showRuler = cfg.showRuler!=null ? !!cfg.showRuler : false;
  state.view.showRulerHighlight = cfg.showRulerHighlight!=null ? !!cfg.showRulerHighlight : true;
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
  return {strokeWidth:3, defaultLineColor:line, defaultCornerColor:line, defaultFillColor:"#ffffff", defaultFillAlpha:0.05, defaultWIn:48, defaultHIn:48, defaultHeightIn:96, defaultRotation:0}; };

function normalizeRotation(v){
  const n=Number(v);
  if(!Number.isFinite(n)) return 0;
  return clamp(n,0,360);
}

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

function applyDefaultsToObj(o){
  const st=ACTIVE.types[o.type] || (ACTIVE.types[o.type]=genDefaultStyle(Object.keys(ACTIVE.types).length));
  if(o.lineColor==null) o.lineColor=st.defaultLineColor;
  if(o.cornerColor==null) o.cornerColor=st.defaultCornerColor;
  if(o.fillColor==null) o.fillColor=st.defaultFillColor;
  if(o.fillAlpha==null) o.fillAlpha=st.defaultFillAlpha;
  if(!Number.isFinite(o.strokeWidth)) o.strokeWidth=st.strokeWidth;
  if(!Number.isFinite(Number(o.rotation))) o.rotation=normalizeRotation(st.defaultRotation ?? 0);
  else o.rotation=normalizeRotation(o.rotation);
  o.locked=!!o.locked;
  if(!Number.isFinite(Number(o.zIndex))) o.zIndex=getDefaultZIndexForType(o.type);
  else o.zIndex=Math.trunc(Number(o.zIndex));
}

function getTypeDisplayOrderIndex(type, structure=ACTIVE){
  const typeOrder=Array.isArray(structure?.typeOrder)
    ? structure.typeOrder
    : ["Room", ...Object.keys(structure?.types||{}).filter(t=>t!=="Room")];
  const idx=typeOrder.indexOf(type);
  return idx>=0 ? idx : typeOrder.length;
}

function getDefaultZIndexForType(type, structure=ACTIVE){
  return getTypeDisplayOrderIndex(type, structure);
}

function getFloorItems(floorId){
  const floor=findFloor(floorId);
  if(!floor) return [];
  const out=[];
  for(const room of floor.rooms||[]){
    for(const item of room.items||[]) out.push(item);
  }
  return out;
}

function adjustSelectedZIndex(mode){
  if(!state.selected) return false;
  if(state.selected.kind==="room"){
    const res=findRoom(state.selected.roomId); if(!res||res.room.locked) return false;
    const room=res.room;
    if(mode==="forward") room.zIndex+=1;
    else if(mode==="backward") room.zIndex-=1;
    else if(mode==="front"){
      const peers=(res.floor.rooms||[]).map(r=>Number(r.zIndex)||0);
      room.zIndex=(peers.length?Math.max(...peers):0)+1;
    } else if(mode==="back"){
      const peers=(res.floor.rooms||[]).map(r=>Number(r.zIndex)||0);
      room.zIndex=(peers.length?Math.min(...peers):0)-1;
    } else return false;
    buildSelectedForm();
    render();
    markDirty();
    pushHistory();
    return true;
  }

  const ids=getSelectedItemIds();
  if(!ids.length) return false;
  const selectedItems=[];
  let floorId=null;
  for(const id of ids){
    const res=findItem(id);
    if(!res||res.item.locked) continue;
    floorId=floorId||res.floor.id;
    if(res.floor.id!==floorId) continue;
    selectedItems.push(res.item);
  }
  if(!selectedItems.length||!floorId) return false;

  if(mode==="forward"||mode==="backward"){
    const delta=mode==="forward" ? 1 : -1;
    for(const item of selectedItems) item.zIndex+=delta;
  } else if(mode==="front"||mode==="back"){
    const peers=getFloorItems(floorId);
    const values=peers.map(i=>Number(i.zIndex)||0);
    const target=mode==="front"
      ? (values.length?Math.max(...values):0)+1
      : (values.length?Math.min(...values):0)-1;
    for(const item of selectedItems) item.zIndex=target;
  } else {
    return false;
  }
  buildSelectedForm();
  render();
  markDirty();
  pushHistory();
  return true;
}
function ensureTypeExists(type){
  if(ACTIVE.types[type]){
    if(!Number.isFinite(Number(ACTIVE.types[type].defaultRotation))) ACTIVE.types[type].defaultRotation=0;
    return;
  }
  const idx=Object.keys(ACTIVE.types).length;
  ACTIVE.types[type]=genDefaultStyle(idx);
  if(!ACTIVE.typeOrder.includes(type)) ACTIVE.typeOrder.push(type);
  state.visibleTypes.add(type);
  state.visibleLabels[type]=false;
}

function seedApp(){
  const id=guid();
  const types={
    "Room":{strokeWidth:6,defaultLineColor:"#cfd6e6",defaultCornerColor:"#55d6be",defaultFillColor:"#ffffff",defaultFillAlpha:0.03,defaultWIn:180,defaultHIn:140,defaultHeightIn:96,defaultRotation:0},
    "Door":{defaultRotation:0,strokeWidth:5,defaultLineColor:"#ffcd6a",defaultCornerColor:"#ffcd6a",defaultFillColor:"#ffcd6a",defaultFillAlpha:0.05,defaultWIn:36,defaultHIn:6,defaultHeightIn:80},
    "Window":{defaultRotation:0,strokeWidth:4,defaultLineColor:"#6aa6ff",defaultCornerColor:"#6aa6ff",defaultFillColor:"#6aa6ff",defaultFillAlpha:0.05,defaultWIn:48,defaultHIn:6,defaultHeightIn:48},
    "Opening":{defaultRotation:0,strokeWidth:4,defaultLineColor:"#c46aff",defaultCornerColor:"#c46aff",defaultFillColor:"#c46aff",defaultFillAlpha:0.05,defaultWIn:36,defaultHIn:6,defaultHeightIn:80},
    "Outlet":{defaultRotation:0,strokeWidth:3,defaultLineColor:"#6aff9f",defaultCornerColor:"#6aff9f",defaultFillColor:"#6aff9f",defaultFillAlpha:0.05,defaultWIn:6,defaultHIn:6,defaultHeightIn:18},
    "Light":{defaultRotation:0,strokeWidth:3,defaultLineColor:"#ffffff",defaultCornerColor:"#ffffff",defaultFillColor:"#ffffff",defaultFillAlpha:0.06,defaultWIn:8,defaultHIn:8,defaultHeightIn:96}
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
  state.visibleTypes=new Set(ACTIVE.typeOrder);
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
function sanitizeGroupId(v){
  if(v==null||v==="") return null;
  const n=Number(v);
  if(!Number.isInteger(n) || n<1) return null;
  return n;
}
function allItems(){
  const out=[];
  for(const floor of HOUSE.floors||[]) for(const room of floor.rooms||[]) for(const item of room.items||[]) out.push(item);
  return out;
}
function getGroupItemIds(groupId){
  const gid=sanitizeGroupId(groupId);
  if(!gid) return [];
  const ids=[];
  for(const item of allItems()) if(sanitizeGroupId(item.groupId)===gid) ids.push(item.id);
  return ids;
}
function expandSelectionByGroups(itemIds){
  const out=new Set((itemIds||[]).filter(Boolean));
  for(const id of [...out]){
    const res=findItem(id);
    const gid=sanitizeGroupId(res?.item?.groupId);
    if(!gid) continue;
    for(const groupedId of getGroupItemIds(gid)) out.add(groupedId);
  }
  return [...out];
}
function nextUnusedGroupId(){
  const used=new Set();
  for(const item of allItems()){
    const gid=sanitizeGroupId(item.groupId);
    if(gid) used.add(gid);
  }
  let next=1;
  while(used.has(next)) next++;
  return next;
}
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

function getSelectedItemIds(){
  if(state.selected?.kind!=="item") return [];
  if(Array.isArray(state.selected.itemIds) && state.selected.itemIds.length){
    return [...new Set(state.selected.itemIds)];
  }
  return state.selected.itemId ? [state.selected.itemId] : [];
}
function isMultiItemSelection(){ return getSelectedItemIds().length>1; }
function isSelectedItemId(itemId){ return getSelectedItemIds().includes(itemId); }
function setSelectedItems(itemIds, lastItemId=null, opts={}){
  const expand=opts.expandGroups!==false;
  const sourceIds=(itemIds||[]).filter(Boolean);
  const expanded=expand ? expandSelectionByGroups(sourceIds) : sourceIds;
  const uniq=[...new Set(expanded)].filter(id=>findItem(id));
  if(!uniq.length){ setSelected(null); return; }
  const last=(lastItemId && uniq.includes(lastItemId)) ? lastItemId : uniq[uniq.length-1];
  const res=findItem(last);
  if(!res){ setSelected(null); return; }
  const sel={kind:"item", floorId:res.floor.id, roomId:res.room.id, itemId:last};
  if(uniq.length>1) sel.itemIds=uniq;
  setSelected(sel);
}
function addItemToSelection(itemId, opts={}){
  const ids=getSelectedItemIds();
  if(ids.includes(itemId)) return;
  const expand=opts.expandGroups!==false;
  const addIds=expand ? expandSelectionByGroups([itemId]) : [itemId];
  setSelectedItems([...ids, ...addIds], itemId, {expandGroups:expand});
}
function toggleItemInSelection(itemId, opts={}){
  const ids=getSelectedItemIds();
  const expand=opts.expandGroups!==false;
  if(ids.includes(itemId)){
    const next=ids.filter(id=>id!==itemId);
    setSelectedItems(next, next[next.length-1]||null, {expandGroups:expand});
    return;
  }
  ids.push(itemId);
  setSelectedItems(ids, itemId, {expandGroups:expand});
}
function groupSelectedItems(){
  const ids=getSelectedItemIds();
  if(ids.length<2) return;
  const gid=nextUnusedGroupId();
  for(const id of ids){
    const res=findItem(id);
    if(res) res.item.groupId=gid;
  }
  setSelectedItems(ids, ids[ids.length-1]||null);
  buildSelectedForm();
  render();
  markDirty();
  pushHistory();
}
function ungroupSelectedItems(){
  const ids=getSelectedItemIds();
  if(!ids.length) return;
  for(const id of ids){
    const res=findItem(id);
    if(res) res.item.groupId=null;
  }
  setSelectedItems(ids, ids[ids.length-1]||null, {expandGroups:false});
  buildSelectedForm();
  render();
  markDirty();
  pushHistory();
}


function getSelectedObject(){
  if(!state.selected) return null;
  if(state.selected.kind==="room"){
    const res=findRoom(state.selected.roomId);
    return res?res.room:null;
  }
  const res=findItem(state.selected.itemId);
  return res?res.item:null;
}

function toggleSelectedLock(){
  const obj=getSelectedObject();
  if(!obj) return;
  obj.locked=!obj.locked;
  buildSelectedForm();
  render();
  markDirty();
  pushHistory();
}


// Selected edits live-commit; no explicit Save/Reset/Clear controls.

function getSelectedItemContexts(){
  const out=[];
  for(const id of getSelectedItemIds()){
    const res=findItem(id);
    if(res) out.push(res);
  }
  return out;
}

function copySelected(){
  if(!state.selected){ clipboard.kind=null; clipboard.data=null; clipboard.source={floorId:null,roomId:null}; return; }
  if(state.selected.kind==="room"){
    const res=findRoom(state.selected.roomId); if(!res) return;
    clipboard.kind="room";
    clipboard.data=JSON.parse(JSON.stringify(res.room));
    clipboard.source={floorId:res.floor.id, roomId:res.room.id};
  } else {
    const selectedItems=getSelectedItemContexts();
    if(!selectedItems.length) return;
    clipboard.kind="item";
    clipboard.data=selectedItems.map((res)=>({
      item: JSON.parse(JSON.stringify(res.item)),
      relNW: normalizeRectRelToRoomPrimary(res.item, res.room)
    }));
    clipboard.source={floorId:selectedItems[selectedItems.length-1].floor.id, roomId:selectedItems[selectedItems.length-1].room.id};
  }
}

function cutSelected(){
  if(!state.selected) return;
  copySelected();
  if(state.selected.kind==="room"){
    const res=findRoom(state.selected.roomId); if(!res) return;
    res.floor.rooms=res.floor.rooms.filter(r=>r.id!==res.room.id);
  } else {
    const ids=new Set(getSelectedItemIds());
    for(const floor of HOUSE.floors||[]) for(const room of floor.rooms||[]){
      room.items=(room.items||[]).filter(i=>!ids.has(i.id));
    }
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
    const entries=Array.isArray(clipboard.data)?clipboard.data:[clipboard.data];
    const newIds=[];
    for(const entry of entries){
      const srcItem=entry.item;
      const copy=JSON.parse(JSON.stringify(srcItem));
      copy.id=guid();
      copy.roomId=res.room.id;
      copy.name=(copy.name||copy.type)+" (Copy)";
      const origRel=entry.relNW;
      const cx=origRel.xIn+(srcItem.wIn||0)/2;
      const cy=origRel.yIn+(srcItem.hIn||0)/2;
      copy.corner="NW";
      setItemFromNW_Rel(copy, res.room, cx, cy);
      ensureTypeExists(copy.type);
      applyDefaultsToObj(copy);
      res.room.items.push(copy);
      newIds.push(copy.id);
    }
    setSelectedItems(newIds, newIds[newIds.length-1]||null);
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
    const contexts=getSelectedItemContexts();
    if(!contexts.length) return;
    const newIds=[];
    for(const res of contexts){
      const copy=JSON.parse(JSON.stringify(res.item)); copy.id=guid(); copy.name=(copy.name||copy.type)+" (Copy)"; copy.roomId=res.room.id;
      const origRel=normalizeRectRelToRoomPrimary(res.item, res.room);
      const cx=origRel.xIn+res.item.wIn/2; const cy=origRel.yIn+res.item.hIn/2;
      copy.corner="NW"; copy.xIn=cx; copy.yIn=cy;
      res.room.items.push(copy);
      newIds.push(copy.id);
    }
    setSelectedItems(newIds, newIds[newIds.length-1]||null);
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
    const ids=getSelectedItemIds();
    if(!ids.length) return;
    if(ids.length===1){
      const res=findItem(ids[0]); if(!res) return;
      if(!confirm(`Delete item "${res.item.name||res.item.type}"?`)) return;
    } else if(!confirm(`Delete ${ids.length} selected items?`)) return;
    const idSet=new Set(ids);
    for(const floor of HOUSE.floors||[]) for(const room of floor.rooms||[]){
      room.items=(room.items||[]).filter(i=>!idSet.has(i.id));
    }
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

function setupDragSort(container, onMove){
  if(container.dataset.dragSortBound==="1") return;
  container.dataset.dragSortBound="1";
  let dragId=null;
  container.addEventListener("dragstart",(ev)=>{
    const row=ev.target.closest("[data-sort-id]");
    if(!row || !container.contains(row)) return;
    if(ev.target.closest("input,button,select,textarea")){
      ev.preventDefault();
      return;
    }
    dragId=row.dataset.sortId;
    row.classList.add("isDragging");
    ev.dataTransfer.effectAllowed="move";
    ev.dataTransfer.setData("text/plain", dragId);
  });
  container.addEventListener("dragover",(ev)=>{
    const row=ev.target.closest("[data-sort-id]");
    if(!row || !dragId || row.dataset.sortId===dragId) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect="move";
  });
  container.addEventListener("drop",(ev)=>{
    const row=ev.target.closest("[data-sort-id]");
    if(!row || !dragId || row.dataset.sortId===dragId) return;
    ev.preventDefault();
    onMove(dragId,row.dataset.sortId);
    dragId=null;
  });
  container.addEventListener("dragend",()=>{
    dragId=null;
    container.querySelectorAll(".isDragging").forEach((el)=>el.classList.remove("isDragging"));
  });
}

function buildFloorToggles(){
  const wrap=document.getElementById("floorToggles"); wrap.innerHTML="";
  for(const floor of HOUSE.floors){
    const row=document.createElement("div"); row.className="floorRow";
    row.draggable=true;
    row.dataset.sortId=floor.id;
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
    const grip=document.createElement("span");
    grip.className="dragGrip";
    grip.textContent="⋮⋮";
    grip.title="Drag to reorder floors";
    row.appendChild(grip);
    row.appendChild(cb);
    row.appendChild(nameBox);
    row.appendChild(del);
    wrap.appendChild(row);
  }
  setupDragSort(wrap,(dragId,targetId)=>{
    const from=HOUSE.floors.findIndex((f)=>f.id===dragId);
    const to=HOUSE.floors.findIndex((f)=>f.id===targetId);
    if(from<0 || to<0 || from===to) return;
    const [moved]=HOUSE.floors.splice(from,1);
    HOUSE.floors.splice(to,0,moved);
    buildAll();
    render();
    markDirty();
    pushHistory();
  });
  updateFloorSummary();
}
function isTypeVisible(t){ return state.visibleTypes.has(t); }
function isLabelVisible(t){ return !!state.visibleLabels[t]; }
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

function resetConfig(){
  const seeded=seedApp().structures[0];
  ACTIVE.types=seeded.types; ACTIVE.typeOrder=seeded.typeOrder;
  state.visibleTypes=new Set(ACTIVE.typeOrder);
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
    const defRot=parseFloat(document.getElementById(`cfg_${id}_defRot`)?.value);

    if(typeof line==="string" && isValidCssColorToken(line)) st.defaultLineColor=line.trim();
    if(typeof corner==="string" && isValidCssColorToken(corner)) st.defaultCornerColor=corner.trim();
    if(typeof fill==="string" && isValidCssColorToken(fill)) st.defaultFillColor=fill.trim();
    if(Number.isFinite(width) && width>0) st.strokeWidth=width;
    if(Number.isFinite(fillAlpha)) st.defaultFillAlpha=clamp(fillAlpha,0,1);
    if(Number.isFinite(defW)) st.defaultWIn=defW;
    if(Number.isFinite(defH)) st.defaultHIn=defH;
    if(Number.isFinite(defZ)) st.defaultHeightIn=defZ;
    if(Number.isFinite(defRot)) st.defaultRotation=normalizeRotation(defRot);
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
    const r={id:guid(),type:"Room",floorId:floor.id,name:"Room",description:"",corner:"NW",xIn:20,yIn:20,wIn:st.defaultWIn??144,hIn:st.defaultHIn??120,heightIn:st.defaultHeightIn??96,rotation:normalizeRotation(st.defaultRotation??0),locked:false,items:[]};
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
  const it={id:guid(),type,roomId:res.room.id,name:type,description:"",corner:"NW",xIn:12,yIn:12,wIn:st.defaultWIn??24,hIn:st.defaultHIn??24,heightIn:st.defaultHeightIn??48,rotation:normalizeRotation(st.defaultRotation??0),locked:false};
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

function buildAll(){
  buildStructureUI();
  buildSelectedForm();
  populateNewItemSelectors();
  buildFloorToggles();
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
  const showRuler=document.getElementById("showRuler");
  if(showRuler) showRuler.checked=!!state.view.showRuler;
  const showRulerHighlight=document.getElementById("showRulerHighlight");
  if(showRulerHighlight) showRulerHighlight.checked=!!state.view.showRulerHighlight;
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
      snapEnabled: (ui.grid||{}).snapEnabled ?? DEFAULT_UI.grid.snapEnabled,
      showRuler: false,
      showRulerHighlight: true
    };
  }

  _applyViewConfigurationFromActive();

  if(!ACTIVE.types) ACTIVE.types={"Room":genDefaultStyle(0)};
  if(!ACTIVE.typeOrder) ACTIVE.typeOrder=["Room",...Object.keys(ACTIVE.types).filter(t=>t!=="Room")];
  if(!ACTIVE.typeOrder.includes("Room")) ACTIVE.typeOrder.unshift("Room");
  for(const t of ACTIVE.typeOrder) ensureTypeExists(t);
  state.visibleFloors=new Set(HOUSE.floors.map(f=>f.id));
  state.visibleTypes=new Set(ACTIVE.typeOrder);
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
