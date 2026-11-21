/**
 * Nookly Match v2 — deterministic, explainable preference alignment.
 * Scores are heuristic alignment points (0–100), NOT probabilities.
 * No schema migration required; supports the current mobile profile fields.
 */
export interface MatchInput {
  userId?: string;
  userType?: string;
  role?: string;
  gender?: string;
  preferredGender?: string;
  preferredRoommateType?: string;
  budget?: number;
  preferredLocation?: string;
  lifestyle?: string[] | string;
  moveInDate?: string;
  lookingFor?: string;
  isActive?: boolean;
}

export interface ScoreDetails {
  score: number;
  matchCoverage: number; // percent of scoring factors having usable information on both sides
  matchReasons: string[];
}

// Same-city matching is a starting point, not proof two properties are nearby.
// Prefer canonical city IDs in Appwrite when we can migrate the collection later.
const KNOWN_PLACES = [
  'victoria falls','chitungwiza','beatrice','bulawayo','chinhoyi','chiredzi',
  'marondera','chegutu','zvishavane','filabusi','shurugwi','murehwa',
  'harare','bindura','mutare','masvingo','gweru','kwekwe','kadoma',
  'kariba','gwanda','lupane','norton','ruwa','rusape','karoi',
  'chipinge','hwange','chivhu','nyanga','plumtree','epworth',
] as const;
const CITY_ALIASES: Record<string, string> = {
  buse: 'bindura',
  'bindura university': 'bindura',
  'bindura university of science education': 'bindura',
  'chinhoyi university of technology': 'chinhoyi',
  cut: 'chinhoyi',
  'midlands state university': 'gweru',
  msu: 'gweru',
  'great zimbabwe university': 'masvingo',
  gzu: 'masvingo',
};
const FILLER = new Set(['near','the','in','at','around','area','close','to','by','of','and','campus','town','city','road','street','avenue','ave','rd']);
const cleaned = (value?: string) => (value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
const words = (s: string) => s.split(' ').filter(Boolean);

const LOCATION_PHRASES: {phrase:string;city:string}[] = [
  ...KNOWN_PLACES.map(phrase=>({phrase,city:phrase})),
  ...Object.entries(CITY_ALIASES).map(([phrase,city])=>({phrase,city})),
];
export function canonicalLocation(value?: string): string {
  const text=cleaned(value);
  if(!text)return '';
  // Native lastIndexOf is far cheaper than compiling dozens of regexes per candidate.
  // A street named after a city is not itself that city: "Harare Road, Bindura" -> Bindura.
  let winner='',winnerEnd=-1;
  for(const {phrase,city} of LOCATION_PHRASES) {
    const i=text.lastIndexOf(phrase);
    if(i<0)continue;
    const end=i+phrase.length;
    if((i===0||text[i-1]===' ')&&(end===text.length||text[end]===' ')&&end>winnerEnd){
      winner=city;winnerEnd=end;
    }
  }
  if(winner)return winner;
  const terms=words(text).filter(t=>t.length>=3&&!FILLER.has(t));
  return terms.join(' ');
}

/** Search terms match legacy stored locations without adding a database field. */
export function locationQueryTerms(value?: string): string[] {
  const city=canonicalLocation(value);
  if (!city) return [];
  if (city==='bindura') return ['Bindura','BUSE'];
  if (city==='chinhoyi') return ['Chinhoyi','CUT'];
  if (city==='gweru') return ['Gweru','MSU'];
  if (city==='masvingo') return ['Masvingo','GZU'];
  return [city.charAt(0).toUpperCase()+city.slice(1)];
}

export function locationsOverlap(a?: string,b?: string): boolean {
  const ca=canonicalLocation(a),cb=canonicalLocation(b);
  return Boolean(ca && cb && ca===cb);
}

export function normalizeLifestyle(value?: string[] | string): string[] {
  let source: unknown = value;
  if (typeof value==='string') {
    try {const parsed:unknown=JSON.parse(value);source=Array.isArray(parsed)?parsed:value.split(',');}
    catch{source=value.split(',');}
  }
  if(!Array.isArray(source))return [];
  return [...new Set(source.filter((x):x is string=>typeof x==='string')
    .map(x=>x.trim().replace(/\s+/g,' ').toLowerCase()).filter(Boolean))];
}

const normalizedGender = (v?: string) => cleaned(v);
const acceptablePreference=(preferred:string,actual:string)=>preferred===''||preferred==='any'||(Boolean(actual)&&preferred===actual);
export function gendersCompatible(a:MatchInput,b:MatchInput):boolean {
  const aGender=normalizedGender(a.gender),bGender=normalizedGender(b.gender);
  return acceptablePreference(normalizedGender(a.preferredGender),bGender)
    && acceptablePreference(normalizedGender(b.preferredGender),aGender);
}

function roommateType(profile:MatchInput):string {
  const declared=cleaned(profile.userType);
  if(declared==='student'||declared==='professional')return declared;
  const role=cleaned(profile.role);
  if(role.includes('professional'))return 'professional';
  return declared==='tenant'?'tenant':'';
}
const budgetIsValid=(v?:number)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const budgetDistance=(a:number,b:number)=>Math.abs(a-b)/Math.max(a,b);

interface Prepared {
  userId?:string;
  isActive?:boolean;
  location:string;
  gender:string;
  genderPreference:string;
  roommatePreference:string;
  roommateCategory:string;
  budget:number|null;
  lifestyle:string[];
  date:number|null;
  hasDate:boolean;
  intention:string;
}
const prepare=(p:MatchInput):Prepared=>({
  userId:p.userId,isActive:p.isActive,location:canonicalLocation(p.preferredLocation),
  gender:normalizedGender(p.gender),genderPreference:normalizedGender(p.preferredGender),
  roommatePreference:cleaned(p.preferredRoommateType),roommateCategory:roommateType(p),
  budget:budgetIsValid(p.budget)?p.budget!:null,lifestyle:normalizeLifestyle(p.lifestyle),
  date:dateValue(p.moveInDate),hasDate:meaningfulDate(p.moveInDate),intention:cleaned(p.lookingFor),
});
const compatibleCategories=(a:Prepared,b:Prepared):boolean=>{
  if(!a.roommatePreference||a.roommatePreference==='any')return true;
  if(!b.roommateCategory)return false;
  if(a.roommatePreference==='student')return b.roommateCategory==='student';
  if(['professional','working professional'].includes(a.roommatePreference))return b.roommateCategory==='professional';
  if(['tenant','other tenant'].includes(a.roommatePreference))return ['tenant','professional'].includes(b.roommateCategory);
  return true; // Legacy unknown preference; don't interpret it as a hard prohibition.
};
const isPreparedMatch=(a:Prepared,b:Prepared):boolean=>{
  if(a.userId && b.userId && a.userId===b.userId)return false;
  if(b.isActive===false)return false;
  if(!a.location||a.location!==b.location)return false;
  if(!acceptablePreference(a.genderPreference,b.gender) || !acceptablePreference(b.genderPreference,a.gender))return false;
  if(!compatibleCategories(a,b)||!compatibleCategories(b,a))return false;
  if(a.budget===null||b.budget===null)return false;
  if(budgetDistance(a.budget,b.budget)>0.6)return false;
  return true;
};
export function isCompatibleMatch(me:MatchInput,candidate:MatchInput):boolean {
  return isPreparedMatch(prepare(me),prepare(candidate));
}

function dateValue(v?:string):number|null {
  if(!v || cleaned(v)==='flexible')return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return null;
  const t=Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===v?t:null;
}
const meaningfulDate=(v?:string)=>Boolean(v?.trim() && (cleaned(v)==='flexible'||dateValue(v)!==null));

function scorePrepared(a:Prepared,b:Prepared):ScoreDetails {
  let score=0,available=0;
  const reasons:string[]=[];
  if(a.budget!==null&&b.budget!==null) {
    available+=40;
    const distance=budgetDistance(a.budget,b.budget);
    score+=40*Math.max(0,1-distance/0.6);
    if(distance<=0.15)reasons.push('Similar monthly budgets');
  }
  if(a.lifestyle.length&&b.lifestyle.length){
    available+=30;
    const bs=new Set(b.lifestyle),shared=a.lifestyle.filter(t=>bs.has(t)).length;
    score+=30*shared/(a.lifestyle.length+b.lifestyle.length-shared);
    if(shared>0)reasons.push(`${shared} shared lifestyle preference${shared===1?'':'s'}`);
  }
  if(a.hasDate&&b.hasDate){
    available+=15;
    if(a.date===null||b.date===null){score+=13;reasons.push('Flexible move-in timing');}
    else {
      const days=Math.abs(a.date-b.date)/86400000;
      const pts=days<=7?15:days<=14?13:days<=30?9:days<=60?3:0;
      score+=pts;
      if(days<=14)reasons.push('Similar move-in dates');
    }
  }
  if(a.intention&&b.intention){
    available+=15;
    if(a.intention===b.intention||a.intention==='both'||b.intention==='both'){
      score+=15;reasons.push('Compatible housing plans');
    }else score+=4;
  }
  return {score:Math.max(0,Math.min(100,Math.round(score))),matchCoverage:available,matchReasons:reasons};
}
export function scoreMatch(a:MatchInput,b:MatchInput):ScoreDetails {
  return scorePrepared(prepare(a),prepare(b));
}
export function computeCompatibilityScore(a:MatchInput,b:MatchInput):number {return scoreMatch(a,b).score;}
export function rankMatches<T extends MatchInput>(me:MatchInput,candidates:T[]):(T&ScoreDetails&{matchScore:number})[] {
  const preparedMe=prepare(me);
  return candidates.flatMap(c=>{
    const preparedCandidate=prepare(c);
    if(!isPreparedMatch(preparedMe,preparedCandidate))return [];
    const details=scorePrepared(preparedMe,preparedCandidate);
    return [{...c,...details,matchScore:details.score}];
  }).sort((a,b)=>b.matchScore-a.matchScore||b.matchCoverage-a.matchCoverage||
    String(a.userId||'').localeCompare(String(b.userId||'')));
}
export function profileCompleteness(p:MatchInput):number {
  const d=prepare(p);
  return [d.budget!==null,Boolean(d.location),d.lifestyle.length>0,d.hasDate,Boolean(d.intention)].filter(Boolean).length;
}
