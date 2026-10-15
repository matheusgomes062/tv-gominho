import type { Schedule } from '@tv-chuvisco/nucleo';
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from '../components/Icon';
import { KeyHints, Overlay } from '../components/Overlay';
import { BACK_KEYS } from '../nav';
import { useSettings } from '../settings';
import {
  buildDefs,
  cycled,
  QUICK_TILES,
  rangeAt,
  rangeFraction,
  stepped,
  steppedWrapping,
  valueLabel,
  type SettingDef,
} from '../settings-model';

interface Props {
  channels: Schedule[];
  onAll(): void;
  onBack(): void;
}

/**
 * The quick-settings bar along the bottom of the picture: one tile per setting, with its
 * current value. Left/Right choose a tile, Up/Down change its value (live), OK toggles it or
 * lists its values. The last tile opens the full panel. With the mouse or a finger: a click does what OK does,
 * a click or drag on a tile's bar sets that value directly, and a click on the dimmed backdrop closes the bar.
 * A greyed-out tile (its parent setting is off) can be focused but nothing changes it.
 */
export function QuickSettings({ channels, onAll, onBack }: Props) {
  const { settings, update } = useSettings();
  const defs = useMemo(() => buildDefs(channels, settings.startChannel), [channels, settings.startChannel]);
  const tiles = QUICK_TILES.map((key) => defs[key]!);
  // The tile whose list of values is open.
  const [listed, setListed] = useState<string | null>(null);

  /** direction 1 = Down (next in a list / less for a range) is handled by the caller. */
  const change = (item: SettingDef, direction: 1 | -1) => {
    if (item.dimmed?.(settings)) return;
    const next = item.kind === 'range' ? stepped(item, settings, direction) : cycled(item, settings, direction);
    if (next) update(next);
  };

  const onKeyDown = (item: SettingDef) => (event: KeyboardEvent) => {
    const key = event.key;
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      // A range goes up with Up (like a volume bar); a list goes forward with Down (the open list reads top to bottom).
      const direction = item.kind === 'range' ? (key === 'ArrowUp' ? 1 : -1) : key === 'ArrowDown' ? 1 : -1;
      change(item, direction);
    } else if (key === 's' || key === 'S') {
      onBack();
    } else if (BACK_KEYS.has(key) && listed !== null) {
      setListed(null);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const activate = (item: SettingDef) => {
    if (item.dimmed?.(settings)) return;
    if (item.kind === 'switch') change(item, 1);
    else if (item.kind === 'range') update(steppedWrapping(item, settings));
    else setListed((open) => (open === item.key ? null : item.key));
  };

  /** A click or drag along a range tile's bar: the value under the pointer. */
  const setFromBar = (item: SettingDef, event: PointerEvent<HTMLElement>) => {
    if (item.dimmed?.(settings)) return;
    const box = event.currentTarget.getBoundingClientRect();
    const next = rangeAt(item, settings, box.width > 0 ? (event.clientX - box.left) / box.width : 0);
    if (next) update(next);
  };

  return (
    <Overlay edge="bottom" label="Ajustes rápidos" onBack={onBack} className="quick">
      <div className="qs-row" role="toolbar" aria-label="Ajustes rápidos">
        {tiles.map((item, i) => (
          <div key={item.key} className="qs-item">
            <button
              data-nav
              data-autofocus={i === 0 ? '' : undefined}
              data-tile={item.key}
              aria-disabled={item.dimmed?.(settings) || undefined}
              className={`qs-tile ${item.dimmed?.(settings) ? 'dimmed' : ''}`}
              onClick={() => activate(item)}
              onKeyDown={onKeyDown(item)}
              onBlur={(event) => {
                if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setListed(null);
              }}
            >
              <Icon name={item.icon} className="qs-icon" />
              <span className="qs-label">{item.tile ?? item.label}</span>
              <span className="qs-value">{valueLabel(item, settings, true)}</span>
              {item.kind === 'range' && (
                <span
                  className="qs-bar"
                  aria-hidden="true"
                  onPointerDown={(event) => {
                    if (item.dimmed?.(settings)) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setFromBar(item, event);
                  }}
                  onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromBar(item, event);
                  }}
                  // The bar sets the value itself: the tile's own click (step up) must not follow.
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="qs-rail">
                    <i style={{ width: `${rangeFraction(item, settings) * 100}%` }} />
                  </span>
                </span>
              )}
              <span className="qs-arrows" aria-hidden="true">
                <Icon name="chevronUp" />
                <Icon name="chevronDown" />
              </span>
            </button>
            {listed === item.key && (
              <ul className="qs-list" role="listbox" aria-label={item.label}>
                {item.options.map((option) => (
                  <li
                    key={String(option.value)}
                    role="option"
                    aria-selected={option.value === item.get(settings)}
                    // Keep the tile focused: choosing with the mouse must not drop the keyboard focus.
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => update(item.set(option.value))}
                  >
                    {option.label}
                    {option.value === item.get(settings) && <Icon name="check" />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <div className="qs-item qs-all">
          <button data-nav data-tile="all" className="qs-tile" onClick={onAll}>
            <Icon name="settings" className="qs-icon" />
            <span className="qs-value">Todas as configurações</span>
          </button>
        </div>
      </div>
      <KeyHints
        hints={[
          ['← →', 'escolher'],
          ['↑ ↓', 'mudar o valor'],
          ['OK', 'ligar/desligar ou ver lista'],
          ['Voltar', 'fechar'],
        ]}
      />
    </Overlay>
  );
}
