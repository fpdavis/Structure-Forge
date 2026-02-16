(function(){
  // Minimal ASCII DXF (R12-ish). Units: inches. Layers = types.
  function header(){
    return ["0","SECTION","2","HEADER","9","$ACADVER","1","AC1009","0","ENDSEC","0","SECTION","2","TABLES","0","TABLE","2","LAYER","70","0"];
  }
  function layer(name,color=7){
    return ["0","LAYER","2",name,"70","0","62",String(color),"6","CONTINUOUS"];
  }
  function endTables(){ return ["0","ENDTAB","0","ENDSEC"]; }
  function textEnt(layer,x,y,txt,height=6){
    return ["0","TEXT","8",layer,"10",String(x),"20",String(y),"30","0","40",String(height),"1",txt];
  }
  function polyRect(layerName,x,y,w,h){
    const pts=[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
    const out=["0","POLYLINE","8",layerName,"66","1","70","1"];
    for(const [px,py] of pts) out.push("0","VERTEX","8",layerName,"10",String(px),"20",String(py),"30","0");
    out.push("0","SEQEND");
    return out;
  }
  function normalize(e){
    let x=e.xIn, y=e.yIn;
    if(e.corner==="NE") x=e.xIn-e.wIn;
    else if(e.corner==="SW") y=e.yIn-e.hIn;
    else if(e.corner==="SE"){x=e.xIn-e.wIn; y=e.yIn-e.hIn;}
    return {x,y,w:e.wIn,h:e.hIn};
  }

  registerExporter({
    id:"dxf",
    name:"DXF (2D, layers by type)",
    export(ctx, opts){
      const visibleOnly=!!opts?.visibleOnly;
      const floors=(ctx.HOUSE.floors||[]).filter(f=>!visibleOnly || ctx.state.visibleFloors.has(f.id));
      const visType=(t)=> t==="Room" ? true : (!visibleOnly || ctx.state.visibleTypes.has(t));
      const typeOrder = ctx.ACTIVE?.typeOrder || ["Room","Door","Window","Opening","Outlet","Light"];

      const out=[];
      out.push(...header());

      const colorMap={Room:7,Door:2,Window:5,Opening:6,Outlet:3,Light:1};
      for(const t of typeOrder) out.push(...layer(t, colorMap[t]||7));

      out.push(...endTables());
      out.push("0","SECTION","2","ENTITIES");

      let yOffset=0;
      const floorGap=240; // inches between floors

      for(const f of floors){
        out.push(...textEnt("Room", 0, yOffset-20, f.name, 10));

        for(const r of (f.rooms||[])){
          if(visType("Room")){
            const rr=normalize(r);
            out.push(...polyRect("Room", rr.x, rr.y+yOffset, rr.w, rr.h));
            if(r.name) out.push(...textEnt("Room", rr.x+rr.w/2, rr.y+yOffset+rr.h/2, r.name, 8));
          }

          for(const it of (r.items||[])){
            if(!visType(it.type)) continue;
            const ir=normalize(it);
            const rr=normalize(r);
            out.push(...polyRect(it.type, rr.x+ir.x, rr.y+yOffset+ir.y, ir.w, ir.h));
            if(it.name) out.push(...textEnt(it.type, rr.x+ir.x+ir.w/2, rr.y+yOffset+ir.y+ir.h/2, it.name, 6));
          }
        }

        yOffset += floorGap;
      }

      out.push("0","ENDSEC","0","EOF");
      return out.join("\n");
    }
  });
})();
