import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronDown, Edit3, HeartHandshake, LockKeyhole, MapPin, RefreshCw, Search, ShieldCheck, Users, UserRound, Eye, EyeOff } from 'lucide-react';
import type { NooklyUser } from '../types';
import { errorMessage, settings } from '../lib/appwrite';
import { getMyMatchProfile, findRoommates, saveMatchProfile, setMatchVisibility, type MatchDraft, type RoommateProfile } from '../lib/matchApi';
import { normalizeLifestyle, profileCompleteness } from '../lib/matching';

const LIFESTYLES = ['Study-focused','Quiet','Social','Early bird','Night owl','Non-smoker','Sober','Churchgoer','Pet lover'];
const emptyDraft: MatchDraft={gender:'male',preferredGender:'any',budget:0,preferredLocation:'',preferredRoommateType:'Any',lifestyle:[],about:'',moveInDate:'Flexible',lookingFor:'roommate'};
type Ranked = RoommateProfile & {matchScore:number;matchCoverage:number;matchReasons:string[]};

export default function RoommateMatch({user,online}:{user:NooklyUser|null;online:boolean}) {
  const [myProfile,setMyProfile]=useState<RoommateProfile|null>(null);
  const [draft,setDraft]=useState<MatchDraft>(emptyDraft);
  const [matches,setMatches]=useState<Ranked[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [editing,setEditing]=useState(false);
  const [publish,setPublish]=useState(false);
  const [consent,setConsent]=useState(false);
  const [truncated,setTruncated]=useState(false);
  const [query,setQuery]=useState('');
  const [revealed,setRevealed]=useState<string|null>(null);
  const isTenant=Boolean(user && user.userMode!=='landlord' && user.userMode!=='driver');
  const ready=Boolean(settings.matchProfilesCollectionId);

  const loadMatches=useCallback(async(profile:RoommateProfile)=>{
    if(profile.isActive===false){setMatches([]);setTruncated(false);return;}
    const result=await findRoommates(profile);
    setMatches(result.matches);
    setTruncated(result.truncated);
  },[]);

  useEffect(()=>{
    let active=true;
    setMyProfile(null);setMatches([]);setEditing(false);setError('');setNotice('');setLoading(true);
    if(!isTenant || !user || !ready || !online){setLoading(false);return()=>{active=false};}
    void (async()=>{
      try {
        const profile=await getMyMatchProfile(user.accountId);
        if(!active)return;
        if(profile){
          setMyProfile(profile);
          setDraft({gender:profile.gender||'male',preferredGender:profile.preferredGender||'any',budget:Number(profile.budget)||0,
            preferredLocation:profile.preferredLocation||'',preferredRoommateType:profile.preferredRoommateType||'Any',
            lifestyle:normalizeLifestyle(profile.lifestyle),about:profile.about||'',moveInDate:profile.moveInDate||'Flexible',lookingFor:profile.lookingFor||'roommate'});
          setPublish(profile.isActive!==false);
          if(profile.isActive!==false){const ranked=await findRoommates(profile);if(active){setMatches(ranked.matches);setTruncated(ranked.truncated);}}
        } else {
          setDraft({...emptyDraft,preferredLocation:user.schoolLocation||''});
          setEditing(true);
        }
      }catch(e){if(active)setError(errorMessage(e));}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false};
  },[user?.accountId,isTenant,ready,online]);

  const refresh=async()=>{
    if(!myProfile||!online)return;
    setBusy(true);setError('');setNotice('');
    try{await loadMatches(myProfile);setNotice('Matches updated.');}
    catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  };
  const save=async(event:FormEvent)=>{
    event.preventDefault();
    if(!user||!online)return;
    if(publish&&!consent){setError('Please confirm that your profile and contact details may be shown to compatible Nookly members, or save it privately.');return;}
    setBusy(true);setError('');setNotice('');
    try{
      const result=await saveMatchProfile(user,draft,myProfile,publish);
      setMyProfile(result);
      setEditing(false);
      setConsent(false);
      setNotice(publish?'Your profile is visible to compatible tenants.':'Your profile is saved privately.');
      await loadMatches(result);
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  };
  const toggleVisibility=async()=>{
    if(!user||!myProfile||!online)return;
    if(myProfile.isActive===false && !window.confirm('Make your profile and its contact details visible to compatible Nookly members?'))return;
    setBusy(true);setError('');setNotice('');
    try{
      const result=await setMatchVisibility(myProfile,user.accountId,myProfile.isActive===false);
      setMyProfile(result);
      await loadMatches(result);
      setNotice(result.isActive?'Your profile is visible.':'Your profile is hidden from matching.');
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  };
  const filtered=useMemo(()=>{
    const target=query.trim().toLowerCase();
    return target?matches.filter(m=>[m.name,m.preferredLocation,m.about,...normalizeLifestyle(m.lifestyle)].some(v=>String(v||'').toLowerCase().includes(target))):matches;
  },[matches,query]);

  if(!user) return <section className="container match-page"><div className="match-guest"><span className="match-round-icon"><Users size={27}/></span><span className="section-kicker">NOOKLY MATCH</span><h1>Find a compatible housemate.</h1><p>Keep exploring properties as a guest. Sign in with your Nookly account to create a roommate profile and see compatible tenants.</p><div className="match-guest-actions"><Link className="btn" to="/sign-in?returnTo=%2Fmatch">Sign in to Match <ArrowRight size={17}/></Link><Link className="btn outline-btn" to="/sign-up">Create account</Link></div></div></section>;
  if(!isTenant) return <section className="container match-page"><div className="match-guest"><LockKeyhole size={30}/><h1>Nookly Match is for tenants</h1><p>Students, single tenants and families can choose to search for housemates. Landlords have their own accommodation dashboard.</p><Link className="btn" to="/landlord">My properties <ArrowRight size={16}/></Link></div></section>;
  if(!ready) return <section className="container match-page"><div className="match-notice match-error"><strong>Match configuration missing.</strong> Add <code>VITE_APPWRITE_MATCH_PROFILES_COLLECTION_ID</code> to your PWA's <code>.env</code> and restart Vite.</div></section>;

  return <section className="container match-page">
    <div className="match-head"><div><span className="section-kicker">NOOKLY MATCH</span><h1>Find your kind of housemate.</h1><p>Match by location, monthly budget, lifestyle and move-in plans. Scores represent preference alignment—not a guarantee of compatibility.</p></div><div className="match-head-badge"><HeartHandshake size={20}/><span>Built from Nookly Mobile</span></div></div>
    {!online&&<div className="match-notice">You’re offline. Matching profiles need an online connection; your property browsing remains available.</div>}
    {error&&<div className="match-notice match-error" role="alert">{error}</div>}
    {notice&&<div className="match-notice match-success" role="status">{notice}</div>}
    {loading?<div className="match-empty"><RefreshCw className="spinning" size={22}/><p>Loading your roommate profile…</p></div>:<>
      <div className="match-layout"><aside className="match-sidebar">
        {myProfile&&!editing?<div className="match-profile"><div className="match-profile-head"><div className="match-profile-avatar">{user.name?.charAt(0)?.toUpperCase()||'N'}</div><div><strong>{user.name}</strong><small>{myProfile.isActive!==false?'Visible to compatible tenants':'Profile hidden'}</small></div></div><div className="match-profile-facts"><span><MapPin size={15}/>{myProfile.preferredLocation}</span><span>Budget <strong>${Number(myProfile.budget||0).toLocaleString('en-ZW')}/month</strong></span><span><ShieldCheck size={15}/> {profileCompleteness(myProfile)}/5 key details completed</span></div><button className="btn btn-wide" onClick={()=>{setEditing(true);setPublish(myProfile.isActive!==false);setConsent(false);}}><Edit3 size={16}/> Edit profile</button><button className="btn outline-btn btn-wide" onClick={()=>void toggleVisibility()} disabled={busy||!online}>{myProfile.isActive!==false?<><EyeOff size={16}/> Hide my profile</>:<><Eye size={16}/> Make profile visible</>}</button></div>:null}
        {editing&&<form className="match-form" onSubmit={save}><div className="match-form-title"><h2>{myProfile?'Edit your search':'Create your roommate profile'}</h2><p>Tell us about your ideal shared home.</p></div>
          <div className="match-fields"><label>Preferred location <span>*</span><input required maxLength={120} value={draft.preferredLocation} onChange={e=>setDraft(d=>({...d,preferredLocation:e.target.value}))} placeholder="e.g. Bindura"/></label>
            <label>Monthly budget (USD) <span>*</span><input required type="number" min="1" max="1000000" step="1" value={draft.budget||''} onChange={e=>setDraft(d=>({...d,budget:Number(e.target.value)}))} placeholder="e.g. 100"/></label>
            <label>Your gender <span>*</span><select required value={draft.gender} onChange={e=>setDraft(d=>({...d,gender:e.target.value as MatchDraft['gender']}))}><option value="male">Male</option><option value="female">Female</option></select></label>
            <label>Preferred housemate gender<select value={draft.preferredGender} onChange={e=>setDraft(d=>({...d,preferredGender:e.target.value as MatchDraft['preferredGender']}))}><option value="any">Any</option><option value="male">Male</option><option value="female">Female</option></select></label>
            <label>Looking for<select value={draft.lookingFor} onChange={e=>setDraft(d=>({...d,lookingFor:e.target.value}))}><option value="roommate">A roommate</option><option value="place to rent">A place to rent together</option><option value="both">Both</option></select></label>
            <label>Preferred roommate type<select value={draft.preferredRoommateType} onChange={e=>setDraft(d=>({...d,preferredRoommateType:e.target.value}))}><option value="Any">Any</option><option value="Student">Student</option><option value="Professional">Working professional</option><option value="Tenant">Other tenant</option></select></label>
            <label>Move-in date<small>Leave empty if flexible</small><input type="date" value={draft.moveInDate==='Flexible'?'':draft.moveInDate} onChange={e=>setDraft(d=>({...d,moveInDate:e.target.value||'Flexible'}))}/></label>
            <label className="match-wide">About your search<textarea rows={3} maxLength={450} value={draft.about} onChange={e=>setDraft(d=>({...d,about:e.target.value}))} placeholder="What would make a great housemate?"/></label>
          </div>
          <fieldset className="match-lifestyle"><legend>My lifestyle</legend><div className="match-lifestyle-pills">{LIFESTYLES.map(v=>{const selected=normalizeLifestyle(draft.lifestyle).includes(v);return <label className={selected?'selected':''} key={v}><input type="checkbox" checked={selected} onChange={()=>setDraft(d=>({...d,lifestyle:selected?normalizeLifestyle(d.lifestyle).filter(x=>x!==v):[...normalizeLifestyle(d.lifestyle),v]}))}/>{selected&&<Check size={13}/>} {v}</label>})}</div></fieldset>
          <div className="match-publication"><label><input type="checkbox" checked={publish} onChange={e=>{setPublish(e.target.checked);setConsent(false)}}/> Make my profile visible to compatible tenants</label>{publish&&<label className="match-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> I understand other matched Nookly users may see my profile and the contact details saved with it.</label>}</div>
          <div className="match-form-actions"><button className="btn" type="submit" disabled={!online||busy}>{busy?'Saving…':myProfile?'Save changes':'Create match profile'}</button>{myProfile&&<button type="button" className="btn outline-btn" onClick={()=>{setEditing(false);setError('')}}>Cancel</button>}</div>
        </form>}
        <p className="match-small-note"><LockKeyhole size={15}/> Your match profile is separate from your accommodation listings. Hide it whenever you're not looking.</p>
      </aside>
      <div className="match-results">
        <div className="match-results-head"><div><h2>Your matches</h2><p>{myProfile?.isActive!==false?`${matches.length} compatible profiles found`:'Publish your profile to see compatible people.'}</p></div><button className="match-refresh" disabled={!myProfile||myProfile.isActive===false||busy||!online} onClick={()=>void refresh()} aria-label="Refresh matches"><RefreshCw size={17} className={busy?'spinning':''}/> Refresh</button></div>
        {truncated&&<div className="match-notice">Some profiles were not scanned because the results were capped. Narrow your area or refresh later for more matches.</div>}
        {myProfile?.isActive!==false && matches.length>0&&<div className="match-search"><Search size={18}/><input aria-label="Filter matches" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filter people, places or lifestyle…"/></div>}
        {!myProfile?<div className="match-empty"><Users size={32}/><h3>Set up your roommate profile</h3><p>Your profile lets Nookly calculate real matches instead of showing random people.</p></div>:
          myProfile.isActive===false?<div className="match-empty"><EyeOff size={32}/><h3>Your profile is hidden</h3><p>Enable it when you're ready to find a housemate.</p></div>:
          !online?<div className="match-empty"><RefreshCw size={26}/><h3>Connect to view matches</h3><p>Matching results aren't stored on this device to protect other people's contact information.</p></div>:
          !matches.length?<div className="match-empty"><Users size={32}/><h3>No compatible matches yet</h3><p>Try a wider area or revise your budget and preferences. We won't show incompatible profiles just to fill the page.</p></div>:
          !filtered.length?<div className="match-empty"><Search size={30}/><h3>No matching search results</h3><p>Try another name or location.</p></div>:
          <div className="match-card-grid">{filtered.map(m=><article className="match-card" key={m.$id}><div className="match-card-top"><div className="match-avatar">{m.avatar&&/^https?:\/\//.test(m.avatar)?<img src={m.avatar} alt=""/>:<UserRound size={26}/>}</div><div className="match-person"><h3>{m.name||'Nookly tenant'}</h3><p><MapPin size={14}/>{m.preferredLocation}</p></div><div className="match-score"><strong>{m.matchScore}%</strong><small>alignment</small></div></div><div className="match-tags"><span>${Number(m.budget||0).toLocaleString('en-ZW')}/month</span><span>{m.moveInDate&&m.moveInDate!=='Flexible'?new Date(m.moveInDate).toLocaleDateString():'Flexible move-in'}</span>{normalizeLifestyle(m.lifestyle).slice(0,2).map(x=><span key={x}>{x}</span>)}</div>{m.about&&<p className="match-about">{m.about}</p>}{m.matchReasons.length>0&&<p className="match-data-note">Why you match: {m.matchReasons.join(" · ")}</p>}{m.matchCoverage<70&&<p className="match-data-note">Limited comparison: only {m.matchCoverage}% of scoring factors have usable answers from both profiles.</p>}
            <button className="match-contact-toggle" onClick={()=>setRevealed(id=>id===m.$id?null:m.$id)} aria-expanded={revealed===m.$id}>{revealed===m.$id?'Hide contact':'View contact'} <ChevronDown size={16}/></button>{revealed===m.$id&&<div className="match-contact"><p>Use contact details responsibly. Do not share them outside Nookly without permission.</p>{m.email&&<a href={`mailto:${m.email}`}>Email {m.name?.split(' ')[0]||'match'}</a>}{m.phone&&<a href={`tel:${m.phone}`}>Call</a>}{!m.email&&!m.phone&&<small>Contact details not provided.</small>}</div>}
          </article>)}</div>}
      </div></div>
    </>}
  </section>;
}
