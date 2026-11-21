import { databases, Query, requireSetting, settings } from './appwrite';
import { getCachedProperties, getCachedProperty, isFresh, saveCachedProperties, saveCachedProperty } from './offline';
import type { Property } from '../types';

const NON_RESIDENTIAL = new Set(['commercial', 'farm', 'industrial', 'land', 'office', 'shop', 'warehouse', 'workplace']);
const MAX_PAGES = 20; // Match Nookly mobile's existing paging cap (2,000 listings).
const PAGE_SIZE = 100;

export function isResidential(property: Property): boolean {
  return property.isAvailable !== false && !NON_RESIDENTIAL.has(String(property.type || '').trim().toLowerCase());
}

export function performanceScore(property: Property): number {
  let rating = Number(property.rating || 0);
  let reviewCount = 0;
  try {
    const list = typeof property.reviews === 'string' ? JSON.parse(property.reviews) : property.reviews;
    if (Array.isArray(list)) {
      reviewCount = list.length;
      const valid = list.map(item => Number(item?.rating)).filter(num => Number.isFinite(num) && num > 0);
      if (valid.length) rating = valid.reduce((a, b) => a + b, 0) / valid.length;
    }
  } catch { /* Malformed legacy reviews should not hide the property. */ }
  return rating * 40 + reviewCount * 7 + Number(property.likes || 0) * 2.5 + Number(property.views || 0) * .2 + Number(property.requests || 0) * 4 + Math.max(0, Number(property.availableSlots || 0));
}

export function sortedResidential(properties: Property[]): Property[] {
  return properties.filter(isResidential).sort((a, b) => performanceScore(b) - performanceScore(a) || Date.parse(b.$createdAt || '') - Date.parse(a.$createdAt || '') || 0);
}

export async function loadProperties(accountId: string, force = false): Promise<{ items: Property[]; fromCache: boolean; savedAt?: number; warning?: string }> {
  const cached = await getCachedProperties(accountId);
  if (!force && isFresh(cached)) return { items: sortedResidential(cached!.items), fromCache: true, savedAt: cached!.savedAt };
  if (!navigator.onLine) {
    if (cached) return { items: sortedResidential(cached.items), fromCache: true, savedAt: cached.savedAt, warning: 'Offline — showing saved listings.' };
    return { items: [], fromCache: true, warning: 'No offline listings saved yet. Open Nookly while online first.' };
  }
  try {
    const docs: Property[] = [];
    const databaseId = requireSetting(settings.databaseId, 'VITE_APPWRITE_DATABASE_ID');
    const collectionId = requireSetting(settings.propertiesCollectionId, 'VITE_APPWRITE_PROPERTIES_COLLECTION_ID');
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await databases.listDocuments({ databaseId, collectionId, queries: [Query.limit(PAGE_SIZE), Query.offset(page * PAGE_SIZE), Query.orderDesc('$createdAt')] });
      docs.push(...result.documents as unknown as Property[]);
      if (result.documents.length < PAGE_SIZE || docs.length >= result.total) break;
    }
    try { await saveCachedProperties(accountId, docs); } catch { /* Browsing must still work when IndexedDB is unavailable. */ }
    return { items: sortedResidential(docs), fromCache: false, savedAt: Date.now() };
  } catch (error) {
    if (cached) return { items: sortedResidential(cached.items), fromCache: true, savedAt: cached.savedAt, warning: 'Could not refresh listings. Showing the last saved copy.' };
    throw error;
  }
}

export async function loadProperty(accountId: string, id: string): Promise<{ property: Property | null; fromCache: boolean }> {
  if (!navigator.onLine) return { property: await getCachedProperty(accountId, id), fromCache: true };
  try {
    const doc = await databases.getDocument({ databaseId: requireSetting(settings.databaseId, 'VITE_APPWRITE_DATABASE_ID'), collectionId: requireSetting(settings.propertiesCollectionId, 'VITE_APPWRITE_PROPERTIES_COLLECTION_ID'), documentId: id });
    const property = doc as unknown as Property;
    try { await saveCachedProperty(accountId, property); } catch { /* Show the live property even if local storage fails. */ }
    return { property, fromCache: false };
  } catch (error) {
    const property = await getCachedProperty(accountId, id);
    if (property) return { property, fromCache: true };
    throw error;
  }
}

export function facilitiesOf(property: Property): string[] {
  const value = property.facilities;
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return value.split(',').map(part => part.trim()).filter(Boolean);
  if (value && typeof value === 'object') return Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([label]) => label);
  return [];
}

export function priceOf(property: Property): number {
  const original = Number(property.price || 0);
  const current = Number(property.new_price || original);
  return current > 0 ? current : original;
}

export function imageOf(property: Property): string | null {
  const options = [property.image1, property.image2, property.image3, ...(property.images ?? [])];
  const valid = options.find(url => typeof url === 'string' && /^https?:\/\//i.test(url.trim()));
  return typeof valid === 'string' ? valid : null;
}

export function filterProperties(properties: Property[], opts: { search: string; category: string; maximumPrice: number | null; schoolLocation: string; availableOnly: boolean }): Property[] {
  const q = opts.search.trim().toLowerCase();
  const location = opts.schoolLocation.trim().toLowerCase();
  return properties.filter(property => {
    const type = String(property.type || '');
    if (opts.category !== 'All' && !(opts.category === 'Boarding' ? /boarding|hostel/i.test(type) : type.toLowerCase() === opts.category.toLowerCase())) return false;
    if (opts.maximumPrice !== null && priceOf(property) > opts.maximumPrice) return false;
    if (opts.availableOnly && property.isAvailable === false) return false;
    if (location && !String(property.address || '').toLowerCase().includes(location)) return false;
    if (q && ![property.propertyName, property.address, property.description, type, facilitiesOf(property).join(' ')].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}
