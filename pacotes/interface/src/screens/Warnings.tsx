import type { LibraryWarning } from '@tv-gominho/nucleo';
import { useEffect } from 'react';
import { focusFirst, useSpatialNav } from '../nav';
import { Icon } from '../components/Icon';

export function WarningList({ warnings }: { warnings: LibraryWarning[] }) {
  return (
    <ul className="warning-list">
      {warnings.map((warning, i) => (
        <li key={i}>
          <Icon name="alert" className="warning-icon" />
          {warning.path && <code>{warning.path}</code>}
          <span>{warning.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function Warnings({ warnings, onBack }: { warnings: LibraryWarning[]; onBack(): void }) {
  useSpatialNav(onBack);
  useEffect(() => focusFirst(), []);
  return (
    <main className="page">
      <header className="page-header">
        <button data-nav className="button" onClick={onBack}>
          <Icon name="back" /> Voltar
        </button>
        <h1>Avisos da biblioteca</h1>
      </header>
      {warnings.length === 0 ? (
        <p>Nenhum aviso. A biblioteca está em ordem!</p>
      ) : (
        <>
          <p className="muted">
            Itens com problema são pulados; o resto funciona normalmente. Veja a documentação em{' '}
            <code>docs/biblioteca.md</code> e <code>docs/grade.md</code>.
          </p>
          <WarningList warnings={warnings} />
        </>
      )}
    </main>
  );
}
