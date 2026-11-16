# Migration status

## Decisions

- MongoDB for application data, Cloudinary for optional files/photos, Firebase Auth/App Check in a new project, Railway for hosting.
- Start empty; no existing Firestore user data is imported or deleted.
- Keep the existing Android package and signing identity, Health Broget branding and manual meal entry.
- Work and test locally, then push the reviewed integration branch; configure and accept live services before deployment/cutover.

## Implemented

- Native MongoDB connection lifecycle, collection validators, indexes, transaction support checks, quotas and expiry handling.
- Firebase UID ownership throughout API repositories; no Flutter Firestore dependencies.
- Profiles/preferences, meal CRUD/paging, daily/monthly/yearly reports, chat idempotency/history, bounded assistant tools/context, remembered notes, nutrition catalog/cache and reminder inbox/actions.
- Optional private photo upload/attachment/display/removal, canonical scan estimates, durable cleanup jobs and account deletion across MongoDB/Cloudinary/Firebase.
- Foreground REST refresh with cancellation and account-switch safeguards.
- Railway Dockerfile/configuration, public-only web build config, updated Android configuration helper and local validation commands.
- Removed active Firestore, Firebase Storage, Cloud Functions and Render deployment configuration. Historical documents are labeled as superseded.

## Live database setup

The supplied Atlas credential is stored only in ignored `backend/.env.migration.local`. Connection and transaction capability checks succeeded. `health_broget_staging` was empty before initialization; application collections/owner validators/indexes were created. No real users, meals or chat records were imported or seeded.

## Validation boundaries

Validated on 16 November 2026: 21 backend core/startup tests, 23 MongoDB/API integration tests and 30 Flutter tests passed; Flutter analysis was clean. Flutter web release and Android debug builds compiled. The production dependency audit reported zero vulnerabilities. The pinned Flutter Docker build tag was verified upstream, but a Railway/Linux Docker build was not run on this Windows machine; perform it during staging deployment.

`npm test` checks schemas, AI transport, calendars, configuration and actual server startup. `npm run test:mongo` checks real local MongoDB transactions plus API flows using test doubles for Firebase, AI and Cloudinary. `flutter analyze` and `flutter test` validate client changes. No cloud credentials are used in automated tests.

Actual new-project Firebase login/verification/reset email delivery, browser/device App Check, real Cloudinary upload/download/delete, Railway container deployment and Android device acceptance require final owner configuration. Do not describe those as completed until exercised. The old live site/APK are not automatically changed by this branch.

## Remaining owner configuration

- New Firebase project ID, public web config and Android google-services.json; Email/Password enabled.
- Firebase Admin credential saved privately as a local file or Railway runtime-only JSON variable.
- App Check web provider/site key and Android certificate/provider registration; authorize the new Railway domain in Firebase Auth.
- Cloudinary cloud name, API key and API secret in private server variables.
- Railway project/service/domain and runtime variables from `backend/railway.env.example`.
- AI credential/model with available quota; optional USDA credential; user-controlled mailbox and physical Android device for acceptance tests.

No Brevo key, MAIL_FROM or SMTP account is required. Secrets never belong in Flutter defines, Docker build arguments or Git. See [Railway guide](RAILWAY.md).
