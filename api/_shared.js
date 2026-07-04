const PARTICIPANT_PATTERN = /^[A-Za-z0-9_-]{1,100}$/u;
const SESSION_PATTERN = /^[0-9a-f-]{36}$/u;
const CONDITIONS = new Set(["control", "fake_ai", "real_ai"]);

export function setCors(req, res) {
  const configured = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  const origin = req.headers.origin || "";
  if (configured.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export function handlePreflight(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export function validateIdentity(body) {
  if (!PARTICIPANT_PATTERN.test(String(body.participant_id || ""))) {
    return "Invalid participant_id";
  }
  if (!SESSION_PATTERN.test(String(body.session_id || ""))) {
    return "Invalid session_id";
  }
  if (!CONDITIONS.has(body.condition)) {
    return "Invalid condition";
  }
  return null;
}

export function jsonError(res, status, message) {
  return res.status(status).json({ error: message });
}
