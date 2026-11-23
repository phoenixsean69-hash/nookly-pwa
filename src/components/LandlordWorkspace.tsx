import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, Building2, Check, CheckCircle2, ImagePlus, MapPin, Plus, RefreshCw, Send, Trash2, X, Eye, Heart, Star, CalendarClock } from 'lucide-react';
import { databases, Query, requireSetting, settings } from '../lib/appwrite';
import { asNumber, createListing, deleteListing, editListing, listLandlordRequests, listingData, messageOf, setListingAvailable, updateRentalRequest, uploadListingImage, uploadListingVideo, validateListing, type ListingDraft, type RentalRequest } from '../lib/propertyWorkflows';
import type { NooklyUser, Property } from '../types';

const EMPTY:ListingDraft={propertyName:'',type:'Boarding',description:'',address:'',price:0,priceThreshold:0,area:0,roomFor:1,bedrooms:1,bathrooms:1,totalSlots:0,availableSlots:0,isAvailable:true,facilities:'',curfew:'',latitude:null,longitude:null};
const types=['Boarding','House','Apartment','Cottage','Duplex','Studio','Luxury'];
const photoFields=['image1','image2','image3'] as const;
const videoFields=['video1','video2','video3'] as const;
function draftOf(p?:Property):ListingDraft {return p ? {
  propertyName:p.propertyName||'',type:p.type||'Boarding',description:p.description||'',address:p.address||'',price:asNumber(p.price),
  priceThreshold:asNumber(p.priceThreshold),area:asNumber(p.area),roomFor:asNumber(p.roomFor),bedrooms:asNumber(p.bedrooms),bathrooms:asNumber(p.bathrooms),
  totalSlots:asNumber(p.totalSlots),availableSlots:asNumber(p.availableSlots),isAvailable:p.isAvailable!==false,facilities:typeof p.facilities==='string'?p.facilities:Array.isArray(p.facilities)?p.facilities.join(', '):'',curfew:String(p.curfew||''),latitude:p.latitude!==null&&p.latitude!==undefined&&Number.isFinite(Number(p.latitude))?Number(p.latitude):null,longitude:p.longitude!==null&&p.longitude!==undefined&&Number.isFinite(Number(p.longitude))?Number(p.longitude):null,image1:p.image1,image2:p.image2,image3:p.image3,video1:typeof p.video1==='string'?p.video1:undefined,video2:typeof p.video2==='string'?p.video2:undefined,video3:typeof p.video3==='string'?p.video3:undefined,
}: {...EMPTY};}

function PickMapPin({latitude,longitude,onChange}:{latitude:number|null;longitude:number|null;onChange:(lat:number,lng:number)=>void}) {
  const ref=useRef<HTMLDivElement>(null);const map=useRef<L.Map|null>(null);const marker=useRef<L.Marker|null>(null);
  useEffect(()=>{
    if(!ref.current||map.current)return;
    const lat=latitude??-17.8252,lon=longitude??31.0335;
    const m=L.map(ref.current,{zoomControl:true}).setView([lat,lon],latitude===null?10:16);map.current=m;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(m);
    const setMarker=(lat:number,lng:number)=>{marker.current?.remove();marker.current=L.marker([lat,lng],{draggable:true,icon:L.divIcon({className:'nw-location-icon',html:'<span class="nw-pin-marker">⌂</span>',iconSize:[34,34],iconAnchor:[17,34]})}).addTo(m);
      marker.current.on('dragend',()=>{const p=marker.current?.getLatLng();if(p)onChange(p.lat,p.lng)});};
    if(latitude!==null&&longitude!==null)setMarker(latitude,longitude);
    m.on('click',(event:L.LeafletMouseEvent)=>{setMarker(event.latlng.lat,event.latlng.lng);onChange(event.latlng.lat,event.latlng.lng)});
    const timer=window.setTimeout(()=>m.invalidateSize(),80);
    return()=>{window.clearTimeout(timer);map.current=null;marker.current=null;m.remove();};
  // Mount on form open. The parent never swaps its identity while editing.
  },[]);
  return <div className="nw-map-picker"><div className="nw-pickmap" ref={ref} aria-label="Choose the property location by clicking or dragging the map pin"/><p className="nw-small"><MapPin size={14}/> {latitude===null||longitude===null?'Click the map to choose an exact location.':'Pin: '+latitude.toFixed(6)+', '+longitude.toFixed(6)}. This does not automatically verify the address.</p></div>;
}

function ListingEditor({user,existing,onExit,onSaved,online}:{user:NooklyUser;existing:Property|null;onExit:()=>void;onSaved:()=>Promise<void>;online:boolean}) {
  const [draft,setDraft]=useState<ListingDraft>(()=>draftOf(existing||undefined));
  const [photos,setPhotos]=useState<(File|null)[]>([null,null,null]);
  const [videos,setVideos]=useState<(File|null)[]>([null,null,null]);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [stage,setStage]=useState('');
  const update=(field:keyof ListingDraft,value:string|number|boolean|null)=>setDraft(p=>({...p,[field]:value}));
  const save=async(e:FormEvent)=>{
    e.preventDefault();setError('');
    try{validateListing(draft)}catch(err){setError(messageOf(err));return;}
    setBusy(true);
    try{
      const saved={...draft};
      for(let i=0;i<photos.length;i++)if(photos[i]){
        setStage(`Uploading photo ${i+1}…`);
        saved[photoFields[i]]=await uploadListingImage(user,photos[i]!);
      }
      for(let i=0;i<videos.length;i++)if(videos[i]){setStage(`Uploading video ${i+1}…`);saved[videoFields[i]]=await uploadListingVideo(user,videos[i]!);}
      setStage(existing?'Updating listing…':'Publishing listing…');
      if(existing)await editListing(user,existing.$id,saved);else await createListing(user,saved);
      await onSaved();onExit();
    }catch(err){setError(messageOf(err))}finally{setBusy(false);setStage('')}
  };
  const numberInput=(label:string,field:keyof ListingDraft,min=0)=><label>{label}<input type="number" min={min} step={1} value={String(draft[field]??'')} onChange={e=>update(field,Math.max(0,Number(e.target.value)))} /></label>;
  return <section className="nw-panel nw-listing-editor"><div className="nw-title-row"><div><span className="section-kicker">LANDLORD LISTINGS</span><h2>{existing?'Edit property':'Add new accommodation'}</h2><p>The same property data used by Nookly Mobile.</p></div><button className="btn outline-btn" onClick={onExit} type="button"><X size={16}/>Close</button></div>
    <form onSubmit={e=>void save(e)}><div className="nw-form-grid">
      <label className="nw-wide">Property name<input required minLength={3} value={draft.propertyName} onChange={e=>update('propertyName',e.target.value)} placeholder="e.g. Greenside Boarding House"/></label>
      <label>Property type<select value={draft.type} onChange={e=>update('type',e.target.value)}>{types.map(t=><option key={t}>{t}</option>)}</select></label>
      <label>Monthly rent (USD)<input required type="number" min="1" value={draft.price||''} onChange={e=>update('price',Number(e.target.value))}/></label>
      <label className="nw-wide">Full address<input required minLength={6} value={draft.address} onChange={e=>update('address',e.target.value)} placeholder="House number, road, suburb, city"/></label>
      <label className="nw-wide">Description<textarea required minLength={15} value={draft.description} onChange={e=>update('description',e.target.value)} placeholder="Describe your rooms, bills, rules, deposit and nearby services"/></label>
      <label className="nw-wide">Facilities (comma-separated)<input value={draft.facilities} onChange={e=>update('facilities',e.target.value)} placeholder="Wi-Fi, water tank, backup power, parking"/></label>
      {numberInput('Bedrooms','bedrooms')}{numberInput('Bathrooms','bathrooms')}
      {numberInput('Room for (people)','roomFor')}{numberInput('Area (m²)','area')}
      {numberInput('Total beds / slots (0 for whole unit)','totalSlots')}{numberInput('Available beds / slots','availableSlots')}
      {numberInput('Minimum rental offer (USD, 0 for none)','priceThreshold')}
      <label>Curfew / rules<input value={draft.curfew} onChange={e=>update('curfew',e.target.value)} placeholder="Optional"/></label>
      <label className="nw-wide nw-checkbox"><input type="checkbox" checked={draft.isAvailable} onChange={e=>update('isAvailable',e.target.checked)}/> Publish as available{draft.totalSlots>0&&draft.availableSlots===0?' (will be marked full)':''}</label>
    </div>
    <h3>Photos</h3><p className="nw-small">Up to three JPG, PNG or WebP photos, 5 MB each. Uploaded images use your existing Appwrite storage bucket.</p><div className="nw-photo-grid">{photoFields.map((field,i)=><label key={field}><span>Photo {i+1}</span>{draft[field]&&!photos[i]&&<img src={draft[field]} alt={`Current property photo ${i+1}`}/>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setPhotos(x=>x.map((v,n)=>n===i?(e.target.files?.[0]||null):v))}/>{photos[i]&&<small>{photos[i]?.name}</small>}</label>)}</div>
    <h3>Video tours (optional)</h3><p className="nw-small">Up to three MP4 or WebM videos, each smaller than 25 MB. Videos are not compressed in the browser.</p>
    <div className="nw-photo-grid">{videoFields.map((field,i)=><label key={field}><span>Video {i+1}</span>{draft[field]&&!videos[i]&&<video controls preload="metadata" src={draft[field]} style={{width:'100%',maxHeight:120}}/>}<input type="file" accept="video/mp4,video/webm" onChange={e=>setVideos(x=>x.map((v,n)=>n===i?(e.target.files?.[0]||null):v))}/>{videos[i]&&<small>{videos[i]?.name}</small>}</label>)}</div>
    <h3>Exact property location</h3><p className="nw-small">Select the pin manually and check the address. Never use a nearby landmark as if it were the property's true location.</p>
    <PickMapPin latitude={draft.latitude} longitude={draft.longitude} onChange={(lat,lng)=>setDraft(d=>({...d,latitude:lat,longitude:lng}))}/>
    <div className="nw-inline-actions"><button type="button" className="btn outline-btn" onClick={()=>setDraft(x=>({...x,latitude:null,longitude:null}))}>Remove pin</button><button type="submit" className="btn" disabled={busy||!online}><Check size={16}/>{busy?stage:existing?'Save changes':'Publish property'}</button></div>
    {error&&<p className="nw-alert nw-error" role="alert">{error}</p>}
    {!online&&<p className="nw-alert">You're offline. Reconnect to publish or edit listings.</p>}
    </form></section>;
}

export default function LandlordWorkspace({user,online,refresh}:{user:NooklyUser|null;online:boolean;refresh:()=>Promise<void>}) {
  const [list,setList]=useState<Property[]>([]);const [requests,setRequests]=useState<RentalRequest[]>([]);
  const [mode,setMode]=useState<'overview'|'new'|'edit'>('overview');const [edit,setEdit]=useState<Property|null>(null);
  const [tab,setTab]=useState<'listings'|'inbox'>('listings');const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');const [busyId,setBusyId]=useState('');
  const load=useCallback(async()=>{
    if(!user||user.userMode!=='landlord'||!online)return;
    setLoading(true);setError('');
    try{
      const result=await databases.listDocuments({databaseId:requireSetting(settings.databaseId,'VITE_APPWRITE_DATABASE_ID'),collectionId:requireSetting(settings.propertiesCollectionId,'VITE_APPWRITE_PROPERTIES_COLLECTION_ID'),queries:[Query.equal('creatorId',user.accountId),Query.orderDesc('$createdAt'),Query.limit(100)]});
      const owned=result.documents as unknown as Property[];
      setList(owned);
      // Some deployments permit owner listing reads but not request reads.
      try{setRequests(await listLandlordRequests(user,owned))}catch(e){setRequests([]);setError('Listings loaded, but rental requests could not be read: '+messageOf(e))}
    }catch(e){setError(messageOf(e))}finally{setLoading(false)}
  },[user?.accountId,user?.userMode,online]);
  useEffect(()=>{void load()},[load]);
  if(!user)return <section className="container page-inner"><h1>Landlord workspace</h1><Link className="btn" to="/sign-in?returnTo=%2Flandlord">Sign in as a landlord</Link></section>;
  if(user.userMode!=='landlord')return <section className="container page-inner"><h1>Landlord access only</h1><p>Sign in with a landlord account to manage listings.</p></section>;
  const act=async(id:string,fn:()=>Promise<unknown>,success:string)=>{setBusyId(id);setError('');setNotice('');try{await fn();setNotice(success);await load();await refresh()}catch(e){setError(messageOf(e))}finally{setBusyId('')}};
  const saved=async()=>{setNotice('Listing saved successfully.');await load();await refresh()};
  const respond=async(req:RentalRequest,next:'approved'|'rejected')=>{
    setBusyId(req.$id);setError('');setNotice('');
    try{
      const result=await updateRentalRequest(user,req,list,next);
      setNotice(result.warning||`Request ${next}.`);
      await load();await refresh();
    }catch(e){setError(messageOf(e))}finally{setBusyId('')}
  };
  return <section className="container page-inner nw-landlord"><div className="nw-title-row"><div><span className="section-kicker">YOUR NOOKLY BUSINESS</span><h1>Landlord workspace</h1><p>Manage accommodation, availability and applications from the existing Nookly database.</p></div><div className="nw-inline-actions"><button className="btn outline-btn" type="button" onClick={()=>void load()} disabled={loading||!online}><RefreshCw size={16}/>Refresh</button><button className="btn" onClick={()=>{setMode('new');setEdit(null)}}><Plus size={16}/>Add property</button></div></div>
    {error&&<p className="nw-alert nw-error" role="alert">{error}</p>}{notice&&<p className="nw-alert nw-success" role="status">{notice}</p>}
    {mode!=='overview'?<ListingEditor key={edit?.$id||'new'} user={user} existing={edit} online={online} onSaved={saved} onExit={()=>setMode('overview')}/>:<>
      <div className="nw-statrow nw-landlord-stats"><span><Building2 size={18}/> <strong>{list.length}</strong> listings</span><span><CheckCircle2 size={18}/> <strong>{list.filter(p=>p.isAvailable!==false).length}</strong> available</span><span><CalendarClock size={18}/> <strong>{requests.filter(x=>x.status==='pending').length}</strong> open requests</span></div>
      <div className="nw-tabs" role="tablist" aria-label="Landlord sections"><button className={tab==='listings'?'selected':''} onClick={()=>setTab('listings')} role="tab" aria-selected={tab==='listings'}>Listings</button><button className={tab==='inbox'?'selected':''} onClick={()=>setTab('inbox')} role="tab" aria-selected={tab==='inbox'}>Rental requests ({requests.length})</button></div>
      {loading&&<p>Loading your Nookly data…</p>}
      {tab==='listings'?list.length?<div className="nw-listing-grid">{list.map(p=><article className="nw-panel nw-listing-card" key={p.$id}><div className="nw-listing-top">{p.image1&&<img src={p.image1} alt={p.propertyName||'Listing'}/>}<div><strong>{p.propertyName||'Property'}</strong><p>{p.address||'Address not provided'}</p><small>${asNumber(p.price).toLocaleString('en-ZW')} per month · {p.type||'Accommodation'}</small></div></div><div className="nw-statrow"><span><Eye size={14}/>{asNumber(p.views)} views</span><span><Heart size={14}/>{asNumber(p.likes)} likes</span><span><Star size={14}/>{p.rating||'—'}</span></div><p className="nw-small">{p.isAvailable===false?'Paused / unavailable':`Available ${asNumber(p.totalSlots)>0?`${asNumber(p.availableSlots)} / ${asNumber(p.totalSlots)} beds`:'for enquiries'}`}</p><div className="nw-inline-actions"><Link className="btn outline-btn" to={`/properties/${p.$id}`}>View</Link><button className="btn outline-btn" onClick={()=>{setEdit(p);setMode('edit')}} type="button">Edit</button><button className="btn outline-btn" type="button" disabled={busyId===p.$id||!online} onClick={()=>void act(p.$id,()=>setListingAvailable(user,p.$id,p.isAvailable===false),'Availability updated.')}>{p.isAvailable===false?'Make available':'Pause'}</button><button className="nw-danger-btn" type="button" disabled={busyId===p.$id||!online} onClick={()=>{if(window.prompt(`Type DELETE to permanently remove “${p.propertyName||'this property'}”`)!=='DELETE')return;void act(p.$id,()=>deleteListing(user,p.$id),'Property deleted.')}}><Trash2 size={15}/>Delete</button></div></article>)}</div>:!loading?<div className="nw-panel nw-empty"><Building2 size={32}/><h2>No listings yet</h2><p>Publish the first property you own to start getting rental enquiries.</p><button className="btn" onClick={()=>setMode('new')}>Add property</button></div>:null
      :requests.length?<div className="nw-request-list">{requests.map(r=><article className="nw-panel nw-request-card" key={r.$id}><div className="nw-title-row"><div><strong>{r.tenantName||'Tenant'}</strong><p>{r.propertyName} · ${asNumber(r.proposedPrice)} proposed / month</p></div><span className={`nw-status nw-${r.status}`}>{r.status}</span></div>{r.message&&<p>{r.message}</p>}<p className="nw-small">{r.moveInDate?`Move-in: ${r.moveInDate} · `:''}{r.leaseDuration?`Duration: ${r.leaseDuration} · `:''}{r.$createdAt?new Date(r.$createdAt).toLocaleDateString('en-ZW'):''}</p><div className="nw-inline-actions">{r.tenantPhone&&<a className="btn outline-btn" href={`tel:${r.tenantPhone.replace(/[^\d+]/g,'')}`}>Call tenant</a>}{r.tenantEmail&&<a className="btn outline-btn" href={`mailto:${encodeURIComponent(r.tenantEmail)}`}>Email</a>}{r.status==='pending'&&<><button className="btn" disabled={busyId===r.$id||!online} onClick={()=>void respond(r,'approved')}>Approve</button><button className="btn outline-btn" disabled={busyId===r.$id||!online} onClick={()=>void respond(r,'rejected')}>Decline</button></>}</div></article>)}</div>:!loading?<div className="nw-panel nw-empty"><Send size={30}/><h2>No rental requests</h2><p>When tenants send applications, they will appear here if the Appwrite requests collection permits owner access.</p></div>:null}
    </>}
  </section>;
}
