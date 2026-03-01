const STORAGE_KEY="house-layout-viewer:v6";

// Persistence
const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000;

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
      if(!Number.isFinite(Number(room.rotation))) room.rotation = normalizeRotation(td.Room?.defaultRotation ?? 0);
      else room.rotation = normalizeRotation(room.rotation);
      room.locked = !!room.locked;
      room.zIndex = Number.isFinite(Number(room.zIndex)) ? Math.trunc(Number(room.zIndex)) : getDefaultZIndexForType("Room");
      for(const item of (room.items||[])){
        if(!item.corner)  item.corner  = "NW";
        if(!item.roomId)  item.roomId  = room.id;
        if(!item.name)    item.name    = item.type;
        item.groupId=sanitizeGroupId(item.groupId);
        // Restore dimension defaults from type config
        const st=td[item.type]||{};
        if(!Number.isFinite(Number(item.rotation))) item.rotation = normalizeRotation(st.defaultRotation ?? 0);
        else item.rotation = normalizeRotation(item.rotation);
        item.locked = !!item.locked;
        item.zIndex = Number.isFinite(Number(item.zIndex)) ? Math.trunc(Number(item.zIndex)) : getDefaultZIndexForType(item.type);
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
        if(!Number.isFinite(Number(st.defaultRotation))) st.defaultRotation=0;
      }
      for(const f of s.house?.floors||[]){
        for(const r of f.rooms||[]){
          if(typeof r.fillColor==="string"){
            const m=r.fillColor.match(/^rgba\((\d+),(\d+),(\d+),([0-9.]+)\)$/i);
            if(m){ r.fillAlpha=clamp(parseFloat(m[4]),0,1); r.fillColor=rgbToHex({r:+m[1],g:+m[2],b:+m[3]}).toLowerCase(); }
          }
          if(r.fillAlpha==null) r.fillAlpha=1;
          if(!Number.isFinite(Number(r.rotation))) r.rotation=normalizeRotation((s.types?.Room||{}).defaultRotation ?? 0); else r.rotation=normalizeRotation(r.rotation);
          r.locked=!!r.locked;
          r.zIndex=Number.isFinite(Number(r.zIndex)) ? Math.trunc(Number(r.zIndex)) : getDefaultZIndexForType("Room");
          for(const it of r.items||[]){
            if(typeof it.fillColor==="string"){
              const m=it.fillColor.match(/^rgba\((\d+),(\d+),(\d+),([0-9.]+)\)$/i);
              if(m){ it.fillAlpha=clamp(parseFloat(m[4]),0,1); it.fillColor=rgbToHex({r:+m[1],g:+m[2],b:+m[3]}).toLowerCase(); }
            }
            if(it.fillAlpha==null) it.fillAlpha=1;
            const td=s.types?.[it.type]||{};
            if(!Number.isFinite(Number(it.rotation))) it.rotation=normalizeRotation(td.defaultRotation ?? 0); else it.rotation=normalizeRotation(it.rotation);
            it.locked=!!it.locked;
            it.zIndex=Number.isFinite(Number(it.zIndex)) ? Math.trunc(Number(it.zIndex)) : getDefaultZIndexForType(it.type);
          }
        }
      }
    }
  }catch{}
  return app;
}
