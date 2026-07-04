import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

export function getFirestoreDatabase() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/gu, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase service account is not configured");
  }

  const app = getApps()[0] || initializeApp({
    credential: cert({ projectId, clientEmail, privateKey })
  });
  return getFirestore(app);
}

export function serverTimestamp() {
  return FieldValue.serverTimestamp();
}
