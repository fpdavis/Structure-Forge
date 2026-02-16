(function(){
  // LOGO exporter (v11)
  // - SETPOS [0 0] is screen center
  // - Heading 0 points up; FD moves up

  function deg(rad){ return rad * 180 / Math.PI; }
  function dist(dx,dy){ return Math.sqrt(dx*dx + dy*dy); }

  // Convert 0..255 channel to LOGO 0..99
  function c255to99(v){
    const n = Number(v);
    if(!isFinite(n)) return 0;
    const x = Math.round(n * 99 / 255);
    return Math.max(0, Math.min(99, x));
  }

  function parseHexColor(s){
    const t = String(s||"").trim();
    const m = t.match(/^#([0-9a-f]{6})$/i);
    if(!m) return null;
    const hex = m[1];
    const r = parseInt(hex.slice(0,2), 16);
    const g = parseInt(hex.slice(2,4), 16);
    const b = parseInt(hex.slice(4,6), 16);
    return {r,g,b,a:null};
  }

  // Return LOGO color token:
  // - rgba(...) -> [r g b a] with r/g/b in 0..99
  // - rgb(...)  -> [r g b]   with r/g/b in 0..99
  // - #rrggbb   -> [r g b]   with r/g/b in 0..99
  // - otherwise -> "name (named colors)
  function logoColorToken(css){
    const t = String(css ?? "").trim();
    if(!t) return '"black';

    const mRGBA = t.match(/^rgba\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i);
    if(mRGBA){
      const r = c255to99(mRGBA[1]);
      const g = c255to99(mRGBA[2]);
      const b = c255to99(mRGBA[3]);
      const a = Number(mRGBA[4]);
      return `[${r} ${g} ${b} ${isFinite(a)?a:1}]`;
    }
    const mRGB = t.match(/^rgb\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i);
    if(mRGB){
      const r = c255to99(mRGB[1]);
      const g = c255to99(mRGB[2]);
      const b = c255to99(mRGB[3]);
      return `[${r} ${g} ${b}]`;
    }
    const hx = parseHexColor(t);
    if(hx){
      return `[${c255to99(hx.r)} ${c255to99(hx.g)} ${c255to99(hx.b)}]`;
    }
    return `"${t}`;
  }

  // Always bracket label text (and sanitize internal brackets)
  function labelBracket(text){
    let s = String(text ?? "");
    s = s.replace(/\[/g, "(").replace(/\]/g, ")");
    return `[${s}]`;
  }

  function roundToHalfIn(vIn){
    const n = Number(vIn);
    if(!isFinite(n)) return 0;
    return Math.round(n * 2) / 2;
  }

  function inchesToFtIn(vIn){
    const n = roundToHalfIn(vIn);
    const sign = n < 0 ? -1 : 1;
    const abs = Math.abs(n);
    const ft = Math.floor(abs / 12);
    const inch = abs - ft*12;
    // format inches: integer, .5, or .0
    const inchStr = (Math.abs(inch - Math.round(inch)) < 1e-9) ? String(Math.round(inch)) : String(inch);
    return `${sign<0?'-':''}${ft}' ${inchStr}"`;
  }

  function normalizeRectAbs(obj){
    let x=obj.xIn, y=obj.yIn;
    if(obj.corner==="NE") x=obj.xIn-obj.wIn;
    else if(obj.corner==="SW") y=obj.yIn-obj.hIn;
    else if(obj.corner==="SE"){ x=obj.xIn-obj.wIn; y=obj.yIn-obj.hIn; }
    return {xIn:x,yIn:y,wIn:obj.wIn,hIn:obj.hIn};
  }

  // Items are stored relative to their room and depend on both room.corner and item.corner.
  function normalizeRectRelToRoomPrimary(item, room){
    const wIn=item.wIn, hIn=item.hIn;
    let x=item.xIn, y=item.yIn;

    // Convert item anchor into "room primary" coordinates (room primary = room.corner)
    if(room.corner==="NE"){ x = room.wIn - x; }
    else if(room.corner==="SW"){ y = room.hIn - y; }
    else if(room.corner==="SE"){ x = room.wIn - x; y = room.hIn - y; }

    // Convert item corner -> NW
    if(item.corner==="NE"){ x = x - wIn; }
    else if(item.corner==="SW"){ y = y - hIn; }
    else if(item.corner==="SE"){ x = x - wIn; y = y - hIn; }

    return {xIn:x,yIn:y,wIn,hIn};
  }

  function itemAbsRect(item, room){
    const roomNW = normalizeRectAbs(room);
    const rel = normalizeRectRelToRoomPrimary(item, room);
    return {xIn:roomNW.xIn + rel.xIn, yIn:roomNW.yIn + rel.yIn, wIn:rel.wIn, hIn:rel.hIn};
  }

  function fmtNum(n){
    const r = Math.round(n*10)/10;
    return (Math.abs(r - Math.round(r)) < 1e-9) ? String(Math.round(r)) : String(r);
  }

  // Build a rect polygon in app coords
  function rectToPoly(r){
    const x=r.xIn, y=r.yIn, w=r.wIn, h=r.hIn;
    return [
      {xIn:x,   yIn:y},
      {xIn:x+w, yIn:y},
      {xIn:x+w, yIn:y+h},
      {xIn:x,   yIn:y+h},
      {xIn:x,   yIn:y}
    ];
  }

  // Centroid of polygon (LOGO coords), assumes last point equals first point
  function centroid(pts){
    let x=0,y=0,n=0;
    for(let i=0;i<pts.length-1;i++){ x += pts[i].x; y += pts[i].y; n++; }
    if(n===0) return {x:0,y:0};
    return {x:x/n,y:y/n};
  }

  // Estimate label half-width for centering in LOGO units.
  function labelHalfWidth(text, labelHeight){
    const s = String(text ?? "");
    // crude monospaced estimate: charWidth ~= 0.6*height
    return (s.length * labelHeight * 0.6) / 2;
  }

  registerExporter({
    id:"logo",
    name:"LOGO",
    export(ctx, opts){
      const visibleOnly = !!opts?.visibleOnly;

      const floors = (ctx.HOUSE?.floors || []).filter(f => !visibleOnly || ctx.state.visibleFloors.has(f.id));
      const visType = (t)=> t==="Room" ? true : (!visibleOnly || ctx.state.visibleTypes.has(t));

      // Collect rects to compute bbox (in app inches) and per-floor boxes
      const rects = [];
      const floorGapIn = 240;
      let yOffsetIn = 0;

      const floorBoxes = new Map(); // floorId -> {floor, minX, minY, maxX, maxY}

      for(const f of floors){
        for(const room of (f.rooms||[])){
          if(visType("Room")){
            const rr = normalizeRectAbs(room);
            const rrOff = {xIn:rr.xIn, yIn:rr.yIn + yOffsetIn, wIn:rr.wIn, hIn:rr.hIn};
            rects.push({kind:"room", floor:f, room, rect:rrOff});

            const fb = floorBoxes.get(f.id) || {floor:f, minX:rrOff.xIn, minY:rrOff.yIn, maxX:rrOff.xIn+rrOff.wIn, maxY:rrOff.yIn+rrOff.hIn};
            fb.minX = Math.min(fb.minX, rrOff.xIn);
            fb.minY = Math.min(fb.minY, rrOff.yIn);
            fb.maxX = Math.max(fb.maxX, rrOff.xIn + rrOff.wIn);
            fb.maxY = Math.max(fb.maxY, rrOff.yIn + rrOff.hIn);
            floorBoxes.set(f.id, fb);
          }
          for(const it of (room.items||[])){
            if(!visType(it.type)) continue;
            const ir = itemAbsRect(it, room);
            const irOff = {xIn:ir.xIn, yIn:ir.yIn + yOffsetIn, wIn:ir.wIn, hIn:ir.hIn};
            rects.push({kind:"item", floor:f, room, item:it, rect:irOff});

            // Expand floor box to include items too
            const fb = floorBoxes.get(f.id);
            if(fb){
              fb.minX = Math.min(fb.minX, irOff.xIn);
              fb.minY = Math.min(fb.minY, irOff.yIn);
              fb.maxX = Math.max(fb.maxX, irOff.xIn + irOff.wIn);
              fb.maxY = Math.max(fb.maxY, irOff.yIn + irOff.hIn);
            }
          }
        }
        yOffsetIn += floorGapIn;
      }

      // bbox
      let minX=0, minY=0, maxX=0, maxY=0;
      if(rects.length){
        minX = Math.min(...rects.map(r=>r.rect.xIn));
        minY = Math.min(...rects.map(r=>r.rect.yIn));
        maxX = Math.max(...rects.map(r=>r.rect.xIn + r.rect.wIn));
        maxY = Math.max(...rects.map(r=>r.rect.yIn + r.rect.hIn));
      }

      const widthIn  = Math.max(1, maxX - minX);
      const heightIn = Math.max(1, maxY - minY);
      const centerXIn = (minX + maxX)/2;
      const centerYIn = (minY + maxY)/2;

      // Fit to drawing area ~1000x800
      const targetW = 1000;
      const targetH = 800;
      const margin  = 60;
      const scale = Math.min((targetW - margin*2)/widthIn, (targetH - margin*2)/heightIn);

      // Transform app -> LOGO:
      // - center about bbox center
      // - scale
      // - flip Y (app is Y-down; LOGO is Y-up)
      // - rotate 90° clockwise to compensate the observed 90° CCW output
      const toLogo = (xIn, yIn)=>{
        const dx = (xIn - centerXIn) * scale;
        const dy = (yIn - centerYIn) * scale;
        const x0 = dx;
        const y0 = -dy;
        // CW rotate: (x,y)->(y,-x)
        return { x: y0, y: -x0 };
      };

      const out = [];
      out.push('; LOGO EXPORT');
      out.push('; Origin: screen center. Heading 0 is up.');
      out.push('CLEARSCREEN');
      out.push('SHOWTURTLE');
      out.push('PU');
      out.push('SETHEADING 0');
      out.push('SETPENSIZE 3');

      const outlineColor = '#0000FF';
      out.push(`SETPENCOLOR ${logoColorToken(outlineColor)}`);

      function moveTo(p){
        out.push(`SETPOS [${fmtNum(p.x)} ${fmtNum(p.y)}]`);
      }

      function setHeadingForDelta(dx,dy){
        // Heading 0 is up, so use atan2(dx,dy)
        let h = deg(Math.atan2(dx, dy));
        if(h < 0) h += 360;
        out.push(`SETHEADING ${fmtNum(h)}`);
      }

      function fdLen(len){
        out.push(`FD ${fmtNum(len)}`);
      }

      function tracePoly(ptsLogo){
        // ptsLogo must be closed (last equals first)
        out.push('PU');
        moveTo(ptsLogo[0]);
        out.push('PD');
        for(let i=1;i<ptsLogo.length;i++){
          const a = ptsLogo[i-1], b = ptsLogo[i];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          setHeadingForDelta(dx,dy);
          fdLen(dist(dx,dy));
        }
        out.push('PU');
      }

      function fillAt(pLogo, fillCss){
        if(!fillCss) return;
        out.push('; fill @ center');
        out.push('PU');
        moveTo(pLogo);
        out.push(`SETPENCOLOR ${logoColorToken(fillCss)}`);
        out.push('FILL');
        out.push(`SETPENCOLOR ${logoColorToken(outlineColor)}`);
      }

      function drawRectWithOptionalFill(rApp, fillCss){
        const polyApp = rectToPoly(rApp);
        const polyLogo = polyApp.map(p=>toLogo(p.xIn, p.yIn));
        out.push('; rect');
        tracePoly(polyLogo);
        fillAt(centroid(polyLogo), fillCss);
      }

      function centeredLabel(text, pLogo, labelHeight){
        const t = String(text ?? '');
        const x = pLogo.x - labelHalfWidth(t, labelHeight);
        out.push('PU');
        out.push(`SETLABELHEIGHT ${fmtNum(labelHeight)}`);
        moveTo({x, y:pLogo.y});
        out.push(`LABEL ${labelBracket(t)}`);
      }

      function drawRoomLabels(room, rApp){
        const cx = rApp.xIn + rApp.wIn/2;
        const cy = rApp.yIn + rApp.hIn/2;
        const cLogo = toLogo(cx, cy);

        const name = room.name || 'Room';
        const dims = `${inchesToFtIn(rApp.wIn)} x ${inchesToFtIn(rApp.hIn)}`;

        // Place name above center, dims below center
        centeredLabel(name, {x:cLogo.x, y:cLogo.y + 18}, 16);
        centeredLabel(dims, {x:cLogo.x, y:cLogo.y - 18}, 12);
      }

      function drawFloorBoxAndLabel(fb){
        const padIn = 12;
        const r = {
          xIn: fb.minX - padIn,
          yIn: fb.minY - padIn,
          wIn: (fb.maxX - fb.minX) + padIn*2,
          hIn: (fb.maxY - fb.minY) + padIn*2,
        };
        out.push(`; FLOOR BOX: ${(fb.floor.name||fb.floor.id||'').toString()}`);
        drawRectWithOptionalFill(r, null);

        const topCenter = toLogo(r.xIn + r.wIn/2, r.yIn);
        const labelPt = {x: topCenter.x, y: topCenter.y + 24};
        centeredLabel(fb.floor.name || 'Floor', labelPt, 18);
      }

      // 1) Draw floor bounding boxes first
      for(const fb of floorBoxes.values()){
        drawFloorBoxAndLabel(fb);
      }

      // 2) Draw rooms and items
      for(const r of rects){
        if(r.kind === 'room'){
          out.push(`; FLOOR: ${(r.floor.name||r.floor.id||'').toString()}`);
          out.push(`; ROOM: ${(r.room.name||r.room.id||'').toString()}`);
          drawRectWithOptionalFill(r.rect, r.room.fill || r.room.fillColor || r.room.color || null);
          drawRoomLabels(r.room, r.rect);
        }else{
          out.push(`; ITEM: ${(r.item.name||r.item.type||r.item.id||'').toString()}`);
          drawRectWithOptionalFill(r.rect, r.item.fill || r.item.fillColor || r.item.color || null);
        }
      }

      out.push('HIDETURTLE');
      return out.join('\n');
    }
  });
})();
