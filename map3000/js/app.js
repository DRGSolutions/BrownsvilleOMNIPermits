// /map3000/js/app.js — centralized boot, single-run guard, exposes `state`
export async function start(){
  if (window.__APP_STARTED__) return;     // avoid double boot
  window.__APP_STARTED__ = true;

  const CFG   = await import('./config.js');
  const DATA  = await import('./data.js');
  const MARK  = await import('./markers.js');
  const AREAS = await import('./areas.js');
  const HEAT  = await import('./heat.js');
  const RPT   = await import('./report.js');
  const UI    = await import('./ui.js');

  const map   = UI.initMap(CFG);
  const state = UI.initState(map, CFG);
  window.state = state;                   // for console & lazy modules

  await DATA.load(state, CFG);

  MARK.init(map, state, CFG);
  AREAS.init(map, state, CFG);
  UI.mountPanels(map, state, CFG, { MARK, AREAS, HEAT, RPT });

  MARK.render({ cluster: true });
  AREAS.rebuild();
  UI.updateViewMode();
}
