import { Link } from 'react-router-dom';
import { FlowerIcon } from '../components/Icons';

export function Home() {
  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-flower"><FlowerIcon /></div>
        <h1>Prato Fiorito</h1>
        <p>Il classico campo minato. Da solo, oppure con gli amici su un unico campo, un turno a testa.</p>
      </section>

      <div className="two-cols">
        <Link to="/gioca" className="card mode-card">
          <span className="mode-emoji">🧍</span>
          <h2>Gioca da solo</h2>
          <p>Principiante, Intermedio, Esperto o campo personalizzato, con i tuoi record.</p>
        </Link>
        <Link to="/multi" className="card mode-card">
          <span className="mode-emoji">👥</span>
          <h2>Gioca con gli amici</h2>
          <p>Crea una partita e condividi il codice: cooperativa a turni o sfida con un campo a testa.</p>
        </Link>
      </div>

      <section className="card rules" id="regole">
        <h2>Come si gioca</h2>
        <div className="rules-grid">
          <div>
            <h3>Obiettivo</h3>
            <p>Scopri tutte le celle che non nascondono una mina. Ogni numero indica quante mine ci sono nelle 8 celle attorno. Il primo click è sempre sicuro.</p>
          </div>
          <div>
            <h3>Mouse</h3>
            <ul>
              <li><kbd>Click sinistro</kbd>: scopri una cella</li>
              <li><kbd>Click destro</kbd>: bandierina → ? → niente</li>
              <li><kbd>Click su un numero</kbd>, <kbd>tasto centrale</kbd> o <kbd>sinistro + destro</kbd>: se attorno ci sono tante bandierine quante il numero, scopre le altre vicine ("chord")</li>
              <li><kbd>F2</kbd> o <kbd>N</kbd>: nuova partita · <kbd>F</kbd>: modalità bandierina</li>
            </ul>
          </div>
          <div>
            <h3>Touch</h3>
            <ul>
              <li><strong>Tap</strong>: scopri (o chord su un numero)</li>
              <li><strong>Pressione lunga</strong>: bandierina</li>
              <li>Il pulsante <strong>⛏️/🚩</strong> inverte tap e pressione lunga</li>
            </ul>
          </div>
          <div>
            <h3>Multiplayer: Cooperativa</h3>
            <p>Un solo campo, a turni; le bandierine sono libere. L'host sceglie da 1 a 5 vite di squadra: ogni mina ne costa una. Le celle del primo click si dividono tra tutti, poi ogni cella vale 1 punto a chi la apre.</p>
          </div>
          <div>
            <h3>Multiplayer: Sfida</h3>
            <p>Ognuno ha il suo campo con le stesse mine e la stessa apertura iniziale, e si gioca tutti insieme. Da 1 a 5 vite a testa, finite le vite sei eliminato. Vedi i campi degli avversari in tempo reale; vince chi fa più punti.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
