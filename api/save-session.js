import { handlePreflight, jsonError, setCors, validateIdentity } from "./_shared.js";
import { getFirestoreDatabase, serverTimestamp } from "./_firebase.js";

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  setCors(req, res);
  if (req.method !== "POST") return jsonError(res, 405, "Method not allowed");

  const body = req.body || {};
  const identityError = validateIdentity(body);
  if (identityError) return jsonError(res, 400, identityError);
  if (
    !process.env.FIREBASE_PROJECT_ID ||
    !process.env.FIREBASE_CLIENT_EMAIL ||
    !process.env.FIREBASE_PRIVATE_KEY
  ) {
    return jsonError(res, 500, "Data store is not configured");
  }

  const record = buildRecord(body);

  try {
    const db = getFirestoreDatabase();
    await db
      .collection("experiment_sessions")
      .doc(body.session_id)
      .set({
        ...record,
        updated_at: serverTimestamp()
      }, { merge: true });
    return res.status(200).json({ saved: true });
  } catch (error) {
    console.error("Firestore save failure", error);
    return jsonError(res, 502, "Could not save session");
  }
}

export function buildRecord(body) {
  return {
    session_id: body.session_id,
    participant_id: body.participant_id,
    condition: body.condition,
    brainstorm_text: String(body.brainstorm_text || "").slice(0, 12000),
    started_at: normaliseDate(body.started_at),
    ended_at: normaliseDate(body.ended_at),
    completed: Boolean(body.completed),
    auto_ended: Boolean(body.auto_ended),
    early_submit: Boolean(body.early_submit),
    duration_seconds: clampInteger(body.duration_seconds, 0, 7200),
    interaction_count: clampInteger(body.interaction_count, 0, 100),
    interactions: sanitiseJson(body.interactions, []),
    client_metadata: sanitiseJson(body.client_metadata, {}),
    last_save_reason: String(body.save_reason || "").slice(0, 40),
    created_at: normaliseDate(body.started_at)
  };
}

function normaliseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function clampInteger(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function sanitiseJson(value, fallback) {
  try {
    const serialised = JSON.stringify(value);
    if (serialised.length > 250000) return fallback;
    return JSON.parse(serialised);
  } catch (_) {
    return fallback;
  }
}
