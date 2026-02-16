(function(){
  registerExporter({
    id:"json",
    name:"JSON (app format)",
    export(ctx, opts){
      if(!opts?.visibleOnly) return JSON.stringify(ctx.APP, null, 2);

      const clone = JSON.parse(JSON.stringify(ctx.APP));
      const active = clone.structures.find(s=>s.id===clone.activeId) || clone.structures[0];

      const visFloors = ctx.state.visibleFloors;
      const visTypes = (t)=> t==="Room" ? true : ctx.state.visibleTypes.has(t);

      active.house.floors = (active.house.floors||[])
        .filter(f=>visFloors.has(f.id))
        .map(f=>{
          if(f.rooms){
            f.rooms = (f.rooms||[]).map(r=>{
              r.items = (r.items||[]).filter(it=>visTypes(it.type));
              return r;
            });
          }
          return f;
        });

      return JSON.stringify(clone, null, 2);
    }
  });
})();
