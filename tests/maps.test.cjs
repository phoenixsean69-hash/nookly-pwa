'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,deps={}){
  const tsText=fs.readFileSync(path.join(root,file),'utf8');
  const result=ts.transpileModule(tsText,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}});
  assert.equal((result.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,'TypeScript syntax errors in '+file);
  const mod={exports:{}};
  new Function('require','module','exports',result.outputText)((name)=>{if(!(name in deps))throw new Error('Unexpected import '+name);return deps[name]},mod,mod.exports);
  return mod.exports;
}
const geo=load('src/lib/geo.ts');
const poi=load('src/lib/poi.ts',{'./geo':geo});
const here={latitude:-17.8252,longitude:31.0335};
const nearby={latitude:-17.826,longitude:31.034};
function elm(tags={},lat=nearby.latitude,lon=nearby.longitude,id=1){return {id,type:'node',lat,lon,tags}}

test('missing coordinates are never turned into the Gulf of Guinea',()=>{
  for(const value of [null,undefined,'', ' ', 'NaN','bad']) assert.equal(geo.parseCoordinates(value,31),null);
  assert.equal(geo.parseCoordinates(0,0),null);
  assert.equal(geo.parseCoordinates(-91,31),null);
  assert.equal(geo.parseCoordinates(-17,181),null);
});
test('numeric strings from older Appwrite records are valid',()=>{assert.deepEqual(geo.parseCoordinates('-17.8252','31.0335'),here)});
test('valid zero latitude with nonzero longitude is preserved',()=>{assert.deepEqual(geo.parseCoordinates(0,31),{latitude:0,longitude:31})});
test('property location reads actual lat/lon fields only',()=>{assert.deepEqual(geo.propertyCoordinates({latitude:'-17.8252',longitude:'31.0335'}),here);assert.equal(geo.propertyCoordinates({address:'Harare'}),null)});
test('haversine distance is symmetric, nonnegative, and sensible',()=>{const d=geo.distanceKm(here,nearby);assert.ok(d>0&&d<1);assert.ok(Math.abs(d-geo.distanceKm(nearby,here))<1e-10);assert.equal(geo.distanceKm(here,here),0)});
test('map links point to valid locations, with routing only via external service',()=>{assert.match(geo.openMapsUrl(here),/openstreetmap\.org/);assert.match(geo.directionsUrl(here,nearby),/directions\?engine=/)});
test('categories retain mobile amenity taxonomy',()=>{assert.equal(poi.POI_CATEGORIES.length,9);assert.equal(poi.categoryOf({amenity:'university'}),'universities');assert.equal(poi.categoryOf({highway:'bus_stop'}),'busTerminals');assert.equal(poi.categoryOf({shop:'supermarket'}),'shopping');assert.equal(poi.categoryOf({leisure:'park'}),'parks');assert.equal(poi.categoryOf({amenity:'police'}),'policeStations');assert.equal(poi.categoryOf({amenity:'fuel'}),'fuelStations')});
test('POI parsing handles ways with a center and rejects missing coordinates',()=>{const list=poi.parsePois([{type:'way',id:44,center:{lat:nearby.latitude,lon:nearby.longitude},tags:{amenity:'hospital',name:'Clinic'}} ,{type:'way',id:45,tags:{amenity:'hospital'}}],here,2);assert.equal(list.length,1);assert.equal(list[0].name,'Clinic')});
test('POI parsing filters outside 2km and deduplicates',()=>{const list=poi.parsePois([elm({amenity:'restaurant',name:'Cafe'}),elm({amenity:'restaurant',name:'Cafe'}),elm({amenity:'hospital'},-18,31,2)],here,2);assert.equal(list.length,1)});
test('POI parses untrusted titles as data (never HTML in markers)',()=>{const list=poi.parsePois([elm({amenity:'cafe',name:'<script>alert(1)</script>'})],here,2);assert.equal(list[0].name,'<script>alert(1)</script>')});
test('public Overpass fallback and in-memory cache',async()=>{
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  let calls=0;
  globalThis.fetch=async(url,options)=>{
    calls++;assert.equal(options.method,'POST');assert.ok(options.body.includes('data='));
    if(calls===1)return {ok:false,status:429};
    return {ok:true,json:async()=>({elements:[elm({amenity:'school',name:'Secondary school'})]})};
  };
  const result=await poi.loadPois(here,2);assert.equal(result[0].category,'schools');assert.equal(calls,2);
  const cached=await poi.loadPois(here,2);assert.equal(cached.length,1);assert.equal(calls,2);
});
test('offline fetch clearly rejects without a network request',async()=>{
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});
  await assert.rejects(poi.loadPois({latitude:-16.19,longitude:31.11},2),/internet connection/);
});
