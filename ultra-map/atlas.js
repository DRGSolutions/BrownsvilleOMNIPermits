// Build a tiny 3-glyph icon atlas (white glyphs so deck IconLayer can tint colors)
// glyphs: circle, triangle, diamond; 64x64 each
export const ICON_SIZE = 64;

function drawAtlas(){
  const s = ICON_SIZE;
  const cols = 3, rows = 1;
  const cv = document.createElement('canvas');
  cv.width = s*cols; cv.height = s*rows;
  const g = cv.getContext('2d');
  g.clearRect(0,0,cv.width,cv.height);
  g.fillStyle = 'white';
  g.strokeStyle = 'white'; g.lineWidth = 2;

  // circle @ x=0
  g.beginPath(); g.arc(s/2, s/2, s*0.35, 0, Math.PI*2); g.fill(); g.closePath();
  // triangle @ x=1
  const x1 = s + s/2, y1 = s*0.18, y2 = s*0.82, dx = s*0.32;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1+dx, y2); g.lineTo(x1-dx, y2); g.closePath(); g.fill();
  // diamond @ x=2
  const x2 = s*2 + s/2, yM = s/2, r = s*0.36;
  g.beginPath(); g.moveTo(x2, yM-r); g.lineTo(x2+r, yM); g.lineTo(x2, yM+r); g.lineTo(x2-r, yM); g.closePath(); g.fill();

  return cv.toDataURL('image/png');
}

export const ICON_ATLAS = drawAtlas();

// mapping: pixel coords in the atlas
export const ICON_MAPPING = {
  circle:   {x:0,          y:0, width:ICON_SIZE, height:ICON_SIZE, mask:true, anchorX:ICON_SIZE/2, anchorY:ICON_SIZE/2},
  triangle: {x:ICON_SIZE,  y:0, width:ICON_SIZE, height:ICON_SIZE, mask:true, anchorX:ICON_SIZE/2, anchorY:ICON_SIZE/2},
  diamond:  {x:ICON_SIZE*2,y:0, width:ICON_SIZE, height:ICON_SIZE, mask:true, anchorX:ICON_SIZE/2, anchorY:ICON_SIZE/2}
};

export function ownerToIcon(owner){
  if (owner==='BPUB') return 'circle';
  if (owner==='AEP')  return 'triangle';
  return 'diamond'; // MVEC default
}
