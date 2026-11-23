import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BedDouble, Bookmark, CalendarDays, Check, ChevronDown, ChevronRight, Eye, FileText, Footprints, Heart, House, KeyRound, MapPin, Menu, RefreshCw, Search, SlidersHorizontal, Star, UserRound, UsersRound, Wifi, WifiOff, X } from 'lucide-react';
import { getPwaAccountId, loadSession, signOut } from './lib/auth';
import { SignInPage, SignUpPage } from './components/AuthPages';
import RoommateMatch from './components/RoommateMatch';
import LandlordWorkspace from './components/LandlordWorkspace';
import MyRequests from './components/MyRequests';
import { PropertyEngagement, PropertyEnquiry } from './components/PropertyInteractions';
import './property-workflows.css';
import { MapBrowsePage, PropertyLocationPanel } from './components/NooklyMaps';
import './map-features.css';
import { errorMessage, missingCoreSettings, Query, databases, settings } from './lib/appwrite';
import { changeFavorite, importGuestFavorites, synchronizeFavorites } from './lib/favorites';
import { facilitiesOf, filterProperties, imageOf, loadProperties, loadProperty, priceOf } from './lib/housing';
import { getFavorites, getPendingFavorites } from './lib/offline';
import { RESIDENTIAL_TYPES, type NooklyUser, type Property } from './types';

function useConnectivity() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return online;
}

type AppState = {
  user: NooklyUser | null;
  userOffline: boolean;
  online: boolean;
  accountId: string;
  properties: Property[];
  loading: boolean;
  loadError: string;
  fromCache: boolean;
  cachedAt?: number;
  favorites: string[];
  pendingFavorites: number;
  guestFavorites: number;
  importGuestFavorites: () => Promise<number>;
  refresh: () => Promise<void>;
  toggleFavorite: (propertyId: string) => Promise<void>;
  onLogin: (user: NooklyUser) => void;
  onLogout: () => Promise<void>;
};

function money(value: number | undefined) {
  return Number(value || 0).toLocaleString('en-ZW', { maximumFractionDigits: 0 });
}

function Brand() {
  return <Link to="/" className="brand" aria-label="Nookly home">
    <span className="brandmark"><img src="/mobile-assets/images/icon.png" alt="" /></span>
    <span>nookly<span className="brand-dot">.</span></span>
  </Link>;
}

function BottomNav({ state }: { state: AppState }) {
  return <nav className="mobile-tabs" aria-label="Primary navigation">
    <NavLink to="/" end><House size={21}/><span>Home</span></NavLink>
    <NavLink to="/explore"><Search size={21}/><span>Explore</span></NavLink>
    <NavLink to="/map"><MapPin size={21}/><span>Map</span></NavLink>
    <NavLink to="/saved"><Heart size={21}/><span>Favorites</span></NavLink>
    {(!state.user || (state.user.userMode !== 'landlord' && state.user.userMode !== 'driver')) && <NavLink to="/match"><UsersRound size={21}/><span>Match</span></NavLink>}
    <NavLink to={state.user?.userMode === 'landlord' ? '/landlord' : '/account'}><UserRound size={21}/><span>{state.user?.userMode === 'landlord' ? 'Listings' : 'Profile'}</span></NavLink>
  </nav>;
}

function Shell({ children, state }: { children: React.ReactNode; state: AppState }) {
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  return <div className="app-shell">
    <header className="topbar"><div className="container topbar-inner">
      <Brand />
      <nav className={`navlinks ${menu ? 'mobile-open' : ''}`} aria-label="Main navigation">
        <NavLink end to="/" onClick={() => setMenu(false)}>Home</NavLink>
        <NavLink to="/explore" onClick={() => setMenu(false)}>Explore</NavLink>
        <NavLink to="/map" onClick={() => setMenu(false)}>Map</NavLink>
        <NavLink to="/saved" onClick={() => setMenu(false)}>Favorites <span className="tiny-count">{state.favorites.length}</span></NavLink>
        {(!state.user || (state.user.userMode !== 'landlord' && state.user.userMode !== 'driver')) && <NavLink to="/match" onClick={() => setMenu(false)}>Roommate Match</NavLink>}
        {state.user?.userMode === 'landlord' && <NavLink to="/landlord" onClick={() => setMenu(false)}>My properties</NavLink>}
      </nav>
      <div className="topbar-right">
        {!state.online && <span className="offline-pill"><WifiOff size={14}/> Offline</span>}
        {state.user ? <div className="user-menu">
          <Link to="/account" className="account-avatar" aria-label="Open account">
            {state.user.avatar && /^https?:\/\//.test(state.user.avatar) ? <img src={state.user.avatar} alt=""/> : <span>{state.user.name?.charAt(0)?.toUpperCase() || 'N'}</span>}
          </Link>
          <Link className="user-name" to="/account">{state.user.name?.split(' ')[0]}</Link>
          <button className="subtle-btn signout" onClick={() => { void state.onLogout().catch(err => window.alert(errorMessage(err))); }}>Sign out</button>
        </div> : <button className="btn btn-small" onClick={() => navigate('/sign-in')}><UserRound size={16}/> Sign in</button>}
        <button className="hamburger" aria-label="Toggle navigation" aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X/> : <Menu/>}</button>
      </div>
    </div></header>
    {!state.online && <div className="network-notice" role="status"><WifiOff size={16}/> You're offline. Saved property information remains available; changes that need the internet may be delayed.</div>}
    {state.userOffline && <div className="network-notice" role="status">Viewing a saved account profile offline. Your Appwrite session will be checked when you reconnect.</div>}
    <main>{children}</main>
    <footer className="site-footer"><div className="container footer-inner"><span>© {new Date().getFullYear()} Nookly · Find your place.</span><span>Nookly Accommodation</span></div></footer>
    <BottomNav state={state}/>
  </div>;
}

function priceSuffix(type?: string) {
  const kind = (type || '').trim().toLowerCase();
  if (['boarding', 'boarding house', 'boardinghouse', 'hostel'].includes(kind)) return '/head';
  if (kind === 'luxury') return '/night';
  return '/month';
}

function PropertyCard({ property, state }: { property: Property; state: AppState }) {
  const saved = state.favorites.includes(property.$id);
  const priceDropped = Number(property.new_price) > 0 && Number(property.new_price) < Number(property.price);
  return <article className="property-card native-property-card">
    <div className="card-cover"><Link to={`/properties/${encodeURIComponent(property.$id)}`} className="cover-link" aria-label={`View ${property.propertyName || 'property'}`}>
      {imageOf(property) ? <img src={imageOf(property)!} alt={property.propertyName || 'Accommodation'} loading="lazy" /> : <div className="photo-placeholder"><House size={42}/><span>Photo unavailable</span></div>}
    </Link>
      {priceDropped ? <span className="mobile-deal-badge">↓ ${money(Number(property.price)-priceOf(property))}</span> : Number(property.views) > 0 ? <span className="mobile-views-badge"><Eye size={12}/>{property.views}</span> : null}
      {Number(property.rating) >= 0 && <span className="mobile-rating"><Star size={13} fill="currentColor"/>{Number(property.rating || 0).toFixed(0)}</span>}
      <span className="mobile-type-tag">{property.type || 'Accommodation'}</span>
    </div>
    <div className="card-body">
      <div className="mobile-card-heading"><Link to={`/properties/${encodeURIComponent(property.$id)}`} className="property-title">{property.propertyName || property.type || 'Accommodation'}</Link>
        <button className={`mobile-save ${saved ? 'is-saved' : ''}`} aria-label={saved ? 'Remove from favorites' : 'Save property'} aria-pressed={saved} onClick={() => void state.toggleFavorite(property.$id)}><Heart size={18} fill={saved?'currentColor':'none'}/></button></div>
      <span className="property-address">{property.address || 'Location not provided'}</span>
      <div className="mobile-card-bottom"><span className={priceDropped ? 'is-deal' : ''}>${money(priceOf(property))}<small>{priceSuffix(property.type)}</small></span>
      {Number(property.likes) > 0 && <span className="like-count"><Heart size={14} fill="#ff69b4" color="#ff69b4"/>{property.likes}</span>}</div>
    </div>
  </article>;
}

function FeaturedCardWeb({ property, state }: { property: Property; state: AppState }) {
  const saved = state.favorites.includes(property.$id);
  const priceDropped = Number(property.new_price) > 0 && Number(property.new_price) < Number(property.price);
  return <article className="featured-property">
    <Link className="featured-property-image" to={`/properties/${encodeURIComponent(property.$id)}`} aria-label={`View ${property.propertyName || 'property'}`}>
      {imageOf(property) ? <img src={imageOf(property)!} alt={property.propertyName || 'Accommodation'} loading="lazy"/> : <div className="photo-placeholder"><House size={35}/></div>}
      <div className="featured-gradient"/>
      {priceDropped ? <span className="featured-views">🔥 -${money(Number(property.price)-priceOf(property))}</span> : Number(property.views)>0 ? <span className="featured-views"><Eye size={13}/>{property.views}</span> : null}
      <span className="featured-rating"><Star size={13} fill="currentColor"/>{Number(property.rating || 0).toFixed(0)}</span>
      <div className="featured-copy"><span className="featured-type">{property.type || 'Accommodation'}</span><strong>{property.propertyName || 'Accommodation'}</strong><span className="featured-address">{property.address || 'Unknown address'}</span><b>${money(priceOf(property))}<small>{priceSuffix(property.type)}</small></b></div>
    </Link>
    <button className={`featured-save ${saved?'is-saved':''}`} aria-label={saved ? 'Remove featured property from favorites' : 'Save featured property'} aria-pressed={saved} onClick={() => void state.toggleFavorite(property.$id)}><Heart size={18} fill={saved ? 'currentColor' : 'none'}/></button>
  </article>;
}

function Empty({ icon = <House size={32}/>, title, desc, action }: { icon?: React.ReactNode; title: string; desc: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{desc}</p>{action}</div>;
}

function StudentTips() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const tips = [
    { icon: <Footprints size={20}/>, color: 'blue', title: 'Check the daily commute', desc: 'Visit the property at the time your lectures normally start. Check transport, walking distance, lighting and road safety.' },
    { icon: <Wifi size={20}/>, color: 'green', title: 'Confirm study essentials', desc: 'Ask about Wi-Fi reliability, electricity backup, water availability, a study desk and quiet hours before paying.' },
    { icon: <FileText size={20}/>, color: 'amber', title: 'Read before paying', desc: 'Confirm rent, deposit, curfew, visitor rules, shared costs and refund terms in writing. Keep every receipt.' },
    { icon: <UsersRound size={20}/>, color: 'violet', title: 'Meet your housemates', desc: 'Discuss cleaning, groceries, noise, guests and study schedules early. Agree on expectations before moving in.' },
  ];
  return <section className="student-tips" id="nookly-tips">
    <div className="native-section-heading"><div><h2>Student Pro Tips</h2><p>Find a safe, affordable place that supports your studies</p></div></div>
    <div className="tips-grid">{tips.map((tip, i) => <div className={`tip-card tip-${tip.color}`} key={tip.title}>
      <button aria-expanded={expanded === i} onClick={() => setExpanded(expanded === i ? null : i)}>
        <span className="tip-icon">{tip.icon}</span><strong>{tip.title}</strong><ChevronDown size={18} className={expanded === i ? 'tip-chevron-open' : ''}/>
      </button>
      {expanded === i && <p>{tip.desc}</p>}
    </div>)}</div>
  </section>;
}

function Explore({ state, mode = 'explore' }: { state: AppState; mode?: 'home' | 'explore' }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [location, setLocation] = useState('');
  const [max, setMax] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {const timer = window.setInterval(() => setClock(new Date()), 60_000); return () => window.clearInterval(timer)}, []);
  const period = clock.getHours() >= 6 && clock.getHours() < 12 ? 'morning' : clock.getHours() >= 12 && clock.getHours() < 17 ? 'afternoon' : clock.getHours() >= 17 && clock.getHours() < 20 ? 'sunset' : 'night';
  const greeting = clock.getHours() < 12 ? 'Good Morning' : clock.getHours() < 18 ? 'Good Afternoon' : 'Good Evening';
  const featured = state.properties.slice(0, 6);
  const visible = useMemo(() => filterProperties(state.properties, { search, category, maximumPrice: max.trim() ? Number(max) : null, schoolLocation: location, availableOnly: true }), [state.properties, search, category, location, max]);
  const isHome = mode === 'home';
  const school = state.user?.schoolLocation?.trim() || '';
  return <>
    {isHome && <section className={`mobile-greeting-banner time-${period}`} style={{ backgroundImage: `linear-gradient(90deg, rgba(8,13,32,.68), rgba(8,13,32,.24)), url('/mobile-assets/images/${period}.jpg')` }}>
      <div className="container greeting-inner"><div className="greeting-identity">
        <Link to={state.user ? '/account' : '/sign-in'} className="greeting-avatar" aria-label="Open your profile">{state.user?.avatar && /^https?:\/\//.test(state.user.avatar) ? <img src={state.user.avatar} alt=""/> : <UserRound size={26}/>}</Link>
        <div><small>{greeting}</small><strong>{state.user?.name || 'Welcome to Nookly'}</strong></div>
      </div><Link to="/account" className="greeting-link" aria-label="View account"><UserRound size={20}/></Link></div>
    </section>}
    <div className={`container native-discovery ${isHome ? 'home-mode' : 'explore-mode'}`}>
      {isHome ? <>
        <Link to="/explore" className="native-search-shortcut"><Search size={20}/><span>{school ? 'Search student housing near your school...' : 'Search accommodation, location or amenities...'}</span><ArrowRight size={17}/></Link>
        <Link to="/explore" className="native-school-card"><span className="native-school-icon"><MapPin size={23}/></span><span><small>{school ? 'Showing student housing within' : 'Discover accommodation across'}</small><strong>{school || 'All locations'}</strong></span><ChevronRight size={20}/></Link>
        <div className="native-shortcuts" aria-label="Quick actions">
          <Link to="/saved"><span className="shortcut-icon red"><Heart size={27}/></span><span>Favorites</span></Link>
          <Link to="/explore"><span className="shortcut-icon blue"><Search size={27}/></span><span>Explore</span></Link>
          <Link to="/map"><span className="shortcut-icon green"><MapPin size={27}/></span><span>Map</span></Link>
          {(!state.user || (state.user.userMode !== 'landlord' && state.user.userMode !== 'driver')) && <Link to="/match"><span className="shortcut-icon blue"><UsersRound size={27}/></span><span>Match</span></Link>}
          <Link to={state.user?.userMode==='landlord'?'/landlord':'/account'}><span className="shortcut-icon green">{state.user?.userMode==='landlord'?<House size={27}/>:<UserRound size={27}/>}</span><span>{state.user?.userMode==='landlord'?'Listings':'Profile'}</span></Link>
          <a href="#nookly-tips"><span className="shortcut-icon amber"><CalendarDays size={27}/></span><span>Pro Tips</span></a>
        </div>
        <section className="featured-section">
          <div className="native-section-heading"><div><h2>Featured</h2><p>{school ? 'Best-performing properties near your school' : 'Best-performing Nookly properties'}</p></div><Link to="/explore" className="native-see-all">See all</Link></div>
          {state.loading && !state.properties.length ? <div className="native-featured-row">{[0,1,2].map(i=><div className="native-featured-skeleton" key={i}/>)}</div>
            : featured.length > 0 ? <div className="native-featured-row">{featured.map(p=><FeaturedCardWeb property={p} state={state} key={p.$id}/>)}</div>
            : <div className="native-featured-empty">No supported properties found yet.</div>}
        </section>
        <StudentTips />
      </> : <>
        <div className="explore-title"><span className="section-kicker">EXPLORE NOOKLY</span><h1>{school ? 'Student Housing' : 'Explore accommodation'}</h1><p>{school ? `Boarding houses, houses, studios and more within ${school}.` : 'Boarding houses, apartments, family homes and more.'}</p></div>
        <div className="native-explore-search">
          <label className="native-search-input"><Search size={20}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, address, type or facilities..." aria-label="Search properties"/>{search&&<button aria-label="Clear search" onClick={()=>setSearch('')}><X size={17}/></button>}</label>
          <label className="native-location-input"><MapPin size={19}/><input value={location} onChange={e=>setLocation(e.target.value)} placeholder="Town or school area" aria-label="Location filter"/></label>
          <button className="native-filter-button" onClick={()=>setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}><SlidersHorizontal size={18}/> Filters <ChevronDown size={15}/></button>
        </div>
        {filtersOpen && <div className="native-extra-filters"><label>Maximum rent (USD)<input type="number" min="0" value={max} onChange={e=>setMax(e.target.value)} placeholder="Any price"/></label><button onClick={()=>{setMax('');setLocation('');setSearch('');setCategory('All')}}>Clear filters</button></div>}
      </>}
      <div className="native-chips" role="group" aria-label="Property types">{RESIDENTIAL_TYPES.map(type => <button key={type} onClick={()=>setCategory(type)} className={category === type?'active':''}>{type === 'Boarding'?'Boarding House':type}</button>)}</div>
      <div className="native-section-heading recommended-heading"><div><h2>{isHome ? 'Recommended' : 'All Student Properties'}</h2><p>{isHome ? 'Ranked housing from Nookly' : 'Search and filter Nookly accommodation'}</p></div><Link to="/map" className="native-refresh"><MapPin size={17}/> View map</Link><button className="native-refresh" disabled={!state.online || state.loading} onClick={()=>void state.refresh()} aria-label="Refresh properties"><RefreshCw size={18} className={state.loading?'spinning':''}/><span>Refresh</span></button></div>
      {(state.fromCache || state.loadError) && <div className={`status-line ${state.loadError && !state.properties.length ? 'status-error' : ''}`} role="status">{state.fromCache && <><Bookmark size={16}/> Showing cached properties</>}</div>}
      <div className="mobile-result-count">{state.loading&&!state.properties.length?'Loading accommodation…':`${visible.length} propert${visible.length===1?'y':'ies'} found`}</div>
      {state.loading && !state.properties.length ? <div className="card-grid">{Array.from({length:6},(_,i)=><div className="card-skeleton" key={i}/>)}</div>
        : visible.length ? <div className="card-grid">{visible.map(property=><PropertyCard key={property.$id} property={property} state={state}/>)}</div>
        : <Empty icon={<Search size={32}/>} title={state.loadError?'Unable to load properties':'No matching homes yet'} desc={state.loadError || 'Try another search term, property type or location.'} action={<button className="btn" onClick={()=>{setSearch('');setLocation('');setMax('');setCategory('All');void state.refresh()}}>Try again</button>}/>}
    </div>
  </>;
}


function SignInRequired({ title, desc, returnTo }: { title: string; desc: string; returnTo: string }) {
  const link = `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
  return <section className="container page-inner"><div className="guest-gate">
    <span className="auth-icon"><KeyRound size={25}/></span>
    <h1>{title}</h1><p>{desc}</p>
    <Link className="btn" to={link}>Sign in to continue <ArrowRight size={17}/></Link>
    <Link to="/explore" className="guest-back-link">Continue browsing accommodation</Link>
  </div></section>;
}

function Account({ state }: { state: AppState }) {
  if (!state.user) return <SignInRequired title="Your Nookly profile" desc="You can explore and save accommodation as a guest. Sign in to access your personal profile." returnTo="/account" />;
  const user = state.user;
  return <section className="container page-inner profile-page"><div className="account-profile-card"><div className="profile-avatar">{user.avatar && /^https?:\/\//.test(user.avatar)?<img src={user.avatar} alt=""/>:user.name.charAt(0).toUpperCase()}</div><div><span className="section-kicker">YOUR NOOKLY ACCOUNT</span><h1>{user.name}</h1><p>{user.email}</p></div></div><div className="profile-facts"><div><span>Account type</span><strong>{user.userMode === 'landlord'?'Landlord':user.tenantType==='student' || user.userMode==='student'?'Student tenant':user.tenantType || user.userMode}</strong></div>{user.schoolLocation&&<div><span>School location</span><strong>{user.schoolLocation}</strong></div>}{user.phone&&<div><span>Phone</span><strong>{user.phone}</strong></div>}</div><p className="profile-note">Manage your Nookly profile and accommodation activity.</p>{user.userMode!=='landlord'&&<Link className="btn outline-btn" to="/my-requests"><CalendarDays size={16}/> My rental requests</Link>}<button className="btn outline-btn" onClick={()=>void state.onLogout().catch(err=>window.alert(errorMessage(err)))}>Sign out</button></section>;
}
function Detail({ state }: { state: AppState }) {
  const { id } = useParams();
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [cached, setCached] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setFailure('');setProperty(null);
    if (!id) {setLoading(false);return;}
    void loadProperty(state.accountId,id).then(result => {if (active) {setProperty(result.property);setCached(result.fromCache)}}).catch(error => {if (active) setFailure(errorMessage(error))}).finally(() => {if (active) setLoading(false)});
    return () => {active=false};
  }, [id, state.accountId, state.online]);
  if (loading) return <div className="container page-inner"><p>Loading property details…</p></div>;
  if (!property) return <div className="container page-inner"><Empty title="Property unavailable" desc={failure || 'This property is not in your saved offline data.'} action={<Link className="btn" to="/">Back to Explore</Link>}/></div>;
  const photos = [property.image1,property.image2,property.image3,...(property.images ?? [])].filter((x): x is string => typeof x === 'string' && /^https?:\/\//.test(x));
  const saved = state.favorites.includes(property.$id);
  return <div className="container detail-page">
    <Link className="back-link" to="/"><ArrowLeft size={18}/> Back to Explore</Link>
    <div className="detail-head"><div><span className="section-kicker">{property.type || 'ACCOMMODATION'}</span><h1>{property.propertyName || 'Accommodation'}</h1><p><MapPin size={18}/>{property.address || 'Location unavailable'}</p></div><button className={`btn outline-btn ${saved?'saved-btn':''}`} onClick={()=>void state.toggleFavorite(property.$id)}><Heart size={18} fill={saved?'currentColor':'none'}/>{saved?'Saved':'Save this home'}</button></div>
    {cached && <div className="status-line"><WifiOff size={16}/> Viewing saved property details. Availability and prices may have changed.</div>}
    <div className="detail-gallery"><div className="gallery-primary">{photos[0] ? <img src={photos[0]} alt={property.propertyName || 'Property photo'}/> : <div className="photo-placeholder"><House size={54}/><span>Photo unavailable</span></div>}</div><div className="gallery-side">{photos.slice(1,3).map((src,i)=><img src={src} alt={`Property photo ${i+2}`} key={src}/>)}{photos.length<2 && <div className="photo-placeholder">More photos coming soon</div>}</div></div>
    {(['video1','video2','video3'] as const).some(key=>typeof property[key]==='string' && /^https?:\/\//.test(String(property[key])))&&<section className="nw-panel nw-video-tours"><h2>Video tours</h2><div className="nw-video-grid">{(['video1','video2','video3'] as const).map((key,i)=>typeof property[key]==='string'&&/^https?:\/\//.test(String(property[key]))?<video key={key} controls preload="metadata" playsInline src={String(property[key])} aria-label={`Property video tour ${i+1}`}/>:null)}</div></section>}
    <div className="detail-layout"><section><div className="detail-block"><h2>About this place</h2><p className="long-copy">{property.description || 'No property description has been provided yet.'}</p></div><div className="detail-block"><h2>What this place offers</h2>{facilitiesOf(property).length ? <div className="amenity-grid">{facilitiesOf(property).map(f => <span key={f}><Check size={18}/>{f}</span>)}</div> : <p className="muted">Amenities have not been listed.</p>}</div><PropertyLocationPanel property={property}/><PropertyEngagement property={property} user={state.user} online={state.online}/></section>
      <aside className="booking-box"><span className="section-kicker">MONTHLY RENT</span><div className="booking-price">${money(priceOf(property))}<small> / month</small></div><div className="booking-sep"/>{Number(property.bedrooms)>0 && <div className="spec-row"><BedDouble size={19}/><span>Bedrooms</span><strong>{property.bedrooms}</strong></div>}{Number(property.roomFor)>0 && <div className="spec-row"><UserRound size={19}/><span>Room for</span><strong>{property.roomFor}</strong></div>}{Number(property.availableSlots)>=0 && property.availableSlots!==undefined && <div className="spec-row"><Check size={19}/><span>Available slots</span><strong>{property.availableSlots}</strong></div>}
        <div className="booking-sep"/>
        <PropertyEnquiry property={property} user={state.user} online={state.online}/>
        <button className="btn outline-btn btn-wide" onClick={()=>void state.toggleFavorite(property.$id)}><Heart size={17} fill={saved?'currentColor':'none'}/>{saved?'Remove from saved':'Save property for later'}</button>
      </aside></div>
  </div>;
}

function Saved({ state }: { state: AppState }) {
  const properties = state.properties.filter(p => state.favorites.includes(p.$id));
  return <section className="container page-inner"><span className="section-kicker">YOUR SHORTLIST</span><div className="section-head"><div><h1>Saved places</h1><p>Keep your favourite accommodation close, including when you're offline.</p></div></div>
    {state.accountId === 'guest' && <div className="status-line">You're browsing as a guest. Favorites are stored on this device; sign in to save them to your account.</div>}
    {state.accountId !== 'guest' && state.guestFavorites > 0 && <div className="guest-import" role="region" aria-label="Import saved guest homes"><div><strong>You have {state.guestFavorites} guest-saved home(s) on this device.</strong><p>Import them into this account? We won't import them unless you choose to.</p></div><button className="btn" onClick={()=>void state.importGuestFavorites().catch(err=>window.alert(errorMessage(err)))}>Import guest favorites</button></div>}
    {state.pendingFavorites>0 && <div className="status-line"><RefreshCw size={16}/>{state.pendingFavorites} favorite change(s) waiting to sync.</div>}
    {properties.length ? <div className="card-grid">{properties.map(p=><PropertyCard key={p.$id} property={p} state={state}/>)}</div> : <Empty icon={<Heart size={34}/>} title="Your shortlist is empty" desc="Tap the heart on any home to keep it here." action={<Link to="/" className="btn">Browse homes <ArrowRight size={17}/></Link>}/>}
  </section>;
}

function Landlord({state}:{state:AppState}) {
  return <LandlordWorkspace user={state.user} online={state.online} refresh={state.refresh}/>;
}

function AppContent(){
  const online=useConnectivity();
  const [user,setUser]=useState<NooklyUser|null>(null);
  const [userOffline,setUserOffline]=useState(false);
  const [sessionReady,setSessionReady]=useState(false);
  const [sessionError,setSessionError]=useState('');
  const accountId=user?.accountId || 'guest';
  const [properties,setProperties]=useState<Property[]>([]);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState('');
  const [fromCache,setFromCache]=useState(false);
  const [cachedAt,setCachedAt]=useState<number>();
  const [favorites,setFavorites]=useState<string[]>([]);
  const [guestFavorites,setGuestFavorites]=useState(0);
  const [pendingFavorites,setPendingFavorites]=useState(0);
  useEffect(()=>{let active=true;
    const ownedAccount=getPwaAccountId();
    if(!ownedAccount){setUser(null);setUserOffline(false);setSessionReady(true);return()=>{active=false};}
    void loadSession(ownedAccount).then(result=>{if(active){setUser(result.user);setUserOffline(result.offline)}}).catch(err=>{if(active)setSessionError(errorMessage(err))}).finally(()=>{if(active)setSessionReady(true)});
    return()=>{active=false};
  },[online]);
  const refresh=useCallback(async(force=false)=>{setLoading(true);setLoadError('');try{const result=await loadProperties(accountId,force);setProperties(result.items);setFromCache(result.fromCache);setCachedAt(result.savedAt);setLoadError(result.warning||'');}catch(err){setLoadError(errorMessage(err));setProperties([])}finally{setLoading(false)}},[accountId]);
  useEffect(()=>{if(sessionReady)void refresh();},[sessionReady,refresh]);
  useEffect(()=>{let active=true;void getFavorites(accountId).then(result=>{if(active)setFavorites(result)});return()=>{active=false}},[accountId]);
  useEffect(()=>{let active=true;void getFavorites('guest').then(result=>{if(active)setGuestFavorites(result.length)});return()=>{active=false}},[accountId]);
  useEffect(()=>{if(!sessionReady)return;let active=true;const run=async()=>{if(online&&accountId!=='guest'){await synchronizeFavorites(accountId)}const [ids,queue]=await Promise.all([getFavorites(accountId),getPendingFavorites(accountId)]);if(active){setFavorites(ids);setPendingFavorites(queue.length)}};void run();return()=>{active=false}},[accountId,online,sessionReady]);
  const toggleFavorite=useCallback(async(id:string)=>{const newIds=await changeFavorite(accountId,id,!favorites.includes(id));setFavorites(newIds);if(accountId==='guest')setGuestFavorites(newIds.length);const queue=await getPendingFavorites(accountId);setPendingFavorites(queue.length);if(online&&accountId!=='guest'){void synchronizeFavorites(accountId).then(async result=>{setPendingFavorites(result.pending);setFavorites(await getFavorites(accountId))}).catch(err=>console.warn('Favorite sync deferred:',err))}},[accountId,favorites,online]);
  const importSavedGuestFavorites=async()=>{if(accountId==='guest')throw new Error('Sign in to import favorites.');const imported=await importGuestFavorites(accountId);setGuestFavorites(0);if(imported){setFavorites(await getFavorites(accountId));setPendingFavorites((await getPendingFavorites(accountId)).length);if(online){const result=await synchronizeFavorites(accountId);setPendingFavorites(result.pending);setFavorites(await getFavorites(accountId));if(result.error)throw new Error(`Favorites saved locally, but server sync is pending: ${result.error}`)}}return imported;};
  const onLogout=async()=>{await signOut();setUser(null);setFavorites([]);setProperties([]);setUserOffline(false);setSessionError('')};
  const state:AppState={user,userOffline,online,accountId,properties,loading,loadError,fromCache,cachedAt,favorites,pendingFavorites,guestFavorites,importGuestFavorites:importSavedGuestFavorites,refresh:()=>refresh(true),toggleFavorite,onLogin:setUser,onLogout};
  if(!sessionReady)return <div className="startup"><Brand/><div className="pulse"/><p>Preparing your Nookly home...</p></div>;
  return <Shell state={state}>{missingCoreSettings().length>0&&<div className="container config-warning"><strong>Appwrite setup needed:</strong> {missingCoreSettings().join(', ')}. Add these values to <code>.env</code> and restart the dev server.</div>}{sessionError&&<div className="container config-warning">Session check: {sessionError}</div>}
    <Routes><Route path="/" element={<Explore state={state} mode="home"/>} /><Route path="/explore" element={<Explore state={state} mode="explore"/>} /><Route path="/map" element={<MapBrowsePage properties={state.properties} loading={state.loading}/>} /><Route path="/saved" element={<Saved state={state}/>} /><Route path="/my-requests" element={<MyRequests user={state.user} online={state.online}/>} /><Route path="/account" element={<Account state={state}/>} /><Route path="/properties/:id" element={<Detail state={state}/>} /><Route path="/sign-in" element={<SignInPage user={state.user} online={state.online} onLogin={state.onLogin}/>} /><Route path="/sign-up" element={<SignUpPage user={state.user} online={state.online} onLogin={state.onLogin}/>} /><Route path="/match" element={<RoommateMatch user={state.user} online={state.online}/>} /><Route path="/landlord" element={<Landlord state={state}/>} /><Route path="*" element={<div className="container page-inner"><Empty title="Page not found" desc="This page isn't available in Nookly Accommodation Web." action={<Link className="btn" to="/">Return home</Link>}/></div>}/></Routes>
  </Shell>;
}

export default function App(){return <BrowserRouter><AppContent/></BrowserRouter>}
