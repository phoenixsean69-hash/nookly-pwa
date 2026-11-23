import { Account, Client, Databases, Storage, ID, Query } from 'appwrite';

export const settings = {
  endpoint: import.meta.env.VITE_APPWRITE_ENDPOINT?.trim() || '',
  projectId: import.meta.env.VITE_APPWRITE_PROJECT_ID?.trim() || '',
  databaseId: import.meta.env.VITE_APPWRITE_DATABASE_ID?.trim() || '',
  usersCollectionId: import.meta.env.VITE_APPWRITE_USERS_COLLECTION_ID?.trim() || '',
  propertiesCollectionId: import.meta.env.VITE_APPWRITE_PROPERTIES_COLLECTION_ID?.trim() || '',
  favoritesCollectionId: import.meta.env.VITE_APPWRITE_FAVORITES_COLLECTION_ID?.trim() || '',
  tenantProfilesCollectionId: import.meta.env.VITE_APPWRITE_TENANT_PROFILES_COLLECTION_ID?.trim() || '',
  landlordsCollectionId: import.meta.env.VITE_APPWRITE_LANDLORDS_COLLECTION_ID?.trim() || '',
  organizationTenantsCollectionId: import.meta.env.VITE_APPWRITE_ORGANIZATION_TENANTS_COLLECTION_ID?.trim() || '',
  organizationsCollectionId: import.meta.env.VITE_APPWRITE_ORGANIZATIONS_COLLECTION_ID?.trim() || '',
  matchProfilesCollectionId: import.meta.env.VITE_APPWRITE_MATCH_PROFILES_COLLECTION_ID?.trim() || '',
  likesCollectionId: import.meta.env.VITE_APPWRITE_LIKES_COLLECTION_ID?.trim() || '',
  requestsCollectionId: import.meta.env.VITE_APPWRITE_REQUESTS_COLLECTION_ID?.trim() || '',
  bucketId: import.meta.env.VITE_APPWRITE_BUCKET_ID?.trim() || '',
};

export const missingCoreSettings = () => ([
  ['VITE_APPWRITE_ENDPOINT', settings.endpoint],
  ['VITE_APPWRITE_PROJECT_ID', settings.projectId],
  ['VITE_APPWRITE_DATABASE_ID', settings.databaseId],
  ['VITE_APPWRITE_PROPERTIES_COLLECTION_ID', settings.propertiesCollectionId],
] as const).filter(([, value]) => !value).map(([name]) => name);

const client = new Client();
if (settings.endpoint && settings.projectId) {
  client.setEndpoint(settings.endpoint).setProject(settings.projectId);
}
export const account = new Account(client);
export const databases = new Databases(client);
export const storage = new Storage(client);
export { ID, Query };

export function requireSetting(value: string, label: string): string {
  if (!value) throw new Error(`Missing ${label}. Check your .env file.`);
  return value;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
