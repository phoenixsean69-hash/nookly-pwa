# Nookly Mobile → Accommodation PWA: Phase 8

This patch ports the existing mobile property workflow into the separate React/TypeScript web PWA. **No backend schema changes, API secrets, or GitHub writes.** It shares the same Appwrite documents as the mobile application.

## What's implemented

- Landlord create, edit, pause/resume, delete, and inventory/bed counts.
- Three property photo uploads and up to three small MP4/WebM tours to the existing Appwrite bucket; existing mobile media are displayed.
- Click-to-pin Leaflet map picker, property details including coordinates.
- Rental request form with proposed monthly rent, move-in date, duration and message; tenant request history; landlord inbox and approve/reject.
- Existing mobile JSON `properties.reviews` display and submission, existing `likes` collection toggles, and best-effort mobile-style view tracking (24h throttling for signed-in viewers).
- Links to contact property owner where permitted.

## Required PUBLIC environment variables (from mobile app)

`VITE_APPWRITE_LIKES_COLLECTION_ID` ← `EXPO_PUBLIC_APPWRITE_LIKES_COLLECTION`

`VITE_APPWRITE_REQUESTS_COLLECTION_ID` ← `EXPO_PUBLIC_APPWRITE_REQUESTS_COLLECTION`

`VITE_APPWRITE_BUCKET_ID` ← `EXPO_PUBLIC_APPWRITE_BUCKET_ID`

Keep your existing database, property, user and other IDs unchanged. **Never put a server API key or secret into Vite `.env`.** Restart Vite after editing `.env`.

## Important release and security caveats

**An existing collection must permit each particular operation, or the UI will display Appwrite errors. Do NOT grant broad write access to all authenticated users.** Client-side owner and role checks are useful UX, but Appwrite permissions or authenticated Functions must enforce them. Before a public launch, audit data privacy for request phone/email fields and update/delete permissions for each collection.

1. Mobile reviews are embedded in `properties.reviews`. Client-side updates are non-atomic and require UPDATE on a property document. Do not grant ordinary tenants unrestricted UPDATE on property documents; implement a secure Appwrite Function to append reviews and prevent tampering, then switch the browser API to that Function before production.
2. Mobile `views` and denormalized `likes` are mutable counters. Signed-in PWA view increments are best effort; anonymous views are not counted. Secure accurate counts need a rate-limited server function or database atomic operations with proper permissions.
3. Approving a request and reducing available beds use two separate document updates. Failures and concurrency can leave partial results. Before launch, perform these as one validated backend operation; the UI exposes partial failures so staff can reconcile.
4. Mobile notification Functions, chat conversations, lease management, landlord screening, video compression, and reviews moderation are **not** ported in this patch. Requests are persistent database records, not instant chat; do not advertise automatic push alerts.
5. Landlord property fields and storage permissions must be confirmed in Appwrite against a test account. Test a real tenant request and owner response end-to-end in separate browser profiles.

## Manual acceptance checklist

- [ ] Landlord logs in, adds a boarding house with 3 images, correct address and map pin.
- [ ] Guest sees that property and its media, including on the map.
- [ ] Tenant logs in, likes the property; liked status and count survive reload.
- [ ] Tenant sends one viewing request, duplicate pending request is blocked.
- [ ] Landlord sees the request and changes its status; tenant sees the result.
- [ ] Landlord updates bed availability, pauses/resumes the property, and edits media.
- [ ] Try reviewing and view counting under the current security rules; note any permission denials and address with Functions, not unrestricted property UPDATE.
- [ ] Verify request phone/email fields are not accessible to unrelated accounts.

Run `node --test tests/property-workflows.test.cjs` and `npm run build` after installation. If a workflow is blocked by Appwrite permissions, share the exact error. Do not weaken backend security just to suppress the warning.
