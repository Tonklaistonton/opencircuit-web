import type {ReactNode} from 'react';

type Command = {label: string; run: () => void; disabled?: boolean};
type Group = {label: string; commands: Command[]};

export function CadMenuBar({groups}: {groups: Group[]}) {
  return <nav className="cad-menu-bar" aria-label="Schematic CAD menu">
    {groups.map((group) => <details className="cad-menu" key={group.label}>
      <summary>{group.label}</summary>
      <div className="cad-menu-popover">
        {group.commands.map((command) => <button key={command.label} disabled={command.disabled}
          onClick={(event) => {command.run(); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');}}>
          {command.label}
        </button>)}
      </div>
    </details>)}
  </nav>;
}

export function CadToolRail({items}: {items: {label: string; icon: ReactNode; active?: boolean; run: () => void}[]}) {
  return <nav className="cad-tool-rail" aria-label="Drawing tools">
    {items.map((item) => <button key={item.label} type="button" title={item.label}
      aria-label={item.label} aria-pressed={!!item.active} className={item.active ? 'active' : ''}
      onClick={item.run}>{item.icon}</button>)}
  </nav>;
}
