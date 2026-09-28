# 🌼 Prato Fiorito

Il classico campo minato, in single player o in **cooperativa a turni** con gli amici tramite codice partita e WebSocket.

## Struttura

```
prato-fiorito/
├── shared/   logica di gioco + tipi del protocollo (usata da client e server)
├── server/   Node + ws: stanze, turni, timer, riconnessione, chat
└── client/   React + Vite + TypeScript
```

La logica sta in `shared/src/engine.ts`: il client la usa per il single player, il server per il multiplayer (è il server a decidere, e le mine non arrivano mai ai client finché la partita non è persa).

## Funzionalità

**Gioco**
- Principiante (9×9, 10), Intermedio (16×16, 40), Esperto (30×16, 99) e campo personalizzato (fino a 40×30)
- Primo click sempre sicuro, e apre sempre un'area (le mine si piazzano dopo il primo click)
- Apertura a cascata degli zeri, bandierine, punti interrogativi (disattivabili)
- Chord: click su un numero, tasto centrale oppure sinistro+destro insieme
- Celle "premute" durante il click, faccina 🙂😮😎😵, contatore mine e timer a 7 segmenti
- A fine partita: mina esplosa in rosso, mine rimaste scoperte, bandierine sbagliate barrate
- Tema **fiori** (come il Prato Fiorito di Windows in italiano) o mine classiche
- Record per difficoltà (localStorage), scorciatoie `F2`/`N` (nuova partita) e `F` (bandierina)
- Touch: tap = scopri, pressione lunga = bandierina, pulsante ⛏️/🚩 per invertirli

**Multiplayer cooperativo**
- Codice partita univoco di 6 caratteri (niente 0/O/1/I/L ambigui) e link d'invito `/partita/CODICE`
- Fino a 8 giocatori, turni a rotazione, timer del turno opzionale (10/20/30/60 s)
- Scoprire una cella consuma il turno; le bandierine sono libere per tutti. Una mina fa perdere tutti.
- Riconnessione automatica (anche ricaricando la pagina); se chi è di turno esce, il turno passa
- Passaggio dell'host se l'host esce, chat, statistiche per giocatore, nuovo round con chi inizia a rotazione
- Server: validazione di ogni input, rate limit, heartbeat, pulizia delle stanze inattive, controllo origin

## Sviluppo locale

```bash
npm install
npm run dev        # server su :8080 + client su :5173
npm test           # test dell'engine
npm run smoke -w server   # test end-to-end del multiplayer (3 client simulati)
```

Per provare il multiplayer da solo apri due schede (ogni scheda è un giocatore diverso) oppure il telefono sulla stessa rete (`http://IP-DEL-PC:5173`).

## Deploy

Vercel non tiene aperte connessioni WebSocket (le funzioni serverless terminano), quindi:
**client su Vercel, server su Render** (o Railway/Fly.io, qualsiasi host con processi Node sempre attivi).

### 1. Server su Render
1. Pubblica il repo su GitHub.
2. Render → **New → Blueprint** → seleziona il repo: legge `render.yaml`.
   (In alternativa: New → Web Service, build `npm ci && npm run build:server`, start `npm start`, health check `/health`.)
3. In `ALLOWED_ORIGINS` metti il dominio Vercel vero (es. `https://prato-fiorito.vercel.app`). Vuoto = qualsiasi origine.
4. Prendi l'URL del servizio, es. `https://prato-fiorito-server.onrender.com`.

> Il piano gratuito di Render mette in pausa il server dopo 15 minuti senza traffico: la prima connessione può impiegare fino a ~1 minuto. La pagina multiplayer lo "sveglia" appena la apri e mostra lo stato.
> Le partite stanno in memoria: se il server si riavvia, le partite in corso si perdono.

### 2. Client su Vercel
1. Vercel → **Add New Project** → importa il repo, lasciando la **Root Directory alla radice** (usa `vercel.json`).
2. Variabile d'ambiente: `VITE_SERVER_URL=https://prato-fiorito-server.onrender.com`
3. Deploy. Il rewrite in `vercel.json` fa funzionare i link diretti tipo `/partita/ABC123`.

## Protocollo WebSocket

Messaggi JSON `{ t: ... }`, tipizzati in `shared/src/protocol.ts`.

| Client → Server | |
|---|---|
| `create { name, config, turnSeconds }` | crea partita, diventi host |
| `join { code, name }` / `resume { code, playerId, token }` | entra / rientra |
| `configure`, `start` | solo host |
| `reveal { i }`, `chord { i }` | solo nel tuo turno |
| `flag { i }`, `chat { text }`, `leave` | sempre |

| Server → Client | |
|---|---|
| `joined { code, playerId, token }` | credenziali per rientrare |
| `state { room }` | stato completo della stanza a ogni cambiamento |
| `chat`, `chatHistory`, `error { code, message }`, `left` | |
