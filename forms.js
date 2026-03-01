const ROOM_FIELDS=[
  {key:"name",label:"Name",kind:"text"},
  {key:"description",label:"Description",kind:"textarea"},
  {key:"corner",label:"Corner",kind:"select",options:["NW","NE","SW","SE"]},
  {key:"xIn",label:"X Coordinate",unit:true,kind:"number"},
  {key:"yIn",label:"Y Coordinate",unit:true,kind:"number"},
  {key:"wIn",label:"Width",unit:true,kind:"number"},
  {key:"hIn",label:"Length",unit:true,kind:"number"},
  {key:"heightIn",label:"Height",unit:true,kind:"number"},
  {key:"rotation",label:"Rotation",kind:"range",min:"0",max:"360",step:"1"},
  {key:"zIndex",label:"Z-Index",kind:"number",step:"1"},
  {key:"locked",label:"Lock",kind:"checkbox"},
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
  {key:"rotation",label:"Rotation",kind:"range",min:"0",max:"360",step:"1"},
  {key:"zIndex",label:"Z-Index",kind:"number",step:"1"},
  {key:"locked",label:"Lock",kind:"checkbox"},
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

  const selectedIds=getSelectedItemIds();
  const multiItems=selectedIds.length>1;

  let obj=null, floorName="", roomName="";
  if(state.selected.kind==="room"){
    const res=findRoom(state.selected.roomId); if(!res) return;
    obj=res.room; floorName=res.floor.name; header.textContent=`${floorName} · Room`;
  } else {
    const res=findItem(state.selected.itemId); if(!res) return;
    obj=res.item; floorName=res.floor.name; roomName=res.room.name;
    header.textContent=multiItems ? "Multi-select" : `${floorName} · ${roomName} · ${obj.type}`;
  }

  const fields = state.selected.kind==="room" ? ROOM_FIELDS : ITEM_FIELDS;

  if(state.selected.kind==="item" && !multiItems){
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
      const commitColor=()=>{
        if(!isValidCssColorToken(txt.value)) return;
        const targets=(state.selected.kind==="item" && selectedIds.length)?selectedIds.map(id=>findItem(id)?.item).filter(Boolean):[obj];
        for(const target of targets){
          target[f.key]=txt.value.trim();
          if(state.selected.kind==="item") ensureTypeExists(target.type);
          applyDefaultsToObj(target);
        }
        buildAll();
        render();
        markDirty();
        pushHistory();
      };
      pick.addEventListener("input",()=>{txt.value=pick.value.toLowerCase();});
      pick.addEventListener("change",commitColor);
      txt.addEventListener("input",()=>{ const h=cssColorToHex(txt.value); if(h) pick.value=h; });
      txt.addEventListener("change",commitColor);
      row.appendChild(txt); row.appendChild(pick);
      box.appendChild(lab); box.appendChild(row);
      wrap.appendChild(box);
      continue;
    }
    let input;
    if(f.kind==="textarea"){ input=document.createElement("textarea"); }
    else if(f.kind==="checkbox"){ input=document.createElement("input"); input.type="checkbox"; }
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
    if(f.kind==="checkbox") v=!!obj?.[f.key];
    if((f.kind==="select"||f.kind==="selectDynamic") && v==="" && input.options.length) v=input.options[0].value;
    if(["xIn","yIn","wIn","hIn","heightIn","fillAlpha","zIndex"].includes(f.key) && v!=="" && Number.isFinite(+v)){
      const step=(f.step?parseFloat(f.step):0.5);
      if(f.key==="zIndex") v=String(Math.trunc(+v));
      else v=String(step===0.01?Math.round(+v*100)/100:roundHalf(+v));
    }
    if(f.kind==="checkbox") input.checked=!!v; else input.value=v;
    if(multiItems && f.key==="name") input.disabled=true;

    const commitValue=(isLive)=>{
      const raw=f.kind==="checkbox" ? input.checked : input.value;
      const targets=(state.selected.kind==="item" && selectedIds.length)?selectedIds.map(id=>findItem(id)?.item).filter(Boolean):[obj];
      for(const target of targets){
        if(f.kind==="number" || f.kind==="range"){
          const num=parseFloat(raw);
          if(Number.isFinite(num)) target[f.key]=(f.key==="zIndex"?Math.trunc(num):num);
        } else if(f.kind==="checkbox"){
          target[f.key]=!!raw;
        } else {
          target[f.key]=raw;
        }
        if(state.selected.kind==="room") applyDefaultsToObj(target);
        else { ensureTypeExists(target.type); applyDefaultsToObj(target); }
      }
      if(!isLive) buildAll();
      render();
      markDirty();
      if(!isLive) pushHistory();
    };

    if(f.kind==="range"){
      input.addEventListener("input",()=>commitValue(true));
      input.addEventListener("change",()=>commitValue(false));
    } else if(f.kind==="checkbox"){
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

function setSelected(sel){ hideContextMenu(); state.selected=sel; buildSelectedForm(); render(); }

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
    block.draggable=t!=="Room";
    block.dataset.sortId=t;

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
      renderCounts();
      render();
      markDirty();
    });
    swWrap.appendChild(sw); swWrap.appendChild(swPick);

    const headLeft=document.createElement("div"); headLeft.className="row"; headLeft.style.gap="10px";
    const grip=document.createElement("span"); grip.className="dragGrip"; grip.textContent="⋮⋮"; grip.title="Drag to reorder item types";
    const titleEl=document.createElement("div"); titleEl.style.fontWeight="700"; titleEl.style.fontSize="13px"; titleEl.textContent=t;
    if(t!=="Room") headLeft.appendChild(grip);
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
    const visibleField=document.createElement("label"); visibleField.className="checkbox";
    const visibleCb=document.createElement("input"); visibleCb.type="checkbox"; visibleCb.checked=isTypeVisible(t);
    const visibleText=document.createElement("div"); visibleText.textContent="Visible";
    visibleField.appendChild(visibleCb); visibleField.appendChild(visibleText);
    const labelField=document.createElement("label"); labelField.className="checkbox";
    const labelCb=document.createElement("input"); labelCb.type="checkbox"; labelCb.checked=isLabelVisible(t);
    const labelText=document.createElement("div"); labelText.textContent="Show Label";
    labelField.appendChild(labelCb); labelField.appendChild(labelText);
    grid.appendChild(visibleField); grid.appendChild(labelField);

    const makeColor=(label, key)=>{
      const f=document.createElement("div"); f.className="field";
      const lab=document.createElement("label"); lab.textContent=label;
      const row=document.createElement("div"); row.className="colorRow";
      const txt=document.createElement("input"); txt.type="text"; txt.id=`cfg_${id}_${key}`; txt.placeholder="#rrggbb or css name";
      const pick=document.createElement("input"); pick.type="color"; pick.id=`cfg_${id}_${key}_picker`;
      txt.value=st[key]; const hx=cssColorToHex(st[key]); if(hx) pick.value=hx;
      pick.addEventListener("input",()=>{txt.value=pick.value.toLowerCase();});
      pick.addEventListener("change",()=>{
        st[key]=pick.value.toLowerCase();
        if(key==="defaultLineColor") sw.style.background=st[key];
        applyStyle();
      });
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

    const defRot=document.createElement("div"); defRot.className="field";
    defRot.innerHTML=`<label>Default Rotation (0-360)</label><input id="cfg_${id}_defRot" type="range" min="0" max="360" step="1" value="${escapeXml(normalizeRotation(st.defaultRotation ?? 0))}" class="sf-rangeFull" />`;
    grid.appendChild(defRot);

    body.appendChild(grid);
    block.appendChild(head);
    block.appendChild(body);
    wrap.appendChild(block);

    // Live-commit changes (no explicit Save button)
    const applyStyle=()=>{ renderCounts(); render(); markDirty(); };
    const lineTxt=document.getElementById(`cfg_${id}_defaultLineColor`);
    const cornerTxt=document.getElementById(`cfg_${id}_defaultCornerColor`);
    const fillTxt=document.getElementById(`cfg_${id}_defaultFillColor`);
    const widthInp=document.getElementById(`cfg_${id}_width`);
    const faInp=document.getElementById(`cfg_${id}_fillAlpha`);
    const defWInp=document.getElementById(`cfg_${id}_defW`);
    const defHInp=document.getElementById(`cfg_${id}_defH`);
    const defZInp=document.getElementById(`cfg_${id}_defZ`);
    const defRotInp=document.getElementById(`cfg_${id}_defRot`);

    visibleCb.addEventListener("change",()=>{
      if(visibleCb.checked) state.visibleTypes.add(t); else state.visibleTypes.delete(t);
      render();
      markDirty();
    });
    labelCb.addEventListener("change",()=>{
      state.visibleLabels[t]=labelCb.checked;
      render();
      markDirty();
    });

    lineTxt?.addEventListener("change",()=>{ if(isValidCssColorToken(lineTxt.value)) st.defaultLineColor=lineTxt.value.trim(); applyStyle(); });
    cornerTxt?.addEventListener("change",()=>{ if(isValidCssColorToken(cornerTxt.value)) st.defaultCornerColor=cornerTxt.value.trim(); applyStyle(); });
    fillTxt?.addEventListener("change",()=>{ if(isValidCssColorToken(fillTxt.value)) st.defaultFillColor=fillTxt.value.trim(); applyStyle(); });
    widthInp?.addEventListener("change",()=>{ const v=parseInt(widthInp.value,10); if(Number.isFinite(v)) st.strokeWidth=v; applyStyle(); });
    faInp?.addEventListener("input",()=>{ const v=parseFloat(faInp.value); if(Number.isFinite(v)) st.defaultFillAlpha=clamp(v,0,1); render(); markDirty(); });
    defWInp?.addEventListener("change",()=>{ const v=parseFloat(defWInp.value); if(Number.isFinite(v)) st.defaultWIn=v; markDirty(); });
    defHInp?.addEventListener("change",()=>{ const v=parseFloat(defHInp.value); if(Number.isFinite(v)) st.defaultHIn=v; markDirty(); });
    defZInp?.addEventListener("change",()=>{ const v=parseFloat(defZInp.value); if(Number.isFinite(v)) st.defaultHeightIn=v; markDirty(); });
    defRotInp?.addEventListener("input",()=>{ st.defaultRotation=normalizeRotation(defRotInp.value); render(); markDirty(); });

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
  setupDragSort(wrap,(dragId,targetId)=>{
    if(dragId==="Room" || targetId==="Room") return;
    const from=ACTIVE.typeOrder.indexOf(dragId);
    const to=ACTIVE.typeOrder.indexOf(targetId);
    if(from<0 || to<0 || from===to) return;
    const [moved]=ACTIVE.typeOrder.splice(from,1);
    ACTIVE.typeOrder.splice(to,0,moved);
    buildAll();
    render();
    markDirty();
    pushHistory();
  });
}
