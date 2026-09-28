import http from 'node:http';
import { randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  CODE_ALPHABET, CODE_LENGTH,
  isValidCode, normalizeCode, normalizeSettings,
  type ClientMessage, type ErrorCode, type ServerMessage,
} from '@prato/shared';
import { Room, RoomError, type Player } from './room';

const PORT = Number(process.env.PORT ?? 8080);
/** Stanza senza nessun giocatore connesso: viene eliminata dopo questo tempo. */
const IDLE_ROOM_MS = 10 * 60_000;
const HEARTBEAT_MS = 30_000;

// ───────────────────────── origini consentite ─────────────────────────
// ALLOWED_ORIGINS="https://prato.vercel.app,https://*.vercel.app" (vuoto = tutte)
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((o) => new RegExp('^' + o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+') + '$'));

function originAllowed(origin: string | undefined): boolean {
  if (allowedOrigins.length === 0) return true;
  return !!origin && allowedOrigins.some((re) => re.test(origin));
}

// ───────────────────────── stanze ─────────────────────────

const rooms = new Map<string, Room>();
const idleTimers = new Map<string, NodeJS.Timeout>();

function destroyRoom(room: Room) {
  room.dispose();
  rooms.delete(room.code);
  const t = idleTimers.get(room.code);
  if (t) clearTimeout(t);
  idleTimers.delete(room.code);
  log(`stanza ${room.code} eliminata (${rooms.size} attive)`);
}

const hooks = {
  onIdleChange(room: Room, idle: boolean) {
    const existing = idleTimers.get(room.code);
    if (existing) clearTimeout(existing);
    idleTimers.delete(room.code);
    if (idle) idleTimers.set(room.code, setTimeout(() => destroyRoom(room), IDLE_ROOM_MS));
  },
  onEmpty: destroyRoom,
};

function generateCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
}

// ───────────────────────── validazione input ─────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : -1);

function parse(data: RawData): ClientMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(data.toString());
  } catch {
    return null;
  }
  if (!isObj(msg) || typeof msg.t !== 'string') return null;
  switch (msg.t) {
    case 'create':
      return { t: 'create', name: str(msg.name, 40), settings: normalizeSettings(msg.settings) };
    case 'join':
      return { t: 'join', code: normalizeCode(str(msg.code, 20)), name: str(msg.name, 40) };
    case 'resume':
      return {
        t: 'resume', code: normalizeCode(str(msg.code, 20)),
        playerId: str(msg.playerId, 64), token: str(msg.token, 64),
      };
    case 'configure':
      return { t: 'configure', settings: normalizeSettings(msg.settings) };
    case 'reveal':
    case 'chord':
    case 'flag':
      return { t: msg.t, i: int(msg.i) };
    case 'chat':
      return { t: 'chat', text: str(msg.text, 500) };
    case 'leave':
    case 'start':
      return { t: msg.t };
    default:
      return null;
  }
}

// ───────────────────────── connessioni ─────────────────────────

interface Conn {
  ws: WebSocket;
  room: Room | null;
  player: Player | null;
  alive: boolean;
  tokens: number;
  lastRefill: number;
}

const send = (ws: WebSocket, msg: ServerMessage) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};
const sendError = (ws: WebSocket, code: ErrorCode, message: string) => send(ws, { t: 'error', code, message });

/** Token bucket: max 20 messaggi di picco, 10 al secondo a regime. */
function allow(c: Conn): boolean {
  const now = Date.now();
  c.tokens = Math.min(20, c.tokens + ((now - c.lastRefill) / 1000) * 10);
  c.lastRefill = now;
  if (c.tokens < 1) return false;
  c.tokens -= 1;
  return true;
}

function enterRoom(c: Conn, room: Room, player: Player) {
  c.room = room;
  c.player = player;
  send(c.ws, { t: 'joined', code: room.code, playerId: player.id, token: player.token });
  send(c.ws, { t: 'chatHistory', messages: room.chatHistory() });
  room.broadcastState();
}

function leaveCurrent(c: Conn) {
  if (c.room && c.player && c.player.socket === c.ws) c.room.remove(c.player.id);
  c.room = null;
  c.player = null;
}

function handle(c: Conn, msg: ClientMessage) {
  switch (msg.t) {
    case 'create': {
      leaveCurrent(c);
      const room = new Room(generateCode(), msg.settings, hooks);
      rooms.set(room.code, room);
      log(`stanza ${room.code} creata (${rooms.size} attive)`);
      enterRoom(c, room, room.addPlayer(msg.name, c.ws));
      return;
    }
    case 'join': {
      const room = isValidCode(msg.code) ? rooms.get(msg.code) : undefined;
      if (!room) throw new RoomError('ROOM_NOT_FOUND', 'Nessuna partita con questo codice.');
      if (c.room === room && c.player?.socket === c.ws) return enterRoom(c, room, c.player);
      leaveCurrent(c);
      enterRoom(c, room, room.addPlayer(msg.name, c.ws));
      return;
    }
    case 'resume': {
      const room = rooms.get(msg.code);
      if (!room) throw new RoomError('ROOM_NOT_FOUND', 'Questa partita non esiste più.');
      if (c.room && c.room !== room) leaveCurrent(c);
      enterRoom(c, room, room.resume(msg.playerId, msg.token, c.ws));
      return;
    }
  }

  // Da qui in poi serve essere dentro una stanza, con il socket "attivo" per quel giocatore.
  const { room, player } = c;
  if (!room || !player || player.socket !== c.ws) {
    throw new RoomError('NOT_IN_ROOM', 'Non sei in nessuna partita.');
  }
  switch (msg.t) {
    case 'leave':
      leaveCurrent(c);
      send(c.ws, { t: 'left' });
      return;
    case 'configure':
      return room.configure(player.id, msg.settings);
    case 'start':
      return room.start(player.id);
    case 'reveal':
    case 'chord':
      return room.reveal(player.id, msg.i, msg.t);
    case 'flag':
      return room.flag(player.id, msg.i);
    case 'chat':
      return room.chatFrom(player.id, msg.text);
  }
}

// ───────────────────────── server HTTP + WS ─────────────────────────

const server = http.createServer((req, res) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));
    return;
  }
  res.writeHead(404, headers);
  res.end();
});

const wss = new WebSocketServer({
  server,
  maxPayload: 4 * 1024,
  verifyClient: ({ origin }: { origin: string }) => originAllowed(origin),
});

wss.on('connection', (ws) => {
  const c: Conn = { ws, room: null, player: null, alive: true, tokens: 20, lastRefill: Date.now() };

  ws.on('pong', () => (c.alive = true));

  ws.on('message', (data) => {
    if (!allow(c)) return sendError(ws, 'RATE_LIMIT', 'Troppi messaggi, rallenta un attimo.');
    const msg = parse(data);
    if (!msg) return sendError(ws, 'INVALID', 'Messaggio non valido.');
    try {
      handle(c, msg);
    } catch (err) {
      if (err instanceof RoomError) sendError(ws, err.code, err.message);
      else {
        console.error(err);
        sendError(ws, 'INVALID', 'Errore interno.');
      }
    }
  });

  ws.on('close', () => {
    if (c.room && c.player) c.room.disconnect(c.player, ws);
  });

  (ws as WebSocket & { conn?: Conn }).conn = c;
});

// Ping periodico: chiude i socket "zombie" (es. telefono andato in standby).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const c = (ws as WebSocket & { conn?: Conn }).conn;
    if (!c) continue;
    if (!c.alive) {
      ws.terminate();
      continue;
    }
    c.alive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

wss.on('close', () => clearInterval(heartbeat));

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), ...args);
}

server.listen(PORT, () => {
  log(`Prato Fiorito server in ascolto sulla porta ${PORT}`);
  if (allowedOrigins.length === 0) log('ATTENZIONE: ALLOWED_ORIGINS non impostato, accetto qualsiasi origine');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log('arresto…');
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
