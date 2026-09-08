import jwt from "jsonwebtoken";

export const JWT_SECRET = process.env.JWT_SECRET || "koodo-dev-secret-change-me";

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.full_name },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

export function signOtpToken(payload) {
  return jwt.sign({ ...payload }, JWT_SECRET, { expiresIn: "15m" });
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  // Fallback : jeton passé en query (?token=) — utile pour EventSource natif
  // qui ne peut pas envoyer d'en-tête Authorization.
  const queryToken = typeof req.query?.token === "string" ? req.query.token : null;
  const token = header.startsWith("Bearer ") ? header.slice(7) : queryToken;
  if (!token) return res.status(401).json({ error: "Non authentifié" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Session expirée ou invalide" });
  }
}
