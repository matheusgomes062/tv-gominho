import {
  formatTimeOfDay,
  generateSchedule,
  localIsoDate,
  scheduleToYaml,
  type Weekday,
  type Library,
  type Schedule,
} from '@tv-gominho/nucleo';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { KeyHints, Overlay } from '../components/Overlay';
import type { Durations } from '../media';
import { clickDirection } from '../settings-model';
import { downloadText, requestWriteAccess, saveGrade, type SaveResult } from '../sources/save';
import type { BrowserLibrary } from '../sources/types';
import {
  DAY_LABELS,
  DAY_ORDER,
  DAY_PRESETS,
  MAX_NAME_LENGTH,
  MAX_RANGES,
  RANGE_PRESETS,
  STEPS,
  addRange,
  applyPreset,
  daysSummary,
  existingGradeFiles,
  formatRange,
  initialState,
  moveRangeEdge,
  movePicked,
  nextStep,
  previousStep,
  removeRange,
  sortedRanges,
  stepIndex,
  stepProblem,
  toGenerateOptions,
  togglePicked,
  toggleDay,
  uniqueFileName,
  type PresetId,
  type StepId,
  type WizardState,
} from '../wizard-model';

interface Props {
  source: BrowserLibrary;
  library: Library;
  durations: Durations;
  channels: Schedule[];
  /** Reads the library again after a channel was written into the folder; false if that failed. */
  onSaved(): Promise<boolean>;
  /** Tunes the channel with this id (the grade file name) and closes the wizard. */
  onWatch(channelId: string): void;
  onBack(): void;
}

type Phase = { name: 'editing' } | { name: 'saving' } | { name: 'done'; result: SaveResult; reread: boolean };

/** How long saving waits for video durations before it goes with typical lengths for the rest. */
const DURATION_WAIT_MS = 12_000;
const SAMPLE_EPISODES = 12;

/**
 * "Montar a semana": a short sequence of steps (time ranges, days, shows, name, save) that builds a new
 * channel with the same generator as `tv-gominho grade` and saves it as a file in grades/. Everything is
 * reachable with arrows, OK and Back; Back goes one step back, and from the first step closes the wizard.
 */
export function WeekWizard({ source, library, durations, channels, onSaved, onWatch, onBack }: Props) {
  const [step, setStep] = useState<StepId>('ranges');
  const [state, setState] = useState<WizardState>(initialState);
  const [phase, setPhase] = useState<Phase>({ name: 'editing' });
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  const playable = useMemo(() => library.shows.filter((show) => show.episodes.length > 0), [library]);
  const taken = useMemo(
    () => [...existingGradeFiles(source.files, library.root), ...library.schedules.map((schedule) => schedule.id)],
    [source, library],
  );
  const fileName = uniqueFileName(state.name, taken);
  const problem = stepProblem(step, state, playable.length);
  const change = (patch: Partial<WizardState>) => setState((current) => ({ ...current, ...patch }));

  // Each step starts with focus on its first choice (or the one marked data-autofocus).
  useEffect(() => {
    const container = body.current;
    if (!container) return;
    // A step with nothing to choose (the summary) starts on the button that moves on.
    const target =
      container.querySelector<HTMLElement>('[data-autofocus]') ??
      container.querySelector<HTMLElement>('[data-nav]') ??
      container.parentElement?.querySelector<HTMLElement>('[data-save], [data-next]');
    target?.focus();
  }, [step, phase.name]);

  const goBack = () => {
    if (phase.name === 'saving') return;
    if (phase.name === 'done') return onBack();
    setError(null);
    const before = previousStep(step);
    if (before) setStep(before);
    else onBack();
  };
  const goOn = () => {
    if (problem) return;
    setStep(nextStep(step));
  };

  async function save() {
    setError(null);
    setPhase({ name: 'saving' });
    // First of all: the permission prompt needs the click that got us here, which long waits below would lose.
    const access = await requestWriteAccess(source);
    try {
      const wanted = state.showMode === 'pick' ? new Set(state.picked) : null;
      const episodes = playable
        .filter((show) => !wanted || wanted.has(show.id))
        .flatMap((show) => show.episodes.slice(0, SAMPLE_EPISODES).map((episode) => episode.path));
      const paths = [...episodes, ...library.interstitials.map((item) => item.path)];
      await Promise.race([durations.load(paths), new Promise((resolve) => setTimeout(resolve, DURATION_WAIT_MS))]);

      const today = localIsoDate(new Date());
      const generated = generateSchedule(library, durations.get, toGenerateOptions(state, today));
      const yaml = scheduleToYaml(generated, [
        `Montada pelo assistente "Montar a semana" em ${today}. Pode editar à vontade (veja docs/grade.md).`,
        'Os horários nos comentários são estimativas, com os intervalos comerciais.',
      ]);
      const result = await saveGrade(source, library, access, state.name.trim(), yaml, taken);
      const reread = result.kind === 'written' ? await onSaved().catch(() => false) : true;
      setPhase({ name: 'done', result, reread });
    } catch (failure) {
      setError(`Não foi possível montar o canal: ${(failure as Error).message}`);
      setPhase({ name: 'editing' });
    }
  }

  const last = step === 'save';
  const index = stepIndex(step);

  return (
    <Overlay edge="left" label="Montar a semana" onBack={goBack} className="wizard-overlay">
      <div className="wizard">
        <header className="panel-header">
          <Icon name="calendar" />
          <h1>Montar a semana</h1>
          <button className="panel-close" onClick={onBack} aria-label="Fechar" title="Fechar" tabIndex={-1} disabled={phase.name === 'saving'}>
            <Icon name="close" />
          </button>
        </header>

        <ol className="wizard-steps" aria-label="Passos">
          {STEPS.map((entry, i) => (
            <li key={entry.id} aria-current={i === index ? 'step' : undefined} className={i < index ? 'past' : i === index ? 'current' : ''}>
              <span className="wizard-step-number">{i < index ? <Icon name="check" /> : i + 1}</span>
              <span className="wizard-step-title">{entry.title}</span>
            </li>
          ))}
        </ol>

        <div className="wizard-body" ref={body} key={`${step}-${phase.name}`}>
          {phase.name === 'done' ? (
            <DonePage result={phase.result} reread={phase.reread} onWatch={() => onWatch(phase.result.fileName)} onClose={onBack} />
          ) : phase.name === 'saving' ? (
            <p className="wizard-busy" role="status">
              Montando o canal… Lendo a duração dos vídeos para os horários fecharem certinho.
            </p>
          ) : (
            <>
              <h2>{STEPS[index]!.help}</h2>
              {step === 'ranges' && <RangesStep state={state} onChange={setState} />}
              {step === 'days' && <DaysStep state={state} onChange={change} />}
              {step === 'shows' && <ShowsStep state={state} library={library} shows={playable} onChange={change} />}
              {step === 'name' && <NameStep state={state} fileName={fileName} onChange={change} onEnter={goOn} />}
              {step === 'save' && <SummaryStep state={state} fileName={fileName} library={library} channels={channels} />}
              {(problem ?? error) && (
                <p className="wizard-problem" role="alert">
                  {problem ?? error}
                </p>
              )}
            </>
          )}
        </div>

        {phase.name === 'editing' && (
          <footer className="wizard-footer">
            <button data-nav className="action-tile" onClick={goBack}>
              <Icon name="back" className="action-icon" />
              <span>{index === 0 ? 'Cancelar' : 'Voltar'}</span>
            </button>
            {last ? (
              <button data-nav data-save className="action-tile primary" onClick={save}>
                <Icon name="check" className="action-icon" />
                <span>Salvar canal</span>
              </button>
            ) : (
              <button data-nav data-next className="action-tile primary" aria-disabled={problem ? true : undefined} onClick={goOn}>
                <span>Avançar</span>
                <Icon name="chevronRight" className="action-icon" />
              </button>
            )}
          </footer>
        )}

        <KeyHints
          hints={[
            ['↑ ↓', 'escolher'],
            ['← →', 'mudar'],
            ['OK', 'confirmar'],
            ['Voltar', index === 0 || phase.name === 'done' ? 'fechar' : 'passo anterior'],
          ]}
        />
      </div>
    </Overlay>
  );
}

// ---------------------------------------------------------------- rows

interface RowProps {
  icon: IconName;
  label: string;
  meta?: string;
  /** A radio/checkbox style row, with its state shown on the right. */
  role?: 'radio' | 'checkbox';
  checked?: boolean;
  autofocus?: boolean;
  children?: ReactNode;
  onClick(event: React.MouseEvent<HTMLButtonElement>): void;
  onKeyDown?(event: KeyboardEvent<HTMLButtonElement>): void;
  /** The row keeps Left/Right for itself (see nav.ts). */
  adjust?: boolean;
  data?: string;
}

function Row({ icon, label, meta, role, checked, autofocus, children, onClick, onKeyDown, adjust, data }: RowProps) {
  return (
    <button
      data-nav
      data-nav-adjust={adjust ? '' : undefined}
      data-autofocus={autofocus ? '' : undefined}
      data-wizard={data}
      className="row wizard-row"
      role={role}
      aria-checked={role ? Boolean(checked) : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <Icon name={icon} className="row-lead" />
      <span className="row-text">
        <span className="row-label">{label}</span>
        {meta && <span className="row-meta">{meta}</span>}
      </span>
      {children ?? (role && <span className="wizard-mark" data-on={Boolean(checked)}>{checked && <Icon name="check" />}</span>)}
    </button>
  );
}

/** A value with ‹ › arrows, changed by Left/Right, by OK (forward) or by clicking its left/right half. */
function Stepper({ icon, label, value, onStep, data, autofocus }: { icon: IconName; label: string; value: string; onStep(direction: 1 | -1): void; data?: string; autofocus?: boolean }) {
  return (
    <Row
      icon={icon}
      label={label}
      adjust
      data={data}
      autofocus={autofocus}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        onStep(event.key === 'ArrowLeft' ? -1 : 1);
      }}
      onClick={(event) => {
        const selector = event.detail > 0 ? (event.target as Element).closest('.selector') : null;
        onStep(selector ? clickDirection(selector, event.clientX) : 1);
      }}
    >
      <span className="row-control selector">
        <Icon name="chevronLeft" className="selector-arrow" />
        <strong>{value}</strong>
        <Icon name="chevronRight" className="selector-arrow" />
      </span>
    </Row>
  );
}

// ---------------------------------------------------------------- steps

function RangesStep({ state, onChange }: { state: WizardState; onChange(update: (state: WizardState) => WizardState): void }) {
  const choose = (preset: PresetId) => onChange((current) => applyPreset(current, preset));
  return (
    <>
      <div role="radiogroup" aria-label="Faixas de horário" className="wizard-list">
        {RANGE_PRESETS.map((preset) => (
          <Row
            key={preset.id}
            icon="clock"
            role="radio"
            autofocus={preset.id === state.preset}
            checked={preset.id === state.preset}
            label={preset.label}
            meta={preset.id === 'custom' ? 'Até 3 faixas, com os horários que você escolher.' : preset.ranges.map(formatRange).join(' e ')}
            data={preset.id}
            onClick={() => choose(preset.id)}
          />
        ))}
      </div>

      {state.preset === 'custom' && (
        <div className="wizard-list" aria-label="Suas faixas">
          {state.ranges.map((range, i) => (
            <div className="wizard-range" key={i}>
              <Stepper
                icon="clock"
                label={`Faixa ${i + 1}: começa às`}
                value={formatTimeOfDay(range.start)}
                data={`start-${i}`}
                onStep={(direction) => onChange((current) => ({ ...current, ranges: moveRangeEdge(current.ranges, i, 'start', direction) }))}
              />
              <Stepper
                icon="clock"
                label={`Faixa ${i + 1}: termina às`}
                value={formatTimeOfDay(range.end)}
                data={`end-${i}`}
                onStep={(direction) => onChange((current) => ({ ...current, ranges: moveRangeEdge(current.ranges, i, 'end', direction) }))}
              />
              {state.ranges.length > 1 && (
                <button data-nav className="action-tile small" onClick={() => onChange((current) => ({ ...current, ranges: removeRange(current.ranges, i) }))}>
                  <Icon name="close" className="action-icon" />
                  <span>Tirar a faixa {i + 1}</span>
                </button>
              )}
            </div>
          ))}
          {state.ranges.length < MAX_RANGES && (
            <button data-nav data-add-range className="action-tile small" onClick={() => onChange((current) => ({ ...current, ranges: addRange(current.ranges) }))}>
              <Icon name="plus" className="action-icon" />
              <span>Adicionar uma faixa</span>
            </button>
          )}
        </div>
      )}
      {state.preset !== 'custom' && (
        <p className="panel-note">No ar: {sortedRanges(state.ranges).map(formatRange).join(' e ')}. Escolha “Faixas próprias” para ajustar os horários.</p>
      )}
    </>
  );
}

function DaysStep({ state, onChange }: { state: WizardState; onChange(patch: Partial<WizardState>): void }) {
  const same = (days: Weekday[]) => days.length === state.days.length && days.every((day) => state.days.includes(day));
  return (
    <>
      <div className="wizard-chips" aria-label="Atalhos">
        {DAY_PRESETS.map((preset) => (
          <button
            key={preset.id}
            data-nav
            data-autofocus={same(preset.days) ? '' : undefined}
            data-days-preset={preset.id}
            className="action-tile"
            aria-pressed={same(preset.days)}
            onClick={() => onChange({ days: [...preset.days] })}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="wizard-chips" role="group" aria-label="Dias da semana">
        {DAY_ORDER.map((day) => {
          const on = state.days.includes(day);
          return (
            <button
              key={day}
              data-nav
              data-day={day}
              role="checkbox"
              aria-checked={on}
              className="action-tile day-chip"
              onClick={() => onChange({ days: toggleDay(state.days, day) })}
            >
              {on && <Icon name="check" className="action-icon" />}
              <span>{DAY_LABELS[day]}</span>
            </button>
          );
        })}
      </div>
      <p className="panel-note">O canal passa só nos dias marcados. Nos outros, a TV reprisa o último dia, como nas outras grades.</p>
    </>
  );
}

function ShowsStep({
  state,
  library,
  shows,
  onChange,
}: {
  state: WizardState;
  library: Library;
  shows: Library['shows'];
  onChange(patch: Partial<WizardState>): void;
}) {
  const picking = state.showMode === 'pick';
  const titleOf = new Map(library.shows.map((show) => [show.id, show.title]));
  return (
    <>
      <div role="radiogroup" aria-label="Quais programas" className="wizard-list">
        <Row
          icon="episode"
          role="radio"
          autofocus={!picking}
          checked={!picking}
          label="Todos os programas"
          meta={`${shows.length} ${shows.length === 1 ? 'programa' : 'programas'}, em rodízio na ordem que o app escolhe.`}
          data="all"
          onClick={() => onChange({ showMode: 'all' })}
        />
        <Row
          icon="episode"
          role="radio"
          autofocus={picking}
          checked={picking}
          label="Escolher os programas"
          meta="Você marca os que entram e a ordem do rodízio."
          data="pick"
          onClick={() => onChange({ showMode: 'pick' })}
        />
      </div>

      {picking && (
        <div className="wizard-list" role="group" aria-label="Programas">
          {shows.map((show) => {
            const position = state.picked.indexOf(show.id);
            const on = position >= 0;
            const move = (direction: 1 | -1) => onChange({ picked: movePicked(state.picked, show.id, direction) });
            return (
              <Row
                key={show.id}
                icon="episode"
                role="checkbox"
                checked={on}
                adjust={on}
                data={`show-${show.id}`}
                label={titleOf.get(show.id) ?? show.id}
                meta={`${show.episodes.length} ${show.episodes.length === 1 ? 'episódio' : 'episódios'}`}
                onKeyDown={(event) => {
                  if (!on || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
                  event.preventDefault();
                  move(event.key === 'ArrowLeft' ? -1 : 1);
                }}
                onClick={(event) => {
                  // The “‹ 2 ›” order box moves the show; anywhere else marks or unmarks it.
                  const selector = on && event.detail > 0 ? (event.target as Element).closest('.selector') : null;
                  if (selector) move(clickDirection(selector, event.clientX));
                  else onChange({ picked: togglePicked(state.picked, show.id) });
                }}
              >
                {on ? (
                  <span className="row-control selector" title="Ordem no rodízio: ← antes, → depois">
                    <Icon name="chevronLeft" className="selector-arrow" />
                    <strong>{position + 1}</strong>
                    <Icon name="chevronRight" className="selector-arrow" />
                  </span>
                ) : (
                  <span className="wizard-mark" data-on="false" />
                )}
              </Row>
            );
          })}
          <p className="panel-note">Os programas passam em rodízio na ordem dos números. Com a seta ← ou → no programa marcado, ele passa para antes ou depois.</p>
        </div>
      )}
    </>
  );
}

function NameStep({ state, fileName, onChange, onEnter }: { state: WizardState; fileName: string; onChange(patch: Partial<WizardState>): void; onEnter(): void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Backspace deletes a letter here; it must not reach the "go back" key handling of the overlay.
    if (event.key === 'Backspace') event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      onEnter();
    }
  };
  return (
    <>
      <label className="wizard-field">
        <span className="row-label">Nome do canal</span>
        <input
          data-nav
          data-nav-adjust
          data-autofocus
          data-name
          type="text"
          value={state.name}
          maxLength={MAX_NAME_LENGTH + 10}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange({ name: event.target.value })}
          onKeyDown={onKeyDown}
          onFocus={(event) => event.target.select()}
        />
      </label>
      <p className="panel-note">
        O canal sempre é novo: nada que já existe é trocado. O arquivo vai se chamar <code>grades/{fileName}.yaml</code>.
      </p>
    </>
  );
}

function SummaryStep({ state, fileName, library, channels }: { state: WizardState; fileName: string; library: Library; channels: Schedule[] }) {
  const shows =
    state.showMode === 'all'
      ? 'Todos os programas'
      : state.picked.map((id) => library.shows.find((show) => show.id === id)?.title ?? id).join(' → ');
  const lines: Array<[string, string]> = [
    ['Canal', state.name.trim()],
    ['Horários', sortedRanges(state.ranges).map(formatRange).join(' e ')],
    ['Dias', daysSummary(state.days)],
    ['Programas', shows],
    ['Arquivo', `${library.root}grades/${fileName}.yaml`],
  ];
  return (
    <>
      <dl className="wizard-summary">
        {lines.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="panel-note">
        Hoje a biblioteca tem {channels.length} {channels.length === 1 ? 'canal' : 'canais'}; este será mais um.
        No Chrome e no Edge, o app pede permissão para gravar na pasta só quando você salva. Nos outros casos, o arquivo é baixado.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- result

const REASONS: Record<'no-folder' | 'denied' | 'failed', string> = {
  'no-folder': 'Este navegador, ou o jeito como a biblioteca foi aberta, não deixa o app gravar na pasta.',
  denied: 'A permissão para gravar na pasta não foi dada.',
  failed: 'Não deu para gravar na pasta.',
};

function DonePage({ result, reread, onWatch, onClose }: { result: SaveResult; reread: boolean; onWatch(): void; onClose(): void }) {
  if (result.kind === 'written') {
    return (
      <div className="wizard-done" data-result="written">
        <h2>Canal salvo</h2>
        <p>
          O arquivo <code>{result.path}</code> foi gravado na pasta da biblioteca.{' '}
          {reread ? 'O canal já está na troca de canais.' : 'Não consegui reler a biblioteca: escolha a pasta de novo para ver o canal.'}
        </p>
        <div className="wizard-footer">
          {reread && (
            <button data-nav data-autofocus data-watch className="action-tile primary" onClick={onWatch}>
              <Icon name="play" className="action-icon" />
              <span>Assistir agora</span>
            </button>
          )}
          <button data-nav data-autofocus={reread ? undefined : ''} className="action-tile" onClick={onClose}>
            <span>Fechar</span>
          </button>
        </div>
      </div>
    );
  }
  const where = result.path.slice(0, result.path.lastIndexOf('/') + 1);
  return (
    <div className="wizard-done" data-result="downloaded">
      <h2>Arquivo baixado</h2>
      <p>{REASONS[result.reason]} Então o app baixou o canal como arquivo: <code>{result.fileName}.yaml</code>.</p>
      <p>Para o canal aparecer:</p>
      <ol className="wizard-instructions">
        <li>
          Copie <code>{result.fileName}.yaml</code> (na pasta de downloads) para <code>{where}</code> dentro da biblioteca. Se a pasta <code>grades</code> não existir, crie.
        </li>
        <li>No pendrive ou no Raspberry Pi, é a mesma pasta <code>grades</code> da biblioteca.</li>
        <li>Abra a biblioteca de novo (recarregue a página ou escolha a pasta outra vez). O canal aparece na troca de canais.</li>
      </ol>
      <div className="wizard-footer">
        <button data-nav data-autofocus className="action-tile primary" onClick={onClose}>
          <span>Entendi</span>
        </button>
        <button data-nav className="action-tile" onClick={() => void redownload(result)}>
          <Icon name="download" className="action-icon" />
          <span>Baixar de novo</span>
        </button>
      </div>
    </div>
  );
}

function redownload(result: SaveResult) {
  if (result.kind === 'downloaded' && result.yaml) downloadText(`${result.fileName}.yaml`, result.yaml);
}
