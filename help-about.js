const HELP_ABOUT_TEMPLATE = `
  <!-- ── ABOUT ─────────────────────────────── -->
  <div class="helpAbout">
    <div class="helpAboutTitle">⚒ Structure Forge</div>
    <div class="helpAboutByline">by ExF Productions</div>
    <div class="helpAboutDesc">
      Browser-based floor &amp; structure layout tool.<br>
      Model buildings with floors, rooms, and objects.
    </div>
  </div>

  <div class="helpDivider"></div>

  <!-- ── CORNER REFERENCE ──────────────────── -->
  <div class="helpSection">
    <div class="helpSectionTitle">📐 Corner Reference</div>
    <div class="helpGrid2">
      <div class="helpCornerCard"><span class="helpAccentStrong">NW</span><br><span class="helpMutedXs">North-West</span></div>
      <div class="helpCornerCard"><span class="helpAccentStrong">NE</span><br><span class="helpMutedXs">North-East</span></div>
      <div class="helpCornerCard"><span class="helpAccentStrong">SW</span><br><span class="helpMutedXs">South-West</span></div>
      <div class="helpCornerCard"><span class="helpAccentStrong">SE</span><br><span class="helpMutedXs">South-East</span></div>
    </div>
    <div class="helpMutedSm">The selected corner defines which point the <strong class="helpStrong">(X, Y)</strong> coordinate refers to on the element. Can be used to designate hinges.</div>
  </div>

  <div class="helpDivider"></div>

  <!-- ── MOUSE CONTROLS ────────────────────── -->
  <div class="helpSection">
    <div class="helpSectionTitle">🖱 Mouse Controls</div>
    <div class="helpCol5">
      <div class="helpRow">
        <span class="helpPill">L-Click</span>
        <span class="helpMutedSm">Select a single object</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">L-Drag</span>
        <span class="helpMutedSm">Move selected object(s)</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Shift/Ctrl + L-Click</span>
        <span class="helpMutedSm">Add/remove items in multi-select</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">L-Drag (empty space)</span>
        <span class="helpMutedSm">Lasso select items in drag box</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Corner</span>
        <span class="helpMutedSm">Drag a corner or wall handle to resize</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">R-Drag</span>
        <span class="helpMutedSm">Pan the canvas</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Scroll</span>
        <span class="helpMutedSm">Zoom in / out</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">R-Click</span>
        <span class="helpMutedSm">Context menu — copy/cut/paste, group/ungroup, duplicate, delete, lock</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Swatch</span>
        <span class="helpMutedSm">Click color swatch to open color picker</span>
      </div>
    </div>
  </div>

  <div class="helpDivider"></div>

  <!-- ── KEYBOARD SHORTCUTS ────────────────── -->
  <div class="helpSection">
    <div class="helpSectionTitle">⌨ Keyboard Shortcuts</div>
    <div class="helpCol5">
      <div class="helpRow">
        <span class="helpPill">Ctrl+Z</span>
        <span class="helpMutedSm">Undo</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Ctrl+Shift+Z / Ctrl+Y</span>
        <span class="helpMutedSm">Redo</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Ins / Ctrl+D</span>
        <span class="helpMutedSm">Duplicate selected object</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Ctrl+C / Ctrl+Ins</span>
        <span class="helpMutedSm">Copy selected room or item</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Ctrl+X</span>
        <span class="helpMutedSm">Cut selected room or item</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Ctrl+V / Shift+Ins</span>
        <span class="helpMutedSm">Paste into selected room (or the room containing the selected item)</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Ctrl+A</span>
        <span class="helpMutedSm">Select all item instances (outside text fields)</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Del</span>
        <span class="helpMutedSm">Delete selected object</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Ctrl+O</span>
        <span class="helpMutedSm">Open file (import JSON)</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Ctrl+S</span>
        <span class="helpMutedSm">Save file (export JSON)</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Ctrl+P</span>
        <span class="helpMutedSm">Collapse panel and print</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Shift+N</span>
        <span class="helpMutedSm">New structure</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Shift+1</span>
        <span class="helpMutedSm">Zoom to fit (all)</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Shift+2</span>
        <span class="helpMutedSm">Zoom to selection</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Shift+3</span>
        <span class="helpMutedSm">Zoom to fit width (scroll top)</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Shift+4</span>
        <span class="helpMutedSm">Zoom to fit height (scroll left)</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Shift+G / Shift+'</span>
        <span class="helpMutedSm">Toggle grid</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Shift+= / Shift++</span>
        <span class="helpMutedSm">Grid size up</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Shift+-</span>
        <span class="helpMutedSm">Grid size down</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">↑↓←→</span>
        <span class="helpMutedSm">Nudge selected object</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">⇧ + ↑↓←→</span>
        <span class="helpMutedSm">Nudge larger step</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Shift + W / A / S / D</span>
        <span class="helpMutedSm">Align multi-selected items to last selected item edge</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Alt+G / Alt+Shift+G</span>
        <span class="helpMutedSm">Group / ungroup selected items</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Esc</span>
        <span class="helpMutedSm">Clear selection or abort drag</span>
      </div>
      <div class="helpRow">
        <span class="helpPill">Enter</span>
        <span class="helpMutedSm">Commit inline rename</span>
      </div>
    </div>
  </div>

  <div class="helpDivider"></div>

  <!-- ── FEATURES ───────────────────────────── -->
  <div class="helpSection">
    <div class="helpSectionTitle">✨ Features</div>
    <div class="helpCol4 helpMutedSm">
      <div>📂 &nbsp;Multi-structure &amp; multi-floor projects</div>
      <div>🏠 &nbsp;Typed elements: Rooms, Doors, Windows,<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Outlets, Lights, custom types &amp; more</div>
      <div>📏 &nbsp;Measurements in inches; adjustable scale</div>
      <div>🔢 &nbsp;Selectable units: inches, ft/in, metric</div>
      <div>🔄 &nbsp;Rotate items and rooms</div>
      <div>📐 &nbsp;Area &amp; perimeter calculations per room/floor</div>
      <div>📏 &nbsp;Canvas rulers and optional snap grid</div>
      <div>🔒 &nbsp;Lock objects to prevent accidental edits</div>
      <div>🧲 &nbsp;Multi-select with additive click + lasso (Ctrl-click ignores group expansion)</div>
      <div>🎨 &nbsp;Per-type default colors &amp; dimensions</div>
      <div>🌓 &nbsp;Dark / light theme toggle</div>
      <div>💾 &nbsp;Autosave to browser storage</div>
      <div>↕️ &nbsp;Drag &amp; drop items between rooms</div>
      <div>🧩 &nbsp;Item grouping with selective group/ungroup actions</div>
      <div>🔁 &nbsp;Assign / reassign item room from detail panel</div>
      <div>🔺 &nbsp;Non-rectangular shapes: circle, triangle,<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;polygon with configurable sides</div>
    </div>
  </div>

  <div class="helpDivider"></div>

  <!-- ── WORKFLOW TIPS ──────────────────────── -->
  <div class="helpSection">
    <div class="helpSectionTitle">💡 Tips</div>
    <div class="helpCol5 helpMutedSm">
      <div>• <strong class="helpStrong">Add New Item</strong> pre-populates floor &amp; room from your last canvas click.</div>
      <div>• <strong class="helpStrong">Z-order</strong> is type-based. Use ↑↓ arrows in Element Visibility to layer types.</div>
      <div>• <strong class="helpStrong">Fill Opacity</strong> steps in increments of 0.1 (0 = transparent, 1 = solid).</div>
      <div>• <strong class="helpStrong">Export formats:</strong> JSON (canonical), Text, SVG, DXF, LOGO (turtle).</div>
    </div>
  </div>

  <div class="helpDivider"></div>

  <!-- ── CREDITS ────────────────────────────── -->
  <div class="helpCredits">
    <div class="helpSectionTitle">🏅 Credits</div>
    <div>Built with ♥ by <strong class="helpStrong">ExF Productions</strong></div>
    <div class="sf-mt4">
      <a href="https://github.com/fpdavis/Structure-Forge" target="_blank" class="helpLink">github.com/fpdavis/Structure-Forge</a>
    </div>
    <div class="helpTinyMuted">No external libraries · Pure JS + SVG</div>
  </div>
`;

function loadHelpAboutContent(){
  const host = document.getElementById("helpAboutContent");
  if(!host) return;
  host.innerHTML = HELP_ABOUT_TEMPLATE;
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", loadHelpAboutContent, {once:true});
} else {
  loadHelpAboutContent();
}
