import { databases, ID, Query, requireSetting, settings } from './appwrite';
import type { NooklyUser } from '../types';
import { normalizeLifestyle, rankMatches, locationQueryTerms } from './matching';

export interface RoommateProfile {
  $id: string;
  userId: string;
  userType: 'student' | 'tenant' | 'professional';
  name: string;
  email: string;
  phone: string;
  avatar?: string;
  role: string;
  gender: 'male' | 'female';
  preferredGender: 'male' | 'female' | 'any';
  budget: number;
  preferredLocation: string;
  preferredRoommateType: string;
  lifestyle: string[] | string;
  about: string;
  moveInDate: string;
  lookingFor: string;
  isActive: boolean;
  matchScore?: number;
}

export type MatchDraft = Pick<RoommateProfile,'gender'|'preferredGender'|'budget'|'preferredLocation'|'preferredRoommateType'|'lifestyle'|'about'|'moveInDate'|'lookingFor'>;

function collection() {
  return {
    databaseId: requireSetting(settings.databaseId,'VITE_APPWRITE_DATABASE_ID'),
    collectionId: requireSetting(settings.matchProfilesCollectionId,'VITE_APPWRITE_MATCH_PROFILES_COLLECTION_ID'),
  };
}
function getUserType(user:NooklyUser):RoommateProfile['userType'] {
  return user.tenantType==='student'||user.userMode==='student'?'student':'tenant';
}

export async function getMyMatchProfile(accountId:string):Promise<RoommateProfile|null> {
  const result=await databases.listDocuments({ ...collection(), queries:[Query.equal('userId',accountId),Query.limit(1)] });
  return result.documents.length ? result.documents[0] as unknown as RoommateProfile : null;
}

/** Called only when the user expressly saves or publishes their profile. */
export async function saveMatchProfile(user:NooklyUser,draft:MatchDraft,existing:RoommateProfile|null,active:boolean):Promise<RoommateProfile> {
  if(user.userMode==='landlord'||user.userMode==='driver') throw new Error('Roommate matching is available to tenants.');
  if(!Number.isFinite(draft.budget)||draft.budget<=0)throw new Error('Enter a valid monthly budget.');
  if(!draft.preferredLocation.trim())throw new Error('Enter your preferred location.');
  if(!['male','female'].includes(draft.gender))throw new Error('Select your gender.');
  if(!['male','female','any'].includes(draft.preferredGender))throw new Error('Choose your roommate preference.');
  const payload = {
    userId:user.accountId,
    userType:getUserType(user),
    name:user.name,
    email:user.email,
    phone:user.phone || '',
    ...(/^https?:\/\//i.test(user.avatar||'')?{avatar:user.avatar}:{}),
    role:getUserType(user)==='student'?'Student':'Tenant',
    gender:draft.gender,
    preferredGender:draft.preferredGender,
    budget:Math.round(draft.budget),
    preferredLocation:draft.preferredLocation.trim(),
    preferredRoommateType:draft.preferredRoommateType||'Any',
    lifestyle:JSON.stringify(normalizeLifestyle(draft.lifestyle)),
    about:draft.about.trim(),
    moveInDate:draft.moveInDate?.trim()||'Flexible',
    lookingFor:draft.lookingFor||'roommate',
    isActive:active,
  };
  if (existing) {
    if(existing.userId!==user.accountId) throw new Error('Cannot update another person’s profile.');
    const result=await databases.updateDocument({...collection(),documentId:existing.$id,data:payload});
    return result as unknown as RoommateProfile;
  }
  // Recheck before create to avoid duplicate accounts from repeated submission / retries.
  const already=await getMyMatchProfile(user.accountId);
  if(already) {
    const result=await databases.updateDocument({...collection(),documentId:already.$id,data:payload});
    return result as unknown as RoommateProfile;
  }
  const result=await databases.createDocument({...collection(),documentId:ID.unique(),data:payload});
  return result as unknown as RoommateProfile;
}

export async function setMatchVisibility(profile:RoommateProfile,userId:string,isActive:boolean):Promise<RoommateProfile> {
  if(profile.userId!==userId)throw new Error('Cannot change another person’s profile.');
  const result=await databases.updateDocument({...collection(),documentId:profile.$id,data:{isActive}});
  return result as unknown as RoommateProfile;
}

/**
 * Query active profiles near the chosen location, then apply the shared
 * hard filters and scoring algorithm locally.
 *
 * Works with the existing Appwrite schema. No new attributes are required.
 * If the collection cannot use `contains` / `or`, falls back to a bounded scan.
 * Longer-term: indexed canonical location + server-side contact consent.
 */
export async function findRoommates(me:RoommateProfile):Promise<{matches:(RoommateProfile & {matchScore:number;matchCoverage:number;matchReasons:string[]})[],truncated:boolean;locationFiltered:boolean}> {
  const placeTerms=locationQueryTerms(me.preferredLocation);
  if(!placeTerms.length)return {matches:[],truncated:false,locationFiltered:true};
  const PER_PAGE=100;
  const MAX_LOCAL=500;
  const MAX_FALLBACK=1200;

  const fetchProfiles=async(locationFilter:boolean)=>{
    const limit=locationFilter?MAX_LOCAL:MAX_FALLBACK;
    const results:RoommateProfile[]=[];
    let cursor='';
    let total=0;
    for(let i=0;results.length<limit;i++) {
      const variants=locationFilter?[...new Set(placeTerms.flatMap(term=>[
        term,term.toLowerCase(),term.toUpperCase(),
      ]))]:[];
      const clauses=variants.map(v=>Query.contains('preferredLocation',v));
      const queries=[
        Query.equal('isActive',true),
        ...(locationFilter?[clauses.length===1?clauses[0]:Query.or(clauses)]:[]),
        Query.orderDesc('$createdAt'),Query.limit(Math.min(PER_PAGE,limit-results.length)),
        ...(cursor?[Query.cursorAfter(cursor)]:[]),
      ];
      const page=await databases.listDocuments({...collection(),queries});
      total=page.total;
      results.push(...page.documents as unknown as RoommateProfile[]);
      if(page.documents.length===0||results.length>=total)break;
      const last=page.documents[page.documents.length-1];
      if(!last||last.$id===cursor)break;
      cursor=last.$id;
    }
    return {results,truncated:results.length<total};
  };

  let fetched:{results:RoommateProfile[];truncated:boolean};
  let locationFiltered=true;
  try {
    fetched=await fetchProfiles(true);
  } catch (error) {
    const code=Number((error as {code?:number})?.code);
    if(code!==400 && code!==422)throw error; // Never mask auth, network, or server failures.
    // Older Appwrite collections may lack the index/feature for contains+or.
    // Avoid a silent empty match list and keep the previously working behavior.
    locationFiltered=false;
    fetched=await fetchProfiles(false);
  }
  const unique=new Map<string,RoommateProfile>();
  for(const profile of fetched.results) {
    if(!profile.userId||profile.userId===me.userId||profile.isActive===false)continue;
    if(!unique.has(profile.userId))unique.set(profile.userId,profile);
  }
  const ranked=rankMatches(me,[...unique.values()]);
  return {matches:ranked,truncated:fetched.truncated,locationFiltered};
}
