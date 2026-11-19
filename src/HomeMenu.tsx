import type { ReactNode } from 'react';

export interface HomeTile { key: string; label: string; icon: ReactNode; badge?: number }

export function HomeMenu({ operation, admin, onOpen }: { operation: HomeTile[]; admin: HomeTile[]; onOpen: (key: string) => void }) {
  const group = (title: string, tiles: HomeTile[], tone: string) => tiles.length > 0 && (
    <section className="home-group">
      <h2 className={`home-title ${tone}`}><i />{title}</h2>
      <div className="home-grid">
        {tiles.map((tile) => (
          <button key={tile.key} className="home-tile" onClick={() => onOpen(tile.key)}>
            <span className="home-icon">{tile.icon}</span>
            <span className="home-label">{tile.label}</span>
            {tile.badge ? <b className="home-badge">{tile.badge}</b> : null}
          </button>
        ))}
      </div>
    </section>
  );
  return <section className="home-page">
    <div className="home-hero"><img src="/logo.png" alt="" /><div><h1>Caraboa Express</h1><p>¿Qué quieres hacer?</p></div></div>
    {group('OPERACIÓN', operation, 'op')}
    {group('ADMINISTRACIÓN', admin, 'adm')}
  </section>;
}
