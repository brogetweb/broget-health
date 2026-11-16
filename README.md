# Health Broget

Flutter Android/web nutrition journal with photo estimates, an assistant, daily/monthly/yearly reports and an in-app reminder inbox.

## Current stack

- Firebase Authentication manages accounts, verification and password-reset emails. Firebase App Check protects the production API.
- MongoDB stores all application data. Flutter accesses it only through the authenticated Node.js API.
- Cloudinary stores optional meal photos with authenticated delivery. The API checks ownership before issuing a 60-second signed download link.
- Railway serves the web bundle and `/api` on one HTTPS origin. No Render service, Firestore, Firebase Storage or Cloud Functions deployment is required by this branch.
- AI and optional USDA nutrition search credentials stay on the backend.

The migration starts with an empty MongoDB database and a new Firebase Auth project. Old cloud data/services are not deleted by this repository. Existing users must register in the new project. Do not point old APKs at the new API contract; release the updated app after configuration and acceptance testing.

## Setup

1. Install Node.js 22 and Flutter 3.47.5 (Dart 3.13.4).
2. Run `npm ci` in `backend/` and `flutter pub get` at the repository root.
3. Copy `backend/migration.env.example` to ignored `backend/.env.migration.local`. Set MongoDB, Cloudinary and Firebase server configuration. The provided MongoDB credential is stored only in that ignored file on the development machine; it is not supplied to Flutter or committed.
4. Configure Email/Password authentication in the new Firebase project. Supply its Web configuration and Android `google-services.json` for package `com.broget.broget_ai`. Configure App Check and authorized app domains.
5. Use `scripts/configure-firebase.ps1` to prepare ignored `config/production.local.json`. `API_BASE_URL` must end in `/api` for the new backend.

Use a MongoDB replica set or sharded cluster: a standalone MongoDB service does not support the transactions used for reports and deletion. Use distinct databases/environments for local testing, staging and production.

## Run and verify locally

From `backend/`:

```powershell
npm run check
npm test
npm run test:mongo
npm run db:check
# Explicitly create collections/validators/indexes in your configured database:
npm run db:init
# With APP_ENV=development and all required local service configuration:
npm run dev
```

`test:mongo` uses a pinned, disposable MongoDB 8.2.6 replica set; it never reads the cloud URI. A test binary downloads on first use. API tests use Firebase/Cloudinary/AI test doubles, and the storage tests run real MongoDB transactions. They do not prove real email delivery, device attestation or Cloudinary account configuration.

From the repository root:

```powershell
flutter analyze
flutter test
flutter run -d chrome --web-port 5173 --dart-define=API_BASE_URL=http://localhost:8787/api
```

The default Flutter development configuration uses the Firebase Auth emulator. Start it with `scripts/dev-emulators.ps1`, and configure the backend for the same emulator/project. MongoDB is separate; there is no Firestore emulator. For real Firebase in development, supply a private local Dart config and set `USE_EMULATORS=false`.

## Deployment and Android

See [Railway setup](docs/RAILWAY.md) and [architecture](ARCHITECTURE.md). Railway uses the root Dockerfile, which builds Flutter web and runs the Node.js API as a non-root user. Only explicitly public Firebase identifiers become Flutter build arguments; database, Cloudinary, AI and Admin SDK secrets are runtime-only variables.

Build a signed Android APK after supplying the new Firebase app configuration and Railway API URL:

```powershell
.\scripts\build.ps1 -Target apk -Config config/production.local.json
```

Keep the existing private Android signing key so users can install future updates. Never commit or share signing credentials.

## Behaviour and limits

- Photo estimates are reviewed and editable before saving. Optional photo retention is selected in the meal review; manual meals work without photos.
- Meals and daily summary changes commit atomically. Calendar reports preserve the user's reporting timezone.
- Assistant context uses bounded recent history and summaries, with owner-scoped date tools. AI changes require user confirmation.
- REST views refresh after successful mutations, when returning to the app and periodically while foregrounded. Data from an old signed-in account is discarded.
- Account deletion first locks writes, then a retryable worker deletes Cloudinary assets, MongoDB data and Firebase identity. A minimal deletion tombstone prevents stale tokens from recreating data. The UI reports deletion as requested, not immediate completion.
- Reminders are in-app only. Scheduled FCM background notifications remain a separate future feature.
- Firebase, MongoDB, Cloudinary, Railway and the AI provider have independent pricing and quotas. Migrating databases does not fix exhausted AI quota.

Never paste credentials into issues, commits or chat. Rotate credentials that were exposed in shared messages before production use.
