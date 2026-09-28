import { NavLink, Route, Routes, Link } from 'react-router-dom';
import { FlowerIcon } from './components/Icons';
import { Home } from './pages/Home';
import { MultiHome } from './pages/MultiHome';
import { RoomPage } from './pages/RoomPage';
import { SinglePlayer } from './pages/SinglePlayer';

export function App() {
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <FlowerIcon />
          <span>Prato Fiorito</span>
        </Link>
        <nav>
          <NavLink to="/gioca">Da solo</NavLink>
          <NavLink to="/multi">Con amici</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/gioca" element={<SinglePlayer />} />
          <Route path="/multi" element={<MultiHome />} />
          <Route path="/partita/:code" element={<RoomPage />} />
          <Route
            path="*"
            element={
              <div className="page narrow">
                <section className="card center">
                  <h2>Pagina non trovata</h2>
                  <Link className="btn primary" to="/">Torna alla home</Link>
                </section>
              </div>
            }
          />
        </Routes>
      </main>
    </>
  );
}
