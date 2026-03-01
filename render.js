const FLOOR_VIEW_PADDING_IN = 0;

function computeFloorBoundsIn(floor){
  // Bounds are used for rendering the SVG viewport. Keep a consistent padding
  // around the structure, but do NOT let absolute placement offsets inflate
  // the displayed width/height in the floor title bar.
  const padIn=FLOOR_VIEW_PADDING_IN;
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
  const padIn=FLOOR_VIEW_PADDING_IN;
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


const RULER_THICKNESS = 32;
const RULER_BACKGROUND_COLOR = "#141924";
const RULER_MAJOR_TICK_COLOR = "#e7eaf0";
const RULER_MINOR_TICK_COLOR = "#8a93a7";
const RULER_FONT_SIZE = 12;
const RULER_TEXT_COLOR = "#e7eaf0";
const RULER_HIGHLIGHT_LINE_COLOR = "#7fc4ff";
const RULER_HIGHLIGHT_LINE_WIDTH = 1.5;

function getSingleSelectionRulerGuides(floorId, fx, fy){
  if(!state.view.showRuler || !state.view.showRulerHighlight || !state.selected) return null;
  if(state.selected.kind==="item"){
    if(Array.isArray(state.selected.itemIds) && state.selected.itemIds.length>1) return null;
    const sel=findItem(state.selected.itemId);
    if(!sel || sel.floor.id!==floorId) return null;
    const abs=itemAbsRect(sel.item, sel.room);
    return {
      xStart:fx(abs.xIn), xEnd:fx(abs.xIn+abs.wIn),
      yStart:fy(abs.yIn), yEnd:fy(abs.yIn+abs.hIn)
    };
  }
  if(state.selected.kind==="room"){
    const sel=findRoom(state.selected.roomId);
    if(!sel || sel.floor.id!==floorId) return null;
    const rr=normalizeRectAbs(sel.room);
    return {
      xStart:fx(rr.xIn), xEnd:fx(rr.xIn+rr.wIn),
      yStart:fy(rr.yIn), yEnd:fy(rr.yIn+rr.hIn)
    };
  }
  return null;
}

function buildRulerGroup(contentWidthPx, contentHeightPx, oxIn, oyIn, guides=null){
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

  const ns="http://www.w3.org/2000/svg";
  const g=document.createElementNS(ns,"g");
  g.setAttribute("class","rulerLayer");

  const mkRect=(x,y,w,h,fill)=>{ const el=document.createElementNS(ns,"rect"); el.setAttribute("x",x); el.setAttribute("y",y); el.setAttribute("width",w); el.setAttribute("height",h); el.setAttribute("fill",fill); return el; };
  const mkLine=(x1,y1,x2,y2,color,w=1)=>{ const el=document.createElementNS(ns,"line"); el.setAttribute("x1",x1); el.setAttribute("y1",y1); el.setAttribute("x2",x2); el.setAttribute("y2",y2); el.setAttribute("stroke",color); el.setAttribute("stroke-width",w); return el; };

  g.appendChild(mkRect(RULER_THICKNESS,0,contentWidthPx,RULER_THICKNESS,RULER_BACKGROUND_COLOR));
  g.appendChild(mkRect(0,RULER_THICKNESS,RULER_THICKNESS,contentHeightPx,RULER_BACKGROUND_COLOR));
  g.appendChild(mkRect(0,0,RULER_THICKNESS,RULER_THICKNESS,RULER_BACKGROUND_COLOR));

  for(let x=x0Minor; x<=contentWidthPx+0.001; x+=minorStepPx){
    const isMajor=Math.abs(((x-x0Major)%majorStepPx+majorStepPx)%majorStepPx)<0.001;
    const h=isMajor ? RULER_THICKNESS-3 : Math.round(RULER_THICKNESS*0.45);
    g.appendChild(mkLine(RULER_THICKNESS+x,RULER_THICKNESS-h,RULER_THICKNESS+x,RULER_THICKNESS,isMajor?RULER_MAJOR_TICK_COLOR:RULER_MINOR_TICK_COLOR,1));
    if(isMajor){
      const t=document.createElementNS(ns,"text");
      t.setAttribute("x",RULER_THICKNESS+x+2);
      t.setAttribute("y",RULER_FONT_SIZE+2);
      t.setAttribute("fill",RULER_TEXT_COLOR);
      t.setAttribute("font-size",String(RULER_FONT_SIZE));
      t.textContent=String(Math.round(((x-x0Minor)/minorStepPx)*minorIn));
      g.appendChild(t);
    }
  }

  for(let y=y0Minor; y<=contentHeightPx+0.001; y+=minorStepPx){
    const isMajor=Math.abs(((y-y0Major)%majorStepPx+majorStepPx)%majorStepPx)<0.001;
    const w=isMajor ? RULER_THICKNESS-3 : Math.round(RULER_THICKNESS*0.45);
    g.appendChild(mkLine(RULER_THICKNESS-w,RULER_THICKNESS+y,RULER_THICKNESS,RULER_THICKNESS+y,isMajor?RULER_MAJOR_TICK_COLOR:RULER_MINOR_TICK_COLOR,1));
    if(isMajor){
      const label=String(Math.round(((y-y0Minor)/minorStepPx)*minorIn));
      const t=document.createElementNS(ns,"text");
      const tx=RULER_FONT_SIZE+2;
      const ty=RULER_THICKNESS+y-2;
      t.setAttribute("x",String(tx));
      t.setAttribute("y",String(ty));
      t.setAttribute("fill",RULER_TEXT_COLOR);
      t.setAttribute("font-size",String(RULER_FONT_SIZE));
      t.setAttribute("transform",`rotate(-90 ${tx} ${ty})`);
      t.textContent=label;
      g.appendChild(t);
    }
  }

  if(guides){
    for(const x of [guides.xStart, guides.xEnd]) g.appendChild(mkLine(RULER_THICKNESS+x,RULER_THICKNESS,RULER_THICKNESS+x,RULER_THICKNESS+contentHeightPx,RULER_HIGHLIGHT_LINE_COLOR,RULER_HIGHLIGHT_LINE_WIDTH));
    for(const y of [guides.yStart, guides.yEnd]) g.appendChild(mkLine(RULER_THICKNESS,RULER_THICKNESS+y,RULER_THICKNESS+contentWidthPx,RULER_THICKNESS+y,RULER_HIGHLIGHT_LINE_COLOR,RULER_HIGHLIGHT_LINE_WIDTH));
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
    const contentWidthPx=vpWidthPx, contentHeightPx=vpHeightPx;
    const rulerEnabled=!!state.view.showRuler;
    const widthPx=contentWidthPx + (rulerEnabled ? RULER_THICKNESS : 0);
    const heightPx=contentHeightPx + (rulerEnabled ? RULER_THICKNESS : 0);

    const block=document.createElement("div"); block.className="floorBlock";
    const header=document.createElement("div"); header.className="floorHeader";
    const totals=floorTotals(floor);
    header.innerHTML=`<div class="floorName">${escapeXml(floor.name)}</div><div class="meta">${escapeXml(formatLinear(bounds.spanW ?? bounds.width))} × ${escapeXml(formatLinear(bounds.spanH ?? bounds.height))} · Area ${escapeXml(formatSqFt(totals.areaIn2))} ft² · Perim ${escapeXml(formatLinear(totals.perimIn))}</div>`;

    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.classList.add("floorSvg");
    svg.dataset.floorId=floor.id;
    svg.setAttribute("viewBox",`0 0 ${widthPx} ${heightPx}`);
    svg.setAttribute("width",widthPx); svg.setAttribute("height",heightPx);

    const contentLayer=document.createElementNS("http://www.w3.org/2000/svg","g");
    if(rulerEnabled) contentLayer.setAttribute("transform",`translate(${RULER_THICKNESS} ${RULER_THICKNESS})`);
    svg.appendChild(contentLayer);

    // Grid (configurable layer)
    const gridGroup = state.grid.mode==="off" ? null : buildGridGroup(contentWidthPx,contentHeightPx,ox,oy);
    if(gridGroup && state.grid.mode==="under") contentLayer.appendChild(gridGroup);
    // Label group — appended last so labels always render above all objects
    const labelGroup=document.createElementNS("http://www.w3.org/2000/svg","g");
    labelGroup.setAttribute("class","labelLayer");

    // Rooms
    const sortedRooms=[...(floor.rooms||[])].sort((a,b)=>{
      const za=Number(a.zIndex)||0;
      const zb=Number(b.zIndex)||0;
      if(za!==zb) return za-zb;
      return getTypeDisplayOrderIndex(a.type)-getTypeDisplayOrderIndex(b.type);
    });
    for(const room of sortedRooms){
      applyDefaultsToObj(room);
      const rr=normalizeRectAbs(room);
      const x=fx(rr.xIn), y=fy(rr.yIn), w=inToPx(rr.wIn), h=inToPx(rr.hIn);
      const st=ACTIVE.types.Room;
      const g=document.createElementNS("http://www.w3.org/2000/svg","g");
      const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
      rect.setAttribute("x",x); rect.setAttribute("y",y); rect.setAttribute("width",w); rect.setAttribute("height",h);
      const roomRotation=normalizeRotation(room.rotation);
      if(roomRotation!==0) rect.setAttribute("transform",`rotate(${roomRotation} ${x+w/2} ${y+h/2})`);
      rect.setAttribute("fill",room.fillColor||st.defaultFillColor);
      rect.setAttribute("fill-opacity", String(room.fillAlpha ?? st.defaultFillAlpha ?? 1));
      rect.setAttribute("stroke",room.lineColor||st.defaultLineColor);
      rect.setAttribute("stroke-width",st.strokeWidth);
      rect.classList.add("selectable");
      rect.dataset.selKind="room"; rect.dataset.roomId=room.id;
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
      marker.dataset.selKind="room"; marker.dataset.roomId=room.id;
      if(room.locked){ rect.classList.add("locked-object"); marker.classList.add("locked-object"); }

      const onClick=(ev)=>{ev.stopPropagation(); setSelected({kind:"room", floorId:floor.id, roomId:room.id}); populateNewItemSelectors();};
      const onDown=(ev)=>{if(ev.button!==0) return; if(room.locked) return; ev.preventDefault(); ev.stopPropagation(); onClick(ev);
        drag.active=true; drag.kind="room"; drag.floorId=floor.id; drag.roomId=room.id; drag.itemId=null;
        drag.startClientX=ev.clientX; drag.startClientY=ev.clientY; drag.startNW={xIn:rr.xIn,yIn:rr.yIn};
        drag.preState=JSON.parse(JSON.stringify(HOUSE)); drag.preSelected=state.selected?JSON.parse(JSON.stringify(state.selected)):null; drag.moved=false; };
      const beginRoomResize=(handleCorner,ev)=>{if(ev.button!==0) return; if(room.locked) return; ev.preventDefault(); ev.stopPropagation(); onClick(ev);
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
      const onRightDown=(ev)=>{ if(ev.button!==2) return; ev.preventDefault(); const alreadySelected=state.selected?.kind==="room" && state.selected.roomId===room.id; if(!alreadySelected) return; drag.moved=false; drag.startClientX=ev.clientX; drag.startClientY=ev.clientY; drag.kind="context-candidate"; };
      rect.addEventListener("mousedown",onRightDown); marker.addEventListener("mousedown",onRightDown);

      g.appendChild(rect); g.appendChild(marker);
      if(roomSelected){
        const beginRoomEdgeResize=(edge,ev)=>{if(ev.button!==0) return; if(room.locked) return; ev.preventDefault(); ev.stopPropagation(); onClick(ev);
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
      contentLayer.appendChild(g)
    }

    // Other types
    const floorItems=[];
    for(const room of floor.rooms||[]){
      for(const it of room.items||[]) floorItems.push({room,it});
    }
    floorItems.sort((a,b)=>{
      const za=Number(a.it.zIndex)||0;
      const zb=Number(b.it.zIndex)||0;
      if(za!==zb) return za-zb;
      return getTypeDisplayOrderIndex(a.it.type)-getTypeDisplayOrderIndex(b.it.type);
    });
    for(const entry of floorItems){
      const room=entry.room;
      const it=entry.it;
      const type=it.type;
      if(type==="Room" || !isTypeVisible(type)) continue;
          ensureTypeExists(it.type);
          applyDefaultsToObj(it);
          const abs=itemAbsRect(it, room);
          const x=fx(abs.xIn), y=fy(abs.yIn), w=inToPx(abs.wIn), h=inToPx(abs.hIn);
          const st=ACTIVE.types[type];

          const g=document.createElementNS("http://www.w3.org/2000/svg","g");
          const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
          rect.setAttribute("x",x); rect.setAttribute("y",y); rect.setAttribute("width",w); rect.setAttribute("height",h);
          const itemRotation=normalizeRotation(it.rotation);
          if(itemRotation!==0) rect.setAttribute("transform",`rotate(${itemRotation} ${x+w/2} ${y+h/2})`);
          rect.setAttribute("fill",it.fillColor||st.defaultFillColor);
          rect.setAttribute("fill-opacity", String(it.fillAlpha ?? st.defaultFillAlpha ?? 1));
          rect.setAttribute("stroke",it.lineColor||st.defaultLineColor);
          rect.setAttribute("stroke-width",st.strokeWidth);
          rect.classList.add("selectable");
          rect.dataset.selKind="item"; rect.dataset.itemId=it.id;
          const itemSelected=isSelectedItemId(it.id);
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
          marker.dataset.selKind="item"; marker.dataset.itemId=it.id;
          if(it.locked){ rect.classList.add("locked-object"); marker.classList.add("locked-object"); }

          const onClick=(ev)=>{ev.stopPropagation();
            if(drag.skipClickSelect){ drag.skipClickSelect=false; return; }
            if(ev.shiftKey||ev.metaKey) toggleItemInSelection(it.id);
            else if(ev.ctrlKey) toggleItemInSelection(it.id, {expandGroups:false});
            else setSelectedItems([it.id], it.id);
            populateNewItemSelectors();
          };
          const onDown=(ev)=>{if(ev.button!==0) return; if(it.locked) return; ev.preventDefault(); ev.stopPropagation();
            if(ev.shiftKey||ev.metaKey){ toggleItemInSelection(it.id); drag.skipClickSelect=true; }
            else if(ev.ctrlKey){ toggleItemInSelection(it.id, {expandGroups:false}); drag.skipClickSelect=true; }
            else if(!isSelectedItemId(it.id)) setSelectedItems([it.id], it.id);
            drag.active=true; drag.kind="item"; drag.floorId=floor.id; drag.roomId=room.id; drag.itemId=it.id;
            drag.startClientX=ev.clientX; drag.startClientY=ev.clientY;
            const baseIds=getSelectedItemIds();
            drag.itemIds=baseIds.length?baseIds:[it.id];
            drag.startItems=drag.itemIds.map(id=>{ const src=findItem(id); if(!src) return null; const rel=normalizeRectRelToRoomPrimary(src.item, src.room); return {itemId:id, roomId:src.room.id, xIn:rel.xIn, yIn:rel.yIn}; }).filter(Boolean);
            const rel=normalizeRectRelToRoomPrimary(it, room);
            drag.startNW={xIn:rel.xIn,yIn:rel.yIn};
            drag.preState=JSON.parse(JSON.stringify(HOUSE)); drag.preSelected=state.selected?JSON.parse(JSON.stringify(state.selected)):null; drag.moved=false; };
          const beginItemResize=(handleCorner,ev)=>{if(ev.button!==0) return; if(it.locked) return; ev.preventDefault(); ev.stopPropagation(); onClick(ev);
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
          const onRightDown=(ev)=>{ if(ev.button!==2) return; ev.preventDefault(); const alreadySelected=isSelectedItemId(it.id); if(!alreadySelected) return; drag.moved=false; drag.startClientX=ev.clientX; drag.startClientY=ev.clientY; drag.kind="context-candidate"; };
          rect.addEventListener("mousedown",onRightDown); marker.addEventListener("mousedown",onRightDown);

          g.appendChild(rect); g.appendChild(marker);
          if(itemSelected){
            const beginItemEdgeResize=(edge,ev)=>{if(ev.button!==0) return; if(it.locked) return; ev.preventDefault(); ev.stopPropagation(); onClick(ev);
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
          contentLayer.appendChild(g)
    }

    if(gridGroup && state.grid.mode==="over") contentLayer.appendChild(gridGroup);
    const guides=getSingleSelectionRulerGuides(floor.id,fx,fy);
    if(rulerEnabled){
      const rulerGroup=buildRulerGroup(contentWidthPx,contentHeightPx,ox,oy,guides);
      if(rulerGroup) svg.appendChild(rulerGroup);
    }
    svg.addEventListener("click",()=>{ if(!lasso.active) setSelected(null); });
    contentLayer.appendChild(labelGroup);
    block.appendChild(header); block.appendChild(svg); inner.appendChild(block);
  }
  wrap.appendChild(inner);
  updateFloorSummary();
}
