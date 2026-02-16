(function(){
  function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function normalize(e){
    let x=e.xIn, y=e.yIn;
    if(e.corner==="NE") x=e.xIn-e.wIn;
    else if(e.corner==="SW") y=e.yIn-e.hIn;
    else if(e.corner==="SE"){x=e.xIn-e.wIn; y=e.yIn-e.hIn;}
    return {x,y,w:e.wIn,h:e.hIn};
  }

  registerExporter({
    id:"svg",
    name:"SVG (standalone)",
    export(ctx, opts){
      const visibleOnly=!!opts?.visibleOnly;
      const ppi=ctx.state.ppi;

      const floors=(ctx.HOUSE.floors||[]).filter(f=>!visibleOnly || ctx.state.visibleFloors.has(f.id));
      const visType=(t)=> t==="Room" ? true : (!visibleOnly || ctx.state.visibleTypes.has(t));
      const typeOrder = ctx.ACTIVE?.typeOrder || ["Room","Door","Window","Opening","Outlet","Light"];

      const padIn=24;
      let yCursor=0;
      let maxW=0;
      const groups=[];

      for(const f of floors){
        // simple bounds
        let maxX=0,maxY=0;
        for(const r of (f.rooms||[])){
          const rr=normalize(r);
          maxX=Math.max(maxX, rr.x+rr.w);
          maxY=Math.max(maxY, rr.y+rr.h);
          for(const it of (r.items||[])){
            const ir=normalize(it);
            maxX=Math.max(maxX, rr.x+ir.x+ir.w);
            maxY=Math.max(maxY, rr.y+ir.y+ir.h);
          }
        }

        const wPx=(maxX+padIn)*ppi;
        const hPx=(maxY+padIn)*ppi;
        maxW=Math.max(maxW,wPx);

        const g=[];
        g.push(`<g id="${esc(f.id)}" data-floor="${esc(f.name)}" transform="translate(0 ${yCursor})">`);
        g.push(`<text x="10" y="18" font-family="system-ui,Arial" font-size="14" fill="#111">${esc(f.name)}</text>`);

        for(const t of typeOrder){
          if(!visType(t)) continue;

          if(t==="Room"){
            for(const r of (f.rooms||[])){
              const rr=normalize(r);
              const x=rr.x*ppi, y=rr.y*ppi, w=rr.w*ppi, h=rr.h*ppi;
              const stroke=r.lineColor||"#000";
              const fill=r.fillColor||"rgba(0,0,0,0)";
              g.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="2" />`);
              if(r.name){
                g.push(`<text x="${x+w/2}" y="${y+h/2}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,Arial" font-size="12" fill="#111">${esc(r.name)}</text>`);
              }
            }
            continue;
          }

          for(const r of (f.rooms||[])){
            const rr=normalize(r);
            for(const it of (r.items||[]).filter(i=>i.type===t)){
              const ir=normalize(it);
              const x=(rr.x+ir.x)*ppi, y=(rr.y+ir.y)*ppi, w=ir.w*ppi, h=ir.h*ppi;
              const stroke=it.lineColor||"#000";
              const fill=it.fillColor||"rgba(0,0,0,0)";
              g.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="2" />`);
              if(it.name){
                g.push(`<text x="${x+w+4}" y="${y}" font-family="system-ui,Arial" font-size="11" fill="#111">${esc(it.name)}</text>`);
              }
            }
          }
        }

        g.push(`</g>`);
        groups.push(g.join("\n"));
        yCursor += hPx + 24;
      }

      const totalH=Math.max(1,yCursor);
      return `<?xml version="1.0" encoding="UTF-8"?>\n`+
        `<svg xmlns="http://www.w3.org/2000/svg" width="${maxW}" height="${totalH}" viewBox="0 0 ${maxW} ${totalH}">\n`+
        `<rect x="0" y="0" width="${maxW}" height="${totalH}" fill="#fff"/>\n`+
        groups.join("\n")+
        `\n</svg>`;
    }
  });
})();
