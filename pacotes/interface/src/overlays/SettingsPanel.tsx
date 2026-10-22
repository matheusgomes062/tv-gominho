import { applyTheme, type PartialSettings, type Schedule, type Theme } from '@tv-gominho/nucleo';
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from '../components/Icon';
import { KeyHints, Overlay } from '../components/Overlay';
import { BACK_KEYS } from '../nav';
import { useSettings } from '../settings';
import {
  buildDefs,
  CATEGORIES,
  clickDirection,
  cycled,
  originOf,
  rangeAt,
  rangeFraction,
  stepped,
  steppedWrapping,
  THEME_DESCRIPTIONS,
  THEME_LABELS,
  valueLabel,
  type SettingDef,
} from '../settings-model';

interface Props {
  channels: Schedule[];
  libraryName: string;
  initialCategory?: string;
  /** Opens the schedule screen (the same one as Menu → Programação). */
  onSchedule(): void;
  /** Focus the "Programação" row when the panel opens (coming back from that screen). */
  focusSchedule?: boolean;
  onBack(): void;
}

/** A value box is only reserved at its widest when that is at most this many characters. */
const MAX_RESERVED_VALUE = 14;

const THEME_ORDER: Theme[] = ['classic', 'vhs', 'modern', 'custom'];

/**
 * The full settings panel, on the left of the live picture: categories in one column, the options of the
 * chosen category in the next. Changes apply to the picture at once. Back goes from the options to the
 * categories, and from the categories closes the panel.
 */
export function SettingsPanel({ channels, libraryName, initialCategory = 'theme', onSchedule, focusSchedule = false, onBack }: Props) {
  const { settings, overrides, fromLibrary, update, reset } = useSettings();
  const [category, setCategory] = useState(initialCategory);
  const [restored, setRestored] = useState(false);
  const defs = useMemo(() => buildDefs(channels, settings.startChannel), [channels, settings.startChannel]);
  const body = useRef<HTMLDivElement>(null);
  const current = CATEGORIES.find((entry) => entry.id === category) ?? CATEGORIES[0]!;

  const apply = (partial: PartialSettings) => {
    update(partial);
    setRestored(false);
  };
  const enterBody = () => body.current?.querySelector<HTMLElement>('[data-nav]')?.focus();
  const leaveBody = () => document.querySelector<HTMLElement>(`[data-cat="${current.id}"]`)?.focus();

  // Right/OK on a category enters its options; Back inside the options returns to the categories.
  const onKeyDown = (event: KeyboardEvent) => {
    const inBody = body.current?.contains(event.target as Node) ?? false;
    if ((event.target as HTMLElement).closest('[data-hub-link]') && event.key === 'ArrowRight') onSchedule();
    else if (inBody && BACK_KEYS.has(event.key)) leaveBody();
    else if (!inBody && event.key === 'ArrowRight') enterBody();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <Overlay edge="left" label="Configurações" onBack={onBack} className="settings-overlay">
      {/* The keydown here only intercepts keys that move between the two columns. */}
      <div className="panel" onKeyDown={onKeyDown}>
        <header className="panel-header">
          <Icon name="settings" />
          <h1>Configurações</h1>
          <button className="panel-close" onClick={onBack} aria-label="Fechar" title="Fechar" tabIndex={-1}>
            <Icon name="close" />
          </button>
        </header>

        <nav className="panel-cats" aria-label="Categorias">
          <button data-nav data-hub-link data-autofocus={focusSchedule ? '' : undefined} className="cat cat-link" onClick={onSchedule}>
            <Icon name="calendar" className="cat-icon" />
            <span>Programação</span>
            <Icon name="chevronRight" className="cat-chevron" />
          </button>
          {CATEGORIES.map((entry) => (
            <button
              key={entry.id}
              data-nav
              data-autofocus={entry.id === current.id && !focusSchedule ? '' : undefined}
              data-cat={entry.id}
              className="cat"
              aria-current={entry.id === current.id}
              onFocus={() => setCategory(entry.id)}
              onClick={() => {
                setCategory(entry.id);
                // The options of the new category are drawn on the next frame.
                requestAnimationFrame(enterBody);
              }}
            >
              <Icon name={entry.icon} className="cat-icon" />
              <span>{entry.label}</span>
            </button>
          ))}
        </nav>

        <div className="panel-body" ref={body} key={current.id}>
          <h2>{current.label}</h2>

          {current.id === 'theme' && (
            <>
              <div className="theme-cards" role="radiogroup" aria-label="Tema">
                {THEME_ORDER.map((theme) => (
                  <button
                    key={theme}
                    data-nav
                    data-theme-card={theme}
                    role="radio"
                    aria-checked={settings.theme === theme}
                    className="theme-card"
                    onClick={() => apply(applyTheme(theme))}
                  >
                    <ThemePreview theme={theme} />
                    <span className="theme-name">
                      {THEME_LABELS[theme]}
                      {settings.theme === theme && <Icon name="check" className="theme-check" />}
                    </span>
                  </button>
                ))}
              </div>
              <p className="theme-description">{THEME_DESCRIPTIONS[settings.theme]}</p>
            </>
          )}

          {current.rows.map((key) => (
            <SettingRow
              key={key}
              item={defs[key]!}
              origin={originOf(defs[key]!, overrides, fromLibrary)}
              apply={apply}
            />
          ))}

          {current.id === 'ads' && settings.commercials === false && (
            <p className="panel-note">Os comerciais estão desligados em “Como a TV passa”, então estes ajustes ficam bloqueados.</p>
          )}

          {current.id === 'about' && (
            <About
              libraryName={libraryName}
              channelCount={channels.length}
              restored={restored}
              onRestore={() => {
                reset();
                setRestored(true);
              }}
            />
          )}
        </div>

        <KeyHints
          hints={[
            ['↑ ↓', 'escolher'],
            ['← →', 'mudar'],
            ['OK', 'confirmar'],
            ['Voltar', 'recuar'],
          ]}
        />
      </div>
    </Overlay>
  );
}

function SettingRow({ item, origin, apply }: { item: SettingDef; origin: string | null; apply(partial: PartialSettings): void }) {
  const { settings } = useSettings();
  const value = item.get(settings);
  const label = valueLabel(item, settings);
  // The value's box is as wide as its longest possible text, so changing it never moves the arrows, the slider or
  // the wrapped text next to it (the pointer is usually right on top of them). Long lists (channel names) get a fixed box instead.
  const widest = widestValue(item);
  const valueWidth = widest <= MAX_RESERVED_VALUE ? `${(widest * 1.15).toFixed(1)}ch` : undefined;
  // A greyed-out row (its parent setting is off) stays focusable so the remote can reach it, but nothing changes it.
  const dimmed = item.dimmed?.(settings) ?? false;

  const onKeyDown = (event: KeyboardEvent) => {
    if (dimmed || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    event.preventDefault();
    if (item.kind === 'switch') {
      if (value !== (direction === 1)) apply(item.set(direction === 1));
    } else if (item.kind === 'range') {
      const next = stepped(item, settings, direction);
      if (next) apply(next);
    } else apply(cycled(item, settings, direction));
  };

  const amountAt = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return box.width > 0 ? (event.clientX - box.left) / box.width : 0;
  };
  const dragTo = (event: PointerEvent<HTMLElement>) => {
    if (dimmed) return;
    const next = rangeAt(item, settings, amountAt(event));
    if (next) apply(next);
  };

  return (
    <button
      data-nav
      data-nav-adjust
      data-setting={item.key}
      className={`row row-${item.kind} ${dimmed ? 'dimmed' : ''}`}
      role={item.kind === 'switch' ? 'switch' : undefined}
      aria-checked={item.kind === 'switch' ? (value as boolean) : undefined}
      aria-disabled={dimmed || undefined}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (dimmed) return;
        if (item.kind === 'range') {
          // Enter/OK (detail 0) steps up and wraps; pointer clicks are handled on the track.
          if (event.detail === 0) apply(steppedWrapping(item, settings));
          return;
        }
        // A pointer click on the left half of a selector's value (the ‹ arrow) goes back; anywhere else goes forward.
        const selector = event.detail > 0 && item.kind === 'select' ? (event.target as Element).closest('.selector') : null;
        apply(cycled(item, settings, selector ? clickDirection(selector, event.clientX) : 1));
      }}
    >
      <Icon name={item.icon} className="row-lead" />
      <span className="row-text">
        <span className="row-label">{item.label}</span>
        {item.hint && <span className="row-meta">{item.hint}</span>}
        {/* Always one line, so a value changing (and its origin tag appearing) never moves the controls under the pointer. */}
        <span className="row-meta row-origin">
          {dimmed ? (
            <em className="from-lock">{item.dimmedReason}</em>
          ) : (
            <em className={origin === 'alterado por você' ? 'from-user' : origin === 'da biblioteca' ? 'from-library' : 'from-default'}>
              {origin ?? 'padrão'}
            </em>
          )}
        </span>
      </span>

      {item.kind === 'switch' && (
        <span className="row-control">
          <span className="row-state">{label}</span>
          <span className="switch" data-on={value as boolean} aria-hidden="true">
            <i />
          </span>
        </span>
      )}
      {item.kind === 'select' && (
        <span className="row-control selector">
          <Icon name="chevronLeft" className="selector-arrow" />
          <strong
            // Long lists (channel names) get one fixed box, too long names are cut: the row never re-wraps.
            style={valueWidth ? { minWidth: `max(calc(3.6 * var(--u)), ${valueWidth})` } : { width: '16ch', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={valueWidth ? undefined : label}
          >
            {label}
          </strong>
          <Icon name="chevronRight" className="selector-arrow" />
        </span>
      )}
      {item.kind === 'range' && (
        <>
          <span className="row-control">
            <strong style={{ minWidth: valueWidth, textAlign: 'right' }}>{label}</strong>
          </span>
          <span
            className="range-track"
            role="slider"
            aria-label={item.label}
            aria-valuemin={item.range!.min}
            aria-valuemax={item.range!.max}
            aria-valuenow={value as number}
            aria-valuetext={label}
            onPointerDown={(event) => {
              if (dimmed) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragTo(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) dragTo(event);
            }}
          >
            <span className="range-rail">
              <span className="range-fill" style={{ width: `${rangeFraction(item, settings) * 100}%` }} />
            </span>
            <span className="range-thumb" style={{ left: `${rangeFraction(item, settings) * 100}%` }} />
          </span>
        </>
      )}
    </button>
  );
}

/** Characters in the longest text a setting's value can show. */
function widestValue(item: SettingDef): number {
  if (item.kind === 'range') {
    const { min, max, format } = item.range!;
    return Math.max(format(min).length, format(max).length);
  }
  return Math.max(...item.options.map((option) => option.label.length));
}

/** A tiny sample of what a theme's on-screen display looks like. */
function ThemePreview({ theme }: { theme: Theme }) {
  return (
    <span className={`theme-preview preview-${theme}`} aria-hidden="true">
      {theme === 'classic' && (
        <>
          <b>CH 03</b>
          <small>TV Gominho</small>
        </>
      )}
      {theme === 'vhs' && (
        <>
          <b>
            PLAY<i className="osd-triangle" />
          </b>
          <small>SP 0:12:04</small>
        </>
      )}
      {theme === 'modern' && (
        <span className="preview-pill">
          <b>03</b>
          <small>TV Gominho</small>
        </span>
      )}
      {theme === 'custom' && <Icon name="settings" />}
    </span>
  );
}

function About({
  libraryName,
  channelCount,
  restored,
  onRestore,
}: {
  libraryName: string;
  channelCount: number;
  restored: boolean;
  onRestore(): void;
}) {
  return (
    <div className="about">
      <p className="about-lib">
        <strong>TV Gominho</strong>
        <span>
          Biblioteca “{libraryName}” · {channelCount} {channelCount === 1 ? 'canal' : 'canais'}
        </span>
      </p>
      <dl className="about-keys">
        <dt>↑ ↓</dt>
        <dd>trocar de canal</dd>
        <dt>OK</dt>
        <dd>o que está passando</dd>
        <dt>Voltar</dt>
        <dd>abrir o menu</dd>
        <dt>S · ← →</dt>
        <dd>ajustes rápidos</dd>
      </dl>
      <button data-nav className="row row-action" onClick={onRestore}>
        <Icon name="restore" className="row-icon" />
        <span className="row-text">
          <span className="row-label">Restaurar padrões</span>
          <span className="row-meta">
            {restored
              ? 'Pronto: voltou ao que a biblioteca define (ou ao padrão do aplicativo).'
              : 'Apaga os ajustes feitos aqui. Eles ficam salvos só neste navegador, para esta biblioteca.'}
          </span>
        </span>
      </button>
    </div>
  );
}
