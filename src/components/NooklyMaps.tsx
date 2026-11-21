import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Compass, Layers, ListFilter, LocateFixed, MapPin, Navigation, RefreshCw, Search, X } from 'lucide-react';
import type { Map as LeafletMap, LayerGroup as LeafletLayerGroup, TileLayer as LeafletTileLayer } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Property } from '../types';
import { distanceKm, distanceText, directionsUrl, openMapsUrl, propertyCoordinates, type Coordinates } from '../lib/geo';
import { loadPois, POI_CATEGORIES, type Poi, type PoiCategory } from '../lib/poi';
import { imageOf, priceOf } from '../lib/housing';

export type MapPoint = { id: string; title: string; coordinates: Coordinates; kind: 'home'|'poi'|'self'; category?: PoiCategory; price?: number };
type MapMode = 'street' | 'hybrid';

function MapCanvas({points,selectedId,onSelect,zoom=14}: {points:MapPoint[]; selectedId?:string|null; onSelect?:(id:string)=>void; zoom?:number}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap|null>(null);
  const layerGroup = useRef<LeafletLayerGroup|null>(null);
  const street = useRef<LeafletTileLayer|null>(null);
  const satellite = useRef<LeafletTileLayer|null>(null);
  const labels = useRef<LeafletTileLayer|null>(null);
  const leaflet = useRef<typeof import('leaflet')|null>(null);
  const [ready,setReady] = useState(false);
  const [mapError,setMapError] = useState('');
  const [mapMode,setMapMode] = useState<MapMode>('street');
  const onSelectRef = useRef(onSelect);
  useEffect(()=>{onSelectRef.current=onSelect},[onSelect]);
  const pointsRef=useRef(points);
  useEffect(()=>{pointsRef.current=points},[points]);
  const fitKey = points.filter(p=>p.kind!=='self').map(p=>`${p.id}:${p.coordinates.latitude}:${p.coordinates.longitude}`).join('|');

  useEffect(()=>{
    if (!element.current) return;
    let alive=true;
    void import('leaflet').then(L=>{
      if (!alive || !element.current) return;
      leaflet.current=L;
      const activePoints = pointsRef.current;
      const first=activePoints[0]?.coordinates || {latitude:-17.8252,longitude:31.0335};
      const instance=L.map(element.current,{zoomControl:true,scrollWheelZoom:false,attributionControl:true}).setView([first.latitude,first.longitude],zoom);
      const defaultLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'});
      // Matches Nookly Mobile's street / hybrid imagery choices.
      const hybrid=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles &copy; Esri'});
      const hybridLabels=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Esri'});
      defaultLayer.addTo(instance);
      map.current=instance;street.current=defaultLayer;satellite.current=hybrid;labels.current=hybridLabels;
      layerGroup.current=L.layerGroup().addTo(instance);
      setReady(true);
      window.setTimeout(()=>{if(alive)instance.invalidateSize()},100);
    }).catch(()=>{if(alive)setMapError('Map engine could not load. Check your connection and refresh.')});
    return ()=>{alive=false;map.current?.remove();map.current=null;layerGroup.current=null;leaflet.current=null;setReady(false)};
    // Create the Leaflet instance only once per mounted map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  useEffect(()=>{
    if (!ready || !map.current || !street.current || !satellite.current || !labels.current) return;
    const instance=map.current;
    for (const layer of [street.current,satellite.current,labels.current]) if (instance.hasLayer(layer)) instance.removeLayer(layer);
    if (mapMode==='hybrid') {satellite.current.addTo(instance);labels.current.addTo(instance);}else street.current.addTo(instance);
  },[mapMode,ready]);

  useEffect(()=>{
    if (!ready || !leaflet.current || !layerGroup.current || !map.current) return;
    const L=leaflet.current,group=layerGroup.current;
    group.clearLayers();
    for (const point of points) {
      const category=POI_CATEGORIES.find(p=>p.id===point.category);
      const glyph=point.kind==='home'?'⌂':point.kind==='self'?'●':category?.glyph||'●';
      const color=point.kind==='home'?'#0061ff':point.kind==='self'?'#0f172a':category?.color||'#64748b';
      const icon=L.divIcon({className:'nookly-pin-wrap',html:`<span class="nookly-map-pin ${point.id===selectedId?'selected':''}" style="--pin-color:${color}">${glyph}</span>`,iconSize:[38,42],iconAnchor:[19,39]});
      const marker=L.marker([point.coordinates.latitude,point.coordinates.longitude],{icon,keyboard:true,title:point.title}).addTo(group);
      if (point.kind!=='self')marker.on('click',()=>onSelectRef.current?.(point.id));
    }
  },[points,selectedId,ready]);

  useEffect(()=>{
    if (!ready || !map.current || !leaflet.current || !fitKey) return;
    const plotted=pointsRef.current.filter(point=>point.kind!=='self');
    if (plotted.length===1){const c=plotted[0].coordinates;map.current.setView([c.latitude,c.longitude],zoom)}
    else if(plotted.length>1){map.current.fitBounds(leaflet.current.latLngBounds(plotted.map(p=>[p.coordinates.latitude,p.coordinates.longitude] as [number,number])),{padding:[30,30],maxZoom:15})}
  },[fitKey,ready,zoom]);

  useEffect(()=>{
    if (!ready || !map.current || !selectedId) return;
    const point=points.find(p=>p.id===selectedId);
    if(point)map.current.panTo([point.coordinates.latitude,point.coordinates.longitude]);
    // Only recenter when selection changes; avoid zoom resets during filtering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selectedId,ready]);

  return <div className="nookly-map-canvas">
    <div ref={element} className="nookly-map-leaflet" aria-label="Interactive accommodation map" role="application"/>
    {mapError&&<p className="nookly-map-error" role="alert">{mapError}</p>}
    <div className="nookly-map-basemap" role="group" aria-label="Map style">
      <button type="button" className={mapMode==='street'?'active':''} onClick={()=>setMapMode('street')} aria-pressed={mapMode==='street'}>Street</button>
      <button type="button" className={mapMode==='hybrid'?'active':''} onClick={()=>setMapMode('hybrid')} aria-pressed={mapMode==='hybrid'}>Satellite</button>
    </div>
  </div>;
}

const nameOf=(property:Property)=>property.propertyName || property.type || 'Accommodation';

export function MapBrowsePage({properties,loading=false}: {properties:Property[];loading?:boolean}) {
  const [params]=useSearchParams();
  const [query,setQuery]=useState('');
  const [type,setType]=useState('All');
  const [budget,setBudget]=useState('');
  const [selectedId,setSelectedId]=useState<string|null>(()=>params.get('property'));
  const [me,setMe]=useState<Coordinates|null>(null);
  const [locating,setLocating]=useState(false);
  const [locationError,setLocationError]=useState('');
  const located = useMemo(()=>properties.filter(p=>propertyCoordinates(p)),[properties]);
  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase(),max=Number(budget);
    let list=located.filter(p=>(type==='All'||(p.type||'').toLowerCase()===type.toLowerCase()) &&(!budget||!Number.isFinite(max)||priceOf(p)<=max) && (!q||[p.propertyName,p.address,p.type,p.city].some(x=>String(x||'').toLowerCase().includes(q))));
    if(me)list=[...list].sort((a,b)=>distanceKm(me,propertyCoordinates(a)!)-distanceKm(me,propertyCoordinates(b)!));
    return list;
  },[located,query,type,budget,me]);
  const selected=filtered.find(p=>p.$id===selectedId)??filtered[0]??null;
  const points=useMemo<MapPoint[]>(()=>[
    ...filtered.map(p=>({id:p.$id,title:nameOf(p),coordinates:propertyCoordinates(p)!,kind:'home' as const,price:priceOf(p)})),
    ...(me?[{id:'current-user-location',title:'Your approximate position',coordinates:me,kind:'self' as const}]:[]),
  ],[filtered,me]);
  const types=['All',...new Set(located.map(p=>String(p.type||'').trim()).filter(Boolean))].slice(0,18);
  const getLocation=()=>{
    if(!navigator.geolocation){setLocationError('Location access is not available in this browser.');return}
    setLocating(true);setLocationError('');
    navigator.geolocation.getCurrentPosition(result=>{setMe({latitude:result.coords.latitude,longitude:result.coords.longitude});setLocating(false)},error=>{setLocationError(error.code===1?'Location permission was declined. You can still browse the map.':'Unable to determine your location.');setLocating(false)},{enableHighAccuracy:false,timeout:11000,maximumAge:120000});
  };
  return <div className="container nookly-maps-page">
    <div className="nookly-maps-heading"><div><span className="section-kicker">EXPLORE ON THE MAP</span><h1>Discover your next place</h1><p>Explore Nookly accommodation with mapped locations. Properties without coordinates are listed in Explore instead.</p></div><Link to="/explore" className="btn outline-btn"><ListFilter size={17}/> List view</Link></div>
    <div className="nookly-maps-filters">
      <label><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search map properties" placeholder="Search properties or areas"/></label>
      <select aria-label="Property type" value={type} onChange={e=>setType(e.target.value)}>{types.map(t=><option key={t} value={t}>{t}</option>)}</select>
      <label><span>Max $</span><input type="number" min="0" placeholder="Any" aria-label="Maximum rent in USD" value={budget} onChange={e=>setBudget(e.target.value)}/></label>
      <button className="nookly-map-geo-btn" type="button" onClick={getLocation} disabled={locating}><LocateFixed size={17}/>{locating?'Locating…':'Near me'}</button>
      {(query||type!=='All'||budget)&&<button className="nookly-map-geo-btn" type="button" onClick={()=>{setQuery('');setType('All');setBudget('')}}><X size={16}/>Clear</button>}
    </div>
    {locationError&&<p className="nookly-map-notice" role="status">{locationError}</p>}
    <div className="nookly-map-browse-grid">
      <div className="nookly-maps-results">
        <div className="nookly-map-count"><strong>{filtered.length} mapped {filtered.length===1?'home':'homes'}</strong><span>{located.length} geolocated out of {properties.length} available listings</span></div>
        {filtered.length===0?<div className="nookly-map-empty">{loading?'Loading homes…':'No properties match these map filters. Try a different area or use the list view.'}</div>:filtered.map(p=>{
          const c=propertyCoordinates(p)!;const active=selected?.$id===p.$id;
          return <article key={p.$id} className={`nookly-map-result ${active?'active':''}`}>
            <button type="button" className="nookly-map-select" onClick={()=>setSelectedId(p.$id)} aria-label={`Show ${nameOf(p)} on map`}>
              {imageOf(p)?<img src={imageOf(p)!} alt="" loading="lazy"/>:<span className="nookly-map-photo-fallback">⌂</span>}
              <span className="nookly-map-result-copy"><strong>{nameOf(p)}</strong><small>{p.address||'Address not provided'}</small><b>${priceOf(p).toLocaleString('en-ZW')} <small>/month</small></b>{me&&<small>{distanceText(distanceKm(me,c))} straight-line from you</small>}</span>
            </button>
            <div className="nookly-map-result-links"><Link to={`/properties/${encodeURIComponent(p.$id)}`}>View property <ArrowRight size={14}/></Link><a href={openMapsUrl(c)} target="_blank" rel="noopener noreferrer">Open maps <Navigation size={14}/></a></div>
          </article>
        })}
      </div>
      <div className="nookly-map-large">
        {points.some(p=>p.kind==='home')?<MapCanvas points={points} selectedId={selected?.$id} onSelect={setSelectedId} zoom={13}/>:<div className="nookly-map-empty nookly-map-empty-big"><MapPin size={26}/> No mapped properties to display</div>}
        {selected&&<div className="nookly-map-active-card"><span><strong>{nameOf(selected)}</strong><small>{selected.address||'Address not provided'}</small></span><Link className="btn btn-small" to={`/properties/${encodeURIComponent(selected.$id)}`}>Details <ArrowRight size={15}/></Link></div>}
      </div>
    </div>
    <p className="nookly-map-data-note">Map locations depend on coordinates submitted by landlords and may be approximate. Map tiles and nearby-place information require internet access.</p>
  </div>;
}

export function PropertyLocationPanel({property}: {property:Property}) {
  const coordinates = propertyCoordinates(property);
  const [expanded,setExpanded]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [pois,setPois]=useState<Poi[]>([]);
  const [enabled,setEnabled]=useState<PoiCategory[]>(POI_CATEGORIES.map(c=>c.id));
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const requestId=useRef(0);
  const reload=useCallback(async()=>{
    if(!coordinates)return;
    const request=++requestId.current;
    setLoading(true);setError('');
    try{const loaded=await loadPois(coordinates,2);if(request===requestId.current)setPois(loaded)}
    catch(e){if(request===requestId.current)setError(e instanceof Error?e.message:'Nearby places unavailable.')}
    finally{if(request===requestId.current)setLoading(false)}
  },[coordinates?.latitude,coordinates?.longitude]);
  useEffect(()=>{setExpanded(false);setPois([]);setError('');setSelectedId(null);return()=>{requestId.current++}},[property.$id]);
  const displayed=useMemo(()=>pois.filter(p=>enabled.includes(p.category)),[pois,enabled]);
  const selected=displayed.find(p=>p.id===selectedId)||null;
  const points=useMemo<MapPoint[]>(()=>coordinates?[
    {id:'home',title:nameOf(property),coordinates,kind:'home' as const},
    ...displayed.map(p=>({id:p.id,title:p.name,coordinates:p.coordinates,kind:'poi' as const,category:p.category})),
  ]:[],[property.$id,coordinates?.latitude,coordinates?.longitude,displayed]);
  return <section className="detail-block nookly-property-location">
    <div className="nookly-map-detail-heading"><div><span className="section-kicker">LOCATION</span><h2>Where you'll live</h2><p>{property.address||'Property address has not been provided.'}</p></div>{coordinates&&<Link to={`/map?property=${encodeURIComponent(property.$id)}`} className="btn outline-btn btn-small"><Compass size={16}/> Full map</Link>}</div>
    {coordinates? <>
      <div className="nookly-property-map"><MapCanvas points={points} selectedId={selected?.id||'home'} onSelect={setSelectedId} zoom={15}/></div>
      <div className="nookly-map-detail-actions"><a href={openMapsUrl(coordinates)} target="_blank" rel="noopener noreferrer"><MapPin size={16}/> Open in Maps</a><a href={`https://www.google.com/maps/dir/?api=1&destination=${coordinates.latitude}%2C${coordinates.longitude}`} target="_blank" rel="noopener noreferrer"><Navigation size={16}/> Get directions</a></div>
      <button type="button" className="nookly-amenities-trigger" onClick={()=>{if(!expanded&&pois.length===0&&!loading)void reload();setExpanded(v=>!v)}} aria-expanded={expanded}><Layers size={18}/><span><strong>Nearby amenities</strong><small>Schools, colleges, hospitals, shopping, public transport and more · within 2 km</small></span><span>{expanded?'−':'+'}</span></button>
      {expanded&&<div className="nookly-amenities-content">
        <div className="nookly-amenity-categories" aria-label="Nearby-place map layers">{POI_CATEGORIES.map(cat=>{const selected=enabled.includes(cat.id);const count=pois.filter(p=>p.category===cat.id).length;return <button key={cat.id} type="button" className={selected?'active':''} onClick={()=>setEnabled(old=>selected?old.filter(x=>x!==cat.id):[...old,cat.id])} aria-pressed={selected}><span>{cat.glyph}</span>{cat.label}{pois.length>0&&<b>{count}</b>}</button>})}</div>
        {loading&&<p className="nookly-map-notice" role="status">Finding nearby mapped places…</p>}
        {error&&<p className="nookly-map-notice" role="alert">{error} <button type="button" onClick={()=>void reload()}><RefreshCw size={14}/> Retry</button></p>}
        {!loading&&!error&&(displayed.length?<><p className="nookly-map-data-note">{displayed.length} mapped places found. Distances are straight-line, not travel distances.</p><div className="nookly-amenities-list">{displayed.slice(0,24).map(p=>{const cat=POI_CATEGORIES.find(c=>c.id===p.category)!;return <button type="button" onClick={()=>setSelectedId(p.id)} className={selectedId===p.id?'active':''} key={p.id}><span className="nookly-poi-badge" style={{backgroundColor:cat.color}}>{cat.glyph}</span><span><strong>{p.name}</strong><small>{cat.label}</small></span><b>{distanceText(p.distanceKm)}</b></button>})}</div>{selected&&<div className="nookly-poi-selected"><strong>{selected.name}</strong><span>{distanceText(selected.distanceKm)} straight-line away</span><a href={directionsUrl(coordinates,selected.coordinates)} target="_blank" rel="noopener noreferrer">Route from property <Navigation size={14}/></a></div>}</>:<p className="nookly-map-notice">No mapped places in the selected layers within 2 km.</p>)}
      </div>}
    </> : <p className="nookly-map-notice">This property hasn't supplied valid latitude and longitude yet, so we won't guess its exact position. Ask the landlord to add a map pin.</p>}
  </section>;
}
