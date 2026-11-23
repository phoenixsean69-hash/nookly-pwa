/** Nookly accommodation workflows ported from the mobile app's lib/appwrite.ts.
 * Browser-side operations use the existing Appwrite collections. No privileged keys.
 * IMPORTANT: Appwrite permissions, not this client, enforce ownership/access.
 */
import { Permission, Role } from 'appwrite';
import { account, databases, ID, Query, requireSetting, settings, storage } from './appwrite';
import { getPwaAccountId } from './auth';
import type { NooklyUser, Property } from '../types';

const db = () => requireSetting(settings.databaseId, 'VITE_APPWRITE_DATABASE_ID');
const propertiesId = () => requireSetting(settings.propertiesCollectionId, 'VITE_APPWRITE_PROPERTIES_COLLECTION_ID');
const likesId = () => requireSetting(settings.likesCollectionId, 'VITE_APPWRITE_LIKES_COLLECTION_ID');
const requestsId = () => requireSetting(settings.requestsCollectionId, 'VITE_APPWRITE_REQUESTS_COLLECTION_ID');

export function messageOf(error: unknown): string {
  const code = Number((error as { code?: unknown } | null)?.code);
  if (code === 401) return 'Your session has expired. Please sign in again.';
  if (code === 403) return 'Appwrite denied this operation. Check collection/document permissions; do not make private data public to work around this.';
  if (code === 404) return 'The requested property or record could not be found.';
  return error instanceof Error ? error.message : String(error);
}

export async function assertSession(user: NooklyUser): Promise<void> {
  if (!navigator.onLine) throw new Error('Connect to the internet to complete this action.');
  if (getPwaAccountId() !== user.accountId) throw new Error('This is not your Accommodation session. Sign in with the correct browser profile.');
  const current = await account.get();
  if (current.$id !== user.accountId) throw new Error('Your Appwrite session changed. Please sign in to Accommodation again.');
}

export function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type PropertyReview = {
  id: string;
  propertyId: string;
  reviewerId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  review: string;
  rating: number;
  date: string;
};

export function readReviews(value: unknown): PropertyReview[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is PropertyReview => Boolean(x && typeof x === 'object' && typeof x.review === 'string' && Number.isFinite(Number(x.rating)) && Number(x.rating) >= 1 && Number(x.rating) <= 5))
      .map(x => ({...x, rating: Number(x.rating), userName: x.userName || 'Nookly member', date: x.date || '', id: String(x.id || ''), propertyId: String(x.propertyId || ''), reviewerId: String(x.reviewerId || x.userId || ''), userId: String(x.userId || x.reviewerId || ''), userAvatar: x.userAvatar || ''}));
  } catch { return []; }
}
export function summarizeReviews(value: unknown): { total: number; average: number } {
  const list = readReviews(value);
  const total = list.length;
  const average = total ? list.reduce((sum,x) => sum + x.rating, 0) / total : 0;
  return { total, average };
}

async function propertyById(id: string): Promise<Property> {
  return await databases.getDocument({ databaseId: db(), collectionId: propertiesId(), documentId: id }) as unknown as Property;
}

export async function postReview(user: NooklyUser, propertyId: string, text: string, rating: number): Promise<Property> {
  await assertSession(user);
  const review = text.trim();
  if (review.length < 10 || review.length > 1200) throw new Error('Write a review between 10 and 1,200 characters.');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Select a rating from 1 to 5 stars.');
  const property = await propertyById(propertyId);
  if (property.creatorId === user.accountId || property.creatorId === user.$id) throw new Error('You cannot review your own property.');
  const existing = readReviews(property.reviews);
  if (existing.some(r => r.userId === user.accountId || r.reviewerId === user.accountId)) throw new Error('You have already reviewed this property.');
  const item: PropertyReview = {
    id: ID.unique(), propertyId, reviewerId:user.accountId, userId:user.accountId,
    userName:user.name, userAvatar:user.avatar || '', review, rating, date:new Date().toISOString(),
  };
  // Mobile stores reviews in properties.reviews JSON. This requires Appwrite
  // document UPDATE permission and cannot guarantee atomic concurrent writes.
  return await databases.updateDocument({ databaseId: db(), collectionId: propertiesId(), documentId: propertyId,
    data: { reviews: JSON.stringify([...existing, item]) },
  }) as unknown as Property;
}

export async function likedByMe(user: NooklyUser, propertyId: string): Promise<boolean> {
  await assertSession(user);
  const result = await databases.listDocuments({databaseId:db(),collectionId:likesId(),queries:[Query.equal('propertyId',propertyId),Query.equal('userId',user.accountId),Query.limit(1)]});
  return result.documents.length > 0;
}
export async function countLikes(propertyId: string): Promise<number> {
  const result = await databases.listDocuments({databaseId:db(),collectionId:likesId(),queries:[Query.equal('propertyId',propertyId),Query.limit(1)]});
  return result.total;
}
export async function togglePropertyLike(user: NooklyUser, propertyId: string): Promise<{ liked:boolean; total:number; syncWarning?:string }> {
  await assertSession(user);
  const existing = await databases.listDocuments({databaseId:db(),collectionId:likesId(),queries:[Query.equal('propertyId',propertyId),Query.equal('userId',user.accountId),Query.limit(1)]});
  const wasLiked = Boolean(existing.documents[0]);
  if (wasLiked) await databases.deleteDocument({databaseId:db(),collectionId:likesId(),documentId:existing.documents[0].$id});
  else await databases.createDocument({databaseId:db(),collectionId:likesId(),documentId:ID.unique(),data:{propertyId,userId:user.accountId}});
  const total = await countLikes(propertyId);
  // Mobile also stores a denormalized count in properties.likes. This is best
  // effort: never undo a successful like because aggregate UPDATE is restricted.
  let syncWarning: string | undefined;
  try {await databases.updateDocument({databaseId:db(),collectionId:propertiesId(),documentId:propertyId,data:{likes:total}})}
  catch {syncWarning='Your like was saved, but the listing summary count could not be synchronized.';}
  return {liked:!wasLiked,total,syncWarning};
}

const VIEW_COOLDOWN = 24 * 60 * 60 * 1000;
export function viewStampKey(propertyId:string, accountId:string):string {return `nookly:property-view:v1:${accountId}:${propertyId}`;}
export async function recordPropertyView(propertyId: string, user: NooklyUser | null, ownerId?:string): Promise<void> {
  if (!navigator.onLine) return;
  if (user && (user.accountId === ownerId || user.$id === ownerId)) return;
  // Viewer counting is a best-effort mobile-compatible counter; an Appwrite
  // Function is required for tamper-resistant analytics and atomic increments.
  const key=viewStampKey(propertyId,user?.accountId || 'guest');
  try {if (Date.now()-Number(localStorage.getItem(key)||0) < VIEW_COOLDOWN) return;} catch {return;}
  try {
    // No guest UPDATE permissions should be granted just for view counting.
    if (!user) return;
    await assertSession(user);
    const property=await propertyById(propertyId);
    await databases.updateDocument({databaseId:db(),collectionId:propertiesId(),documentId:propertyId,data:{views:Math.max(0,asNumber(property.views))+1}});
    try{localStorage.setItem(key,String(Date.now()));}catch{/*Ignore*/}
  } catch {/*Missing field UPDATE permission must never block reading a listing.*/}
}

export type ListingDraft = {
  propertyName:string; type:string; description:string; address:string; price:number;
  priceThreshold:number; area:number; roomFor:number; bedrooms:number; bathrooms:number;
  totalSlots:number; availableSlots:number; isAvailable:boolean; facilities:string;
  curfew:string; latitude:number|null; longitude:number|null;
  image1?:string; image2?:string; image3?:string; video1?:string; video2?:string; video3?:string;
};

export function validateListing(draft: ListingDraft): void {
  if (draft.propertyName.trim().length<3) throw new Error('Enter a property name (at least 3 characters).');
  if (draft.address.trim().length<6) throw new Error('Enter a complete property address.');
  if (!draft.type.trim()) throw new Error('Choose a property type.');
  if (draft.description.trim().length<15) throw new Error('Describe the accommodation in at least 15 characters.');
  if (!Number.isFinite(draft.price) || draft.price<=0) throw new Error('Enter a valid monthly rent.');
  if (!Number.isFinite(draft.priceThreshold) || draft.priceThreshold<0) throw new Error('Enter a valid minimum offer amount.');
  for(const k of ['area','roomFor','bedrooms','bathrooms','totalSlots','availableSlots'] as const){
    if (!Number.isFinite(draft[k]) || draft[k]<0 || !Number.isInteger(draft[k])) throw new Error(`${k} must be a non-negative whole number.`);
  }
  if(draft.totalSlots>0 && draft.availableSlots>draft.totalSlots) throw new Error('Available slots cannot exceed total slots.');
  if((draft.latitude===null)!==(draft.longitude===null)) throw new Error('Choose both map coordinates, or leave both unset.');
  if(draft.latitude!==null && (!Number.isFinite(draft.latitude) || draft.latitude < -90 || draft.latitude > 90)) throw new Error('Invalid latitude.');
  if(draft.longitude!==null && (!Number.isFinite(draft.longitude) || draft.longitude < -180 || draft.longitude > 180)) throw new Error('Invalid longitude.');
}

export function listingData(draft: ListingDraft):Record<string,unknown>{
  validateListing(draft);
  const hasSlots=draft.totalSlots>0;
  const slots=hasSlots?draft.availableSlots:0;
  return {
    propertyName:draft.propertyName.trim(),type:draft.type,description:draft.description.trim(),address:draft.address.trim(),
    price:draft.price,area:draft.area,roomFor:draft.roomFor,bedrooms:draft.bedrooms,bathrooms:draft.bathrooms,
    facilities:draft.facilities.trim(),curfew:draft.curfew.trim(),latitude:draft.latitude,longitude:draft.longitude,
    priceThreshold:draft.priceThreshold,totalSlots:draft.totalSlots,availableSlots:slots,
    occupiedSlots:hasSlots?draft.totalSlots-slots:0,
    isAvailable:draft.isAvailable && (!hasSlots || slots>0),
    image1:draft.image1||null,image2:draft.image2||null,image3:draft.image3||null,
    video1:draft.video1||null,video2:draft.video2||null,video3:draft.video3||null,
  };
}

export async function createListing(user:NooklyUser,draft:ListingDraft):Promise<Property>{
  await assertSession(user);
  if(user.userMode!=='landlord')throw new Error('Only landlord accounts can post accommodation.');
  const data=listingData(draft);
  // Preserve mobile's agent=user document ID, creatorId=Appwrite account ID.
  return await databases.createDocument({databaseId:db(),collectionId:propertiesId(),documentId:ID.unique(),data:{...data,creatorId:user.accountId,agent:user.$id}}) as unknown as Property;
}
export async function assertPropertyOwner(user:NooklyUser,id:string):Promise<Property>{
  await assertSession(user);
  if(user.userMode!=='landlord') throw new Error('Landlord access required.');
  const property=await propertyById(id);
  if(property.creatorId!==user.accountId && property.creatorId!==user.$id) throw new Error('You do not own this listing.');
  return property;
}
export async function editListing(user:NooklyUser,id:string,draft:ListingDraft):Promise<Property>{
  await assertPropertyOwner(user,id);
  return await databases.updateDocument({databaseId:db(),collectionId:propertiesId(),documentId:id,data:listingData(draft)}) as unknown as Property;
}
export async function setListingAvailable(user:NooklyUser,id:string,active:boolean):Promise<Property>{
  const p=await assertPropertyOwner(user,id);
  const hasSlots=asNumber(p.totalSlots)>0;
  return await databases.updateDocument({databaseId:db(),collectionId:propertiesId(),documentId:id,data:{isAvailable:active && (!hasSlots || asNumber(p.availableSlots)>0)}}) as unknown as Property;
}
export async function deleteListing(user:NooklyUser,id:string):Promise<void>{
  await assertPropertyOwner(user,id);
  await databases.deleteDocument({databaseId:db(),collectionId:propertiesId(),documentId:id});
}

export async function uploadListingImage(user:NooklyUser,file:File):Promise<string>{
  await assertSession(user);
  if(user.userMode!=='landlord') throw new Error('Only landlords can upload listing photos.');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('Choose a JPG, PNG or WebP photo smaller than 5 MB.');
  const bucketId=requireSetting(settings.bucketId,'VITE_APPWRITE_BUCKET_ID');
  const uploaded=await storage.createFile({bucketId,fileId:ID.unique(),file});
  return String(storage.getFileView({bucketId,fileId:uploaded.$id}));
}

export async function uploadListingVideo(user:NooklyUser,file:File):Promise<string>{
  await assertSession(user);
  if(user.userMode!=='landlord') throw new Error('Only landlords can upload property tours.');
  if(!['video/mp4','video/webm'].includes(file.type)||file.size>25*1024*1024) throw new Error('Choose an MP4 or WebM tour smaller than 25 MB.');
  const bucketId=requireSetting(settings.bucketId,'VITE_APPWRITE_BUCKET_ID');
  const uploaded=await storage.createFile({bucketId,fileId:ID.unique(),file});
  return String(storage.getFileView({bucketId,fileId:uploaded.$id}));
}

export type RentalRequest = {
  $id:string; propertyId:string; propertyName:string; tenantId:string;
  tenantName:string; tenantEmail:string; tenantPhone?:string; tenantAvatar?:string;
  status:'pending'|'approved'|'rejected'|string;
  proposedPrice:number; originalPrice?:number; message?:string; moveInDate?:string;
  leaseDuration?:string; questions?:string; $createdAt?:string;
};
export type RequestDraft = { proposedPrice:number; message:string; moveInDate:string; leaseDuration:string; questions:string[] };

export async function listMyRentalRequests(user:NooklyUser):Promise<RentalRequest[]>{
  await assertSession(user);
  const rows=await databases.listDocuments({databaseId:db(),collectionId:requestsId(),queries:[Query.equal('tenantId',user.accountId),Query.orderDesc('$createdAt'),Query.limit(100)]});
  return rows.documents as unknown as RentalRequest[];
}
export async function submitRentalRequest(user:NooklyUser,propertyId:string,draft:RequestDraft):Promise<RentalRequest>{
  await assertSession(user);
  if(user.userMode==='landlord'||user.userMode==='driver')throw new Error('Use a tenant account to enquire about this accommodation.');
  const p=await propertyById(propertyId);
  if(p.isAvailable===false || (asNumber(p.totalSlots)>0 && asNumber(p.availableSlots)<=0)) throw new Error('This property is not currently accepting new enquiries.');
  if(!Number.isFinite(draft.proposedPrice)||draft.proposedPrice<=0) throw new Error('Enter a valid proposed monthly rent.');
  if(draft.message.trim().length<10 || draft.message.trim().length>1500)throw new Error('Tell the landlord about your enquiry (10–1,500 characters).');
  if(asNumber(p.priceThreshold)>0 && draft.proposedPrice<asNumber(p.priceThreshold)) throw new Error('This landlord requires a minimum rental offer of $'+asNumber(p.priceThreshold)+'.');
  const existing=await databases.listDocuments({databaseId:db(),collectionId:requestsId(),queries:[Query.equal('tenantId',user.accountId),Query.equal('propertyId',propertyId),Query.limit(10)]});
  if(existing.documents.some(x=>['pending','approved'].includes(String(x.status)))) throw new Error('You already have an active request for this property. Check My Requests.');
  if(!p.creatorId || typeof p.creatorId!=='string') throw new Error('The property owner account could not be verified. Do not submit personal data until the listing is corrected.');
  const doc=await databases.createDocument({databaseId:db(),collectionId:requestsId(),documentId:ID.unique(),permissions:[
    Permission.read(Role.user(user.accountId)),
    Permission.read(Role.user(p.creatorId)),Permission.update(Role.user(p.creatorId)),
  ],data:{
    propertyId,propertyName:p.propertyName||'Property',tenantId:user.accountId,tenantName:user.name,tenantEmail:user.email,
    tenantPhone:user.phone||'',tenantAvatar:user.avatar||'',status:'pending',proposedPrice:draft.proposedPrice,originalPrice:asNumber(p.price),
    message:draft.message.trim(),moveInDate:draft.moveInDate,leaseDuration:draft.leaseDuration,questions:JSON.stringify(draft.questions),
  }});
  // Mobile attempts tenant-profile and push updates as secondary operations.
  // The PWA deliberately doesn't impersonate a privileged notification service.
  return doc as unknown as RentalRequest;
}

export async function listLandlordRequests(user:NooklyUser,ownedProperties:Property[]):Promise<RentalRequest[]>{
  await assertSession(user);
  if(user.userMode!=='landlord')throw new Error('Landlord access required.');
  const ids=ownedProperties.filter(x=>x.creatorId===user.accountId || x.creatorId===user.$id).map(x=>x.$id);
  if(!ids.length)return [];
  const all:RentalRequest[]=[];
  // Batch IN queries to avoid overly long query strings.
  for(let i=0;i<ids.length;i+=20){
    const batch=ids.slice(i,i+20);
    const result=await databases.listDocuments({databaseId:db(),collectionId:requestsId(),queries:[Query.equal('propertyId',batch),Query.orderDesc('$createdAt'),Query.limit(100)]});
    all.push(...result.documents as unknown as RentalRequest[]);
  }
  return all.sort((a,b)=>Date.parse(b.$createdAt||'')-Date.parse(a.$createdAt||''));
}

export async function updateRentalRequest(user:NooklyUser,request:RentalRequest,ownedProperties:Property[],nextStatus:'approved'|'rejected'):Promise<{ status:string;warning?:string }>{
  await assertSession(user);
  if(user.userMode!=='landlord') throw new Error('Landlord access required.');
  const owns=ownedProperties.some(x=>x.$id===request.propertyId && (x.creatorId===user.accountId || x.creatorId===user.$id));
  if(!owns)throw new Error('This request is not for one of your properties.');
  const latest=await databases.getDocument({databaseId:db(),collectionId:requestsId(),documentId:request.$id});
  if(latest.propertyId!==request.propertyId || latest.status!=='pending')throw new Error('This request is no longer pending. Refresh your inbox.');
  const property=await assertPropertyOwner(user,request.propertyId);
  if(nextStatus==='approved'&&asNumber(property.totalSlots)>0&&asNumber(property.availableSlots)<=0)throw new Error('No places remain. Update availability before approving.');
  // Mobile's approval uses two distinct Appwrite document writes. Those are
  // not atomic; this implementation explicitly surfaces partial completion.
  await databases.updateDocument({databaseId:db(),collectionId:requestsId(),documentId:request.$id,data:{status:nextStatus}});
  if(nextStatus==='approved'&&asNumber(property.totalSlots)>0){
    const available=Math.max(0,asNumber(property.availableSlots)-1);
    try{await databases.updateDocument({databaseId:db(),collectionId:propertiesId(),documentId:property.$id,data:{
      occupiedSlots:Math.min(asNumber(property.totalSlots),asNumber(property.occupiedSlots)+1),availableSlots:available,isAvailable:available>0&&property.isAvailable!==false,
    }});}catch{return{status:nextStatus,warning:'Request approved, but the available-bed count could not be updated. Correct it manually immediately.'};}
  }
  return {status:nextStatus};
}
