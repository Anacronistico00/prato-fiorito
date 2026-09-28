// Test end-to-end del server: `npm run build -w server && node server/test/smoke.mjs`
// Avvia il server su una porta libera e simula 3 giocatori.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const PORT = 18080 + Math.floor(Math.random() * 1000);
const WS_URL = `ws://localhost:${PORT}`;
const serverPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const srv = spawn(process.execPath, [serverPath], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
await new Promise((res) => srv.stdout.on('data', (d) => d.toString().includes('in ascolto') && res()));

class Client {
  constructor(label) {
    this.label = label;
    this.msgs = [];
    this.waiters = [];
  }
  async open() {
    this.ws = new WebSocket(WS_URL, { origin: 'http://localhost:5173' });
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.msgs.push(m);
      if (m.t === 'state') this.room = m.room;
      if (m.t === 'joined') this.session = m;
      this.waiters = this.waiters.filter((w) => !w(m));
    });
    await new Promise((r) => this.ws.on('open', r));
    return this;
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  next(pred, ms = 2000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${this.label}: timeout`)), ms);
      this.waiters.push((m) => (pred(m) ? (clearTimeout(t), res(m), true) : false));
    });
  }
  state(pred = () => true) {
    if (this.room && pred(this.room)) return Promise.resolve(this.room);
    return this.next((m) => m.t === 'state' && pred(m.room)).then((m) => m.room);
  }
  error() { return this.next((m) => m.t === 'error'); }
}

try {
  const a = await new Client('A').open();
  const b = await new Client('B').open();
  const c = await new Client('C').open();

  // Creazione + codice
  a.send({ t: 'create', name: 'Alice', settings: { config: { width: 9, height: 9, mines: 10 }, turnSeconds: 0, mode: 'coop', lives: 1 } });
  const joined = await a.next((m) => m.t === 'joined');
  assert.match(joined.code, /^[A-Z2-9]{6}$/);
  const code = joined.code;

  // Codice errato
  b.send({ t: 'join', code: 'ZZZZZZ', name: 'Bob' });
  assert.equal((await b.error()).code, 'ROOM_NOT_FOUND');

  b.send({ t: 'join', code: code.toLowerCase(), name: 'Bob' });
  await b.next((m) => m.t === 'joined');
  c.send({ t: 'join', code, name: 'alice' }); // nome duplicato
  await c.next((m) => m.t === 'joined');
  let room = await a.state((r) => r.players.length === 3);
  assert.deepEqual(room.players.map((p) => p.name), ['Alice', 'Bob', 'alice 2']);
  assert.equal(room.hostId, room.players[0].id);

  // Solo l'host avvia
  b.send({ t: 'start' });
  assert.equal((await b.error()).code, 'NOT_HOST');
  a.send({ t: 'configure', settings: { config: { width: 16, height: 16, mines: 40 }, turnSeconds: 0, mode: 'coop', lives: 3 } });
  await a.state((r) => r.settings.config.width === 16 && r.settings.lives === 3);
  a.send({ t: 'start' });
  room = await b.state((r) => r.phase === 'playing');
  const [pa, pb, pc] = room.players.map((p) => p.id);
  assert.equal(room.turnPlayerId, pa);
  assert.ok(room.board.view.every((v) => v === -1), 'nessuna mina esposta');

  // Fuori turno
  b.send({ t: 'reveal', i: 0 });
  assert.equal((await b.error()).code, 'NOT_YOUR_TURN');

  // Bandierina fuori turno: ammessa, non consuma turni
  b.send({ t: 'flag', i: 255 });
  room = await a.state((r) => r.board.view[255] === -2);
  assert.equal(room.turnPlayerId, pa);
  b.send({ t: 'flag', i: 255 });
  await a.state((r) => r.board.view[255] === -1);

  // Prima mossa di A: sicura, turno a B
  a.send({ t: 'reveal', i: 136 });
  room = await c.state((r) => r.turnPlayerId === pb);
  assert.equal(room.board.status, 'playing');
  // Prima apertura divisa tra i 3 giocatori (resto a chi ha cliccato)
  const opened = room.board.view.filter((v) => v >= 0 && v <= 8).length;
  const scores = room.players.map((p) => p.score);
  assert.equal(scores.reduce((x, y) => x + y, 0), opened);
  assert.ok(scores[1] > 0 && scores[1] === scores[2] && scores[0] >= scores[1], `split: ${scores}`);
  assert.ok(!room.board.view.some((v) => v >= 9), 'mine nascoste durante il gioco');

  // Click su cella già scoperta: non consuma il turno
  b.send({ t: 'reveal', i: 136 });
  b.send({ t: 'chat', text: '  ciao   a tutti ' });
  const chat = await a.next((m) => m.t === 'chat' && !m.msg.system);
  assert.equal(chat.msg.text, 'ciao a tutti');
  assert.equal(a.room.turnPlayerId, pb);

  // Disconnessione di chi ha il turno → passa al successivo; poi resume
  const bSession = b.session;
  b.ws.terminate();
  room = await a.state((r) => r.turnPlayerId === pc);
  assert.equal(room.players[1].connected, false);
  const b2 = await new Client('B2').open();
  b2.send({ t: 'resume', code, playerId: bSession.playerId, token: 'sbagliato' });
  assert.equal((await b2.error()).code, 'SESSION_INVALID');
  b2.send({ t: 'resume', code, playerId: bSession.playerId, token: bSession.token });
  await b2.next((m) => m.t === 'joined');
  room = await a.state((r) => r.players[1].connected);

  // Gioca finché la partita non finisce: ogni giocatore rivela la prima cella coperta
  const clients = { [pa]: a, [pb]: b2, [pc]: c };
  let guard = 0;
  while (room.phase === 'playing' && guard++ < 400) {
    const idx = room.board.view.findIndex((v) => v === -1);
    const mover = clients[room.turnPlayerId];
    const prevRound = JSON.stringify(room.board.view);
    mover.send({ t: 'reveal', i: idx });
    room = await a.state((r) => JSON.stringify(r.board.view) !== prevRound);
  }
  assert.equal(room.phase, 'ended');
  assert.ok(['won', 'lost'].includes(room.board.status));
  if (room.board.status === 'lost') assert.ok(room.board.view.includes(10), 'mina esplosa visibile');
  console.log(`  partita finita: ${room.board.status} dopo ${guard} mosse`);

  // Nuovo round: inizia il secondo giocatore
  a.send({ t: 'start' });
  room = await a.state((r) => r.round === 2);
  assert.equal(room.turnPlayerId, pb);

  // Host se ne va → host passa a B
  a.send({ t: 'leave' });
  await a.next((m) => m.t === 'left');
  room = await c.state((r) => r.players.length === 2);
  assert.equal(room.hostId, pb);

  b2.send({ t: 'start' });
  assert.equal((await b2.error()).code, 'BAD_PHASE');

  // Chiude il round 2 giocando a caso (3 vite di squadra)
  const clients2 = { [pb]: b2, [pc]: c };
  for (let k = 0; room.phase === 'playing' && k < 400; k++) {
    const idx = room.board.view.findIndex((v) => v === -1);
    const prev = JSON.stringify(room.board.view);
    clients2[room.turnPlayerId].send({ t: 'reveal', i: idx });
    room = await c.state((r) => JSON.stringify(r.board.view) !== prev);
  }
  assert.equal(room.phase, 'ended');
  if (room.board.status === 'lost') assert.equal(room.board.hits, 3, 'con 3 vite si perde alla terza mina');

  // ── Sfida: stesse mine, campi separati, in contemporanea
  b2.send({ t: 'configure', settings: { config: { width: 9, height: 9, mines: 10 }, turnSeconds: 0, mode: 'race', lives: 2 } });
  await c.state((r) => r.settings.mode === 'race');
  b2.send({ t: 'start' });
  room = await c.state((r) => r.phase === 'playing' && r.settings.mode === 'race');
  assert.equal(room.turnPlayerId, null);
  const [bb, cb] = room.players.map((p) => p.board);
  assert.deepEqual(bb.view, cb.view, 'stessa apertura per tutti');
  assert.ok(bb.view.some((v) => v >= 0), 'apertura già scoperta');
  assert.deepEqual(room.players.map((p) => p.score), [0, 0], 'l\'apertura non dà punti');

  const mineShown = (r) => r.players.some((p) => p.board.view.some((v) => v === 9));
  const racers = { [pb]: b2, [pc]: c };
  let moves = 0;
  while (room.phase === 'playing' && moves++ < 400) {
    // entrambi muovono sul proprio campo, senza turni
    for (const p of room.players) {
      if (p.board.status !== 'playing') continue;
      const idx = p.board.view.findIndex((v) => v === -1);
      racers[p.id].send({ t: 'reveal', i: idx });
      const before = JSON.stringify(p.board.view);
      room = await c.state((r) => JSON.stringify(r.players.find((x) => x.id === p.id).board.view) !== before);
      if (room.phase === 'playing') assert.ok(!mineShown(room), 'mine nascoste durante la sfida');
    }
  }
  assert.equal(room.phase, 'ended');
  for (const p of room.players) {
    assert.ok(['won', 'lost'].includes(p.board.status));
    if (p.board.status === 'lost') assert.equal(p.board.hits, 2);
    assert.equal(p.score, p.board.view.filter((v) => v >= 0 && v <= 8).length - bb.view.filter((v) => v >= 0).length);
  }
  const win = await c.next((m) => m.t === 'chat' && m.msg.text.includes('vince'), 1000).catch(() => null)
    ?? c.msgs.find((m) => m.t === 'chat' && m.msg.text.includes('vince'));
  assert.ok(win, 'annuncio vincitore');
  console.log(`  sfida finita: ${room.players.map((p) => `${p.name} ${p.score}pt ${p.board.status}`).join(', ')}`);

  console.log('✅ smoke test OK');
  process.exitCode = 0;
} catch (err) {
  console.error('❌', err);
  process.exitCode = 1;
} finally {
  srv.kill();
  setTimeout(() => process.exit(), 100);
}
