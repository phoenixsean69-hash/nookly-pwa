import { databases, Query, requireSetting, settings } from './appwrite';

export type RegisteredInstitution = {
  $id: string;
  name: string;
  city: string;
  type_of?: string;
};

/** Matches the mobile school selector's requirement: registered organizations
 * with type_of = school. Don't invent local IDs or allow arbitrary text.
 * Requires read access to the appropriate organization directory.
 * Never expose private organization records solely to enable registration.
 */
export async function listRegisteredSchools(): Promise<RegisteredInstitution[]> {
  const db = requireSetting(settings.databaseId, 'VITE_APPWRITE_DATABASE_ID');
  const collectionId = requireSetting(settings.organizationsCollectionId, 'VITE_APPWRITE_ORGANIZATIONS_COLLECTION_ID');
  const found: RegisteredInstitution[] = [];
  for (let page = 0; page < 10; page++) {
    const result = await databases.listDocuments({
      databaseId: db, collectionId,
      queries: [Query.limit(100), Query.offset(page * 100)],
    });
    for (const raw of result.documents) {
      if (String(raw.type_of ?? '').trim().toLowerCase() !== 'school') continue;
      if (raw.isActive === false || raw.isApproved === false) continue;
      if (typeof raw.name !== 'string' || !raw.name.trim()) continue;
      found.push({ $id: raw.$id, name: raw.name, city: String(raw.city || ''), type_of: 'school' });
    }
    if (result.documents.length < 100 || (page + 1) * 100 >= result.total) break;
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}
