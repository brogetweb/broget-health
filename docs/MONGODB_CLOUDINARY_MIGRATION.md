# Migration status

## Decisions

- MongoDB for application data, Cloudinary for optional files/photos, existing Firebase Auth/App Check project broget-health-ai, Render for the API and existing Firebase Hosting for the website.
- Start MongoDB empty; no existing Firestore user data is imported or deleted. Existing Auth users/UIDs are preserved.
- Keep the existing Android package and signing identity, Health Broget branding and manual meal entry.
- Work and test locally, then push the validated code to the company repository brogetweb/broget-health; configure and accept live services before deployment/cutover.

## Implemented

- Native MongoDB connection lifecycle, collection validators, indexes, transaction support checks, quotas and expiry handling.
- Firebase UID ownership throughout API repositories; no Flutter Firestore dependencies.
- Profiles/preferences, meal CRUD/paging, daily/monthly/yearly reports, chat idempotency/history, bounded assistant tools/context, remembered notes, nutrition catalog/cache and reminder inbox/actions.
- Optional private photo upload/attachment/display/removal, canonical scan estimates, durable cleanup jobs and account deletion across MongoDB/Cloudinary/Firebase.
- Foreground REST refresh with cancellation and account-switch safeguards.
- Render Node service blueprint/runtime configuration, Firebase Hosting configuration, updated Android configuration helper and local validation commands.
- Removed active Firestore, Firebase Storage and Cloud Functions deployment configuration. Railway configuration has been replaced with Render. Historical documents are labeled as superseded.

## Live database setup

The supplied Atlas credential is stored only in ignored `backend/.env.migration.local`. Connection and transaction capability checks succeeded. `health_broget` and the separate staging database were empty before initialization; application collections/owner validators/indexes were created. No real users, meals or chat records were imported or seeded.

## Validation boundaries

Validated on 17 November 2026: 22 backend core/startup tests, 24 MongoDB/API integration tests and 30 Flutter tests passed; Flutter analysis was clean. Flutter web release and Android debug builds compiled. The production dependency audit reported zero vulnerabilities. Live Cloudinary upload/download, unsigned/expired access denial and diagnostic deletion passed. Existing Firebase Admin Auth access was verified read-only. Render deployment and physical-device acceptance remain manual.

`npm test` checks schemas, AI transport, calendars, configuration and actual server startup. `npm run test:mongo` checks real local MongoDB transactions plus API flows using test doubles for Firebase, AI and Cloudinary. `flutter analyze` and `flutter test` validate client changes. No cloud credentials are used in the unit/integration test suites. Separate live service diagnostics use the ignored local environment.

Complete browser/device login, verification/reset email delivery, App Check on the updated deployment, Render deployment and Android device acceptance remain to be exercised after cutover. Do not describe those as completed until exercised. The old live site/APK are not automatically changed by this branch.

## Remaining manual actions

- Connect Render to the company repository, choose Node and the backend root, and import ignored backend/.env.render.local. Upload the existing Firebase Admin SDK credential as firebase-admin.json.
- Grant Render outbound access in Atlas if required; do not expose the database publicly beyond the necessary access list.
- Manually deploy the backend, verify /health reports mongodb, then build/deploy the client using the existing Firebase project and the Render /api URL.
- Run browser/phone acceptance checks; AI still requires available provider quota.
- Old Firestore test data may be cleared manually. Do not delete the Firebase project, app registrations, App Check or authentication configuration; deleting Auth users removes their existing logins.

No Brevo key, MAIL_FROM or SMTP account is required. Secrets never belong in Flutter defines or Git. See [Render guide](RENDER.md).
