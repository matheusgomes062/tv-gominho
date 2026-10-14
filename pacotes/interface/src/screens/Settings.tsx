import type { PartialSettings, Schedule, Settings } from '@tv-chuvisco/nucleo';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { focusFirst, useSpatialNav } from '../nav';
import { useSettings } from '../settings';

interface Props {
  /** The channels, to choose `canal_inicial` among. */
  channels: Schedule[];
  onBack(): void;
}

interface Option<V> {
  value: V;
  label: string;
}

/** One row of the screen: a setting with a short list of values to cycle through. */
interface Row {
  /** Path inside Settings, e.g. "aspect" or "crt.enabled". */
  key: string;
  label: string;
  hint?: string;
  /** Shown indented, under the setting it depends on. */
  indent?: boolean;
  options: Option<unknown>[];
  get(settings: Settings): unknown;
  set(value: unknown): PartialSettings;
}

interface Group {
  title: string;
  rows: Row[];
}

function row<V>(definition: {
  key: string;
  label: string;
  hint?: string;
  indent?: boolean;
  options: Option<NoInfer<V>>[];
  get(settings: Settings): V;
  set(value: NoInfer<V>): PartialSettings;
}): Row {
  return definition as Row;
}

const YES_NO: Option<boolean>[] = [
  { value: true, label: 'Sim' },
  { value: false, label: 'Não' },
];

function buildGroups(channels: Schedule[], current: string | null): Group[] {
  const channelOptions: Option<string | null>[] = [
    { value: null, label: 'O primeiro' },
    ...channels.map((channel) => ({ value: channel.name as string | null, label: channel.name })),
  ];
  // A name from configuracoes.yaml that matches no channel name (e.g. a file id) still has to show up.
  if (current !== null && !channelOptions.some((option) => option.value === current)) {
    channelOptions.push({ value: current, label: current });
  }

  return [
    {
      title: 'Canal',
      rows: [
        row({
          key: 'startMode',
          label: 'Ao abrir, mostrar',
          options: [
            { value: 'tv', label: 'TV' },
            { value: 'library', label: 'Biblioteca' },
          ],
          get: (s) => s.startMode,
          set: (startMode) => ({ startMode }),
        }),
        row({
          key: 'startChannel',
          label: 'Canal inicial',
          hint: 'Só vale quando você ainda não escolheu um canal neste navegador.',
          options: channelOptions,
          get: (s) => s.startChannel,
          set: (startChannel) => ({ startChannel }),
        }),
        row({
          key: 'channelsPerShow',
          label: 'Um canal para cada programa',
          options: YES_NO,
          get: (s) => s.channelsPerShow,
          set: (channelsPerShow) => ({ channelsPerShow }),
        }),
        row({
          key: 'channelChangeStatic',
          label: 'Chuvisco ao trocar de canal',
          options: YES_NO,
          get: (s) => s.channelChangeStatic,
          set: (channelChangeStatic) => ({ channelChangeStatic }),
        }),
      ],
    },
    {
      title: 'Imagem',
      rows: [
        row({
          key: 'aspect',
          label: 'Proporção da tela',
          options: [
            { value: '4:3', label: '4:3' },
            { value: 'stretch', label: 'Esticar' },
            { value: 'original', label: 'Original' },
          ],
          get: (s) => s.aspect,
          set: (aspect) => ({ aspect }),
        }),
        row({
          key: 'crt.enabled',
          label: 'Efeito de TV de tubo (CRT)',
          options: YES_NO,
          get: (s) => s.crt.enabled,
          set: (enabled) => ({ crt: { enabled } }),
        }),
        row({
          key: 'crt.intensity',
          label: 'Intensidade do efeito',
          indent: true,
          options: [
            { value: 'soft', label: 'Suave' },
            { value: 'medium', label: 'Média' },
            { value: 'strong', label: 'Forte' },
          ],
          get: (s) => s.crt.intensity,
          set: (intensity) => ({ crt: { intensity } }),
        }),
        row({
          key: 'crt.curvature',
          label: 'Tela curva',
          indent: true,
          options: YES_NO,
          get: (s) => s.crt.curvature,
          set: (curvature) => ({ crt: { curvature } }),
        }),
        row({
          key: 'crt.scanlines',
          label: 'Linhas de varredura',
          indent: true,
          options: YES_NO,
          get: (s) => s.crt.scanlines,
          set: (scanlines) => ({ crt: { scanlines } }),
        }),
        row({
          key: 'clock',
          label: 'Relógio na tela',
          options: YES_NO,
          get: (s) => s.clock,
          set: (clock) => ({ clock }),
        }),
      ],
    },
    {
      title: 'Programação',
      rows: [
        row({
          key: 'schedule',
          label: 'Horário da programação',
          options: [
            { value: 'continuous', label: 'Contínuo' },
            { value: 'real', label: 'Horário real' },
            { value: 'fromStart', label: 'Do início' },
          ],
          get: (s) => s.schedule,
          set: (schedule) => ({ schedule }),
        }),
        row({
          key: 'interstitials',
          label: 'Vinhetas',
          options: YES_NO,
          get: (s) => s.interstitials,
          set: (interstitials) => ({ interstitials }),
        }),
        row({
          key: 'commercials',
          label: 'Comerciais',
          options: YES_NO,
          get: (s) => s.commercials,
          set: (commercials) => ({ commercials }),
        }),
      ],
    },
  ];
}

function isSet(partial: PartialSettings, key: string): boolean {
  const [first, second] = key.split('.') as [string, string | undefined];
  const value = (partial as Record<string, unknown>)[first];
  if (second === undefined) return value !== undefined;
  return (value as Record<string, unknown> | undefined)?.[second] !== undefined;
}

export function SettingsScreen({ channels, onBack }: Props) {
  const { settings, overrides, fromLibrary, update, reset } = useSettings();
  const [restored, setRestored] = useState(false);
  useSpatialNav(onBack);
  // Start on the first setting rather than on the Back button.
  useEffect(() => focusFirst(document.querySelector('.setting-list') ?? document), []);

  const groups = useMemo(() => buildGroups(channels, settings.startChannel), [channels, settings.startChannel]);

  const cycle = (item: Row, direction: 1 | -1) => {
    const index = item.options.findIndex((option) => option.value === item.get(settings));
    const next = item.options[(index + direction + item.options.length) % item.options.length]!;
    update(item.set(next.value));
    setRestored(false);
  };

  // Left/Right change the value (nav.ts leaves them alone on [data-nav-adjust]); Enter clicks, which goes forward.
  const onKeyDown = (item: Row) => (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') cycle(item, -1);
    else if (event.key === 'ArrowRight') cycle(item, 1);
    else return;
    event.preventDefault();
  };

  return (
    <main className="page settings">
      <header className="page-header">
        <button data-nav className="button" onClick={onBack}>
          ← Voltar
        </button>
        <h1>Configurações</h1>
      </header>

      {groups.map((group) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
          <div className="setting-list">
            {group.rows.map((item) => {
              const value = item.get(settings);
              const label = item.options.find((option) => option.value === value)?.label ?? String(value);
              const origin = isSet(overrides, item.key)
                ? 'alterado por você'
                : isSet(fromLibrary, item.key)
                  ? 'da biblioteca'
                  : null;
              return (
                <button
                  key={item.key}
                  data-nav
                  data-nav-adjust
                  data-setting={item.key}
                  className={`setting-row ${item.indent ? 'indent' : ''}`}
                  onClick={() => cycle(item, 1)}
                  onKeyDown={onKeyDown(item)}
                >
                  <span className="setting-text">
                    <span className="setting-label">{item.label}</span>
                    {item.hint && <span className="setting-hint">{item.hint}</span>}
                  </span>
                  {origin && <span className="setting-origin">{origin}</span>}
                  <span className="setting-value">
                    <span aria-hidden="true">‹</span>
                    <strong>{label}</strong>
                    <span aria-hidden="true">›</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <section>
        <button
          data-nav
          className="button"
          onClick={() => {
            reset();
            setRestored(true);
          }}
        >
          Restaurar padrões
        </button>
        <p className="muted">
          {restored
            ? 'Pronto: voltou ao que a biblioteca define (ou ao padrão do aplicativo).'
            : 'Apaga as escolhas feitas aqui. Elas ficam salvas só neste navegador, para esta biblioteca.'}
        </p>
      </section>

      <p className="muted keys">↑ ↓ escolhem a opção · ← → (ou OK) mudam o valor · Esc volta ao menu</p>
    </main>
  );
}
