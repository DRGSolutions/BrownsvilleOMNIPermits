// /map3000/js/app.js
export async function start(){
  // Import modules here so index.html can catch failures
  const CFG   = await import('./config.js');
  const DATA  = await import('./data.js');
  const MARK  = await import('./markers.js');
  const AREAS = await import('./areas.js');
  const HEAT  = await import('./heat.js');
  const RPT   = await import('./report.js');
  const UI    = await import('./ui.js');

  // Map + state
  const map   = UI.initMap(CFG);
  const state = UI.initState(map, CFG);

  // Make modules reachable from others that rely on global 'state'
  window.state = state;

  // Load data
  await DATA.load(state, CFG);

  // Init subsystems
  MARK.init(map, state, CFG);
  AREAS.init(map, state, CFG);
  UI.mountPanels(map, state, CFG, { MARK, AREAS, HEAT, RPT });

  // First paint
  MARK.render({ cluster: true });
  AREAS.rebuild();
  UI.updateViewMode();
}
