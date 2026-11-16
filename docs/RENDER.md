# Company deployment: Render + MongoDB + Cloudinary

Keep Firebase project **broget-health-ai**, including Authentication, Web/Android registrations, App Check and the existing Firebase Hosting site. Application records now live in MongoDB database **health_broget**; optional photos live in Cloudinary. No Firestore or Firebase Storage connection is used by the app.

## Verified locally and against services

- Atlas connectivity, transaction support/rollback, collections and owner/index configuration.
- Cloudinary private upload, byte-exact signed download, rejection of unsigned and expired links, and deletion of the synthetic diagnostic image.
- Existing Firebase Admin Authentication access, without changing Auth users or logging personal data.
- Local storage/API tests, Flutter analysis/tests, web release compilation and Android debug compilation. These do not replace final deployed browser/phone acceptance.

## 1. Connect the company source to Render

Use https://github.com/brogetweb/broget-health from GitHub account sudheerchaurasiyaa. Grant the Render GitHub installation access to organization brogetweb and this repository if it is not listed.

Update the existing broget-health-api service's repository/branch settings, or create a new Node Web Service. Disable automatic deployment before changing source/environment values. The committed render.yaml also defaults to manual deploys.

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Branch | main |
| Root directory | backend |
| Build command | npm ci --omit=dev |
| Start command | npm start |
| Health check | /health |
| Node version | 22 |

The existing service URL can remain https://broget-health-api.onrender.com. If you create a different URL, update the private client configuration before building.

## 2. Add runtime variables privately

The development machine has a prepared, ignored **backend/.env.render.local**. Import its values using Render Environment -> Add from .env, or copy them into the dashboard privately. Never commit it, send it in chat or include it in Flutter defines. The public template is backend/render.env.example.

Required values: APP_ENV, FIREBASE_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS, PUBLIC_APP_ORIGIN, ADDITIONAL_APP_ORIGINS, MONGODB_URI, MONGODB_DB_NAME, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, AI_API_KEY and AI_MODEL. USDA_API_KEY is optional. Render provides PORT.

- FIREBASE_PROJECT_ID stays broget-health-ai.
- PUBLIC_APP_ORIGIN is https://broget-health-ai.web.app.
- ADDITIONAL_APP_ORIGINS is https://broget-health-ai.firebaseapp.com.
- MONGODB_DB_NAME is health_broget.
- GOOGLE_APPLICATION_CREDENTIALS is /etc/secrets/firebase-admin.json.
- Remove any Firebase emulator variables from the hosted service.

Keep the existing Firebase Admin SDK credential in Render Secret Files as **firebase-admin.json**. If it is already installed and valid, keep it. The local credential ending b39f946af6 was verified read-only against the existing Auth project. Do not paste the JSON in GitHub or chat.

## 3. Allow the Render backend in Atlas

In Atlas, verify the database user can read/write and manage indexes/validators in health_broget. Network Access must permit the Render service's outbound addresses; use the addresses shown for that Render service. Local connectivity being successful does not prove the Render network is allowed. Do not remove existing access entries without reviewing other services that use them.

## 4. Manually deploy and verify the API

Deploy the latest company main commit. Open `/health` and confirm a successful response with `database: mongodb`. Startup creates the reviewed indexes and validators. An unauthenticated request to `/api/profile` must return sign-in-required, not user data.

No Cloudinary unsigned upload preset or public bucket is required. Media is uploaded by the server using authenticated delivery. Keep credentials server-side.

The cleanup worker resumes durable jobs on startup and every 30 seconds while the service runs. Render free services can sleep after 15 idle minutes, so scheduled cleanup may wait until the service wakes; use an always-running service if cleanup deadlines must be guaranteed. A cold first request can take longer. See [Render free-instance limitations](https://render.com/docs/free).

## 5. Publish the updated web app after the backend is healthy

The private config/production.local.json retains the existing Firebase identifiers and App Check site key and uses https://broget-health-api.onrender.com/api. If the Render URL changed, update API_BASE_URL accordingly.

```powershell
.\scripts\build.ps1 -Target web -Config config/production.local.json
firebase.cmd deploy --project broget-health-ai --account official.codewithkannadiga@gmail.com --only hosting
```

Do not run an unrestricted Firebase deploy. Only Hosting is configured for deployment; Auth emulators remain available for local development. This branch does not delete or migrate old cloud data.

The old live website/APK still use the previous API contract until replaced. Publish the client after the new backend is ready, and test sign-in, onboarding, manual meals, scanning/editing, private photo storage, reports, assistant, verification/reset email delivery and two-user isolation. Confirm an account-deletion test removes its Cloudinary assets and MongoDB records.

## 6. Android release

Use the existing Android Firebase registration, google-services.json, package com.broget.broget_ai and private signing identity. Build with the same Render /api URL, then test on a real phone:

```powershell
.\scripts\build.ps1 -Target apk -Config config/production.local.json
```

Publish a production APK only after its login, App Check, camera/gallery, save/display/remove-photo and deletion flows pass. The current debug compile is a build check, not a distribution release.

## Old Firebase test data

You may manually remove obsolete Firestore test records after any desired backup. Keep the Firebase project, Authentication configuration, app registrations, App Check and Hosting if continuing to use them. Deleting Auth users also removes their existing logins. Do not delete the whole Firebase project while using Firebase Authentication.

MongoDB, Cloudinary, Firebase, Render and the AI provider have independent quotas. Changing the database does not restore an exhausted AI quota. Rotate database and Cloudinary credentials shared in chat before company production use and update the private runtime variables.

Official references: [Render Node deployment](https://render.com/docs/deploy-node-express-app), [environment variables and secret files](https://render.com/docs/configure-environment-variables), [Cloudinary access controls](https://cloudinary.com/documentation/control_access_to_media).
