function hideContextMenu(){
  if(contextMenu.el){ contextMenu.el.remove(); contextMenu.el=null; contextMenu.target=null; }
}

function showContextMenu(clientX, clientY){
  hideContextMenu();
  if(!state.selected) return;
  const obj=getSelectedObject();
  if(!obj) return;
  const menu=document.createElement("div");
  menu.className="sf-contextMenu";
  const mk=(label,fn)=>{
    const b=document.createElement("button");
    b.type="button";
    b.className="sf-contextMenuItem";
    b.textContent=label;
    b.addEventListener("click",(ev)=>{ ev.preventDefault(); ev.stopPropagation(); hideContextMenu(); fn(); });
    menu.appendChild(b);
  };
  const hasClipboardData=!!(clipboard.kind && clipboard.data);
  const selectedItemContexts=getSelectedItemContexts();
  const hasMultiSelectedItems=selectedItemContexts.length>1;
  const hasUngroupedSelectedItem=selectedItemContexts.some((res)=>!sanitizeGroupId(res.item.groupId));
  const hasGroupedSelectedItem=selectedItemContexts.some((res)=>!!sanitizeGroupId(res.item.groupId));
  mk("Copy",()=>copySelected());
  mk("Cut",()=>cutSelected());
  if(hasClipboardData) mk("Paste",()=>pasteClipboard());
  mk("Duplicate",()=>duplicateSelected());
  if(state.selected.kind==="item"){
    if(hasMultiSelectedItems && hasUngroupedSelectedItem) mk("Group",()=>groupSelectedItems());
    if(hasGroupedSelectedItem) mk("Ungroup",()=>ungroupSelectedItems());
  }
  mk("Delete",()=>deleteSelected());
  mk("Bring Forward",()=>adjustSelectedZIndex("forward"));
  mk("Send Backward",()=>adjustSelectedZIndex("backward"));
  mk("Bring to Front",()=>adjustSelectedZIndex("front"));
  mk("Send to Back",()=>adjustSelectedZIndex("back"));
  mk(obj.locked?"Unlock":"Lock",()=>toggleSelectedLock());
  menu.style.left=`${Math.max(8,clientX)}px`;
  menu.style.top=`${Math.max(8,clientY)}px`;
  document.body.appendChild(menu);
  contextMenu.el=menu;
  contextMenu.target=state.selected?JSON.parse(JSON.stringify(state.selected)):null;
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


function wire(){
  document.getElementById("navToggle").addEventListener("click",(e)=>{e.preventDefault(); document.body.classList.toggle("navCollapsed");});

  const canvasWrap=document.getElementById("canvasWrap");
  const leftPanel=document.querySelector(".left");
  const focusCanvas=()=>{
    if(canvasWrap && typeof canvasWrap.focus==="function") canvasWrap.focus({preventScroll:true});
  };
  const releaseSidebarFocus=()=>{
    const ae=document.activeElement;
    if(ae && leftPanel && leftPanel.contains(ae) && typeof ae.blur==="function") ae.blur();
    focusCanvas();
  };
  canvasWrap?.addEventListener("pointerdown", releaseSidebarFocus);

  const isSidebarControl=(el)=>{
    if(!el || !el.closest) return false;
    return !!el.closest('input[type="checkbox"],input[type="radio"],input[type="range"],input[type="color"],select,button,input[type="text"],input[type="number"],textarea');
  };
  leftPanel?.addEventListener("change",(ev)=>{ if(isSidebarControl(ev.target)) focusCanvas(); });
  leftPanel?.addEventListener("click",(ev)=>{ if(isSidebarControl(ev.target)) focusCanvas(); });
  leftPanel?.addEventListener("keydown",(ev)=>{
    if(ev.key!=="Enter") return;
    if(isSidebarControl(ev.target)) focusCanvas();
  });
  const ppi=document.getElementById("ppi"); const ppiValue=document.getElementById("ppiValue");
  ppi.addEventListener("input",()=>{
    state.ppi=parseInt(ppi.value,10);
    if(ppiValue) ppiValue.textContent=String(state.ppi);
    render();
    _commitViewConfiguration();
  });

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
  document.getElementById("showRuler")?.addEventListener("change",(ev)=>{ state.view.showRuler=!!ev.target.checked; render(); _commitViewConfiguration(); });
  document.getElementById("showRulerHighlight")?.addEventListener("change",(ev)=>{ state.view.showRulerHighlight=!!ev.target.checked; render(); _commitViewConfiguration(); });

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
    hideContextMenu();
    // ── Esc: abort an in-progress drag and revert ──────────────────────────
    if(ev.key==="Escape"){
      if(drag.active && drag.preState){
        ev.preventDefault();
        ACTIVE.house=JSON.parse(JSON.stringify(drag.preState));
        HOUSE=ACTIVE.house;
        drag.active=false; drag.kind=null; drag.floorId=null; drag.roomId=null; drag.itemId=null; drag.itemIds=null; drag.startItems=null;
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

    // ── Group / Ungroup ───────────────────────────────────────────────────
    if(ev.altKey && (ev.key==="g"||ev.key==="G")){
      ev.preventDefault();
      if(ev.shiftKey) ungroupSelectedItems();
      else groupSelectedItems();
      return;
    }

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
      if(k==="a"||k==="A"){
        ev.preventDefault();
        const ids=[];
        for(const floor of HOUSE.floors||[]) for(const room of floor.rooms||[]) for(const it of room.items||[]) ids.push(it.id);
        setSelectedItems(ids, ids[ids.length-1]||null);
        return;
      }
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
    if(ev.shiftKey && (ev.key==="n"||ev.key==="N")){ 
	  ev.preventDefault();
	  newStructure();
	  return; 
	}

    if(ev.shiftKey && ["W","A","S","D","w","a","s","d"].includes(ev.key)){
      const ids=getSelectedItemIds();
      if(ids.length<2) return;
      ev.preventDefault();
      const anchorId=state.selected?.itemId;
      const anchorRes=findItem(anchorId);
      if(!anchorRes) return;
      const anchor=itemAbsRect(anchorRes.item, anchorRes.room);
      for(const id of ids){
        if(id===anchorId) continue;
        const res=findItem(id); if(!res || res.item.locked) continue;
        const abs=itemAbsRect(res.item, res.room);
        let nx=abs.xIn, ny=abs.yIn;
        if(ev.key==="W"||ev.key==="w") ny=anchor.yIn;
        if(ev.key==="S"||ev.key==="s") ny=anchor.yIn+anchor.hIn-abs.hIn;
        if(ev.key==="A"||ev.key==="a") nx=anchor.xIn;
        if(ev.key==="D"||ev.key==="d") nx=anchor.xIn+anchor.wIn-abs.wIn;
        const roomNW=normalizeRectAbs(res.room);
        setItemFromNW_Rel(res.item,res.room,nx-roomNW.xIn,ny-roomNW.yIn);
      }
      buildSelectedForm(); render(); markDirty(); pushHistory();
      return;
    }
	
    // ── Z-index shortcuts ───────────────────────────────────────────────
    if(ev.altKey && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey){
      if(ev.key==="]"){ ev.preventDefault(); adjustSelectedZIndex("forward"); return; }
      if(ev.key==="["){ ev.preventDefault(); adjustSelectedZIndex("backward"); return; }
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
        for(const id of getSelectedItemIds()){
          const res=findItem(id); if(!res || res.item.locked) continue;
          const rel=normalizeRectRelToRoomPrimary(res.item, res.room);
          setItemFromNW_Rel(res.item, res.room, rel.xIn+dx, rel.yIn+dy);
        }
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
    if(contextMenu.el && drag.active) hideContextMenu();
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
      const res=findRoom(drag.roomId); if(!res || res.room.locked) return;
      const rr=normalizeRectAbs(res.room);
      const nwX=drag.startNW.xIn+dxIn;
      const nwY=drag.startNW.yIn+dyIn;
      setRoomFromNW(res.room,nwX,nwY);
      updateSelectedXYInputs(res.room);
    } else {
      const starts=Array.isArray(drag.startItems)&&drag.startItems.length ? drag.startItems : null;
      if(starts){
        for(const st of starts){
          const res=findItem(st.itemId); if(!res || res.item.locked) continue;
          setItemFromNW_Rel(res.item,res.room,st.xIn+dxIn,st.yIn+dyIn);
        }
      } else {
        const res=findItem(drag.itemId); if(!res || res.item.locked) return;
        const nwX=drag.startNW.xIn+dxIn;
        const nwY=drag.startNW.yIn+dyIn;
        setItemFromNW_Rel(res.item,res.room,nwX,nwY);
        updateSelectedXYInputs(res.item);
      }
    }
    if(!drag.raf){
      drag.raf=true;
      requestAnimationFrame(()=>{drag.raf=false; render();});
    }
  });
  window.addEventListener("mouseup",(ev)=>{
    if(drag.kind==="context-candidate" && ev.button===2){
      const moved=Math.abs((ev.clientX||0)-drag.startClientX)>3 || Math.abs((ev.clientY||0)-drag.startClientY)>3;
      if(!moved) showContextMenu(ev.clientX||0, ev.clientY||0);
    }
    if(drag.active && drag.moved && drag.kind==="item"){
      const draggedIds=(Array.isArray(drag.itemIds)&&drag.itemIds.length)?drag.itemIds:[drag.itemId];
      for(const id of draggedIds){
        const res=findItem(id);
        if(!res) continue;
        const abs=itemAbsRect(res.item, res.room);
        const dropTarget=findRoomOnFloorAtAbsPoint(res.floor.id, abs.xIn+abs.wIn/2, abs.yIn+abs.hIn/2, res.room.id);
        if(dropTarget) reassignItemToRoom(res.item.id, dropTarget.room.id);
      }
      if(draggedIds.length>1) setSelectedItems(draggedIds, drag.itemId);
    }
    if(drag.active && drag.moved){ pushHistory(); }
    drag.active=false; drag.kind=null; drag.floorId=null; drag.roomId=null; drag.itemId=null; drag.itemIds=null; drag.startItems=null;
    drag.preState=null; drag.preSelected=null; drag.moved=false; drag.skipClickSelect=false;
  });
}



function updateLassoBox(clientX, clientY){
  if(!lasso.active || !lasso.boxEl) return;
  const left=Math.min(lasso.startX, clientX);
  const top=Math.min(lasso.startY, clientY);
  const width=Math.abs(clientX-lasso.startX);
  const height=Math.abs(clientY-lasso.startY);
  lasso.boxEl.style.left=`${left}px`;
  lasso.boxEl.style.top=`${top}px`;
  lasso.boxEl.style.width=`${width}px`;
  lasso.boxEl.style.height=`${height}px`;

  const r={left,top,right:left+width,bottom:top+height};
  const ids=new Set(lasso.additive?lasso.baseSelection:[]);
  document.querySelectorAll('.selectable[data-sel-kind="item"][data-item-id]').forEach((el)=>{
    const b=el.getBoundingClientRect();
    const hit=!(b.right<r.left || b.left>r.right || b.bottom<r.top || b.top>r.bottom);
    if(hit) ids.add(el.dataset.itemId);
  });
  setSelectedItems([...ids], null, {expandGroups:!lasso.bypassGroupExpand});
}
function endLasso(){
  if(!lasso.active) return;
  lasso.active=false;
  if(lasso.boxEl){ lasso.boxEl.remove(); lasso.boxEl=null; }
}

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

  wrap.addEventListener("contextmenu",(ev)=>{ ev.preventDefault(); });
  wrap.addEventListener("mousedown",(ev)=>{
    if(ev.button!==2) hideContextMenu();
    // Pan with right-drag anywhere on the canvas (objects or background)
    if(ev.button===2){
      ev.preventDefault();
      pan.active=true; pan.startX=ev.clientX; pan.startY=ev.clientY; pan.startTx=state.view.tx; pan.startTy=state.view.ty;
      return;
    }
    if(ev.button!==0) return;
    if(ev.target?.closest('.selectable')) return;
    ev.preventDefault();
    lasso.active=true;
    lasso.additive=!!(ev.shiftKey||ev.ctrlKey||ev.metaKey);
    lasso.bypassGroupExpand=!!ev.ctrlKey;
    lasso.startX=ev.clientX;
    lasso.startY=ev.clientY;
    lasso.baseSelection=lasso.additive?getSelectedItemIds():[];
    const box=document.createElement('div');
    box.className='sf-lassoBox';
    box.style.left=`${ev.clientX}px`; box.style.top=`${ev.clientY}px`; box.style.width='0px'; box.style.height='0px';
    document.body.appendChild(box);
    lasso.boxEl=box;
  });
  window.addEventListener("mousemove",(ev)=>{
    if(contextMenu.el && drag.active) hideContextMenu();
    if(lasso.active) updateLassoBox(ev.clientX, ev.clientY);
    if(!pan.active) return;
    state.view.tx=pan.startTx+(ev.clientX-pan.startX);
    state.view.ty=pan.startTy+(ev.clientY-pan.startY);
    render();
  });
  window.addEventListener("mouseup",()=>{pan.active=false; endLasso();});
  document.addEventListener("mousedown",(ev)=>{
    if(contextMenu.el && !contextMenu.el.contains(ev.target)) hideContextMenu();
  });
}
