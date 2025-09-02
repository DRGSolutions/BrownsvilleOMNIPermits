// /map3000/js/app.js — centralized boot, exposes global `state`
export async function start() {
  const CFG   = await import('./config.js');
  const DATA  = await import('./data.js');
  const MARK  = await import('./markers.js');
  const AREAS = await import('./areas.js');
  const HEAT  = await import('./heat.js');
  const RPT   = await import('./report.js');
  const UI    = await import('./ui.js');

  const map   = UI.initMap(CFG);
  const state = UI.initState(map, CFG);

  // >>> CRITICAL: expose to console + lazy modules
  window.state = state;

  await DATA.load(state, CFG);

  MARK.init(map, state, CFG);
  AREAS.init(map, state, CFG);
  UI.mountPanels(map, state, CFG, { MARK, AREAS, HEAT, RPT });

  // First paint — markers set bounds, then areas, then view mode styling
  MARK.render({ cluster: true });
  AREAS.rebuild();
  UI.updateViewMode();
}
