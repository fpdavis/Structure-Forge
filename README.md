# Structure Forge

GitHub: https://github.com/fpdavis/Structure-Forge  
Live: https://fpdavis.github.io/Structure-Forge/

## About

Structure Forge is a browser-based floor/structure layout tool for quickly modeling buildings using floors, rooms, and placeable objects (doors, windows, outlets, furniture, fixtures). It is designed to be simple, fast, and export-friendly, with a JSON-based project format and pluggable exporters.

## Description / Purpose

- Create and edit multi-structure projects (house, detached garage, shed, etc.)
- Model floors and rooms, then place objects inside rooms
- Visualize layouts on a canvas with basic editing tools
- Export layouts to multiple formats via exporter modules

## Glossary

Use these terms consistently in docs, bug reports, PRs, and discussion.

### Data model terms
- **Project**: top-level file payload (`schemaVersion`, `activeId`, `structures`)
- **Structure**: one building/unit within a project (`structures[]`)
- **Floor**: one level inside a structure (`house.floors[]`)
- **Room**: rectangular space inside a floor (`floor.rooms[]`)
- **Item Instance** (or **Item** in UI): placed object inside a room (`room.items[]`)
- **Item Type**: reusable definition in `structure.types` (defaults like size/color/height)
- **Geometry**: `xIn`, `yIn`, `wIn`, `hIn`, `heightIn`, `corner`

### Geometry and coordinate terms
- **Units source**: persisted geometry values are interpreted by `structure.viewConfiguration.units` (`imperial` or `metric`)
- **Global origin**: canvas top-left, with +X right and +Y down
- **Room coordinates**: floor-relative
- **Item coordinates**: room-relative before normalization
- **Corner anchor**: `corner` (`NW`, `NE`, `SW`, `SE`) defines which rectangle corner `xIn`/`yIn` refer to
- **Normalization**: convert any corner-anchored rectangle to NW absolute rect for rendering/export

### Left sidebar panel names
Use these exact names when referring to UI sections:
- `Selected`
- `Add New Item`
- `View`
- `Floors`
- `Elements Visibility / Order`
- `Label Visibility`
- `Counts`
- `Configuration`
- `Export / Import`
- `Help / About`

---

## TODO List

### Core editing enhancements (easy → medium)
- **Cleanup work needed to align application with glossary terms**
  - Standardize visible UI copy (`object` vs `item`, `element` vs `item`, capitalization of panel names)
  - Align internal code variable naming where low-risk (`HOUSE`/`house` vs `structure` terminology)
  - Add a README sidebar panel reference table (panel name, purpose, key actions, primary data affected)
  - Update exporter/docs language so data model and UI references match glossary terms
  - Add a bug-report reference convention in docs (example: `[Sidebar > Configuration] Door default width not applied`)
- **Additional keyboard shortcuts**
  - Select All: Ctrl + A — Quickly selects every element in the current layout.
  - Group / Ungroup: Ctrl + G to group selected elements and Ctrl + Shift + G to ungroup them.
  - Layer Order:
    - Bring Forward: Ctrl + ]
    - Send Backward: Ctrl + [
  - Align Top/Bottom/Left/Right: Using Alt + W/S/A/D provides a very fast way to snap elements to edges. 
- **Inline rename in lists**
  - Enter to commit
  - Esc to cancel
- **Drop down on object details for what room the object belongs to**
  - Reassign item to a different room from the details panel
- **Ability to drag and drop objects from one room to another**
  - From list to list, or via canvas drop target
- LocalStorage autosave all changes
- Multi-select
- Rulers along X/Y axis
- Optional grid snap
 
### Interaction + UX improvements (medium)
- **Lock/freeze objects to prevent accidental edits**
  - Per-object lock
  - Optional floor-level lock
- **Context menu (right-click)**
  - Duplicate, delete
  - Bring front/back
  - Lock/unlock
  - Rename
- **User selectable units**
  - Inches, feet/inches, metric
  - Display + input conversions
- **Theme toggle (dark/light) with persisted setting**
- **Improved User Interface**
  - Layout polish, discoverability, consistent controls

### Geometry + analysis features (medium → hard)
- **Rotation**
  - Rotate items, and optionally rooms
  - Persist rotation and update export logic

### Advanced object modeling (hard)
- **Different object shapes**
  - Circle, triangle, pentagon, hexagon, etc.
  - Option: user-defined number of sides from 3 (triangle) to 360 (circle)
  - Editing handles and hit-testing for arbitrary polygons
  - Export implications for non-rectangular shapes
