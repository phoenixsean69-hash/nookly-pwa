import { account, databases, ID, Query, requireSetting, settings, storage } from './appwrite';
import { getCachedProfile, setCachedProfile } from './offline';
import type { NooklyUser, TenantType } from '../types';

const LAST_ACCOUNT = 'nookly-pwa:last-account';
// This marker is local to the Accommodation PWA. It is NOT an isolated
// Appwrite cookie: other web apps under the same origin/project can share it.
const PWA_ACCOUNT = 'nookly-accommodation:pwa-account-v1';

export function getPwaAccountId(): string | null {
  try { return localStorage.getItem(PWA_ACCOUNT); } catch { return null; }
}
function rememberPwaAccount(id: string): void {
  try { localStorage.setItem(PWA_ACCOUNT, id); } catch { /* Storage may be blocked. */ }
}
function forgetPwaAccount(): void {
  try { localStorage.removeItem(PWA_ACCOUNT); localStorage.removeItem(LAST_ACCOUNT); } catch { /* Optional. */ }
}
const errorCode = (error: unknown) => Number((error as { code?: unknown } | null)?.code);
const isUnauthenticated = (error: unknown) => [401, 403].includes(errorCode(error));
const readableError = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Appwrite's users.avatar attribute is a URL, so an empty string is invalid.
 * Use the same Appwrite initials service as the mobile application.
 */
function initialsAvatarUrl(name: string): string {
  const endpoint = requireSetting(settings.endpoint, 'VITE_APPWRITE_ENDPOINT').replace(/\/+$/, '');
  const project = requireSetting(settings.projectId, 'VITE_APPWRITE_PROJECT_ID');
  const url = new URL(`${endpoint}/avatars/initials`);
  url.searchParams.set('name', name || 'Nookly');
  url.searchParams.set('width', '200');
  url.searchParams.set('height', '200');
  url.searchParams.set('project', project);
  return url.toString();
}

export async function loadSession(expectedAccountId?: string): Promise<{ user: NooklyUser | null; offline: boolean }> {
  try {
    const auth = await account.get();
    if (expectedAccountId && auth.$id !== expectedAccountId) {
      // Different app/account on the shared Appwrite endpoint. Never adopt it.
      forgetPwaAccount();
      return { user: null, offline: false };
    }
    try { localStorage.setItem(LAST_ACCOUNT, auth.$id); } catch { /* Optional cache. */ }
    const docs = await databases.listDocuments({
      databaseId: requireSetting(settings.databaseId, 'VITE_APPWRITE_DATABASE_ID'),
      collectionId: requireSetting(settings.usersCollectionId, 'VITE_APPWRITE_USERS_COLLECTION_ID'),
      queries: [Query.equal('accountId', auth.$id), Query.limit(1)],
    });
    const user = docs.documents[0] as unknown as NooklyUser | undefined;
    if (!user) throw new Error('Your Appwrite account exists, but its Nookly user profile was not found.');
    if (!['tenant', 'student', 'landlord'].includes(user.userMode)) {
      // The PWA is accommodation-only; never reveal driver UI.
      forgetPwaAccount();
      return { user: null, offline: false };
    }
    try { await setCachedProfile(auth.$id, user); } catch { /* Offline caching is optional. */ }
    return { user, offline: false };
  } catch (error) {
    if (navigator.onLine) {
      if (isUnauthenticated(error)) {
        if (expectedAccountId) forgetPwaAccount();
        return { user: null, offline: false };
      }
      throw error;
    }
    const id = expectedAccountId || getPwaAccountId();
    return { user: id ? await getCachedProfile<NooklyUser>(id) : null, offline: true };
  }
}

/** Avoid overwriting/revoking a session belonging to Nookly Organizations.
 * Appwrite authenticates the entire browser against the same endpoint/project.
 * Users who need both apps simultaneously should use separate browser profiles.
 */
async function ensureNoOtherSession(): Promise<void> {
  try {
    const existing = await account.get();
    if (existing) {
      throw new Error('Another Nookly session is active in this browser. Open Accommodation in a separate Edge profile or InPrivate window, or sign out of that other app first. We will not replace its session.');
    }
  } catch (error) {
    if (isUnauthenticated(error)) return;
    throw error;
  }
}

export async function signIn(email: string, password: string): Promise<NooklyUser> {
  if (!navigator.onLine) throw new Error('Sign in requires internet access. You can still browse saved accommodation offline.');
  await ensureNoOtherSession();
  await account.createEmailPasswordSession({ email: email.trim().toLowerCase(), password });
  try {
    const result = await loadSession();
    if (!result.user) throw new Error('Your account was authenticated, but its Nookly profile is not available for this accommodation app.');
    rememberPwaAccount(result.user.accountId);
    return result.user;
  } catch (error) {
    // Only revoke the session we JUST created, never an inherited organization session.
    try { await account.deleteSession({ sessionId: 'current' }); } catch { /* Best effort. */ }
    forgetPwaAccount();
    throw error;
  }
}

export async function signOut(): Promise<void> {
  if (!navigator.onLine) throw new Error('Reconnect before signing out so the server session can be closed safely.');
  const expected = getPwaAccountId();
  if (!expected) { forgetPwaAccount(); return; }
  try {
    const current = await account.get();
    if (current.$id !== expected) { forgetPwaAccount(); return; }
    await account.deleteSession({ sessionId: 'current' });
    forgetPwaAccount();
  } catch (error) {
    if (isUnauthenticated(error)) { forgetPwaAccount(); return; }
    throw error;
  }
}

export type RegisterInput = {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  userMode: 'tenant' | 'landlord';
  tenantType?: TenantType;
  schoolLocation?: string;
  organizationId?: string;
  /** User-entered institution name; not an Appwrite organization membership or verified school. */
  institutionNotListed?: boolean;
  avatarFile?: File | null;
};
export type RegisterResult = { user: NooklyUser; warnings: string[] };

function validateRegistration(input: RegisterInput): void {
  if (!input.name.trim()) throw new Error('Enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new Error('Enter a valid email address.');
  if (!input.phone.trim()) throw new Error('Enter your phone number.');
  if (!['tenant', 'landlord'].includes(input.userMode)) throw new Error('Choose tenant or landlord.');
  if (input.userMode === 'tenant' && !['student','family','single'].includes(input.tenantType ?? '')) throw new Error('Choose your tenant type.');
  if (input.userMode === 'tenant' && input.tenantType === 'student') {
    if (!input.schoolLocation?.trim()) throw new Error('Enter or select your institution name.');
    if (input.schoolLocation.trim().length < 3 || input.schoolLocation.trim().length > 140)
      throw new Error('Institution name must be between 3 and 140 characters.');
    if (!input.institutionNotListed && !input.organizationId?.trim())
      throw new Error('Select a registered institution or choose Other.');
    if (input.institutionNotListed && input.organizationId?.trim())
      throw new Error('An unregistered institution cannot have a registered organization ID.');
  }
  if (input.password.length < 8) throw new Error('Password must have at least 8 characters.');
  if (input.password !== input.confirmPassword) throw new Error('Passwords do not match.');
  if (input.avatarFile && (!input.avatarFile.type.startsWith('image/') || input.avatarFile.size > 5 * 1024 * 1024)) {
    throw new Error('Choose a photo (JPG, PNG or WebP) smaller than 5 MB.');
  }
}

/** Mobile-compatible account creation. The first user document is required;
 * supporting tenant/landlord rows are attempted independently as on mobile.
 * No API keys or privileged credentials are used in the browser.
 */
export async function createAccount(input: RegisterInput, mode: 'new' | 'repair' = 'new'): Promise<RegisterResult> {
  if (!navigator.onLine) throw new Error('Connect to the internet to create your Nookly account.');
  validateRegistration(input);
  if (mode === 'new') await ensureNoOtherSession();
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const phone = input.phone.trim();
  const tenantType = input.userMode === 'tenant' ? input.tenantType : undefined;
  const schoolLocation = tenantType === 'student' ? input.schoolLocation!.trim().toLowerCase() : undefined;
  let auth: { $id: string; email: string };

  if (mode === 'repair') {
    // The Appwrite auth account already exists. NEVER create another one here.
    let current: { $id: string; email: string } | null = null;
    try { current = await account.get(); }
    catch (error) { if (!isUnauthenticated(error)) throw error; }
    if (!current) {
      // Only establish a session if no other application's session is active.
      await ensureNoOtherSession();
      await account.createEmailPasswordSession({ email, password: input.password });
      current = await account.get();
    }
    if (current.email.trim().toLowerCase() !== email) {
      throw new Error('Another account is signed in to this browser. Use the same email as that account or open a separate browser profile. No account data was changed.');
    }
    auth = current;
    // Never create a duplicate profile for an already complete account.
    const existing = await databases.listDocuments({
      databaseId: requireSetting(settings.databaseId, 'VITE_APPWRITE_DATABASE_ID'),
      collectionId: requireSetting(settings.usersCollectionId, 'VITE_APPWRITE_USERS_COLLECTION_ID'),
      queries: [Query.equal('accountId', auth.$id), Query.limit(1)],
    });
    if (existing.documents.length) {
      const user = existing.documents[0] as unknown as NooklyUser;
      rememberPwaAccount(auth.$id);
      return { user, warnings: [] };
    }
  } else {
    const created = await account.create({ userId: ID.unique(), email, password: input.password, name });
    auth = { $id: created.$id, email };
    // If session creation fails, auth account may exist. Do not create duplicates.
    try { await account.createEmailPasswordSession({ email, password: input.password }); }
    catch (error) {
      throw new Error(`Your Appwrite account was created, but sign-in failed: ${readableError(error)}. Please use Sign in; do not register again.`);
    }
  }

  let userDoc: NooklyUser;
  try {
    userDoc = await databases.createDocument({
      databaseId: requireSetting(settings.databaseId, 'VITE_APPWRITE_DATABASE_ID'),
      collectionId: requireSetting(settings.usersCollectionId, 'VITE_APPWRITE_USERS_COLLECTION_ID'),
      documentId: ID.unique(),
      data: {
        email, name, accountId: auth.$id, phone, avatar: initialsAvatarUrl(name), userMode: input.userMode,
        ...(tenantType ? { tenantType } : {}),
        ...(schoolLocation ? { schoolLocation } : {}),
      },
    }) as unknown as NooklyUser;
  } catch (error) {
    // Keep the new session (we know this PWA created it), so an administrator
    // can recover the profile. Don't delete a user's account or claim rollback.
    throw new Error(mode === 'repair'
      ? `Your login is valid, but Nookly could not finish your profile: ${readableError(error)}. Do not create another account.`
      : `Your login account was created, but its Nookly profile could not be saved: ${readableError(error)}. Do not sign up again. Choose Finish existing registration to repair your profile.`);
  }

  rememberPwaAccount(auth.$id);
  try { await setCachedProfile(auth.$id, userDoc); } catch { /* Optional. */ }
  const warnings: string[] = [];
  const createSupportingDoc = async (collectionId: string, label: string, data: Record<string, unknown>) => {
    if (!collectionId) { warnings.push(`${label}: collection ID is not configured.`); return; }
    try { await databases.createDocument({ databaseId: settings.databaseId, collectionId, documentId: ID.unique(), data }); }
    catch (error) { warnings.push(`${label}: ${readableError(error)}`); }
  };

  if (input.userMode === 'tenant') {
    // Same fields as Nookly Mobile's createUser() onboarding.
    await createSupportingDoc(settings.tenantProfilesCollectionId, 'Tenant profile', {
      userId: auth.$id,
      tenantScore: 0, isIdVerified: false,
      landlordReviews: JSON.stringify([]),
      onTimePayments: 0, totalPayments: 0, paymentReliability: 0,
      previousLandlords: [], totalRentalMonths: 0, screeningStatus: 'none',
    });
    await createSupportingDoc(settings.organizationTenantsCollectionId, 'Organization-tenant record', {
      userId: userDoc.$id, email, name, avatar: userDoc.avatar || initialsAvatarUrl(name), tenantPhone: phone,
    });
  } else {
    await createSupportingDoc(settings.landlordsCollectionId, 'Landlord profile', {
      userId: userDoc.$id, email, phone, properties: 0,
    });
  }

  // Profile photo is optional and runs only once the account has a session.
  if (input.avatarFile) {
    if (!settings.bucketId) warnings.push('Profile photo was not uploaded: add VITE_APPWRITE_BUCKET_ID to .env.');
    else {
      try {
        const uploaded = await storage.createFile({
          bucketId: settings.bucketId, fileId: ID.unique(), file: input.avatarFile,
        });
        const avatar = String(storage.getFileView({ bucketId: settings.bucketId, fileId: uploaded.$id }));
        const saved = await databases.updateDocument({
          databaseId: settings.databaseId, collectionId: settings.usersCollectionId,
          documentId: userDoc.$id, data: { avatar },
        });
        userDoc = saved as unknown as NooklyUser;
      } catch (error) {
        warnings.push(`Profile photo: ${readableError(error)}. Your account was created with its default initials avatar.`);
      }
    }
  }
  try { await setCachedProfile(auth.$id, userDoc); } catch { /* Optional cache. */ }
  return { user: userDoc, warnings };
}

/** Recover a partially created account without making a second auth account. */
export async function repairAccount(input: RegisterInput): Promise<RegisterResult> {
  return createAccount(input, 'repair');
}
