import { del, get, set } from 'idb-keyval';
import type { Property } from '../types';

const PREFIX = 'nookly-pwa:v1:';
const LIST_TTL = 15 * 60 * 1000;
const key = (accountId: string, category: string) => `${PREFIX}${accountId}:${category}`;

export interface CachedList { items: Property[]; savedAt: number }
export interface PendingFavorite { propertyId: string; shouldSave: boolean; queuedAt: number }

export async function getCachedProperties(accountId: string): Promise<CachedList | null> {
  try { return (await get<CachedList>(key(accountId, 'properties'))) ?? null; } catch { return null; }
}

export async function saveCachedProperties(accountId: string, items: Property[]): Promise<void> {
  await set(key(accountId, 'properties'), { items, savedAt: Date.now() });
}

export const isFresh = (entry: CachedList | null): boolean => Boolean(entry && Date.now() - entry.savedAt < LIST_TTL);

export async function getCachedProperty(accountId: string, id: string): Promise<Property | null> {
  try {
    const saved = await get<Property>(key(accountId, `property:${id}`));
    if (saved) return saved;
    const list = await getCachedProperties(accountId);
    return list?.items.find(property => property.$id === id) || null;
  } catch { return null; }
}

export async function saveCachedProperty(accountId: string, property: Property): Promise<void> {
  await set(key(accountId, `property:${property.$id}`), property);
}

export async function getFavorites(accountId: string): Promise<string[]> {
  try { return (await get<string[]>(key(accountId, 'favorites'))) ?? []; } catch { return []; }
}

export async function saveFavorites(accountId: string, ids: string[]): Promise<void> {
  await set(key(accountId, 'favorites'), [...new Set(ids)]);
}

export async function getPendingFavorites(accountId: string): Promise<PendingFavorite[]> {
  try { return (await get<PendingFavorite[]>(key(accountId, 'favorites-outbox'))) ?? []; } catch { return []; }
}

export async function queueFavorite(accountId: string, propertyId: string, shouldSave: boolean): Promise<void> {
  const pending = await getPendingFavorites(accountId);
  // Keep only the latest intent for each property, preventing duplicate remote writes.
  await set(key(accountId, 'favorites-outbox'), [
    ...pending.filter(item => item.propertyId !== propertyId),
    { propertyId, shouldSave, queuedAt: Date.now() },
  ] satisfies PendingFavorite[]);
}

export async function removePendingFavorite(accountId: string, propertyId: string): Promise<void> {
  const pending = await getPendingFavorites(accountId);
  await set(key(accountId, 'favorites-outbox'), pending.filter(item => item.propertyId !== propertyId));
}

export async function clearUserOfflineData(accountId: string): Promise<void> {
  await Promise.all([
    del(key(accountId, 'properties')),
    del(key(accountId, 'favorites')),
    del(key(accountId, 'favorites-outbox')),
    del(key(accountId, 'profile')),
  ]);
  // Individually cached property details intentionally remain until browser storage is cleared.
  // They are still isolated by accountId and cannot be shown to a different account.
}

export async function getCachedProfile<T>(accountId: string): Promise<T | null> {
  try { return (await get<T>(key(accountId, 'profile'))) ?? null; } catch { return null; }
}

export async function setCachedProfile<T>(accountId: string, user: T): Promise<void> {
  await set(key(accountId, 'profile'), user);
}
