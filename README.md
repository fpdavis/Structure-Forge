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

---

## Known Bugs

- **Right mouse selection fix**
  - Remove right mouse selection ability. Right-click interactions can interfere with selection behavior (selection vs context/pan behavior needs consistent rules).

---

## TODO List

### 2) Core editing enhancements (easy → medium)
- **Define nomenclature**
  - Standard terms for: structure, floor, room, item/object, type, instance
  - Document canonical coordinate system and corner semantics
- **Fill Opacity Steps should be .1**
- **Label z-index should be on top of all objects**
- **Additional keyboard shortcuts**
- **Keyboard nudging**
  - Arrow keys
  - Shift for larger step
- **Inline rename in lists**
  - Enter to commit
  - Esc to cancel
- **Drop down on object details for what room the object belongs to**
  - Reassign item to a different room from the details panel
- **Ability to drag and drop objects from one room to another**
  - From list to list, or via canvas drop target
- Autosave support (and conflict handling with localStorage)

### 3) Interaction + UX improvements (medium)
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
- **Help pop up**
  - Quick-start, controls, shortcuts
- **Credits**
  - Acknowledge libraries, contributors, inspirations

### 4) Geometry + analysis features (medium → hard)
- **Rotation**
  - Rotate items, and optionally rooms
  - Persist rotation and update export logic
- **Area and perimeter calculations**
  - Per room
  - Totals per floor
- **Rulers and guides**
  - Rulers along X/Y axis
  - Optional grid and snap integration

### 5) Advanced object modeling (hard)
- **Different object shapes**
  - Circle, triangle, pentagon, hexagon, etc.
  - Option: user-defined number of sides from 3 (triangle) to 360 (circle)
  - Editing handles and hit-testing for arbitrary polygons
  - Export implications for non-rectangular shapes
