(function(){
  "use strict";

  const SCHEMA_VERSION = 6;

  /**
   * Strip a room object down to only non-default, non-inferrable fields:
   *  - type "Room"      → omit (implied by floor.rooms containment)
   *  - floorId          → omit (inferred from containment)
   *  - corner "NW"      → omit (universal default)
   *  - description ""   → omit (empty)
   *  - name "Room"      → kept (rooms always have meaningful names)
   */
  function stripRoom(room, typeDefaults) {
    const r = Object.assign({}, room);
    delete r.type;
    delete r.floorId;
    if (r.corner    === "NW") delete r.corner;
    if (r.description === "") delete r.description;
    if (r.items) r.items = r.items.map(it => stripItem(it, typeDefaults));
    return r;
  }

  /**
   * Strip an item down to only non-default, non-inferrable fields:
   *  - roomId                  → omit (inferred from containment)
   *  - corner "NW"             → omit (default)
   *  - description ""          → omit (empty)
   *  - name === type           → omit (redundant; restored to type on load)
   *  - wIn/hIn/heightIn        → omit when equal to type's defaultWIn/defaultHIn/defaultHeightIn
   *  - lineColor/cornerColor/
   *    fillColor/fillAlpha/
   *    strokeWidth              → omit when equal to type's defaults
   */
  function stripItem(item, typeDefaults) {
    const it = Object.assign({}, item);
    const td = typeDefaults[it.type] || {};

    delete it.roomId;
    if (it.corner      === "NW") delete it.corner;
    if (it.description === "")   delete it.description;
    if (it.name        === it.type) delete it.name;

    // Dimension defaults
    if (it.wIn      === td.defaultWIn)      delete it.wIn;
    if (it.hIn      === td.defaultHIn)      delete it.hIn;
    if (it.heightIn === td.defaultHeightIn) delete it.heightIn;

    // Style defaults (only strip when explicitly equal; null/undefined means "use type default" and is already absent)
    if (it.lineColor   === td.defaultLineColor)   delete it.lineColor;
    if (it.cornerColor === td.defaultCornerColor) delete it.cornerColor;
    if (it.fillColor   === td.defaultFillColor)   delete it.fillColor;
    if (it.fillAlpha   === td.defaultFillAlpha)   delete it.fillAlpha;
    if (it.strokeWidth === td.strokeWidth)        delete it.strokeWidth;

    return it;
  }

  /**
   * Normalise the types block to object format (keyed by type name, no "name" field),
   * then strip each type's fields that are implied by position/containment.
   * Input may be either list [{name,…}] or object {TypeName:{…}}.
   */
  function normaliseTypes(rawTypes) {
    if (!rawTypes) return {};
    // List → object
    if (Array.isArray(rawTypes)) {
      const obj = {};
      for (const t of rawTypes) { if (t && t.name) { const {name,...rest}=t; obj[name]=rest; } }
      return obj;
    }
    return rawTypes;
  }

  function stripStructure(struct, typeDefaults) {
    const s = Object.assign({}, struct);
    s.types = normaliseTypes(s.types);
    if (s.house && s.house.floors) {
      s.house = Object.assign({}, s.house, {
        floors: s.house.floors.map(floor => {
          const f = Object.assign({}, floor);
          if (f.rooms) f.rooms = f.rooms.map(r => stripRoom(r, typeDefaults));
          return f;
        })
      });
    }
    return s;
  }

  registerExporter({
    id: "json",
    name: "JSON (native format)",
    export(ctx, opts) {
      // typeDefaults comes from the live ACTIVE.types (already normalised to object)
      const typeDefaults = ctx.ACTIVE.types || {};

      let clone = JSON.parse(JSON.stringify(ctx.APP));

      if (opts?.visibleOnly) {
        // Only export the active structure, with only visible floors and visible item types.
        const active = clone.structures.find(s => s.id === clone.activeId) || clone.structures[0];
        const visFloors = ctx.state.visibleFloors;
        const visTypes  = (t) => t === "Room" ? true : ctx.state.visibleTypes.has(t);
        active.house.floors = (active.house.floors || [])
          .filter(f => visFloors.has(f.id))
          .map(f => {
            if (f.rooms) f.rooms = f.rooms.map(r => {
              r.items = (r.items || []).filter(it => visTypes(it.type));
              return r;
            });
            return f;
          });
        // Discard all other structures — visible-only export is scoped to the active structure only.
        clone.structures = [active];
      }

      const out = {
        application: "ExF Productions' Structure Forge",
        url: window.location.href,
        dateTime: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
        activeId: clone.activeId,
        structures: clone.structures.map(s => stripStructure(s, typeDefaults))
      };

      return JSON.stringify(out, null, 2);
    }
  });
})();
