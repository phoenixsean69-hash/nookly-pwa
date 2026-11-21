import { databases, ID, Query, requireSetting, settings } from './appwrite';
import { getFavorites, getPendingFavorites, queueFavorite, removePendingFavorite, saveFavorites } from './offline';

// The mobile app stores favorites as documents {userId, propertyId}.
// Write operations are queued in IndexedDB until Appwrite confirms them.
export async function changeFavorite(accountId: string, propertyId: string, save: boolean): Promise<string[]> {
  const current = await getFavorites(accountId);
  const next = save ? [...new Set([...current, propertyId])] : current.filter(id => id !== propertyId);
  await saveFavorites(accountId, next);
  if (accountId !== 'guest') await queueFavorite(accountId, propertyId, save);
  return next;
}

export async function synchronizeFavorites(accountId: string): Promise<{ pending: number; error?: string }> {
  if (accountId === 'guest' || !navigator.onLine || !settings.favoritesCollectionId) {
    return { pending: (await getPendingFavorites(accountId)).length };
  }
  const databaseId = requireSetting(settings.databaseId, 'VITE_APPWRITE_DATABASE_ID');
  const collectionId = settings.favoritesCollectionId;
  const pending = await getPendingFavorites(accountId);
  let errorText: string | undefined;
  for (const action of pending) {
    try {
      const existing = await databases.listDocuments({ databaseId, collectionId, queries: [Query.equal('userId', accountId), Query.equal('propertyId', action.propertyId), Query.limit(100)] });
      if (action.shouldSave && existing.documents.length === 0) {
        await databases.createDocument({ databaseId, collectionId, documentId: ID.unique(), data: { userId: accountId, propertyId: action.propertyId } });
      } else if (!action.shouldSave) {
        for (const doc of existing.documents) await databases.deleteDocument({ databaseId, collectionId, documentId: doc.$id });
      }
      await removePendingFavorite(accountId, action.propertyId);
    } catch (error) { errorText = error instanceof Error ? error.message : String(error); break; }
  }
  // Only merge remote favorites on first local initialization (never overwrite pending local changes).
  try {
    const remote = await databases.listDocuments({ databaseId, collectionId, queries: [Query.equal('userId', accountId), Query.limit(100)] });
    const remaining = await getPendingFavorites(accountId);
    const local = await getFavorites(accountId);
    const remoteIds = remote.documents.map(d => String(d.propertyId));
    const pendingById = new Map(remaining.map(x => [x.propertyId, x.shouldSave]));
    const merged = [...new Set([...remoteIds, ...local.filter(id => pendingById.get(id) === true)])].filter(id => pendingById.get(id) !== false);
    // Remote is canonical once all queued actions succeed.
    await saveFavorites(accountId, merged);
  } catch (error) { errorText ||= error instanceof Error ? error.message : String(error); }
  return { pending: (await getPendingFavorites(accountId)).length, error: errorText };
}

// Import is explicit: never merge favorites saved by another person who used
// guest mode on a shared browser without the signed-in user's action.
export async function importGuestFavorites(accountId: string): Promise<number> {
  if (accountId === 'guest') throw new Error('Sign in before importing guest favorites.');
  const [guest, current] = await Promise.all([getFavorites('guest'), getFavorites(accountId)]);
  const additions = guest.filter(id => !current.includes(id));
  if (!additions.length) { await saveFavorites('guest', []); return 0; }
  // Queue remote operations first; failures must not strand favorites without sync.
  for (const propertyId of additions) await queueFavorite(accountId, propertyId, true);
  await saveFavorites(accountId, [...new Set([...current, ...additions])]);
  // The user explicitly imported these homes, so clear the anonymous shortlist.
  await saveFavorites('guest', []);
  return additions.length;
}
