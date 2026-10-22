import {
  formatSpan,
  formatTimeOfDay,
  localIsoDate,
  proposalToRaw,
  scheduleToYaml,
  type Weekday,
  type Library,
  type Proposal,
  type Schedule,
  type Show,
} from '@tv-gominho/nucleo';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { KeyHints, Overlay } from '../components/Overlay';
import { ScrollBody } from '../components/ScrollBody';
import { useWeek } from '../components/useWeek';
import { WeekView, WeekWarnings } from '../components/WeekView';
import type { WeekDay } from '../week-model';
import type { Durations } from '../media';
import { useSettings } from '../settings';
import { clickDirection } from '../settings-model';
import { PAIR_MESSAGES, PIN_LENGTH, pinComplete, typePin, type PairOutcome } from '../pin-model';
import { overwriteWithBackup, type ReplaceResult } from '../sources/overwrite';
import { downloadText, requestWriteAccess, saveGrade, saveThroughServer, type SaveResult, type WriteAccess } from '../sources/save';
import type { AiBackend, BrowserLibrary, ServerEditing } from '../sources/types';
import { EXAMPLES, MAX_REQUEST_LENGTH, NOTICE, NOTICE_KEY, afterProposal, applyProposal, currentChoices, iaReply, requestProblem, typicalMinutes } from '../ia-model';
import {
  DAY_LABELS,
  DAY_ORDER,
  DAY_PRESETS,
  MAX_NAME_LENGTH,
  MAX_RANGES,
  QUICK_PRESET,
  RANGE_PRESETS,
  addRange,
  adSummary,
  advanceLabel,
  advanceNav,
  advancedLines,
  applyPreset,
  applyQuickPreset,
  backNav,
  buildChannel,
  bumperBrands,
  bumperChoice,
  bumperEras,
  changeStep,
  chooseBrand,
  chooseNew,
  chooseReplace,
  dayLabel,
  daysSummary,
  existingGradeFiles,
  formatRange,
  initialState,
  longDayLabel,
  moveRangeEdge,
  movePicked,
  openStep,
  planReplace,
  previewDates,
  removeRange,
  replaceableChannels,
  sortedRanges,
  startNav,
  stepAd,
  stepEra,
  stepHeading,
  stepInfo,
  stepProblem,
  summaryLines,
  toggleDay,
  togglePicked,
  uniqueFileName,
  wizardDirty,
  type BuiltChannel,
  type Nav,
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

type Phase =
  // Serving with `--editar`: asking the server whether this device is paired, before anything else.
  | { name: 'checking' }
  | { name: 'editing' }
  // 'Pedir para a IA' (when the AI has a key and is on): the request, then the proposal fills the answers and opens the preview.
  | { name: 'ia' }
  | { name: 'saving' }
  // Saving through `tv-gominho servir --editar` and this device is not paired yet: the PIN, then the same file.
  // `start`: asked on opening the wizard (Back leaves it), before any answer is lost to a refusal at the end.
  | { name: 'pin'; editing: ServerEditing; again(message: string): Promise<void>; message?: string; start?: boolean }
  | { name: 'done'; result: SaveResult | ReplaceResult; reread: boolean };

/** The channel the answers build, kept from the preview to the save so both show and write the same thing. */
interface Prepared {
  /** The answers it was built from (JSON): it is stale once they change. */
  key: string;
  built: BuiltChannel;
  today: string;
}

/** How long the preview waits for the first video durations before it shows typical lengths for the rest. */
const DURATION_WAIT_MS = 12_000;
const SAMPLE_EPISODES = 12;
/** The preview is built again this long after the last change of an answer (typing the name). */
const REBUILD_DELAY_MS = 350;

/**
 * "Criar uma programação": four screens (Quando?, O que passa?, Nome e prévia, Salvar) that build a channel with the same
 * generator as `tv-gominho grade` and save it as a file in grades/: a new one, or in the place of an existing one (with
 * a backup copy of the old file). Comerciais, Vinhetas and "Trocar um canal existente" sit behind "Ajustes avançados".
 * Everything is reachable with arrows, OK and Back; Back goes to the screen before. On the last screen each answer has
 * "Mudar", which opens its screen and comes back. Served with --editar, the PIN is asked on opening.
 */
export function WeekWizard({ source, library, durations, channels, onSaved, onWatch, onBack }: Props) {
  const { settings } = useSettings();
  const [nav, setNav] = useState<Nav>(startNav);
  const step = nav.step;
  const [state, setState] = useState<WizardState>(() => initialState(settings.adBreaks));
  const [fresh] = useState<WizardState>(() => initialState(settings.adBreaks));
  // Leaving with answers that would be lost asks once (as the channel editor does).
  const [leaving, setLeaving] = useState(false);
  const [phase, setPhase] = useState<Phase>(() => (source.editing ? { name: 'checking' } : { name: 'editing' }));
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  /** The explanation of the AI's proposal while the answers are the ones it proposed (they can still be adjusted). */
  const [iaNote, setIaNote] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  /** "Pedir para a IA" shows only when the AI has a key and is on (Configurações, Assistente de IA). */
  const [aiOn, setAiOn] = useState(false);
  useEffect(() => {
    let live = true;
    void source.ai
      ?.status()
      .then((status) => live && setAiOn(status?.available ?? false))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [source]);

  // Served with --editar: the PIN comes first, so nobody fills in four screens to be refused at the end.
  useEffect(() => {
    const editing = source.editing;
    if (!editing) return;
    let live = true;
    void editing
      .isPaired()
      .catch(() => true)
      .then((paired) => {
        if (!live) return;
        setPhase((current) =>
          current.name !== 'checking' ? current : paired ? { name: 'editing' } : { name: 'pin', editing, start: true, again: async () => setPhase({ name: 'editing' }) },
        );
      });
    return () => {
      live = false;
    };
  }, [source]);

  const playable = useMemo(() => library.shows.filter((show) => show.episodes.length > 0), [library]);
  const taken = useMemo(
    () => [...existingGradeFiles(source.files, library.root), ...library.schedules.map((schedule) => schedule.id)],
    [source, library],
  );
  const replacing = state.target === null ? null : (library.schedules.find((schedule) => schedule.id === state.target) ?? null);
  const fileName = replacing ? planReplace(replacing, localIsoDate(new Date()), [], library.root).fileName : uniqueFileName(state.name, taken);
  const problem = stepProblem(step, state, playable.length);
  const change = (patch: Partial<WizardState>) => setState((current) => ({ ...current, ...patch }));
  const stateKey = JSON.stringify(state);
  const stale = prepared !== null && prepared.key !== stateKey;

  /** Builds the channel for the answers, after reading the duration of the videos it will use (as far as that is quick). */
  async function build(): Promise<Prepared> {
    const wanted = state.showMode === 'pick' ? new Set(state.picked) : null;
    const episodes = playable
      .filter((show) => !wanted || wanted.has(show.id))
      .flatMap((show) => show.episodes.slice(0, SAMPLE_EPISODES).map((episode) => episode.path));
    const paths = [...episodes, ...library.interstitials.map((item) => item.path)];
    await Promise.race([durations.load(paths), new Promise((resolve) => setTimeout(resolve, DURATION_WAIT_MS))]);
    const today = localIsoDate(new Date());
    const built = buildChannel({ state, library, durationOf: durations.get, settings, today, taken });
    return { key: stateKey, built, today };
  }

  // The "Nome e prévia" screen builds the channel for the answers it has, and again shortly after each change (the name
  // seeds the day's draws, so even a letter changes the preview). The old preview stays until the new one is ready.
  useEffect(() => {
    if (step !== 'review' || phase.name !== 'editing') return;
    if (prepared?.key === stateKey) return;
    if (stepProblem('when', state, playable.length) || stepProblem('shows', state, playable.length) || stepProblem('review', state, playable.length)) return;
    let current = true;
    setError(null);
    const timer = setTimeout(
      () => {
        build().then(
          (result) => current && setPrepared(result),
          (failure: Error) => current && setError(`Não foi possível montar o canal: ${failure.message}`),
        );
      },
      prepared ? REBUILD_DELAY_MS : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // build() reads the answers of this render, which stateKey stands for.
  }, [step, phase.name, stateKey]);

  // Each screen starts with focus on its first choice (or the one marked data-autofocus).
  useEffect(() => {
    const container = body.current;
    if (!container) return;
    // The last screen starts on the button that saves: the answers are above it, one "Mudar" away.
    const target =
      container.querySelector<HTMLElement>('[data-autofocus]') ??
      (step === 'save' ? container.parentElement?.parentElement?.querySelector<HTMLElement>('[data-save]') : null) ??
      container.querySelector<HTMLElement>('[data-nav]');
    target?.focus();
  }, [step, phase.name]);

  const goBack = () => {
    if (phase.name === 'saving' || phase.name === 'checking') return;
    if (phase.name === 'done') return onBack();
    if (phase.name === 'pin') return phase.start ? onBack() : setPhase({ name: 'editing' });
    if (phase.name === 'ia') return setPhase({ name: 'editing' });
    setError(null);
    const before = backNav(nav);
    if (before) setNav(before);
    else leave();
  };
  /** Closes the wizard; with answers that would be lost, the first try only asks (the second one leaves). */
  const leave = () => {
    if (phase.name === 'saving') return;
    if (phase.name === 'done' || phase.name === 'pin' || leaving || !wizardDirty(step, state, fresh)) return onBack();
    setLeaving(true);
  };
  // Any change of answer or screen takes the question back.
  useEffect(() => setLeaving(false), [stateKey, step, phase.name]);
  const goOn = () => {
    if (problem) return;
    setNav(advanceNav(nav));
  };

  /** The AI's proposal becomes the answers; the preview shows it, unless a screen still has a problem with it. */
  function takeProposal(proposal: Proposal) {
    const next = applyProposal(state, proposal);
    setState(next);
    setIaNote(proposal.note || 'A IA preencheu as escolhas.');
    setError(null);
    setPhase({ name: 'editing' });
    const target = afterProposal(next, playable.length);
    setNav(target === 'when' ? startNav() : openStep(startNav(), target));
  }

  function discardProposal() {
    setState(initialState(settings.adBreaks));
    setIaNote(null);
    setNav(startNav());
  }

  async function save() {
    // Replacing a channel needs the confirmation of the last screen.
    if (problem) return;
    setError(null);
    setPhase({ name: 'saving' });
    // First of all: the permission prompt needs the click that got us here, which long waits below would lose.
    const access = await requestWriteAccess(source);
    try {
      // The channel the preview showed; built again only if the answers changed since.
      const { built, today } = prepared?.key === stateKey ? prepared : await build();
      const yaml = scheduleToYaml(built.generated, [
        `Criada pelo assistente "Criar uma programação" em ${today}. Pode editar à vontade (veja docs/grade.md).`,
        'Os horários nos comentários são estimativas, com os intervalos comerciais.',
        ...(built.replaces ? ['Troca a grade anterior, que ficou guardada ao lado, com a data no nome e a terminação .bak.'] : []),
      ]);
      if (built.replaces) return await replaceChannel(access, built.replaces.path, today, yaml);
      if (source.editing) return await saveToServer(source.editing, yaml);
      await finish(await saveGrade(source, library, access, state.name.trim(), yaml, taken));
    } catch (failure) {
      setError(`Não foi possível montar o canal: ${(failure as Error).message}`);
      setPhase({ name: 'editing' });
    }
  }

  async function saveToServer(editing: ServerEditing, yaml: string, message?: string): Promise<void> {
    setPhase({ name: 'saving' });
    const result = await saveThroughServer(editing, library, state.name.trim(), yaml, taken);
    if (result === 'needs-pin') setPhase({ name: 'pin', editing, again: (again) => saveToServer(editing, yaml, again), message });
    else await finish(result);
  }

  /** Trocar canal: over the same file, after the copy of the old one (folder, server with PIN, or download). */
  async function replaceChannel(access: WriteAccess, path: string, today: string, yaml: string, message?: string): Promise<void> {
    setPhase({ name: 'saving' });
    const result = await overwriteWithBackup(source, library, access, path, today, yaml);
    if (result === 'needs-pin' && source.editing) {
      setPhase({ name: 'pin', editing: source.editing, again: (again) => replaceChannel(access, path, today, yaml, again), message });
    } else if (result !== 'needs-pin') await finish(result);
  }

  async function finish(result: SaveResult | ReplaceResult) {
    const reread = result.kind === 'written' ? await onSaved().catch(() => false) : true;
    setPhase({ name: 'done', result, reread });
  }

  const last = step === 'save';
  const first = nav.trail.length === 0;

  return (
    <Overlay edge="left" label="Criar uma programação" onBack={goBack} className="wizard-overlay">
      <div className="wizard">
        <header className="panel-header">
          <Icon name="calendar" />
          <h1>Criar uma programação</h1>
          <button className="panel-close" onClick={leave} aria-label="Fechar" title="Fechar" tabIndex={-1} disabled={phase.name === 'saving'}>
            <Icon name="close" />
          </button>
        </header>

        <p className="wizard-progress" aria-label="Passo atual" data-step={step}>
          {phase.name === 'pin' && phase.start ? 'Antes de começar · PIN do computador' : stepHeading(step)}
        </p>

        <ScrollBody className="wizard-body" innerRef={body} key={`${step}-${phase.name}`}>
          {phase.name === 'done' ? (
            <DonePage result={phase.result} reread={phase.reread} onWatch={() => onWatch(phase.result.fileName)} onClose={onBack} />
          ) : phase.name === 'checking' ? (
            <p className="wizard-busy" role="status">
              Conferindo se este aparelho já foi pareado com o computador…
            </p>
          ) : phase.name === 'pin' ? (
            <PinPage
              editing={phase.editing}
              what={
                phase.start
                  ? 'criar e salvar programações neste computador'
                  : state.target
                    ? `trocar a programação “${state.name.trim()}”`
                    : `salvar a programação “${state.name.trim()}”`
              }
              message={phase.message}
              onPaired={() =>
                void phase.again('O computador pediu o PIN de novo. Confira o número no terminal.').catch((failure) => {
                  setError(`Não foi possível salvar o canal: ${(failure as Error).message}`);
                  setPhase({ name: 'editing' });
                })
              }
              onCancel={goBack}
            />
          ) : phase.name === 'ia' && source.ai ? (
            <IaPage
              assistant={source.ai}
              library={library}
              shows={playable}
              durations={durations}
              current={currentChoices(state, settings.adBreaks)}
              onProposal={takeProposal}
              onCancel={goBack}
            />
          ) : phase.name === 'saving' ? (
            <p className="wizard-busy" role="status">
              {state.target ? 'Guardando a cópia de segurança e trocando o canal…' : 'Gravando o canal…'}
            </p>
          ) : (
            <>
              {step !== 'save' && <h2>{stepInfo(step).help}</h2>}
              {step === 'when' && (
                <WhenStep
                  state={state}
                  onChange={setState}
                  onAi={aiOn && source.ai ? () => setPhase({ name: 'ia' }) : undefined}
                  onQuick={() => {
                    setState(applyQuickPreset);
                    setNav(advanceNav(nav));
                  }}
                />
              )}
              {step === 'shows' && (
                <ShowsStep
                  state={state}
                  library={library}
                  shows={playable}
                  onChange={change}
                  onAll={() => {
                    change({ showMode: 'all' });
                    setNav(advanceNav(nav));
                  }}
                />
              )}
              {step === 'review' && (
                <>
                  <NameField state={state} onChange={setState} onEnter={goOn} />
                  <button data-nav data-advanced className="action-tile small" onClick={() => setNav(openStep(nav, 'advanced'))}>
                    <Icon name="settings" className="action-icon" />
                    <span>Ajustes avançados</span>
                  </button>
                  {iaNote && (
                    <div className="wizard-list" data-note="ia">
                      <p className="panel-note">
                        Proposta da IA: {iaNote} Confira a prévia. Para ajustar, volte aos passos anteriores; para seguir, avance e salve.
                      </p>
                      <button data-nav className="action-tile small" onClick={discardProposal}>
                        <Icon name="close" className="action-icon" />
                        <span>Descartar a proposta</span>
                      </button>
                    </div>
                  )}
                  <PreviewStep prepared={prepared} stale={stale} building={!prepared && !problem && !error} library={library} durations={durations} />
                </>
              )}
              {step === 'advanced' && <AdvancedStep state={state} library={library} onOpen={(id) => setNav(openStep(nav, id))} />}
              {step === 'commercials' && <CommercialsStep state={state} library={library} onChange={setState} />}
              {step === 'bumpers' && <BumpersStep state={state} library={library} onChange={setState} />}
              {step === 'replace' && <ReplaceStep state={state} fileName={fileName} library={library} onChange={setState} />}
              {step === 'save' && (
                <SummaryStep
                  state={state}
                  fileName={fileName}
                  library={library}
                  channels={channels}
                  replacing={replacing}
                  onChange={setState}
                  onChangeStep={(id) => setNav(changeStep(nav, id))}
                />
              )}
              {(problem ?? error) && (
                <p className="wizard-problem" role="alert">
                  {problem ?? error}
                </p>
              )}
            </>
          )}
        </ScrollBody>

        {phase.name === 'editing' && leaving && (
          <p className="wizard-problem wizard-leaving" role="alert" data-leaving>
            Suas escolhas ainda não foram salvas. Aperte Voltar de novo para sair sem salvar, ou siga até o fim e salve.
          </p>
        )}

        {phase.name === 'editing' && (
          <footer className="wizard-footer" data-nav-zone="footer" data-nav-row="footer">
            <button data-nav className="action-tile" onClick={goBack}>
              <Icon name="back" className="action-icon" />
              <span>{first ? 'Cancelar' : 'Voltar'}</span>
            </button>
            {last ? (
              <button data-nav data-save className="action-tile primary" aria-disabled={problem ? true : undefined} onClick={save}>
                <Icon name="check" className="action-icon" />
                <span>{state.target ? 'Trocar o canal' : 'Salvar canal'}</span>
              </button>
            ) : (
              <button data-nav data-next className="action-tile primary" aria-disabled={problem ? true : undefined} onClick={goOn}>
                <span>{advanceLabel(nav)}</span>
                <Icon name={advanceLabel(nav) === 'Pronto' ? 'check' : 'chevronRight'} className="action-icon" />
              </button>
            )}
          </footer>
        )}

        <KeyHints
          hints={[
            ['↑ ↓', 'escolher'],
            ['← →', 'mudar'],
            ['OK', 'confirmar'],
            [
              'Voltar',
              phase.name === 'pin' || phase.name === 'ia' ? 'cancelar' : first || phase.name === 'done' ? 'fechar' : 'tela anterior',
            ],
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
  /** A button that is on or off (not a radio): aria-pressed, with the same mark. */
  pressed?: boolean;
  autofocus?: boolean;
  children?: ReactNode;
  className?: string;
  onClick(event: React.MouseEvent<HTMLButtonElement>): void;
  onKeyDown?(event: KeyboardEvent<HTMLButtonElement>): void;
  /** The row keeps Left/Right for itself (see nav.ts). */
  adjust?: boolean;
  data?: string;
}

function Row({ icon, label, meta, role, checked, pressed, autofocus, children, className = '', onClick, onKeyDown, adjust, data }: RowProps) {
  const on = Boolean(role ? checked : pressed);
  return (
    <button
      data-nav
      data-nav-adjust={adjust ? '' : undefined}
      data-autofocus={autofocus ? '' : undefined}
      data-wizard={data}
      className={`row wizard-row ${className}`.trim()}
      role={role}
      aria-checked={role ? Boolean(checked) : undefined}
      aria-pressed={!role && pressed !== undefined ? pressed : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <Icon name={icon} className="row-lead" />
      <span className="row-text">
        <span className="row-label">{label}</span>
        {meta && <span className="row-meta">{meta}</span>}
      </span>
      {children ?? ((role || pressed !== undefined) && <span className="wizard-mark" data-on={on}>{on && <Icon name="check" />}</span>)}
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

// ---------------------------------------------------------------- screen 1: when

/** "Quando?": the one-press shortcut first, then the time ranges and the days together. */
function WhenStep({
  state,
  onChange,
  onAi,
  onQuick,
}: {
  state: WizardState;
  onChange(update: (state: WizardState) => WizardState): void;
  onAi?: () => void;
  onQuick(): void;
}) {
  const choose = (preset: PresetId) => onChange((current) => applyPreset(current, preset));
  const sameDays = (days: Weekday[]) => days.length === state.days.length && days.every((day) => state.days.includes(day));
  const setDays = (days: Weekday[]) => onChange((current) => ({ ...current, days }));
  return (
    <>
      {onAi && (
        <Row
          icon="text"
          label="Pedir para a IA"
          meta="Descreva o canal em português; a IA propõe e você revisa antes de salvar."
          data="ia"
          onClick={onAi}
        />
      )}
      <Row
        icon="clock"
        autofocus
        className="wizard-quick"
        label={QUICK_PRESET.label}
        meta={`${RANGE_PRESETS.find((preset) => preset.id === QUICK_PRESET.preset)!.ranges.map(formatRange).join(' e ')}. OK já usa e segue para os programas.`}
        data="quick"
        onClick={onQuick}
      >
        <Icon name="chevronRight" className="selector-arrow" />
      </Row>

      <p className="wizard-group">Ou ajuste</p>
      <div className="wizard-chips" role="group" aria-label="Faixas de horário" data-nav-row="presets">
        {RANGE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            data-nav
            data-preset={preset.id}
            className="action-tile"
            aria-pressed={preset.id === state.preset}
            title={preset.id === 'custom' ? 'Até 3 faixas, com os horários que você escolher' : preset.ranges.map(formatRange).join(' e ')}
            onClick={() => choose(preset.id)}
          >
            <Icon name="clock" className="action-icon" />
            <span>{preset.label}</span>
          </button>
        ))}
      </div>

      {state.preset === 'custom' ? (
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
      ) : null}

      <div className="wizard-chips" aria-label="Atalhos de dias" data-nav-row="day-presets">
        {DAY_PRESETS.map((preset) => (
          <button
            key={preset.id}
            data-nav
            data-days-preset={preset.id}
            className="action-tile"
            aria-pressed={sameDays(preset.days)}
            onClick={() => setDays([...preset.days])}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="wizard-chips" role="group" aria-label="Dias da semana" data-nav-row="days">
        {DAY_ORDER.map((day) => {
          const on = state.days.includes(day);
          return (
            <button
              key={day}
              data-nav
              data-day={day}
              role="checkbox"
              aria-checked={on}
              aria-label={DAY_LABELS[day]}
              title={DAY_LABELS[day]}
              className="action-tile day-chip"
              onClick={() => setDays(toggleDay(state.days, day))}
            >
              <span>{DAY_LABELS[day].slice(0, 3)}</span>
            </button>
          );
        })}
      </div>
      <p className="panel-note">
        No ar: {sortedRanges(state.ranges).map(formatRange).join(' e ')}, {daysSummary(state.days).toLowerCase()}.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- screen 2: shows

function ShowsStep({
  state,
  library,
  shows,
  onChange,
  onAll,
}: {
  state: WizardState;
  library: Library;
  shows: Library['shows'];
  onChange(patch: Partial<WizardState>): void;
  /** "Todos os programas" is the answer most people want: choosing it goes on. */
  onAll(): void;
}) {
  const picking = state.showMode === 'pick';
  const titleOf = new Map(library.shows.map((show) => [show.id, show.title]));
  return (
    <>
      <div className="wizard-list" role="group" aria-label="Quais programas">
        <Row
          icon="episode"
          pressed={!picking}
          autofocus={!picking}
          label="Todos os programas"
          meta={`${shows.length} ${shows.length === 1 ? 'programa' : 'programas'}, em rodízio na ordem que o app escolhe. OK já usa e segue.`}
          data="all"
          onClick={onAll}
        />
        <Row
          icon="episode"
          pressed={picking}
          autofocus={picking}
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

// ---------------------------------------------------------------- the advanced screens

/** "Ajustes avançados": the three things that start on the default and rarely need to change. */
function AdvancedStep({ state, library, onOpen }: { state: WizardState; library: Library; onOpen(id: StepId): void }) {
  const icons: Partial<Record<StepId, IconName>> = { commercials: 'ads', bumpers: 'interstitials', replace: 'restore' };
  return (
    <>
      <div className="wizard-list" role="group" aria-label="Ajustes avançados">
        {advancedLines(state, library).map((line, i) => (
          <Row key={line.id} icon={icons[line.id] ?? 'settings'} autofocus={i === 0} label={line.label} meta={`${line.value}${line.changed ? ' (mudado)' : ''}`} data={`advanced-${line.id}`} onClick={() => onOpen(line.id)}>
            <Icon name="chevronRight" className="selector-arrow" />
          </Row>
        ))}
      </div>
      <p className="panel-note">Nada aqui precisa ser mexido para criar um canal: o padrão segue a configuração geral, usa qualquer marca de vinhetas e cria um canal novo.</p>
    </>
  );
}

function CommercialsStep({ state, library, onChange }: { state: WizardState; library: Library; onChange(update: (state: WizardState) => WizardState): void }) {
  const { settings } = useSettings();
  const custom = state.adMode === 'custom';
  const hasAds = library.interstitials.some((item) => item.category === 'comerciais');
  const setAd = (patch: Partial<WizardState['ad']>) => onChange((current) => ({ ...current, ad: { ...current.ad, ...patch } }));
  return (
    <>
      <div role="radiogroup" aria-label="Regras dos comerciais" className="wizard-list">
        <Row
          icon="ads"
          role="radio"
          autofocus={!custom}
          checked={!custom}
          label="Seguir a configuração geral"
          meta={adSummary(settings.adBreaks)}
          data="general"
          onClick={() => onChange((current) => ({ ...current, adMode: 'general' }))}
        />
        <Row
          icon="ads"
          role="radio"
          autofocus={custom}
          checked={custom}
          label="Regras próprias deste canal"
          meta="Só este canal: de quanto em quanto tempo há intervalo e quantos comerciais passam."
          data="custom"
          onClick={() => onChange((current) => ({ ...current, adMode: 'custom' }))}
        />
      </div>

      {custom && (
        <div className="wizard-list" aria-label="Regras deste canal">
          <Stepper
            icon="timer"
            label="Intervalo a cada"
            value={state.ad.every > 0 ? `${state.ad.every} min` : 'sem cortes'}
            data="every"
            onStep={(direction) => onChange((current) => ({ ...current, ad: stepAd(current.ad, 'every', direction) }))}
          />
          <Stepper
            icon="ads"
            label="Comerciais por intervalo"
            value={String(state.ad.ads)}
            data="ads"
            onStep={(direction) => onChange((current) => ({ ...current, ad: stepAd(current.ad, 'ads', direction) }))}
          />
          <Row
            icon="episode"
            role="checkbox"
            checked={state.ad.afterEpisode}
            label="Intervalo depois de cada episódio"
            data="after"
            onClick={() => setAd({ afterEpisode: !state.ad.afterEpisode })}
          />
          <Row
            icon="interstitials"
            role="checkbox"
            checked={state.ad.bumpers}
            label="Vinhetas de entrada e saída do intervalo"
            data="bumpers"
            onClick={() => setAd({ bumpers: !state.ad.bumpers })}
          />
        </div>
      )}

      <p className="panel-note">
        {custom
          ? 'Estas regras ficam no arquivo do canal e valem só para ele; os outros canais seguem a configuração geral.'
          : 'O canal não escreve regras próprias: vale o que está em Configurações, e muda junto com ela.'}{' '}
        O interruptor geral de comerciais vence: um canal só muda <em>como</em> são os intervalos, nunca <em>se</em> há comerciais.
      </p>
      {!settings.commercials && (
        <p className="panel-note" data-note="commercials-off">
          Os comerciais estão desligados na configuração geral, então este canal passa sem eles, qualquer que seja a regra escolhida.
        </p>
      )}
      {settings.commercials && !hasAds && <p className="panel-note">A biblioteca não tem comerciais em <code>vinhetas/comerciais</code>: os episódios passam sem intervalos.</p>}
    </>
  );
}

function BumpersStep({ state, library, onChange }: { state: WizardState; library: Library; onChange(update: (state: WizardState) => WizardState): void }) {
  const { settings } = useSettings();
  const brands = useMemo(() => bumperBrands(library), [library]);
  const eras = useMemo(() => bumperEras(library, state.brand), [library, state.brand]);
  const choice = bumperChoice(library, state);
  if (brands.length === 0 && eras.length === 0 && choice.every((entry) => entry.ref === null)) {
    return <p className="panel-note">A biblioteca não tem vinhetas de abertura, encerramento ou intervalo: o canal passa só com os programas. Nada a escolher aqui.</p>;
  }
  return (
    <>
      <div role="radiogroup" aria-label="Marca das vinhetas" className="wizard-list">
        <Row
          icon="interstitials"
          role="radio"
          autofocus={state.brand === ''}
          checked={state.brand === ''}
          label="Qualquer marca"
          meta="O app escolhe entre as vinhetas da biblioteca."
          data="brand-any"
          onClick={() => onChange((current) => chooseBrand(current, library, ''))}
        />
        {brands.map((brand) => (
          <Row
            key={brand.id}
            icon="interstitials"
            role="radio"
            autofocus={state.brand === brand.id}
            checked={state.brand === brand.id}
            label={brand.id}
            meta={`${brand.count} ${brand.count === 1 ? 'vinheta' : 'vinhetas'}`}
            data={`brand-${brand.id}`}
            onClick={() => onChange((current) => chooseBrand(current, library, brand.id))}
          />
        ))}
      </div>

      {eras.length > 0 ? (
        <div className="wizard-list" aria-label="Época">
          <Stepper
            icon="calendar"
            label="Época das vinhetas"
            value={state.era === null ? 'Qualquer' : String(state.era)}
            data="era"
            onStep={(direction) => onChange((current) => ({ ...current, era: stepEra(eras, current.era, direction) }))}
          />
        </div>
      ) : (
        <p className="panel-note">Os nomes das vinhetas não trazem ano (como “2003-2009” ou “(2011)”): não há época para escolher.</p>
      )}

      <dl className="wizard-summary" aria-label="Vinhetas escolhidas">
        {choice.map((entry) => (
          <div key={entry.label}>
            <dt>{entry.label}</dt>
            <dd>{entry.ref ?? 'nenhuma na biblioteca'}</dd>
          </div>
        ))}
      </dl>
      {!settings.interstitials && <p className="panel-note">As vinhetas estão desligadas na configuração geral: o canal passa sem elas.</p>}
    </>
  );
}

function NameField({
  state,
  onChange,
  onEnter,
}: {
  state: WizardState;
  onChange(update: (state: WizardState) => WizardState): void;
  onEnter(): void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Backspace deletes a letter here; it must not reach the "go back" key handling of the overlay.
    if (event.key === 'Backspace') event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      onEnter();
    }
  };
  return (
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
        aria-describedby="wizard-file-note"
        onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
        onKeyDown={onKeyDown}
        onFocus={(event) => event.target.select()}
      />
      <span className="row-meta" id="wizard-file-note">
        {state.target === null ? 'Aparece na troca de canais.' : 'Aparece na troca de canais. Vai por cima de um canal que já existe, com cópia de segurança.'}
      </span>
    </label>
  );
}

/** "Trocar um canal existente": the wizard makes a new channel unless one of these is chosen (and confirmed on the last screen). */
function ReplaceStep({ state, fileName, library, onChange }: { state: WizardState; fileName: string; library: Library; onChange(update: (state: WizardState) => WizardState): void }) {
  const channels = replaceableChannels(library);
  const replacing = state.target !== null;
  const target = channels.find((channel) => channel.id === state.target);
  const backupName = target ? planReplace(target, localIsoDate(new Date()), [], library.root).backupName : '';
  return (
    <>
      <div role="radiogroup" aria-label="Canal novo ou trocar um canal" className="wizard-list">
        <Row
          icon="plus"
          role="radio"
          autofocus={!replacing}
          checked={!replacing}
          label="Criar um canal novo"
          meta="O jeito seguro: nada que já existe é trocado."
          data="new"
          onClick={() => onChange(chooseNew)}
        />
        {channels.map((channel) => (
          <Row
            key={channel.id}
            icon="restore"
            role="radio"
            autofocus={state.target === channel.id}
            checked={state.target === channel.id}
            label={`Trocar o canal “${channel.name}”`}
            meta={`${channel.path} · o arquivo antigo fica guardado como cópia de segurança`}
            data={`replace-${channel.id}`}
            onClick={() => onChange((current) => chooseReplace(current, channel))}
          />
        ))}
      </div>

      {replacing ? (
        <p className="panel-note" data-note="replace">
          O canal será refeito com as escolhas deste assistente e gravado por cima de <code>{fileName}.yaml</code>. Antes disso, o arquivo antigo é copiado para{' '}
          <code>grades/{backupName}</code>, que a TV não lê como canal. Cada programa continua no episódio em que estava hoje. A confirmação fica na última tela.
        </p>
      ) : (
        <p className="panel-note">
          O arquivo vai se chamar <code>grades/{fileName}.yaml</code>.
        </p>
      )}
    </>
  );
}

/// ---------------------------------------------------------------- preview

type PreviewView = 'day' | 'week';

function PreviewStep({
  prepared,
  stale,
  building,
  library,
  durations,
}: {
  prepared: Prepared | null;
  /** The answers changed since `prepared` was built: it stays on screen until the new one is ready. */
  stale: boolean;
  building: boolean;
  library: Library;
  durations: Durations;
}) {
  const [view, setView] = useState<PreviewView>('day');
  const [day, setDay] = useState(0);

  const schedule = prepared?.built.generated.schedule;
  const today = prepared?.today;
  const dates = useMemo(() => (today ? previewDates(today) : []), [today]);
  // The same week as the one of "Mudar uma programação" (week-model.ts), with the real durations once they are read.
  const { week, reading } = useWeek(schedule, library, dates, durations);

  if (!prepared || !schedule || !week) {
    return building ? (
      <p className="wizard-busy" role="status">
        Montando a prévia… Lendo a duração dos vídeos para os horários fecharem certinho.
      </p>
    ) : null;
  }

  const selected = week.days[day]!;

  return (
    <>
      <div className="wizard-chips" role="group" aria-label="Ver" data-nav-row="view">
        {(['day', 'week'] as const).map((name) => (
          <button
            key={name}
            data-nav
            data-view={name}
            className="action-tile"
            aria-pressed={view === name}
            onClick={() => setView(name)}
          >
            <Icon name={name === 'day' ? 'clock' : 'calendar'} className="action-icon" />
            <span>{name === 'day' ? 'Um dia' : 'A semana'}</span>
          </button>
        ))}
      </div>

      {view === 'day' && (
        <Stepper
          icon="calendar"
          label="Dia"
          value={longDayLabel(dates[day]!)}
          data="day"
          onStep={(direction) => setDay((current) => (current + direction + dates.length) % dates.length)}
        />
      )}

      {/* The week is read first and its warnings come after it; a day's warnings come before its list. */}
      {view === 'day' ? (
        <>
          <WeekWarnings week={week} only={selected.label} />
          <DayList day={selected} />
        </>
      ) : (
        <>
          <WeekView week={week} label="A semana" />
          <WeekWarnings week={week} />
        </>
      )}

      <p className="panel-note" data-note="estimate">
        {stale
          ? 'Atualizando a prévia com as suas mudanças… '
          : week.estimated
          ? 'Estimado: alguns vídeos ainda não tiveram a duração lida, então valem durações típicas (22 minutos por episódio) e os horários são aproximados. '
          : reading
            ? 'Lendo a duração dos vídeos da semana… os horários podem mudar um pouco. '
            : 'Horários calculados com a duração real dos vídeos. '}
        Os intervalos comerciais já contam. Cada horário marcado começa na hora certa, a menos que o anterior passe dela.
      </p>
    </>
  );
}

/** One day, a line per episode with how long it runs; the times are the ones of the week (week-model.ts). */
function DayList({ day }: { day: WeekDay }) {
  const { preview } = day;
  if (!preview.airs) return <p className="panel-note">O canal não passa neste dia: não está entre os dias escolhidos.</p>;
  if (day.airings.length === 0) return <p className="panel-note">Nada a mostrar neste dia.</p>;
  return (
    <ul className="preview-list" aria-label="Programação do dia">
      {preview.rows.map((row, i) => {
        const airing = day.airings[i]!;
        const newBlock = i === 0 || preview.rows[i - 1]!.block !== row.block;
        return (
          <li key={airing.key} className="preview-row" tabIndex={0} data-nav data-row={i}>
            {newBlock && <span className="preview-block">Às {formatTimeOfDay(preview.blocks[row.block]!.start)}</span>}
            <span className="preview-time">{airing.time}</span>
            <span className="row-text">
              <span className="row-label">{airing.showTitle}</span>
              <span className="row-meta">
                {airing.label}
                {airing.title ? ` · ${airing.title}` : ''} · {formatSpan(row.end - row.start)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The last screen: every answer in a row with "Mudar", which opens its screen and comes back here with the answers kept. */
function SummaryStep({
  state,
  fileName,
  library,
  channels,
  replacing,
  onChange,
  onChangeStep,
}: {
  state: WizardState;
  fileName: string;
  library: Library;
  channels: Schedule[];
  replacing: Schedule | null;
  onChange(update: (state: WizardState) => WizardState): void;
  onChangeStep(step: StepId): void;
}) {
  const lines = summaryLines(state, { library, fileName });
  const lostAgenda = replacing?.agenda?.length ?? 0;
  return (
    <>
      <ul className="summary-list" aria-label="Resumo do canal">
        {lines.map((line) => (
          <li key={line.id}>
            <button data-nav data-change={line.id} className="row summary-row" aria-label={`Mudar ${line.label.toLowerCase()}: ${line.value}`} onClick={() => onChangeStep(line.step)}>
              <span className="summary-label">{line.label}</span>
              <span className="summary-value">{line.value}</span>
              <span className="hub-edit">Mudar</span>
            </button>
          </li>
        ))}
      </ul>
      {replacing ? (
        <>
          <p className="panel-note" data-note="replace-warning">
            <strong>Atenção:</strong> isto troca o canal “{replacing.name}”. O arquivo antigo fica guardado como cópia de segurança em <code>grades/</code>, com a data no nome e
            terminando em <code>.bak</code> (a TV não a lê como canal; para voltar atrás, tire o <code>.bak</code> e a data do nome).
            {lostAgenda > 0 && ' A agenda de episódios escolhidos à mão do canal antigo não é copiada: ela fica só na cópia de segurança.'}
          </p>
          <div className="wizard-list">
            <Row
              icon="alert"
              role="checkbox"
              autofocus={!state.confirmed}
              checked={state.confirmed}
              label={`Sim, trocar o canal “${replacing.name}”`}
              meta="Marque para liberar o botão “Trocar o canal”."
              data="confirm"
              onClick={() => onChange((current) => ({ ...current, confirmed: !current.confirmed }))}
            />
          </div>
        </>
      ) : (
        <p className="panel-note">
          Hoje a biblioteca tem {channels.length} {channels.length === 1 ? 'canal' : 'canais'}; este será mais um.
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- PIN

// ---------------------------------------------------------------- the AI

/** How long the request waits for the episode lengths it sends as hints. */
const IA_DURATION_WAIT_MS = 4_000;

const noticeRead = () => {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * "Pedir para a IA": before the first use, what leaves the computer and what it costs; then the request, typed in
 * Portuguese. The server (or this browser, with its own key) asks the model and checks the answer; the wizard shows it
 * in the preview.
 */
function IaPage({
  assistant,
  library,
  shows,
  durations,
  current,
  onProposal,
  onCancel,
}: {
  assistant: AiBackend;
  library: Library;
  shows: Show[];
  durations: Durations;
  current: Proposal | null;
  onProposal(proposal: Proposal): void;
  onCancel(): void;
}) {
  const [view, setView] = useState<'notice' | 'form' | 'busy' | 'pin'>(() => (noticeRead() ? 'form' : 'notice'));
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const page = useRef<HTMLDivElement>(null);

  useEffect(() => {
    page.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [view]);

  function accept() {
    try {
      localStorage.setItem(NOTICE_KEY, '1');
    } catch {
      // private window: the notice comes back next time
    }
    setView('form');
  }

  async function send() {
    const invalid = requestProblem(text);
    if (invalid) return setProblem(invalid);
    setProblem(null);
    setView('busy');
    const paths = shows.flatMap((show) => show.episodes.slice(0, 3).map((episode) => episode.path));
    await Promise.race([durations.load(paths).catch(() => {}), new Promise((resolve) => setTimeout(resolve, IA_DURATION_WAIT_MS))]);
    const { status, body } = await assistant.propose(
      {
        pedido: text.trim(),
        ...(current ? { atual: proposalToRaw(current) } : {}),
        duracoes: typicalMinutes(shows, durations.get),
      },
      library,
    );
    const reply = iaReply(status, body, library);
    if (reply.kind === 'proposal') return onProposal(reply.proposal);
    if (reply.kind === 'needs-pin' && assistant.pair) return setView('pin');
    if (reply.kind === 'needs-pin') {
      setProblem('A IA não aceitou o pedido. Confira a chave em Configurações, Assistente de IA.');
      return setView('form');
    }
    setProblem(reply.message);
    setView('form');
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Backspace deletes a letter here; it must not reach the "go back" key handling of the overlay.
    if (event.key === 'Backspace') event.stopPropagation();
    // OK on the remote sends; Shift+Enter makes a new line on a keyboard.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  if (view === 'pin' && assistant.pair) {
    return <PinPage editing={{ pair: assistant.pair }} what="pedir uma proposta à IA" message="Para usar a IA, este aparelho precisa do PIN." onPaired={() => void send()} onCancel={() => setView('form')} />;
  }

  return (
    <div className="wizard-ia" ref={page}>
      <h2>Pedir para a IA</h2>
      {view === 'notice' ? (
        <>
          <p className="panel-note">Antes de usar, leia o que acontece:</p>
          <ul className="panel-note" data-note="ia-aviso">
            <li>{NOTICE.sent}</li>
            <li>{NOTICE.cost}</li>
            <li>{NOTICE.review}</li>
            <li>{NOTICE.off}</li>
          </ul>
          <div className="wizard-footer" data-nav-zone="footer" data-nav-row="footer">
            <button data-nav className="action-tile" onClick={onCancel}>
              <span>Agora não</span>
            </button>
            <button data-nav data-autofocus data-ia-accept className="action-tile primary" onClick={accept}>
              <Icon name="check" className="action-icon" />
              <span>Entendi, quero usar</span>
            </button>
          </div>
        </>
      ) : view === 'busy' ? (
        <p className="wizard-busy" role="status">
          A IA está montando uma proposta. Pode levar até um minuto…
        </p>
      ) : (
        <>
          <label className="wizard-field">
            <span className="row-label">O que você quer no canal?</span>
            <textarea
              data-nav
              data-nav-adjust
              data-autofocus
              data-ia-text
              value={text}
              maxLength={MAX_REQUEST_LENGTH}
              rows={3}
              placeholder={EXAMPLES[0]}
              autoComplete="off"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </label>
          <p className="panel-note">
            Exemplos: {EXAMPLES.map((example) => `“${example}”`).join('; ')}. {text.length}/{MAX_REQUEST_LENGTH} letras.
          </p>
          <p className="panel-note">{NOTICE.sent}</p>
          {problem && (
            <p className="wizard-problem" role="alert">
              {problem}
            </p>
          )}
          <div className="wizard-footer" data-nav-zone="footer" data-nav-row="footer">
            <button data-nav className="action-tile" onClick={onCancel}>
              <span>Cancelar</span>
            </button>
            <button data-nav data-ia-send className="action-tile primary" aria-disabled={requestProblem(text) ? true : undefined} onClick={() => void send()}>
              <Icon name="check" className="action-icon" />
              <span>Pedir proposta</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'delete', '0', 'ok'] as const;

/**
 * Pairing this device with `tv-gominho servir --editar`: the PIN shown in the terminal, typed with the
 * remote's number keys or with the on-screen keypad (arrows and OK). Asked once; the server remembers
 * the device by a cookie until it is turned off.
 */
export function PinPage({ editing, what, message, onPaired, onCancel }: { editing: { pair(pin: string): Promise<PairOutcome> }; what: string; message?: string; onPaired(): void; onCancel(): void }) {
  const [pin, setPin] = useState('');
  const [problem, setProblem] = useState(message ?? null);
  const [busy, setBusy] = useState(false);

  async function confirm(value: string) {
    if (busy || !pinComplete(value)) return;
    setBusy(true);
    const outcome = await editing.pair(value);
    setBusy(false);
    if (outcome === 'paired') return onPaired();
    setProblem(PAIR_MESSAGES[outcome]);
    setPin('');
  }
  const press = (key: string) => {
    if (key === 'ok') return void confirm(pin);
    const next = typePin(pin, key);
    setPin(next);
    if (next.length === PIN_LENGTH && next !== pin) void confirm(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      press(event.key);
    } else if (event.key === 'Backspace' && pin) {
      // Deletes a digit; with nothing typed, Backspace goes back as everywhere else.
      event.preventDefault();
      event.stopPropagation();
      press('delete');
    }
  };

  return (
    <div className="wizard-pin" onKeyDown={onKeyDown}>
      <h2>Digite o PIN</h2>
      <p className="wizard-pin-what" data-pin-what>
        Para: {what}
      </p>
      <p className="panel-note">
        O PIN de {PIN_LENGTH} números aparece na tela do computador onde o TV Gominho está ligado. Só é pedido uma vez neste aparelho.
      </p>
      <p className="wizard-pin-digits" aria-label={`PIN: ${pin.length} de ${PIN_LENGTH} números`} data-pin-length={pin.length}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} data-on={i < pin.length}>
            {i < pin.length ? '•' : ''}
          </span>
        ))}
      </p>
      <div className="wizard-keypad" role="group" aria-label="Teclado numérico">
        {KEYPAD.map((key) => (
          <button
            key={key}
            data-nav
            data-autofocus={key === '1' ? '' : undefined}
            data-key={key}
            className={`action-tile${key === 'ok' ? ' primary' : ''}`}
            aria-label={key === 'delete' ? 'Apagar' : key === 'ok' ? 'Confirmar' : undefined}
            aria-disabled={(key === 'ok' && !pinComplete(pin)) || busy ? true : undefined}
            onClick={() => press(key)}
          >
            {key === 'delete' ? <Icon name="back" className="action-icon" /> : key === 'ok' ? <Icon name="check" className="action-icon" /> : key}
          </button>
        ))}
      </div>
      {problem && (
        <p className="wizard-problem wizard-pin-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="wizard-footer" data-nav-zone="footer" data-nav-row="footer">
        <button data-nav data-cancel className="action-tile" onClick={onCancel}>
          <span>Cancelar</span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- result

const REASONS: Record<'no-folder' | 'denied' | 'failed', string> = {
  'no-folder': 'Este navegador, ou o jeito como a biblioteca foi aberta, não deixa o app gravar na pasta.',
  denied: 'A permissão para gravar na pasta não foi dada.',
  failed: 'Não deu para gravar na pasta.',
};

function DonePage({ result, reread, onWatch, onClose }: { result: SaveResult | ReplaceResult; reread: boolean; onWatch(): void; onClose(): void }) {
  const replaced = 'replaces' in result ? result : null;
  if (result.kind === 'written') {
    return (
      <div className="wizard-done" data-result="written">
        <h2>{replaced ? 'Canal trocado' : 'Canal salvo'}</h2>
        <p>
          O arquivo <code>{result.path}</code> foi gravado na pasta da biblioteca.{' '}
          {reread ? 'O canal já está na troca de canais.' : 'Não consegui reler a biblioteca: escolha a pasta de novo para ver o canal.'}
        </p>
        {replaced?.backupPath && (
          <p data-backup={replaced.backupPath}>
            O canal antigo está guardado em <code>{replaced.backupPath}</code>. A TV não o lê como canal. Para voltar atrás, apague o canal novo e tire o <code>.bak</code> e a data do nome da cópia.
          </p>
        )}
        <div className="wizard-footer" data-nav-zone="footer" data-nav-row="footer">
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
  const name = result.path.slice(result.path.lastIndexOf('/') + 1);
  return (
    <div className="wizard-done" data-result="downloaded">
      <h2>{replaced ? 'Arquivos baixados' : 'Arquivo baixado'}</h2>
      <p>{REASONS[result.reason]} Então o app baixou o canal como arquivo: <code>{name}</code>{replaced?.backupName && <>, e a cópia do canal antigo: <code>{replaced.backupName}</code></>}.</p>
      <p>{replaced ? 'Para trocar o canal:' : 'Para o canal aparecer:'}</p>
      <ol className="wizard-instructions">
        <li>
          {replaced ? (
            <>
              Copie <code>{replaced.backupName ?? 'a cópia'}</code> e <code>{name}</code> (na pasta de downloads) para <code>{where}</code> dentro da biblioteca. Aceite trocar <code>{name}</code>: o antigo continua na cópia <code>.bak</code>, que a TV não lê como canal.
            </>
          ) : (
            <>
              Copie <code>{name}</code> (na pasta de downloads) para <code>{where}</code> dentro da biblioteca. Se a pasta <code>grades</code> não existir, crie.
            </>
          )}
        </li>
        <li>No pendrive ou no Raspberry Pi, é a mesma pasta <code>grades</code> da biblioteca.</li>
        <li>Abra a biblioteca de novo (recarregue a página ou escolha a pasta outra vez). O canal aparece na troca de canais.</li>
      </ol>
      <div className="wizard-footer" data-nav-zone="footer" data-nav-row="footer">
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

function redownload(result: SaveResult | ReplaceResult) {
  if (result.kind !== 'downloaded' || !result.yaml) return;
  downloadText(result.path.slice(result.path.lastIndexOf('/') + 1), result.yaml);
  if ('replaces' in result && result.backupName && result.backupYaml) downloadText(result.backupName, result.backupYaml);
}
