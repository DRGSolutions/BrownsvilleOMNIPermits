// /map3000/js/app.js — centralized boot, exposes global `state`
export async function start(){
  const CFG   = await import('./config.js');
  const DATA  = await import('./data.js');
  const MARK  = await import('./markers.js');
  const AREAS = await import('./areas.js');
  const HEAT  = await import('./heat.js');
  const RPT   = await import('./report.js');
  const UI    = await import('./ui.js');

  const map   = UI.initMap(CFG);
  const state = UI.initState(map, CFG);

  // IMPORTANT: make state visible to console and any lazy modules
  window.state = state;

  await DATA.load(state, CFG);

  MARK.init(map, state, CFG);
  AREAS.init(map, state, CFG);
  UI.mountPanels(map, state, CFG, { MARK, AREAS, HEAT, RPT });

  // First paint — order matters: markers → areas → apply view mode
  MARK.render({ cluster: true });
  AREAS.rebuild();
  UI.updateViewMode();
}
