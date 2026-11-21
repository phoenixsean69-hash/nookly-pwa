import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Building2, Camera, Check, CheckCircle2,
  Eye, EyeOff, GraduationCap, Home, KeyRound, LockKeyhole,
  RefreshCcw, School, Search, ShieldCheck, UserRound, UsersRound,
} from 'lucide-react';
import { createAccount, repairAccount, signIn, type RegisterInput, type RegisterResult } from '../lib/auth';
import { errorMessage } from '../lib/appwrite';
import { listRegisteredSchools, type RegisteredInstitution } from '../lib/institutions';
import type { NooklyUser, TenantType } from '../types';

interface AuthProps {
  online: boolean;
  onLogin: (user: NooklyUser) => void;
  user: NooklyUser | null;
}

/** Only navigate inside the PWA. Never accept an arbitrary URL from returnTo. */
function resolveReturnTo(search: string): string {
  const requested = new URLSearchParams(search).get('returnTo') || '';
  return /^\/(?:properties\/[A-Za-z0-9._-]+|account|landlord)$/.test(requested) ? requested : '';
}
function nextPage(user: NooklyUser, returnTo: string): string {
  return returnTo && (returnTo !== '/landlord' || user.userMode === 'landlord')
    ? returnTo : user.userMode === 'landlord' ? '/landlord' : '/account';
}
function authError(error: unknown): string {
  const code = Number((error as { code?: unknown } | null)?.code);
  const type = String((error as { type?: string } | null)?.type || '');
  if (code === 429) return 'Too many attempts. Please try again later.';
  if (type.includes('user_invalid_credentials')) return 'Incorrect email or password. Please try again.';
  if (type.includes('user_already_exists')) return 'This email is already registered. Sign in instead.';
  return errorMessage(error);
}
function AuthVisual({ registration = false }: { registration?: boolean }) {
  return <aside className="nookly-auth-photo" aria-label="Nookly accommodation">
    <div className="nookly-auth-photo-cover">
      <div className="nookly-auth-photo-icon"><Home size={27}/></div>
      <span className="nookly-auth-photo-kicker">NOOKLY ACCOMMODATION</span>
      <h2>{registration ? 'Your space. Your next chapter.' : 'A place to feel at home.'}</h2>
      <p>Explore housing, discover your community and find somewhere that feels right.</p>
    </div>
  </aside>;
}
function PasswordInput({ value, onChange, label, autoComplete, placeholder, minLength }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  placeholder: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return <label className="nookly-auth-field"><span>{label}</span>
    <span className="nookly-password-wrap">
      <input type={visible ? 'text' : 'password'} required minLength={minLength} autoComplete={autoComplete} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/>
      <button type="button" className="nookly-show-password" onClick={()=>setVisible(!visible)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>
        {visible ? <EyeOff size={18}/> : <Eye size={18}/>}
      </button>
    </span>
  </label>;
}
export function SignInPage({ online, onLogin, user }: AuthProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = resolveReturnTo(location.search);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('');
    if (!online) { setError('Connect to the internet to sign in.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    if (!password) { setError('Enter your password.'); return; }
    setBusy(true);
    try {
      const loggedIn = await signIn(email.trim(), password);
      onLogin(loggedIn);
      navigate(nextPage(loggedIn, returnTo), { replace: true });
    } catch (caught) { setError(authError(caught)); }
    finally { setBusy(false); }
  };
  if (user) return <main className="nookly-auth-already"><CheckCircle2 size={34}/><h1>You're already signed in</h1><p>Continue to your Nookly account.</p><Link to={nextPage(user, returnTo)} className="btn">Continue <ArrowRight size={17}/></Link></main>;
  return <main className="nookly-auth-layout container">
    <section className="nookly-auth-panel">
      <Link to="/" className="nookly-auth-back"><ArrowLeft size={16}/> Browse homes</Link>
      <div className="nookly-auth-symbol"><KeyRound size={23}/></div>
      <span className="section-kicker">WELCOME BACK</span>
      <h1>Sign in to Nookly</h1>
      <p className="nookly-auth-lede">Your Nookly Mobile account works here too. Sign in to manage your accommodation and profile.</p>
      {!online && <p role="status" className="nookly-auth-notice">You're offline. Browsing saved homes is still available.</p>}
      <form className="nookly-auth-form" onSubmit={submit}>
        <label className="nookly-auth-field"><span>Email address</span><input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
        <PasswordInput label="Password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={setPassword}/>
        {error && <div className="nookly-auth-error" role="alert">{error}</div>}
        <button type="submit" className="btn nookly-auth-primary" disabled={busy||!online}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={18}/></button>
      </form>
      <p className="nookly-auth-switch">New to Nookly? <Link to={`/sign-up${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`}>Create an account</Link></p>
      <p className="nookly-auth-switch">Account created but profile setup failed? <Link to="/sign-up?recover=1">Finish registration</Link></p>
    </section>
    <AuthVisual/>
  </main>;
}

const TENANT_TYPES: { value: TenantType; title: string; desc: string; Icon: typeof GraduationCap }[] = [
  {value:'student',title:'Student',desc:'Campus-friendly and shared accommodation',Icon:GraduationCap},
  {value:'family',title:'Family',desc:'Space and family-friendly facilities',Icon:UsersRound},
  {value:'single',title:'Single',desc:'Studios, rooms and solo living',Icon:UserRound},
];
const initial: RegisterInput = {
  name: '', email: '', phone: '', password: '', confirmPassword: '',
  userMode: 'tenant', tenantType: 'student', schoolLocation: '', organizationId: '', institutionNotListed: false, avatarFile: null,
};
export function SignUpPage({ online, onLogin, user }: AuthProps) {
  const [form, setForm] = useState<RegisterInput>(initial);
  const [schools, setSchools] = useState<RegisteredInstitution[]>([]);
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolsBusy, setSchoolsBusy] = useState(false);
  const [schoolsError, setSchoolsError] = useState('');
  const [schoolsLoaded, setSchoolsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = resolveReturnTo(location.search);
  const recoverMode = new URLSearchParams(location.search).get('recover') === '1';
  const update = <K extends keyof RegisterInput>(field: K, value: RegisterInput[K]) => {
    setForm(prev=>({ ...prev, [field]: value })); setError('');
  };
  useEffect(()=>{
    if (!form.avatarFile) { setAvatarPreview(null); return; }
    const url = URL.createObjectURL(form.avatarFile);
    setAvatarPreview(url);
    return ()=> URL.revokeObjectURL(url);
  }, [form.avatarFile]);
  const fetchSchools = async () => {
    setSchoolsBusy(true); setSchoolsError('');
    try { setSchools(await listRegisteredSchools()); setSchoolsLoaded(true); }
    catch (caught) {
      setSchoolsError(`Couldn't load registered institutions: ${authError(caught)}. You can still choose Other and enter your institution's name.`);
      setSchoolsLoaded(false);
    } finally { setSchoolsBusy(false); }
  };
  useEffect(()=>{
    if (form.userMode === 'tenant' && form.tenantType === 'student' && online && !schoolsLoaded && !schoolsBusy && !schoolsError) {
      void fetchSchools();
    }
  // Initial load when user chooses student; retry is explicit after an error.
  }, [form.userMode,form.tenantType,online,schoolsLoaded,schoolsBusy,schoolsError]);
  const visibleSchools = useMemo(()=>{
    const q = schoolQuery.trim().toLowerCase();
    return q ? schools.filter(s=>`${s.name} ${s.city}`.toLowerCase().includes(q)) : schools;
  },[schools,schoolQuery]);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('');
    if (!online) { setError('Registration requires an internet connection.'); return; }
    if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }
    if (form.userMode==='tenant' && form.tenantType==='student' &&
      (form.institutionNotListed ? !form.schoolLocation?.trim() : !form.organizationId)) {
      setError(form.institutionNotListed ? 'Enter the name of your institution.' : 'Select your institution or choose Other.'); return;
    }
    setBusy(true);
    try {
      const registered = await (recoverMode ? repairAccount(form) : createAccount(form));
      onLogin(registered.user);
      setResult(registered);
    } catch (caught) { setError(authError(caught)); }
    finally { setBusy(false); }
  };
  if (user && !result) return <main className="nookly-auth-already"><CheckCircle2 size={34}/><h1>You're already signed in</h1><p>Sign out first to register another account.</p><Link to="/account" className="btn">Your account <ArrowRight size={17}/></Link></main>;
  if (result) return <main className="nookly-auth-success container">
    <CheckCircle2 size={48} className="nookly-success-check"/>
    <span className="section-kicker">ACCOUNT READY</span>
    <h1>Welcome to Nookly, {result.user.name.split(' ')[0]}.</h1>
    <p>Your accommodation account is ready. You can sign into Nookly Mobile with the same email and password.</p>
    {!!result.warnings.length && <div className="nookly-auth-warning" role="status"><strong>Some profile setup steps need attention:</strong>
      <ul>{result.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul><p>Your main account was created. Please don't register again.</p>
    </div>}
    <button className="btn" onClick={()=>navigate(nextPage(result.user,returnTo),{replace:true})}>Continue to Nookly <ArrowRight size={17}/></button>
  </main>;
  return <main className="nookly-auth-layout nookly-signup-layout container">
    <section className="nookly-auth-panel nookly-signup-panel">
      <Link to="/" className="nookly-auth-back"><ArrowLeft size={16}/> Browse homes</Link>
      <span className="section-kicker">{recoverMode ? 'COMPLETE YOUR SETUP' : 'JOIN NOOKLY'}</span>
      <h1>{recoverMode ? 'Finish registration' : 'Create account'}</h1>
      <p className="nookly-auth-lede">{recoverMode
        ? 'Your login account already exists. Enter the SAME email and your details to finish its Nookly profile. This will not create a new login.'
        : 'Find a place that fits your life. Use the same account on Nookly Mobile and Web.'}</p>
      <form className="nookly-auth-form" onSubmit={submit}>
        <div className="nookly-avatar-area">
          <label className="nookly-avatar-picker" htmlFor="nookly-avatar" title="Choose a profile photo">
            {avatarPreview ? <img src={avatarPreview} alt="Selected profile photo"/> : form.name ? <span>{form.name.trim().split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase()}</span> : <Camera size={25}/>}
            <span className="nookly-avatar-camera"><Camera size={13}/></span>
          </label>
          <input id="nookly-avatar" type="file" accept="image/jpeg,image/png,image/webp" className="nookly-visually-hidden" onChange={e=>update('avatarFile',e.target.files?.[0]||null)}/>
          <div><strong>Profile photo <small>(optional)</small></strong><p>JPG, PNG or WebP, up to 5 MB.</p></div>
          {form.avatarFile && <button type="button" className="nookly-text-btn" onClick={()=>update('avatarFile',null)}>Remove</button>}
        </div>
        <div className="nookly-form-two">
          <label className="nookly-auth-field"><span>Full name</span><input required autoComplete="name" value={form.name} onChange={e=>update('name',e.target.value)} placeholder="Your full name"/></label>
          <label className="nookly-auth-field"><span>Phone number</span><input required type="tel" autoComplete="tel" value={form.phone} onChange={e=>update('phone',e.target.value)} placeholder="+263 ..."/></label>
        </div>
        <label className="nookly-auth-field"><span>Email address</span><input type="email" required autoComplete="email" value={form.email} onChange={e=>update('email',e.target.value)} placeholder="you@example.com"/></label>
        <fieldset className="nookly-choice-section"><legend>How will you use Nookly?</legend>
          <div className="nookly-role-grid">
            <button type="button" className={`nookly-choice ${form.userMode==='tenant'?'selected':''}`} onClick={()=>setForm(prev=>({...prev,userMode:'tenant',tenantType:prev.tenantType||'student'}))} aria-pressed={form.userMode==='tenant'}>
              <span className="nookly-choice-icon"><Home size={21}/></span><span><strong>Tenant</strong><small>Find and manage a place to live</small></span>{form.userMode==='tenant'&&<Check size={18}/>}</button>
            <button type="button" className={`nookly-choice ${form.userMode==='landlord'?'selected':''}`} onClick={()=>setForm(prev=>({...prev,userMode:'landlord',tenantType:undefined,schoolLocation:'',organizationId:'',institutionNotListed:false}))} aria-pressed={form.userMode==='landlord'}>
              <span className="nookly-choice-icon"><Building2 size={21}/></span><span><strong>Landlord</strong><small>List properties and manage tenants</small></span>{form.userMode==='landlord'&&<Check size={18}/>}</button>
          </div>
        </fieldset>
        {form.userMode==='tenant' && <fieldset className="nookly-choice-section"><legend>What type of tenant are you?</legend>
          <div className="nookly-tenant-grid">{TENANT_TYPES.map(({value,title,desc,Icon})=><button type="button" key={value} className={`nookly-choice ${form.tenantType===value?'selected':''}`} aria-pressed={form.tenantType===value} onClick={()=>setForm(prev=>({...prev,tenantType:value,schoolLocation:value==='student'?prev.schoolLocation:'',organizationId:value==='student'?prev.organizationId:'',institutionNotListed:value==='student'?prev.institutionNotListed:false}))}>
            <span className="nookly-choice-icon"><Icon size={20}/></span><span><strong>{title}</strong><small>{desc}</small></span>{form.tenantType===value&&<Check size={17}/>}</button>)}</div>
        </fieldset>}
        {form.userMode==='tenant' && form.tenantType==='student' && <div className="nookly-school-picker">
          <label htmlFor="nookly-school-query">Pick your Institution <span className="nookly-required">*</span></label>
          <p>Select a registered institution, or choose Other if yours isn't listed yet.</p>
          {!form.institutionNotListed && <div className="nookly-school-search"><Search size={16}/><input id="nookly-school-query" value={schoolQuery} onChange={e=>setSchoolQuery(e.target.value)} placeholder="Search institutions by name or city"/></div>}
          {schoolsBusy && <p className="nookly-school-status">Loading registered institutions…</p>}
          {!!schoolsError && <div className="nookly-auth-error" role="alert">{schoolsError} <button type="button" className="nookly-text-btn" onClick={()=>void fetchSchools()}><RefreshCcw size={14}/> Retry</button></div>}
          <select aria-label="Institution" required value={form.institutionNotListed ? '__other__' : form.organizationId||''} onChange={e=>{
            const other = e.target.value === '__other__';
            const selected = schools.find(s=>s.$id===e.target.value);
            setForm(prev=>({...prev,institutionNotListed:other,organizationId:selected?.$id||'',schoolLocation:selected?.name||''}));
            setError('');
          }}>
            <option value="">{schoolsBusy ? 'Loading institutions...' : 'Select your institution'}</option>
            {visibleSchools.map(s=><option key={s.$id} value={s.$id}>{s.name}{s.city?` — ${s.city}`:''}</option>)}
            <option value="__other__">Other — my institution isn't listed</option>
          </select>
          {form.institutionNotListed && <label className="nookly-auth-field">
            <span>Institution name <span className="nookly-required">*</span></span>
            <input required autoComplete="organization" maxLength={140} value={form.schoolLocation||''} onChange={e=>update('schoolLocation',e.target.value)} placeholder="Enter your university, polytechnic or college"/>
            <small className="nookly-school-status">We'll save the name you enter. This does not register or verify the institution.</small>
          </label>}
          {!!form.organizationId && !form.institutionNotListed && <p className="nookly-school-selected"><School size={15}/> {form.schoolLocation}</p>}
        </div>}
        <div className="nookly-form-two">
          <PasswordInput label="Password" placeholder="At least 8 characters" autoComplete="new-password" minLength={8} value={form.password} onChange={value=>update('password',value)}/>
          <PasswordInput label="Confirm password" placeholder="Repeat your password" autoComplete="new-password" minLength={8} value={form.confirmPassword} onChange={value=>update('confirmPassword',value)}/>
        </div>
        {error && <div className="nookly-auth-error" role="alert">{error}</div>}
        <button type="submit" className="btn nookly-auth-primary" disabled={busy || !online || (form.userMode==='tenant'&&form.tenantType==='student'&&
          (form.institutionNotListed ? !form.schoolLocation?.trim() : !form.organizationId))}>{busy ? (recoverMode ? 'Finishing your profile…' : 'Creating your account…') : (recoverMode ? 'Finish registration' : 'Create account')} <ArrowRight size={18}/></button>
        {!online && <p className="nookly-auth-notice" role="status">Connect to the internet before registering.</p>}
      </form>
      <p className="nookly-auth-switch">Already have an account? <Link to={`/sign-in${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`}>Sign in</Link></p>
      {!recoverMode && <p className="nookly-auth-switch">Login account created but the profile failed? <Link to="/sign-up?recover=1">Finish existing registration</Link></p>}
      {recoverMode && <p className="nookly-auth-switch">No account yet? <Link to="/sign-up">Create a new account instead</Link></p>}
      <p className="nookly-auth-subnote"><ShieldCheck size={14}/> Your account is shared with Nookly Mobile. No Rides or SOS on this PWA.</p>
    </section>
    <AuthVisual registration/>
  </main>;
}
