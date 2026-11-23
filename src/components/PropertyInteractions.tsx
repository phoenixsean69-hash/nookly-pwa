import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, CheckCircle2, Heart, Mail, MessageSquare, Phone, Send, Star, Users, Eye } from 'lucide-react';
import { databases, Query, requireSetting, settings } from '../lib/appwrite';
import { asNumber, countLikes, likedByMe, messageOf, postReview, readReviews, recordPropertyView, submitRentalRequest, summarizeReviews, togglePropertyLike, type RequestDraft } from '../lib/propertyWorkflows';
import type { NooklyUser, Property } from '../types';

export function PropertyEngagement({property,user,online}:{property:Property;user:NooklyUser|null;online:boolean}){
  const [current,setCurrent]=useState(property);
  const [liked,setLiked]=useState(false);
  const [likes,setLikes]=useState(asNumber(property.likes));
  const [savingLike,setSavingLike]=useState(false);
  const [rating,setRating]=useState(5);
  const [review,setReview]=useState('');
  const [savingReview,setSavingReview]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const reviews=useMemo(()=>readReviews(current.reviews),[current.reviews]);
  const summary=useMemo(()=>summarizeReviews(current.reviews),[current.reviews]);
  const alreadyReviewed=Boolean(user&&reviews.some(x=>x.userId===user.accountId || x.reviewerId===user.accountId));
  const own=Boolean(user&&(property.creatorId===user.accountId || property.creatorId===user.$id));

  useEffect(()=>{setCurrent(property);setLikes(asNumber(property.likes));setLiked(false);setNotice('');setError('');},[property.$id,property.reviews,property.likes]);
  useEffect(()=>{if(!online)return;let active=true;
    void countLikes(property.$id).then(n=>{if(active)setLikes(n)}).catch(()=>{});
    if(user)void likedByMe(user,property.$id).then(v=>{if(active)setLiked(v)}).catch(()=>{});
    return ()=>{active=false};
  },[property.$id,user?.accountId,online]);
  useEffect(()=>{if(online)void recordPropertyView(property.$id,user,property.creatorId);},[property.$id,user?.accountId,online]);

  const like=async()=>{
    if(!user||!online)return;
    setSavingLike(true);setError('');setNotice('');
    try{const result=await togglePropertyLike(user,property.$id);setLikes(result.total);setLiked(result.liked);if(result.syncWarning)setNotice(result.syncWarning);}catch(e){setError(messageOf(e))}finally{setSavingLike(false)}
  };
  const submitReview=async(e:FormEvent)=>{
    e.preventDefault();if(!user||!online)return;
    setSavingReview(true);setError('');setNotice('');
    try{const next=await postReview(user,property.$id,review,rating);setCurrent(next);setReview('');setNotice('Your review has been published.');}catch(e){setError(messageOf(e))}finally{setSavingReview(false)}
  };
  return <section className="detail-block nw-engagement" aria-label="Ratings and property activity">
    <div className="nw-heading"><div><h2>Reviews & activity</h2><p>Feedback from Nookly members. Read property details and arrange a viewing before paying.</p></div></div>
    <div className="nw-statrow">
      <span><Star size={17}/><strong>{summary.total?summary.average.toFixed(1):'—'}</strong> {summary.total} review{summary.total===1?'':'s'}</span>
      <span><Heart size={17}/><strong>{likes}</strong> like{likes===1?'':'s'}</span>
      <span><Eye size={17}/><strong>{asNumber(current.views)}</strong> recorded views</span>
    </div>
    <div className="nw-inline-actions">
      {user?<button className={`btn outline-btn ${liked?'nw-liked':''}`} disabled={savingLike||!online} onClick={()=>void like()} type="button"><Heart size={17} fill={liked?'currentColor':'none'}/>{savingLike?'Saving…':liked?'Unlike':'Like this place'}</button>:<Link className="btn outline-btn" to={`/sign-in?returnTo=${encodeURIComponent('/properties/'+property.$id)}`}><Heart size={17}/>Sign in to like</Link>}
    </div>
    {error&&<p className="nw-alert nw-error" role="alert">{error}</p>}
    {notice&&<p className="nw-alert" role="status">{notice}</p>}
    {reviews.length?<div className="nw-review-list">{[...reviews].reverse().slice(0,50).map((r,i)=><article className="nw-review" key={`${r.id}-${i}`}><div className="nw-review-top"><strong>{r.userName}</strong><span>{'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}</span></div>{r.date&&<time>{new Date(r.date).toLocaleDateString('en-ZW')}</time>}<p>{r.review}</p></article>)}</div>:<p className="muted">No reviews yet. Be the first to share a genuine experience.</p>}
    {user&&(!alreadyReviewed&&!own)?<form className="nw-review-form" onSubmit={e=>void submitReview(e)}><h3>Write a review</h3><label>Your rating<select value={rating} onChange={e=>setRating(Number(e.target.value))} disabled={!online}>{[5,4,3,2,1].map(n=><option value={n} key={n}>{n} star{n===1?'':'s'}</option>)}</select></label><label>Experience<textarea required minLength={10} maxLength={1200} value={review} onChange={e=>setReview(e.target.value)} placeholder="Describe the room, landlord communication and what a future tenant should know"/></label><p className="nw-small">Reviews should reflect real experiences. Avoid sharing private contact details.</p><button className="btn" type="submit" disabled={savingReview||!online}><Star size={16}/>{savingReview?'Posting…':'Post review'}</button></form>:user?<p className="nw-small">{own?'Landlords cannot review their own listings.':'You have already reviewed this property.'}</p>:<p className="nw-small"><Link to={`/sign-in?returnTo=${encodeURIComponent('/properties/'+property.$id)}`}>Sign in</Link> to leave a review.</p>}
  </section>;
}

export function PropertyEnquiry({property,user,online}:{property:Property;user:NooklyUser|null;online:boolean}){
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [contacts,setContacts]=useState<{name:string;phone:string;email:string}>({name:property.creatorName||'',phone:property.creatorPhone||'',email:property.creatorEmail||''});
  const [draft,setDraft]=useState<RequestDraft>({proposedPrice:asNumber(property.price),message:'',moveInDate:'',leaseDuration:'',questions:[]});
  const own=Boolean(user&&(property.creatorId===user.accountId||property.creatorId===user.$id));
  useEffect(()=>{setOpen(false);setNotice('');setError('');setDraft({proposedPrice:asNumber(property.price),message:'',moveInDate:'',leaseDuration:'',questions:[]});setContacts({name:property.creatorName||'',phone:property.creatorPhone||'',email:property.creatorEmail||''});},[property.$id]);
  useEffect(()=>{if(!user||!online||own||(!property.creatorId&&!property.agent))return;let active=true;
    // Mobile resolves creatorId (account ID) from users. Only do so for authenticated renters.
    void (async()=>{
      try{
        const owner=property.creatorId;
        if(!owner)return;
        const rows=await databases.listDocuments({databaseId:requireSetting(settings.databaseId,'VITE_APPWRITE_DATABASE_ID'),collectionId:requireSetting(settings.usersCollectionId,'VITE_APPWRITE_USERS_COLLECTION_ID'),queries:[Query.equal('accountId',owner),Query.limit(1)]});
        const row=rows.documents[0];
        if(active&&row)setContacts(previous=>({name:previous.name||String(row.name||''),phone:previous.phone||String(row.phone||''),email:previous.email||String(row.email||'')}));
      }catch{/* Creator lookup may be private. */}
    })();return()=>{active=false};
  },[property.$id,property.creatorId,user?.accountId,online,own]);
  const unavailable=property.isAvailable===false||(asNumber(property.totalSlots)>0&&asNumber(property.availableSlots)<=0);
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!user)return;setBusy(true);setError('');setNotice('');
    try{await submitRentalRequest(user,property.$id,draft);setNotice('Your rental request was saved. Follow its progress in My Requests.');setOpen(false);}catch(err){setError(messageOf(err))}finally{setBusy(false)}
  };
  return <div className="nw-enquiry">
    {unavailable&&<p className="nw-alert">This listing is currently marked unavailable. Contact the landlord to confirm future vacancies.</p>}
    {user && !own && (contacts.phone||contacts.email)&&<div className="nw-owner"><p className="nw-small">Contact listed property owner{contacts.name?` · ${contacts.name}`:''}</p><div className="nw-inline-actions">{contacts.phone&&<a href={`tel:${contacts.phone.replace(/[^0-9+]/g,'')}`} className="btn outline-btn"><Phone size={15}/>Call</a>}{contacts.email&&<a href={`mailto:${encodeURIComponent(contacts.email)}?subject=${encodeURIComponent('Nookly enquiry: '+(property.propertyName||'Property'))}`} className="btn outline-btn"><Mail size={15}/>Email</a>}</div></div>}
    {!user?<><p className="booking-note">Browse freely. Sign in to contact the owner and submit a rental request.</p><Link className="btn btn-wide" to={`/sign-in?returnTo=${encodeURIComponent('/properties/'+property.$id)}`}><Send size={17}/> Sign in to enquire</Link></>:own?<p className="booking-note">This is your listing. Manage rental applications in your landlord workspace.</p>:<><button className="btn btn-wide" disabled={!online||unavailable} onClick={()=>setOpen(x=>!x)} type="button"><MessageSquare size={17}/>{open?'Close form':'Request to rent / arrange viewing'}</button>
    {open&&<form className="nw-request-form" onSubmit={e=>void submit(e)}><label>Proposed monthly rent (USD)<input type="number" min={1} required value={draft.proposedPrice} onChange={e=>setDraft(x=>({...x,proposedPrice:Number(e.target.value)}))}/></label><label>Preferred move-in date<input type="date" value={draft.moveInDate} onChange={e=>setDraft(x=>({...x,moveInDate:e.target.value}))}/></label><label>Lease duration<select value={draft.leaseDuration} onChange={e=>setDraft(x=>({...x,leaseDuration:e.target.value}))}><option value="">Not decided</option><option value="1 month">1 month</option><option value="3 months">3 months</option><option value="6 months">6 months</option><option value="12 months">12 months</option><option value="Flexible">Flexible</option></select></label><label>Message to landlord<textarea minLength={10} maxLength={1500} required value={draft.message} onChange={e=>setDraft(x=>({...x,message:e.target.value}))} placeholder="Introduce yourself, ask about viewing times, and confirm deposits or house rules"/></label><button type="submit" className="btn" disabled={busy||!online}>{busy?'Sending…':'Send rental request'}<ArrowRight size={16}/></button></form>}
    <Link className="nw-small nw-my-requests" to="/my-requests"><CalendarDays size={14}/> My rental requests</Link></>}
    {notice&&<p className="nw-alert nw-success" role="status"><CheckCircle2 size={16}/>{notice}</p>}
    {error&&<p className="nw-alert nw-error" role="alert">{error}</p>}
    <p className="nw-small">Never pay before verifying the property and agreeing with the real owner. Nookly does not hold deposits.</p>
  </div>;
}
