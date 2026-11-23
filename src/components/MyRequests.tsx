import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, CheckCircle2, ClipboardList, RefreshCw } from 'lucide-react';
import { listMyRentalRequests, messageOf, type RentalRequest } from '../lib/propertyWorkflows';
import type { NooklyUser } from '../types';

export default function MyRequests({user,online}:{user:NooklyUser|null;online:boolean}){
  const [items,setItems]=useState<RentalRequest[]>([]);const [loading,setLoading]=useState(false);const [error,setError]=useState('');
  const refresh=async()=>{
    if(!user||!online)return;
    setLoading(true);setError('');
    try{setItems(await listMyRentalRequests(user))}catch(e){setError(messageOf(e))}finally{setLoading(false)}
  };
  useEffect(()=>{void refresh()},[user?.accountId,online]);
  if(!user)return <section className="container page-inner"><div className="nw-panel nw-empty"><ClipboardList size={32}/><h1>Your rental requests</h1><p>Sign in to see enquiries you have sent.</p><Link className="btn" to="/sign-in">Sign in <ArrowRight size={16}/></Link></div></section>;
  return <section className="container page-inner nw-my-requests-page"><div className="nw-title-row"><div><span className="section-kicker">YOUR RENTAL JOURNEY</span><h1>My rental requests</h1><p>See which enquiries are still pending and which have been answered.</p></div><button className="btn outline-btn" onClick={()=>void refresh()} disabled={!online||loading}><RefreshCw size={16}/>Refresh</button></div>
    {error&&<p className="nw-alert nw-error" role="alert">{error}</p>}
    {!online&&<p className="nw-alert">Reconnect to load current request statuses.</p>}
    {loading&&<p>Loading enquiries…</p>}
    {!loading&&(items.length?<div className="nw-request-list">{items.map(r=><article className="nw-panel nw-request-card" key={r.$id}><div className="nw-title-row"><div><strong>{r.propertyName||'Property'}</strong><p>{r.message||'Rental enquiry'}</p></div><span className={`nw-status nw-${r.status}`}>{r.status}</span></div><div className="nw-statrow"><span><CalendarClock size={15}/> {r.moveInDate||'Flexible move-in'}</span><span>${Number(r.proposedPrice||0).toLocaleString('en-ZW')}/mo proposed</span></div><div className="nw-inline-actions"><Link className="btn outline-btn" to={`/properties/${r.propertyId}`}>View property <ArrowRight size={15}/></Link>{r.status==='approved'&&<span className="nw-small"><CheckCircle2 size={14}/> Approved: confirm the next steps with the landlord. Do not pay without verification.</span>}</div></article>)}</div>:!error?<div className="nw-panel nw-empty"><ClipboardList size={30}/><h2>No requests yet</h2><p>Explore accommodation and send a request to the landlord when you find somewhere suitable.</p><Link className="btn" to="/explore">Explore properties <ArrowRight size={16}/></Link></div>:null)}
  </section>;
}
