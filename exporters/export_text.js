(function(){
  "use strict";

  // Text exporter requirements:
  // - Use feet and inches
  // - Round inches to nearest half inch
  // - Name comes first; append [Type] only if name isn't an exact match to the type
  // - Include description
  // - Corner formatting: "NW @" (no "corner=")
  // - Do not include scale
  // - Include counts

  const roundToHalfIn = (v)=> Math.round((Number(v) || 0) * 2) / 2;

  function fmtInPart(inches){
    const v = roundToHalfIn(inches);
    const whole = Math.floor(v);
    const frac = v - whole;
    if(frac === 0) return `${whole}`;
    // Only expecting 0.5 increments
    if(whole === 0) return `1/2`;
    return `${whole} 1/2`;
  }

  function fmtFtIn(inches){
    const v = roundToHalfIn(inches);
    const sign = v < 0 ? "-" : "";
    const abs = Math.abs(v);

    const feet = Math.floor(abs / 12);
    const remIn = abs - (feet * 12);

    const inStr = fmtInPart(remIn);
    return `${sign}${feet}' ${inStr}"`;
  }

  function norm(s){
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function displayNameWithOptionalType(name, type){
    const t = String(type || "").trim();
    const n = String(name || "").trim();

    if(!n) return t || "";
    if(!t) return n;

    // Only suppress [Type] when the name exactly matches the type.
    if(norm(n) === norm(t)) return n;
    return `${n} [${t}]`;
  }

  function addCounts(lines, floors){
    let roomCount = 0;
    let itemTotal = 0;
    const byType = new Map();

    for(const f of floors){
      for(const r of (f.rooms || [])){
        roomCount++;
        for(const it of (r.items || [])){
          itemTotal++;
          const k = it?.type || "Unknown";
          byType.set(k, (byType.get(k) || 0) + 1);
        }
      }
    }

    lines.push(`Counts: floors=${floors.length}, rooms=${roomCount}, items=${itemTotal}`);
    const types = [...byType.keys()].sort((a,b)=> String(a).localeCompare(String(b)));
    for(const t of types){
      lines.push(`  ${t}: ${byType.get(t)}`);
    }
    lines.push("");
  }

  registerExporter({
    id: "text",
    name: "Plain text (human-friendly)",
    export(ctx, opts){
      const visibleOnly = !!opts?.visibleOnly;

      const floors = (ctx.HOUSE.floors || [])
        .filter(f => !visibleOnly || ctx.state.visibleFloors.has(f.id))
        .map(f => {
          // For visibleOnly, also filter items by type visibility (Room always visible).
          const out = {...f};
          out.rooms = (f.rooms || []).map(r => {
            const rr = {...r};
            rr.items = (r.items || []).filter(it => {
              if(!visibleOnly) return true;
              if(it?.type === "Room") return true;
              return ctx.state.visibleTypes.has(it?.type);
            });
            return rr;
          });
          return out;
        });

      const lines = [];
      lines.push(`Structure: ${ctx.ACTIVE?.name || ""}`);
      lines.push("");

      addCounts(lines, floors);

      for(const f of floors){
        lines.push(`FLOOR: ${f.name}`);
        for(const r of (f.rooms || [])){
          const rName = displayNameWithOptionalType(r.name, "Room");
          const rDesc = (r.description || "").trim();
          const descSuffix = rDesc ? ` — ${rDesc}` : "";

          lines.push(
            `  ${rName} (${fmtFtIn(r.wIn)} x ${fmtFtIn(r.hIn)}) ${r.corner} @ (${fmtFtIn(r.xIn)}, ${fmtFtIn(r.yIn)})${descSuffix}`
          );

          for(const it of (r.items || [])){
            const nm = displayNameWithOptionalType(it.name, it.type);
            const itDesc = (it.description || "").trim();
            const itDescSuffix = itDesc ? ` — ${itDesc}` : "";

            lines.push(
              `    ${nm} (${fmtFtIn(it.wIn)} x ${fmtFtIn(it.hIn)}) ${it.corner} @ (${fmtFtIn(it.xIn)}, ${fmtFtIn(it.yIn)})${itDescSuffix}`
            );
          }
        }
        lines.push("");
      }

      return lines.join("\n").trimEnd();
    }
  });
})();