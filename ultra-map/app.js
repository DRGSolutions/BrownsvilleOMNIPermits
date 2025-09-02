import { loadData, buildContexts, toIconData, statusColorHex, hexToRGBA, distinctValues } from './data.js';
import { ICON_ATLAS, ICON_MAPPING, ownerToIcon, ICON_SIZE } from './atlas.js';
import { initFilterUI, buildPredicate } from './filters.js';
import { buildJobPolygons } from './boundaries.js';
import { wireUI, toast, renderLegendStatuses, renderReport, toggleReport, fillDetails } from './ui.js';

let MAP, OVERLAY, SHOW_BOUNDARIES=true;
let ALL_CTX=[], ICON_DATA=[], JOB_POLYS={ polys:[] };

function initMap(){
  MAP = new maplibregl.Map({
    container:'map',
    style:{
      version:8,
      name:'UltraDark',
      sources:{
        osm: { type:'raster', tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize:256, attribution:'© OSM' }
      },
      layers:[
        { id:'bg', type:'background', paint:{ 'background-color':'#05060a' }},
        { id:'osm', type:'raster', source:'osm', minzoom:0, maxzoom:20, paint:{ 'raster-opacity':0.85 } }
      ],
      glyphs:'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
    },
    center:[-97.5, 26.1], zoom:10, pitch:45, bearing:-12, dragRotate:true, touchZoomRotate:true,
    attributionControl:false
  });
  MAP.addControl(new maplibregl.NavigationControl({ visualizePitch:true }), 'bottom-right');
}

function makeLayers(filteredIconData){
  const { IconLayer, PolygonLayer, TextLayer } = deck;
  // Points: owner shapes tinted by status color, GPU-picked
  const points = new IconLayer({
    id:'poles',
    data: filteredIconData,
    iconAtlas: ICON_ATLAS,
    iconMapping: ICON_MAPPING,
    sizeScale: 1,
    getIcon: d => ownerToIcon(d.owner),
    getPosition: d => d.position,
    getSize: d => 24,                 // px
    getColor: d => hexToRGBA(statusColorHex(d.status), 230),
    pickable: true,
    onClick: info => { if (info.object) window.dispatchEvent(new CustomEvent('ui:pole-click',{ detail: info.object.ctx })); },
    parameters: { depthTest:false }
  });

  const layers = [points];

  if (SHOW_BOUNDARIES && JOB_POLYS.polys.length){
    const polys = new PolygonLayer({
      id:'job-polys',
      data: JOB_POLYS.polys,
      getPolygon: f => f.feature.geometry.coordinates,
      filled: true, stroked:true, pickable:false, extruded:false,
      getFillColor: f => hexToRGBA(f.color, 45),
      getLineColor: f => hexToRGBA(f.color, 180),
      lineWidthMinPixels: 1.5,
      parameters: { depthTest:false, blend: true }
    });
    const labels = new TextLayer({
      id:'job-labels',
      data: JOB_POLYS.polys,
      getPosition: f => f.centroid,
      getText: f => f.job,
      getSize: 16,
      getColor: [220,230,255,230],
      getBackgroundColor: [15,18,32,220],
      background: true,
      backgroundPadding: [6,4],
      fontFamily: 'ui-sans-serif, system-ui, Segoe UI, Roboto, Arial',
      parameters: { depthTest:false }
    });
    layers.push(polys, labels);
  }
  return layers;
}

function ensureOverlay(){
  if (OVERLAY) return;
  const { MapboxOverlay } = deck;
  OVERLAY = new MapboxOverlay({ layers: [] });
  MAP.addControl(OVERLAY);
}

function computeCounts(ctxs){
  const statusCounts = {};
  const ownerCounts = {};
  for(const c of ctxs){
    statusCounts[c.latestStatus] = (statusCounts[c.latestStatus]||0)+1;
    ownerCounts[c.pole.owner] = (ownerCounts[c.pole.owner]||0)+1;
  }
  for (const s of ['Approved','Submitted - Pending','Created - NOT Submitted','Not Approved - Cannot Attach','Not Approved - PLA Issues','Not Approved - MRE Issues','Not Approved - Other Issues','NONE']){
    statusCounts[s] = statusCounts[s] || 0;
  }
  return { statusCounts, ownerCounts };
}

function applyFilter(filter){
  const pred = buildPredicate(filter);
  const filteredCtx = ALL_CTX.filter(pred);
  const data = toIconData(filteredCtx);
  OVERLAY.setProps({ layers: makeLayers(data) });

  // Legend + report
  const groups = new Map();
  for(const c of filteredCtx){
    const k=c.pole.job_name; if(!groups.has(k)) groups.set(k,0); groups.set(k, groups.get(k)+1);
  }
  const { statusCounts, ownerCounts } = computeCounts(filteredCtx);
  renderLegendStatuses(statusCounts);
  renderReport({ poles: filteredCtx.map(x=>x.pole), groups, statusCounts, ownerCounts });

  if (filteredCtx[0]) fillDetails(filteredCtx[0]);
}

async function main(){
  initMap(); ensureOverlay();
  try{
    const { poles, permits } = await loadData();
    ALL_CTX = buildContexts(poles, permits);
    ICON_DATA = toIconData(ALL_CTX);

    // Job polygons (one-time, overlap-aware) — heavy-lifting but done once
    JOB_POLYS = buildJobPolygons(ALL_CTX);

    // Filters UI
    const statusSet = new Set(permits.map(r=>r.permit_status));
    ['Created - NOT Submitted','Submitted - Pending','Approved','Not Approved - Cannot Attach','Not Approved - PLA Issues','Not Approved - MRE Issues','Not Approved - Other Issues','NONE'].forEach(s=>statusSet.add(s));
    initFilterUI({ poles, permits, statuses:Array.from(statusSet) }, applyFilter);

    // Wire toggles
    document.getElementById('toggleBoundaries').addEventListener('change', (e)=>{ SHOW_BOUNDARIES=!!e.target.checked; applyFilter(null); });
    wireUI({ onToggleBoundaries:(on)=>{ SHOW_BOUNDARIES=on; applyFilter(null); }, onReportToggle:()=> toggleReport(document.getElementById('report').classList.contains('hidden')) });

    // First render
    OVERLAY.setProps({ layers: makeLayers(ICON_DATA) });
    applyFilter(null);
    toast('Ultra Map ready');
  }catch(e){
    console.error(e); toast(`Load error: ${e.message}`);
  }
}
main();
