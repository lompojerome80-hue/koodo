// File d'attente temps réel (SSE) : un utilisateur peut avoir plusieurs onglets
// ou appareils connectés (multi-instance du côté client).
const clients = new Map(); // userId -> Set<{ id, res }>

export function subscribe(userId, res) {
  const entry = { id: Math.random().toString(36).slice(2), res };
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(entry);
  return entry;
}

export function unsubscribe(userId, entry) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(entry);
  if (set.size === 0) clients.delete(userId);
}

// Pousse un événement JSON à tous les appareils connectés de cet utilisateur.
export function pushTo(userId, payload) {
  const set = clients.get(userId);
  if (!set) return;
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const c of set) {
    try {
      c.res.write(line);
    } catch {
      /* client déconnecté */
    }
  }
}

// Destinataire d'un message dans une conversation : le vendeur, ou l'acheteur
// le plus récent qui a écrit (pour les messages démarés par le vendeur).
export function counterpartOf(db, offer, currentUserId) {
  if (offer.user_id !== currentUserId) return offer.user_id;
  const last = db.prepare(
    `SELECT sender_id FROM messages WHERE offer_id=? AND sender_id<>? ORDER BY datetime(created_at) DESC LIMIT 1`
  ).get(offer.id, offer.user_id);
  return last ? last.sender_id : null;
}