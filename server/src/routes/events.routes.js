import { Router } from "express";
import { authRequired } from "../auth.js";
import { subscribe, unsubscribe } from "../realtime.js";

// Canal temps réel (Server-Sent Events). Le client s'abonne avec son JWT
// (en-tête Authorization, ou ?token= pour EventSource natif).
const router = Router();

router.get("/", authRequired, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const entry = subscribe(req.user.sub, res);
  const heartbeat = setInterval(() => {
    try {
      res.write(": hb\n\n");
    } catch {
      /* socket fermé */
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe(req.user.sub, entry);
  });
});

export default router;