import { initializeApp, applicationDefault, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getAppCheck } from 'firebase-admin/app-check';

export function firebaseIdentity(config) {
  let credential;
  if (config.serviceAccountJson) {
    let service;
    try { service = JSON.parse(config.serviceAccountJson); } catch { throw new Error('Invalid Firebase server credential JSON'); }
    if (service.project_id !== config.projectId) throw new Error('Firebase credential project does not match FIREBASE_PROJECT_ID');
    credential = cert(service);
  } else if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) credential = applicationDefault();
  const name = `identity-${config.projectId}`;
  const app = getApps().find(app => app.name === name) ?? initializeApp({
    projectId: config.projectId,
    ...(credential ? { credential } : {}),
  }, name);
  const auth = getAuth(app), check = getAppCheck(app);
  return { auth, verifyToken: token => auth.verifyIdToken(token, true), verifyApp: token => check.verifyToken(token) };
}
