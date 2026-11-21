# Nookly Accommodation PWA — Web Conversion, Phase 1

A separate browser-first Nookly application based on the **actual accommodation data model** of `phoenixsean69-hash/nookly-main`. The original mobile repo was used **read-only**; this package does not contain its Android/iOS source or driver/SOS modules.

## Implemented in Phase 1

- Vite + React + TypeScript + Appwrite **Web** SDK
- Responsive accommodation homepage, search, residential type and price filters, property details
- Existing Nookly property schema (`propertyName`, `type`, `address`, `price`, `new_price`, `image1`, `facilities`, `availableSlots`, `creatorId`)
- Existing-account **sign in** and user-mode lookup through `users.accountId`
- Landlord's **read-only** own listings
- IndexedDB cached property listings and details, per-account saved favorites, queued Appwrite favorite writes
- Production PWA manifest, installable icons, app-shell precache, property-image runtime caching
- No Rides or SOS pages, services or user flows

## Not yet migrated

**Do not deploy this as a replacement for all of Nookly accommodation yet.** Phase 1 is a functional browsing foundation, not a full feature-complete port. Registration is intentionally disabled in the UI until mobile's full multi-collection onboarding is ported safely. Landlord add/edit, accommodation requests, chat, matches, student institution-location mappings, notifications, image/video uploads, leasing, verification and complete offline action handling will follow. This intentionally avoids exposing broken account creation or silently omitting business logic.

## Install (Windows PowerShell)

The folder `C:\Users\nooklyweb\Documents\nookly-pwa` should be empty before extracting. Extract **the contents** of the downloaded ZIP to that folder (not another nested folder).

```powershell
$target = 'C:\Users\nooklyweb\Documents\nookly-pwa'
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\nookly-web-phase1.zip" -DestinationPath $target -Force
Set-Location $target
powershell -NoProfile -ExecutionPolicy Bypass -File '.\scripts\import-public-env.ps1'
notepad '.env'
npm install
npm run dev
```

**Do not run `git clone` inside the new web directory.**

### Appwrite configuration

The provided `scripts/import-public-env.ps1` attempts to read **only public IDs and endpoint** from the **local** mobile reference's `.env` file. If that file does not exist, it creates a blank template for you to fill manually: `EXPO_PUBLIC_APPWRITE_*` becomes `VITE_APPWRITE_*` (names are mapped inside `.env.example`). Never put an Appwrite API key, administrator credential or secret in Vite browser environment variables.

In the Appwrite Console, add your local web origin (e.g. `http://localhost:5173` or `http://127.0.0.1:5173`) as a **Web platform**. The Vite dev server defaults to `http://127.0.0.1:5173`; add this exact origin. Add your production deployment origin too. Browser sessions require compatible Appwrite origin/cookie settings. Users still need Appwrite read permissions for listings.

Missing environment values are displayed in a diagnostic notice instead of a blank screen.

### Production

```powershell
npm run build
npm run preview
```

Installability/service worker are verified in **production preview**, not normal dev mode. Serve `dist/` over HTTPS with SPA rewrite fallback. The included `vercel.json` supports Vercel; `public/_redirects` supports Netlify. Appwrite web platform origins must be configured for your deployment.

### Offline behavior

1. Open Nookly online; allow listings to load. IndexedDB caches them.
2. Navigate to property details online to save the complete details. Images are opportunistically cached by the service worker once visited.
3. Turn off network; reload a production preview or installed PWA. The app shell and previously saved listing data should remain available.
4. Favorites are locally persisted per account and queued for sync upon reconnection. Actual Appwrite favorites synchronization requires `VITE_APPWRITE_FAVORITES_COLLECTION_ID` and collection permissions.
5. First visits, new account sign-in, property requests and landlord actions **require internet**.

Do **not** assume every listing image will be present offline. Cache storage is subject to browser eviction, quotas and cross-origin response permissions.

### Source mapping

| Nookly mobile source | PWA Phase 1 module |
| --- | --- |
| `lib/appwrite-client.ts`, `lib/appwrite.ts` | `src/lib/appwrite.ts`, `src/lib/auth.ts` |
| `lib/studentHousing.ts`, `lib/discoveryQueries.ts` | `src/lib/housing.ts` |
| `lib/offline/property.repository.ts`, `lib/offline/outbox.ts` | `src/lib/offline.ts`, `src/lib/favorites.ts` |
| `app/(root)/(student)/s-tenantHome.tsx`, `app/(root)/(tabs)/tenantHome.tsx` | `src/App.tsx` / Explore |
| `app/(root)/properties/[id].tsx` | `src/App.tsx` / Property details |
| `app/(root)/(landlord)/landHome.tsx` | `src/App.tsx` / Landlord read-only |

**Security:** No privileged SDK or API keys. Appwrite access restrictions remain authoritative; hiding routes is not access control. Offline profile is only a local presentation cache and is labeled accordingly; it does not establish a valid session offline.
