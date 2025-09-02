// /map3000/js/app.js — centralized boot with visible errors caught by index.html
export async function start(){
  // Import modules in one place so index.html can catch any import/boot errors
  const CFG   = await import('./config.js');
  const DATA  = await import('./data.js');
  const MARK  = await import('./markers.js');
  const AREAS = await import('./areas.js');
  const HEAT  = await import('./heat.js');
  const RPT   = await import('./report.js');
  const UI    = await import('./ui.js');

  // Map + global state
  const map   = UI.initMap(CFG);
  const state = UI.initState(map, CFG);
  // Expose to other modules that reference window.state
  window.state = state;

  // Load data (poles + permits). data.js already resolves your /data/ path.
  await DATA.load(state, CFG);

  // Initialize subsystems
  MARK.init(map, state, CFG);     // clusters + single-layer + marker renderers
  AREAS.init(map, state, CFG);    // dedicated 'areas-pane' with high z-index glow
  UI.mountPanels(map, state, CFG, { MARK, AREAS, HEAT, RPT }); // UI wiring

  // FIRST RENDER — ORDER MATTERS:
  // 1) markers set bounds, 2) areas draw with neon + bringToFront, 3) view mode visuals
  MARK.render({ cluster: true });
  AREAS.rebuild();                // boundaries now unmistakable
  UI.updateViewMode();

  // Optional: re-draw areas after filters or view changes are applied by UI (UI calls these)
  // Nothing else needed here unless you add live data streaming.
}
