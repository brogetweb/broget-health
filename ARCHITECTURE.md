# Health Broget architecture

## Trust boundaries

Flutter uses Firebase Auth SDKs for account/session operations. Every private API request includes an ID token; production also requires App Check. The API verifies signature, project/audience, expiry and revocation using Firebase Admin, derives the UID from verified claims and scopes every private MongoDB operation to that UID. There are no client database credentials or direct Firestore reads. Profile schemas reject client-supplied identity/deletion fields.

Passwords and Firebase refresh/ID tokens are not stored in MongoDB. Registration, verification/resend, login, password reset and logout continue through Firebase; no Brevo or custom password system is needed.

## Persistence

`backend/src/mongo/database.js` manages one bounded pool, readiness, transaction retries and shutdown. Startup requires transaction support and creates reviewed indexes/owner validators. All application persistence is native MongoDB, including profiles, preferences, meals, reports, chat turns/messages, scan snapshots, assistant notes, reminder histories, quotas, nutrition caches, media metadata and cleanup jobs.

An account document is the transaction serialization fence for private writes. Meal edits replace their indexed contribution and update old/new daily aggregates in the same transaction. Reports read a consistent snapshot. Unique user/request IDs and attempt IDs prevent duplicate or stale chat completion. Clearing chat invalidates pending turns. Expiry checks accompany TTL indexes because deletion by TTL is asynchronous.

Keep all operations in a transaction sequential. AI calls, Cloudinary requests and Firebase account deletion occur outside MongoDB transactions; durable jobs bridge these external effects. A replica set or sharded MongoDB cluster is required.

## Media lifecycle

Images are size-limited, decoded and re-encoded to strip metadata. An owner-scoped randomized Cloudinary ID and cleanup job are reserved before upload. Assets use authenticated delivery. The API checks the requesting owner and asset state before issuing an expiring signed download URL; permanent public URLs are not persisted. Saving a meal attaches its asset inside the meal transaction. Removing/replacing/deleting it enqueues cleanup. Abandoned uploads expire through the worker after a grace period.

The worker uses leases and retries and can resume after restarts. An account-deletion fence prevents new writes, and the worker revokes Firebase sessions, removes Cloudinary files, removes personal MongoDB records and deletes Firebase identity. A minimal tombstone remains to block reinitialization by stale credentials. In-flight uploads are given time to finish before deletion; their IDs were already reserved for recovery.

## Assistant and reminders

Structured AI responses are schema-validated. Deterministic meal totals drive daily/monthly/yearly reports. Bounded history/notes/reports form context, and tools query only the verified owner's records. Proposed writes always require user confirmation. Canonical AI nutrition snapshots cannot be substituted across users or overwritten by altered client estimates; edits are explicitly user-entered label values.

Reminder generation respects consent, preferences and quiet hours; duplicate reminders and user actions have stable keys. No FCM delivery or measured movement is claimed.

## Deployment

Render hosts the Node.js API; Firebase Hosting keeps the web app. CORS permits only the configured Hosting origins, and production requires Firebase App Check. Both clients retain project broget-health-ai and the existing Android package/signing identity. Server credentials are runtime-only variables or a Render secret file. MongoDB health_broget stores application data and Cloudinary stores private photos. The company repository is brogetweb/broget-health; deployments remain manual until configuration and acceptance checks pass.

See [migration status](docs/MONGODB_CLOUDINARY_MIGRATION.md) and [deployment](docs/RENDER.md).
