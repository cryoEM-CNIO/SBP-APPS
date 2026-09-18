// PeakyParse — DOM-free UNICORN export parsing + MW-calibration math shared by
// index.html (the viewer) and calibrate.html (the calibration builder), so the
// two pages can never disagree on how a zip is decoded or how a Kav/Ve fit is
// computed. Classic script (no ES module) so it still works from file://.
(function(){

// ---------- zip → file map ----------

async function readZipToFileMap(file){
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const zipMap = {};
  for(const path of Object.keys(zip.files)){
    const entry = zip.files[path];
    if(entry.dir) continue;
    const data = await entry.async('uint8array');
    const base = path.split('/').pop();
    zipMap[base.toLowerCase()] = {name: base, data};
  }
  return zipMap;
}

// ---------- small XML helpers ----------

function textOf(node, tag){
  const el = node.querySelector(tag);
  return el ? el.textContent.trim() : '';
}

// Finds the volume of the injection event, if present, so a trace/peak can be
// re-zeroed at the point sample actually enters the system.
function findInjectionVolume(events){
  const priorities = [
    e => e.text === 'Injection valve Inject (Completed)',
    e => /inject/i.test(e.text) && /completed/i.test(e.text) && !/load/i.test(e.text),
    e => /inject/i.test(e.text) && !/load/i.test(e.text)
  ];
  for(const test of priorities){
    const found = events.find(test);
    if(found) return found.volume;
  }
  return null;
}

// Turns a curve name like "UV 1_280" into the conventional "UV 280 nm" label.
function curveDisplayLabelRaw(name){
  const m = name.match(/^UV\s*\d+_(\d{2,4})$/i);
  if(m) return 'UV ' + m[1] + ' nm';
  return name;
}

// Picks which curve should be shown by default when a file has no curve already
// selected. Real absorbance channels are strongly preferred over whatever else the
// export happens to list first (which can be an instrument diagnostic/system curve).
function pickDefaultUvCurve(curves){
  let c = curves.find(c=>curveDisplayLabelRaw(c.name)==='UV 280 nm');
  if(c) return c;
  c = curves.find(c=>curveDisplayLabelRaw(c.name)==='UV 260 nm');
  if(c) return c;
  c = curves.find(c=>c.name.trim().toUpperCase()==='UV');
  if(c) return c;
  return null;
}

// Reads Result.xml's base64-encoded ResultRunInformation payloads for the column
// name/volume and run start date — metadata that isn't in Chrom.N.Xml at all.
// UNICORN declares these payloads as utf-16 but actually writes them as plain
// single-byte-per-char ASCII, so atob() alone (no TextDecoder) gives usable text.
// Deliberately defensive: any missing file/node/malformed base64 just yields nulls.
function parseResultInfo(fileMap){
  const empty = {resultName: null, columnName: null, columnVolume: null, runStartDate: null};
  const entry = fileMap['result.xml'];
  if(!entry) return empty;
  try{
    const xmlText = new TextDecoder('utf-8').decode(entry.data);
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if(doc.querySelector('parsererror')) return empty;
    const resultName = textOf(doc.documentElement, 'Name') || null;
    let columnName = null, columnVolume = null, runStartDate = null;
    const riNodes = Array.from(doc.querySelectorAll('ResultRunInformation'));
    for(const node of riNodes){
      const type = node.getAttribute('RunInformationType');
      const raw = textOf(node, 'RunInformation');
      if(!raw) continue;
      let decoded;
      try{ decoded = atob(raw); }catch(e){ continue; }
      if(type === 'ColumnInformation'){
        try{
          const colDoc = new DOMParser().parseFromString(decoded, 'application/xml');
          const colNode = colDoc.querySelector('column');
          if(colNode){
            columnName = textOf(colNode, 'name') || null;
            const vol = parseFloat(textOf(colNode, 'volume'));
            columnVolume = isFinite(vol) ? vol : null;
          }
        }catch(e){ /* leave column fields null */ }
      } else if(type === 'RunStartDate'){
        runStartDate = decoded.trim() || null;
      }
    }
    return {resultName, columnName, columnVolume, runStartDate};
  }catch(e){
    return empty;
  }
}

// ---------- binary curve file decoding ----------
// UNICORN's per-curve binary blobs are themselves a tiny local zip-like container
// (PK local-file-header signatures with raw-deflate bodies, no real central
// directory) wrapping .NET NRBF-serialized primitive arrays.

function findAllSig(bytes){
  const out = [];
  const a=0x50,b=0x4b,c=0x03,d=0x04;
  for(let i=0;i<=bytes.length-4;i++){
    if(bytes[i]===a && bytes[i+1]===b && bytes[i+2]===c && bytes[i+3]===d) out.push(i);
  }
  return out;
}

function parseNRBF(u8){
  if(u8.length < 1) return null;
  if(u8[0] !== 0) return {text: new TextDecoder('utf-8').decode(u8)};
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let pos = 1 + 16;
  if(pos >= u8.length) return null;
  const recordType = u8[pos]; pos += 1;
  if(recordType !== 15) return null; // only ArraySinglePrimitive supported
  const length = dv.getInt32(pos+4, true);
  const ptype = u8[pos+8];
  const dataPos = pos+9;
  let arr;
  if(ptype === 11){ // Single (float32)
    arr = new Float64Array(length);
    for(let k=0;k<length;k++) arr[k] = dv.getFloat32(dataPos + k*4, true);
  } else if(ptype === 6){ // Double
    arr = new Float64Array(length);
    for(let k=0;k<length;k++) arr[k] = dv.getFloat64(dataPos + k*8, true);
  } else if(ptype === 8){ // Int32
    arr = new Float64Array(length);
    for(let k=0;k<length;k++) arr[k] = dv.getInt32(dataPos + k*4, true);
  } else {
    return null;
  }
  return {arr};
}

function decodeCurveFile(bytes){
  const offsets = findAllSig(bytes);
  if(!offsets.length) throw new Error('not a recognised curve container');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = {};
  for(let i=0;i<offsets.length;i++){
    const pos = offsets[i];
    const fnameLen = dv.getUint16(pos+26, true);
    const extraLen = dv.getUint16(pos+28, true);
    const name = new TextDecoder('utf-8').decode(bytes.slice(pos+30, pos+30+fnameLen));
    const dataStart = pos+30+fnameLen+extraLen;
    const dataEnd = (i+1<offsets.length) ? offsets[i+1] : bytes.length;
    const chunk = bytes.slice(dataStart, dataEnd);
    let inflated;
    try{ inflated = pako.inflateRaw(chunk); }
    catch(e){ continue; }
    entries[name] = parseNRBF(inflated);
  }

  let yArr=null, xArr=null, xUnit=null;
  for(const [name, val] of Object.entries(entries)){
    if(!val || !val.arr) continue;
    const lower = name.toLowerCase();
    if(lower.includes('amplitude')) { yArr = val.arr; }
    else if(lower.includes('volume')) { xArr = val.arr; xUnit = 'mL'; }
    else if(lower.includes('time')) { if(!xArr){ xArr = val.arr; xUnit = 'min'; } }
    else if(!yArr && !lower.includes('datatype')) { yArr = val.arr; }
  }
  if(!yArr) return null;
  return {y: yArr, x: xArr, xUnit};
}

// ---------- UNICORN export → pure curve/run data ----------
//
// Extracts everything derivable from the zip's own files alone (no app state, no
// DOM). Colour/axis/selection defaults, cross-run matching and anything else that
// depends on what's already loaded stay the caller's job — this function's output
// is used identically by the viewer (which does that decoration) and by
// calibrate.html (which doesn't need it at all).
function parseUnicornExport(fileMap){
  const xmlEntry = Object.values(fileMap).find(f=>/\.xml$/i.test(f.name));
  if(!xmlEntry){
    const looksLikeImage = Object.values(fileMap).some(f=>/\.(png|jpe?g|tif{1,2}|bmp|gif|webp)$/i.test(f.name));
    return {ok: false, error: looksLikeImage
      ? 'That looks like an image file, not a chromatogram export (.zip or .Xml + curve files).'
      : 'No .Xml metadata file found in that drop.'};
  }
  const xmlText = new TextDecoder('utf-8').decode(xmlEntry.data);
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if(doc.querySelector('parsererror')){
    return {ok: false, error: 'Could not parse the .Xml file.'};
  }

  const chromatogramName = textOf(doc.documentElement, 'ChromatogramName') || xmlEntry.name.replace(/\.xml$/i,'');
  const curveNodes = Array.from(doc.querySelectorAll('Curves > Curve'));
  const curves = [];

  for(const node of curveNodes){
    const name = textOf(node,'Name') || ('Curve '+(curves.length+1));
    const curveNumber = textOf(node,':scope > CurveNumber');
    const amplitudeUnit = textOf(node,'AmplitudeUnit') || '';
    const volumeUnit = textOf(node,'VolumeUnit') || '';
    const timeUnit = textOf(node,'TimeUnit') || '';
    const distBetween = parseFloat(textOf(node,'DistanceBetweenPoints'));
    const distStart = parseFloat(textOf(node,'DistanceToStartPoint'));
    const columnVolume = parseFloat(textOf(node,'ColumnVolume'));
    const binName = node.querySelector('CurvePoints CurvePoint BinaryCurvePointsFileName');
    const binFileName = binName ? binName.textContent.trim() : null;

    if(!binFileName) continue;
    const entry = fileMap[binFileName.toLowerCase()];
    if(!entry) continue; // this curve's binary file wasn't in the drop

    let decoded;
    try{
      decoded = decodeCurveFile(entry.data);
    }catch(err){
      console.warn('failed to decode', binFileName, err);
      continue;
    }
    if(!decoded || !decoded.y || !decoded.y.length) continue;

    let x = decoded.x;
    let xUnit = decoded.xUnit;
    if(!x){
      const n = decoded.y.length;
      x = new Float64Array(n);
      const step = isFinite(distBetween) ? distBetween : 1;
      const start = isFinite(distStart) ? distStart : 0;
      for(let i=0;i<n;i++) x[i] = start + i*step;
      xUnit = volumeUnit || timeUnit || '';
    }

    curves.push({
      name, curveNumber, x, y: decoded.y,
      xUnit: xUnit || volumeUnit || timeUnit || '',
      yUnit: amplitudeUnit,
      columnVolume: isFinite(columnVolume) ? columnVolume : null,
      peaks: [],
      peaksZeroAdjustedToInjection: false
    });
  }

  // peak tables (absent entirely on exports where UNICORN's own peak
  // integration/evaluation wasn't run — the caller falls back to auto-detection)
  const peakTables = Array.from(doc.querySelectorAll('PeakTables > PeakTable'));
  for(const pt of peakTables){
    const dcNode = pt.querySelector('DataCurve > CurveNumber');
    const cn = dcNode ? dcNode.textContent.trim() : null;
    const curve = curves.find(c=>c.curveNumber===cn);
    if(!curve) continue;
    curve.peaksZeroAdjustedToInjection = pt.querySelector('ZeroAdjustedToInjectionNumber') !== null;
    const peakNodes = Array.from(pt.querySelectorAll('Peaks > Peak'));
    for(const pk of peakNodes){
      const ret = parseFloat(textOf(pk,'MaxPeakRetention'));
      const height = parseFloat(textOf(pk,'Height'));
      const nm = textOf(pk,'Name') || '';
      if(isFinite(ret)) curve.peaks.push({retention: ret, height: isFinite(height)?height:null, name: nm, hidden: false});
    }
  }

  // events / fractions
  const events = [];
  const eventNodes = Array.from(doc.querySelectorAll('Events > Event'));
  for(const ev of eventNodes){
    const vol = parseFloat(textOf(ev,'EventVolume'));
    const txt = textOf(ev,'EventText') || '';
    if(isFinite(vol) && txt) events.push({volume: vol, text: txt});
  }

  if(!curves.length){
    return {ok: false, error: 'Found the metadata, but none of the referenced curve files (e.g. Chrom.1_1_True) were in this drop.'};
  }

  return {
    ok: true,
    chromatogramName,
    resultInfo: parseResultInfo(fileMap),
    events,
    injectionVolume: findInjectionVolume(events),
    curves
  };
}

// ---------- automatic peak detection ----------
//
// Fallback for chromatograms exported before peak integration/evaluation was run
// in UNICORN (so <PeakTables/> is empty or missing) — finds local maxima directly
// from the raw curve data. This is a simple, dependency-free local-maximum +
// prominence detector, not UNICORN's own integration algorithm, so results are
// approximate and always clearly marked as auto-detected wherever they're shown.

const DEFAULT_AUTO_SENSITIVITY = 5; // 1 (few, strong peaks only) .. 10 (many, weak peaks included)

// Centered moving average (via prefix sums, so it's cheap even on long curves).
function movingAverage(y, w){
  const n = y.length;
  if(w<=1) return Float64Array.from(y);
  const out = new Float64Array(n);
  const half = Math.floor(w/2);
  const prefix = new Float64Array(n+1);
  for(let i=0;i<n;i++) prefix[i+1] = prefix[i]+y[i];
  for(let i=0;i<n;i++){
    const lo = Math.max(0,i-half), hi = Math.min(n-1,i+half);
    out[i] = (prefix[hi+1]-prefix[lo])/(hi-lo+1);
  }
  return out;
}

// sensitivity 1..10 -> minimum peak prominence, as a fraction of the curve's own
// (smoothed) amplitude range. Higher sensitivity = lower threshold = more peaks.
function sensitivityToMinPromFrac(sensitivity){
  const s = Math.min(10, Math.max(1, sensitivity||DEFAULT_AUTO_SENSITIVITY));
  return 0.11 - (s-1)*0.0095; // s=1 -> 0.11, s=10 -> 0.0245
}

// Returns detected peaks as {retention, height, prominence, name:'', hidden:false,
// auto:true}, in the curve's own raw x/y coordinates (the same space UNICORN-
// sourced peaks use before any run offset/injection-zero correction is applied).
function detectPeaksForCurve(x, y, sensitivity){
  const n = y ? y.length : 0;
  if(n < 5) return [];
  const smoothWin = Math.max(3, Math.round(n/400));
  const ys = movingAverage(y, smoothWin);
  let ymin=Infinity, ymax=-Infinity;
  for(let i=0;i<n;i++){ if(ys[i]<ymin)ymin=ys[i]; if(ys[i]>ymax)ymax=ys[i]; }
  const range = ymax-ymin;
  if(!isFinite(range) || range<=0) return [];
  const minProm = range * sensitivityToMinPromFrac(sensitivity);
  const minSeparationPts = Math.max(3, Math.round(n*0.008));
  const k = Math.max(2, Math.round(minSeparationPts/2));

  let candidates = [];
  for(let i=k;i<n-k;i++){
    let isMax = true;
    for(let j=i-k;j<=i+k;j++){ if(j!==i && ys[j]>ys[i]){ isMax=false; break; } }
    if(isMax) candidates.push(i);
  }
  let deduped = [];
  candidates.forEach(idx=>{
    if(deduped.length && idx-deduped[deduped.length-1] < minSeparationPts){
      if(ys[idx] > ys[deduped[deduped.length-1]]) deduped[deduped.length-1] = idx;
    } else deduped.push(idx);
  });
  // topographic prominence: how far the peak stands above the higher of the two
  // nearest points (on either side) that are themselves taller than it
  function prominence(idx){
    let leftMin = ys[idx];
    for(let i=idx-1;i>=0;i--){ if(ys[i]>ys[idx]) break; if(ys[i]<leftMin) leftMin=ys[i]; }
    let rightMin = ys[idx];
    for(let i=idx+1;i<n;i++){ if(ys[i]>ys[idx]) break; if(ys[i]<rightMin) rightMin=ys[i]; }
    return ys[idx] - Math.max(leftMin, rightMin);
  }
  return deduped
    .map(idx=>({idx, prom: prominence(idx)}))
    .filter(p=>p.prom >= minProm)
    .sort((a,b)=>a.idx-b.idx)
    .map(p=>({retention: x[p.idx], height: y[p.idx], prominence: p.prom, name:'', hidden:false, auto:true}));
}

// ---------- MW calibration math ----------
//
// Two calibration models share one estimator:
//  - "kav": Kav = (Ve-V0)/(Vt-V0), fit against real lab-measured standards (a
//    void run gives V0; each loaded run supplies its own Vt from its own
//    ColumnVolume metadata, which normalizes the estimate across runs).
//  - "ve": fit directly against raw elution volume (legacy digitized curves that
//    have no measured void volume — see calibrations/README.md).
// Either way, the raw standards are the only authoritative data; the fit is
// always recomputed here and memoized onto the calibration object as `_fit`,
// never trusted from a precomputed/hand-written coefficient in the JSON file.

function kav(ve, v0, vt){
  if(ve==null || !isFinite(ve) || !isFinite(v0) || !isFinite(vt) || vt<=v0) return null;
  return (ve - v0) / (vt - v0);
}

function fitLogLinearXY(xs, ys){
  const n = xs.length;
  if(n < 2) return null;
  const xbar = xs.reduce((a,b)=>a+b,0)/n, ybar = ys.reduce((a,b)=>a+b,0)/n;
  let num=0, den=0;
  for(let i=0;i<n;i++){ num += (xs[i]-xbar)*(ys[i]-ybar); den += (xs[i]-xbar)*(xs[i]-xbar); }
  const slope = den ? num/den : 0;
  const intercept = ybar - slope*xbar;
  let ssRes=0, ssTot=0;
  for(let i=0;i<n;i++){ const pred=intercept+slope*xs[i]; ssRes+=(ys[i]-pred)**2; ssTot+=(ys[i]-ybar)**2; }
  const r2 = ssTot ? 1-ssRes/ssTot : 1;
  return {slope, intercept, r2, xMin: Math.min(...xs), xMax: Math.max(...xs), n};
}

function fitKavLogLinear(cal){
  const v0 = cal.void && cal.void.v0Ml;
  const vt = cal.column && cal.column.vtMl;
  if(!isFinite(v0) || !isFinite(vt)) return null;
  const xs = [], ys = [];
  (cal.standards||[]).forEach(s=>{
    const k = kav(s.veMl, v0, vt);
    if(k==null || !isFinite(s.mw)) return;
    xs.push(k); ys.push(Math.log10(s.mw));
  });
  return fitLogLinearXY(xs, ys);
}

function fitVeLogLinear(cal){
  const xs = [], ys = [];
  (cal.standards||[]).forEach(s=>{
    if(!isFinite(s.veMl) || !isFinite(s.mw)) return;
    xs.push(s.veMl); ys.push(Math.log10(s.mw));
  });
  return fitLogLinearXY(xs, ys);
}

// Memoized least-squares fit for a calibration object, dispatched on its model.
function calibrationFit(cal){
  if(!cal) return null;
  if(!cal._fit) cal._fit = cal.model === 'kav' ? fitKavLogLinear(cal) : fitVeLogLinear(cal);
  return cal._fit;
}

// Returns {mw, x, extrapolated} for a peak's elution volume `ve` (mL, measured
// from injection) under calibration `cal`, using `vt` (the loaded run's own
// ColumnVolume, falling back to the calibration's own Vt) for "kav" calibrations.
// Returns null if the calibration, fit, or inputs aren't usable.
function estimateMW(ve, vt, cal){
  if(!cal || ve==null || !isFinite(ve)) return null;
  const fit = calibrationFit(cal);
  if(!fit) return null;
  let x;
  if(cal.model === 'kav'){
    const v0 = cal.void && cal.void.v0Ml;
    const effVt = isFinite(vt) ? vt : (cal.column && cal.column.vtMl);
    x = kav(ve, v0, effVt);
    if(x == null) return null;
  } else {
    x = ve;
  }
  const mw = Math.pow(10, fit.intercept + fit.slope*x);
  let extrapolated = x < fit.xMin || x > fit.xMax;
  if(cal.model === 'kav' && (x < 0 || x > 1)) extrapolated = true;
  return {mw, x, extrapolated};
}

// Compact "512 kDa" / "1.2 MDa" / "850 Da" style formatting for an MW estimate.
function fmtMW(mw){
  if(!isFinite(mw) || mw<=0) return '?';
  if(mw >= 1e6) return (mw/1e6).toPrecision(3).replace(/\.?0+$/,'') + ' MDa';
  if(mw >= 1e3) return (mw/1e3).toPrecision(3).replace(/\.?0+$/,'') + ' kDa';
  return Math.round(mw) + ' Da';
}

window.PeakyParse = {
  readZipToFileMap,
  textOf, findInjectionVolume, curveDisplayLabelRaw, pickDefaultUvCurve,
  parseResultInfo, parseUnicornExport,
  findAllSig, parseNRBF, decodeCurveFile,
  DEFAULT_AUTO_SENSITIVITY, movingAverage, sensitivityToMinPromFrac, detectPeaksForCurve,
  kav, fitKavLogLinear, fitVeLogLinear, calibrationFit, estimateMW, fmtMW
};

})();
