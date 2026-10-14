import { applyTheme, type PartialSettings, type Schedule, type Theme } from '@tv-chuvisco/nucleo';
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from '../components/Icon';
import { KeyHints, Overlay } from '../components/Overlay';
import { BACK_KEYS } from '../nav';
import { useSettings } from '../settings';
import {
  buildDefs,
  CATEGORIES,
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
  onBack(): void;
}

const THEME_ORDER: Theme[] = ['classic', 'vhs', 'modern', 'custom'];

/**
 * The full settings panel, on the left of the live picture: categories in one column, the options of the
 * chosen category in the next. Changes apply to the picture at once. Back goes from the options to the
 * categories, and from the categories closes the panel.
 */
export function SettingsPanel({ channels, libraryName, initialCategory = 'theme', onBack }: Props) {
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
    if (inBody && BACK_KEYS.has(event.key)) leaveBody();
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
          <h1>Configurações</h1>
        </header>

        <nav className="panel-cats" aria-label="Categorias">
          {CATEGORIES.map((entry) => (
            <button
              key={entry.id}
              data-nav
              data-autofocus={entry.id === current.id ? '' : undefined}
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
            <p className="panel-note">Os comerciais estão desligados em Programação, então estes ajustes não têm efeito.</p>
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
  const dimmed = item.dimmed?.(settings) ?? false;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
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
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (item.kind === 'range') {
          // Enter/OK (detail 0) steps up and wraps; pointer clicks are handled on the track.
          if (event.detail === 0) apply(steppedWrapping(item, settings));
        } else apply(cycled(item, settings, 1));
      }}
    >
      <span className="row-text">
        <span className="row-label">{item.label}</span>
        {item.hint && <span className="row-meta">{item.hint}</span>}
        {origin && (
          <span className="row-meta">
            <em className={origin === 'da biblioteca' ? 'from-library' : 'from-user'}>{origin}</em>
          </span>
        )}
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
          <strong>{label}</strong>
          <Icon name="chevronRight" className="selector-arrow" />
        </span>
      )}
      {item.kind === 'range' && (
        <>
          <span className="row-control">
            <strong>{label}</strong>
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
              event.currentTarget.setPointerCapture(event.pointerId);
              dragTo(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) dragTo(event);
            }}
          >
            <span className="range-fill" style={{ width: `${rangeFraction(item, settings) * 100}%` }} />
            <span className="range-thumb" style={{ left: `${rangeFraction(item, settings) * 100}%` }} />
          </span>
        </>
      )}
    </button>
  );
}

/** A tiny sample of what a theme's on-screen display looks like. */
function ThemePreview({ theme }: { theme: Theme }) {
  return (
    <span className={`theme-preview preview-${theme}`} aria-hidden="true">
      {theme === 'classic' && (
        <>
          <b>CH 03</b>
          <small>TV Globinho</small>
        </>
      )}
      {theme === 'vhs' && (
        <>
          <b>PLAY ▶</b>
          <small>SP 0:12:04</small>
        </>
      )}
      {theme === 'modern' && (
        <span className="preview-pill">
          <b>03</b>
          <small>TV Globinho</small>
        </span>
      )}
      {theme === 'custom' && <Icon name="gear" />}
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
        <strong>TV Chuvisco</strong>
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
