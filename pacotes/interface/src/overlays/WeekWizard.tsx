import {
  formatSpan,
  formatTimeOfDay,
  localIsoDate,
  previewDay,
  scheduleToYaml,
  type DayPreview,
  type Weekday,
  type Library,
  type Schedule,
} from '@tv-gominho/nucleo';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { KeyHints, Overlay } from '../components/Overlay';
import type { Durations } from '../media';
import { useSettings } from '../settings';
import { clickDirection } from '../settings-model';
import { downloadText, replaceGrade, requestWriteAccess, saveGrade, type ReplaceResult, type SaveResult } from '../sources/save';
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
  adSummary,
  applyPreset,
  buildChannel,
  bumperBrands,
  bumperChoice,
  bumperEras,
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
  nextStep,
  planReplace,
  previewDates,
  previousStep,
  removeRange,
  replaceableChannels,
  sortedRanges,
  stepAd,
  stepEra,
  stepIndex,
  stepProblem,
  togglePicked,
  toggleDay,
  gradeFolderFiles,
  uniqueFileName,
  type BuiltChannel,
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

type Phase = { name: 'editing' } | { name: 'saving' } | { name: 'done'; result: SaveResult | ReplaceResult; reread: boolean };

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

/**
 * "Montar a semana": a short sequence of steps (time ranges, days, shows, commercials, bumpers, name, preview, save) that
 * builds a channel with the same generator as `tv-gominho grade` and saves it as a file in grades/: a new one, or in
 * the place of an existing one (with a backup copy of the old file). Everything is reachable with arrows, OK and Back;
 * Back goes one step back, and from the first step closes the wizard.
 */
export function WeekWizard({ source, library, durations, channels, onSaved, onWatch, onBack }: Props) {
  const { settings } = useSettings();
  const [step, setStep] = useState<StepId>('ranges');
  const [state, setState] = useState<WizardState>(() => initialState(settings.adBreaks));
  const [phase, setPhase] = useState<Phase>({ name: 'editing' });
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const body = useRef<HTMLDivElement>(null);

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

  // Entering the preview builds the channel once; it stays for the save step, and any other step forgets it (the answers may change).
  useEffect(() => {
    if (step !== 'preview') {
      if (step !== 'save') setPrepared(null);
      return;
    }
    let current = true;
    setError(null);
    build().then(
      (result) => current && setPrepared(result),
      (failure: Error) => {
        if (!current) return;
        setError(`Não foi possível montar o canal: ${failure.message}`);
        setStep('name');
      },
    );
    return () => {
      current = false;
    };
    // Only the step starts a build: the answers cannot change while the preview is open.
  }, [step]);

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
    // Replacing a channel needs the confirmation of the last step.
    if (problem) return;
    setError(null);
    setPhase({ name: 'saving' });
    // First of all: the permission prompt needs the click that got us here, which long waits below would lose.
    const access = await requestWriteAccess(source);
    try {
      // The channel the preview showed; built again only if the answers changed since.
      const { built, today } = prepared?.key === stateKey ? prepared : await build();
      const yaml = scheduleToYaml(built.generated, [
        `Montada pelo assistente "Montar a semana" em ${today}. Pode editar à vontade (veja docs/grade.md).`,
        'Os horários nos comentários são estimativas, com os intervalos comerciais.',
        ...(built.replaces ? ['Troca a grade anterior, que ficou guardada ao lado, com a data no nome e a terminação .bak.'] : []),
      ]);
      const result = built.replaces
        ? await replaceGrade(source, library, access, built.replaces, today, yaml)
        : await saveGrade(source, library, access, state.name.trim(), yaml, taken);
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
              {state.target ? 'Guardando a cópia de segurança e trocando o canal…' : 'Gravando o canal…'}
            </p>
          ) : (
            <>
              <h2>{STEPS[index]!.help}</h2>
              {step === 'ranges' && <RangesStep state={state} onChange={setState} />}
              {step === 'days' && <DaysStep state={state} onChange={change} />}
              {step === 'shows' && <ShowsStep state={state} library={library} shows={playable} onChange={change} />}
              {step === 'commercials' && <CommercialsStep state={state} library={library} onChange={setState} />}
              {step === 'bumpers' && <BumpersStep state={state} library={library} onChange={setState} />}
              {step === 'name' && <NameStep state={state} fileName={fileName} library={library} onChange={setState} onEnter={goOn} />}
              {step === 'preview' && <PreviewStep prepared={prepared?.key === stateKey ? prepared : null} library={library} durations={durations} />}
              {step === 'save' && (
                <SummaryStep
                  state={state}
                  fileName={fileName}
                  library={library}
                  channels={channels}
                  replacing={replacing}
                  onChange={setState}
                />
              )}
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
              <button data-nav data-save className="action-tile primary" aria-disabled={problem ? true : undefined} onClick={save}>
                <Icon name="check" className="action-icon" />
                <span>{state.target ? 'Trocar o canal' : 'Salvar canal'}</span>
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

function NameStep({
  state,
  fileName,
  library,
  onChange,
  onEnter,
}: {
  state: WizardState;
  fileName: string;
  library: Library;
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
  const channels = replaceableChannels(library);
  const replacing = state.target !== null;
  const target = channels.find((channel) => channel.id === state.target);
  const backupName = target ? planReplace(target, localIsoDate(new Date()), [], library.root).backupName : '';
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
          onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
          onKeyDown={onKeyDown}
          onFocus={(event) => event.target.select()}
        />
      </label>

      <div role="radiogroup" aria-label="Canal novo ou trocar um canal" className="wizard-list">
        <Row
          icon="plus"
          role="radio"
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
          <code>grades/{backupName}</code>, que a TV não lê como canal. Cada programa continua no episódio em que estava hoje.
        </p>
      ) : (
        <p className="panel-note">
          O arquivo vai se chamar <code>grades/{fileName}.yaml</code>.
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- preview

type PreviewView = 'day' | 'week';

/** The clock time of an estimate: "08:22". */
const at = (seconds: number) => formatTimeOfDay(seconds);

function PreviewStep({ prepared, library, durations }: { prepared: Prepared | null; library: Library; durations: Durations }) {
  const { settings } = useSettings();
  const [view, setView] = useState<PreviewView>('day');
  const [day, setDay] = useState(0);
  // Bumps when the durations of the days' videos have been read, to lay the days out again with the real lengths.
  const [loaded, setLoaded] = useState(0);
  const [reading, setReading] = useState(false);

  const schedule = prepared?.built.generated.schedule;
  const today = prepared?.today;
  const dates = useMemo(() => (today ? previewDates(today) : []), [today]);
  const days = useMemo<DayPreview[]>(
    () => (schedule ? dates.map((date) => previewDay(schedule, library, date, { settings, durationOf: durations.get })) : []),
    // `loaded` stands for "durations.get answers differently now".
    [schedule, library, settings, dates, durations, loaded],
  );

  // Read the durations of what the week airs (the plan of each day decides which files), then lay the days out again.
  useEffect(() => {
    if (!schedule) return;
    const paths = [...new Set(dates.flatMap((date) => previewDay(schedule, library, date, { settings, durationOf: durations.get }).paths))];
    let current = true;
    setReading(true);
    durations.load(paths).finally(() => {
      if (!current) return;
      setReading(false);
      setLoaded((count) => count + 1);
    });
    return () => {
      current = false;
    };
  }, [schedule, library, settings, dates, durations]);

  if (!prepared || !schedule) {
    return (
      <p className="wizard-busy" role="status">
        Montando o canal… Lendo a duração dos vídeos para os horários fecharem certinho.
      </p>
    );
  }

  const titleOf = (id: string) => library.shows.find((show) => show.id === id)?.title ?? id;
  const selected = days[day]!;
  // One line per message; in the week view, with the days it applies to.
  const warned = new Map<string, { kind: string; days: string[] }>();
  days.forEach((preview, i) => {
    for (const warning of preview.warnings) {
      const entry = warned.get(warning.message) ?? { kind: warning.kind, days: [] };
      warned.set(warning.message, { ...entry, days: [...entry.days, dayLabel(dates[i]!)] });
    }
  });
  const warnings =
    view === 'day'
      ? selected.warnings.map((warning) => ({ message: warning.message, kind: warning.kind, days: [] as string[] }))
      : [...warned].map(([message, entry]) => ({ message, ...entry }));
  const guessed = days.some((preview) => preview.estimated);

  return (
    <>
      <div className="wizard-chips" role="group" aria-label="Ver">
        {(['day', 'week'] as const).map((name) => (
          <button
            key={name}
            data-nav
            data-autofocus={view === name ? '' : undefined}
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

      {warnings.map((warning) => (
        <p key={warning.message} className="wizard-warning" role="note" tabIndex={0} data-nav data-warning={warning.kind}>
          <Icon name="alert" className="row-lead" />
          <span>
            {warning.message}
            {warning.days.length > 0 && <em> ({warning.days.length === dates.length ? 'todos os dias' : warning.days.join(', ')})</em>}
          </span>
        </p>
      ))}

      {view === 'day' ? (
        <DayList preview={selected} titleOf={titleOf} />
      ) : (
        <ul className="preview-week" aria-label="A semana">
          {days.map((preview, i) => (
            <li key={preview.date} className="preview-day" tabIndex={0} data-nav data-day-section={preview.date}>
              <strong>{dayLabel(dates[i]!)}</strong>
              {preview.airs ? (
                <span className="preview-chips">
                  {preview.rows.map((row) => (
                    <span key={`${row.start}-${row.episodeIndex}`} className="preview-chip">
                      <b>{at(row.start)}</b> {titleOf(row.show.id)} <i>{episodeNumber(row.episode.number, row.episodeIndex)}</i>
                    </span>
                  ))}
                </span>
              ) : (
                <span className="row-meta">O canal não passa neste dia.</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="panel-note" data-note="estimate">
        {guessed
          ? 'Estimado: alguns vídeos ainda não tiveram a duração lida, então valem durações típicas (22 minutos por episódio) e os horários são aproximados. '
          : reading
            ? 'Lendo a duração dos vídeos da semana… os horários podem mudar um pouco. '
            : 'Horários calculados com a duração real dos vídeos. '}
        Os intervalos comerciais já contam. Cada bloco começa na hora marcada, a menos que o anterior passe dela.
      </p>
    </>
  );
}

/** "ep. 12"; an episode with no number in its file name is shown by its place in the show ("#3"). */
function episodeNumber(number: number | null, index: number): string {
  return number === null ? `#${index + 1}` : `ep. ${number}`;
}

function DayList({ preview, titleOf }: { preview: DayPreview; titleOf(id: string): string }) {
  if (!preview.airs) return <p className="panel-note">O canal não passa neste dia: não está entre os dias escolhidos.</p>;
  if (preview.rows.length === 0) return <p className="panel-note">Nada a mostrar neste dia.</p>;
  return (
    <ul className="preview-list" aria-label="Programação do dia">
      {preview.rows.map((row, i) => {
        const newBlock = i === 0 || preview.rows[i - 1]!.block !== row.block;
        return (
          <li key={`${row.start}-${row.episodeIndex}`} className="preview-row" tabIndex={0} data-nav data-row={i}>
            {newBlock && <span className="preview-block">Bloco das {at(preview.blocks[row.block]!.start)}</span>}
            <span className="preview-time">{at(row.start)}</span>
            <span className="row-text">
              <span className="row-label">{titleOf(row.show.id)}</span>
              <span className="row-meta">
                {episodeNumber(row.episode.number, row.episodeIndex)}
                {row.episode.title ? ` · ${row.episode.title}` : ''} · {formatSpan(row.end - row.start)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SummaryStep({
  state,
  fileName,
  library,
  channels,
  replacing,
  onChange,
}: {
  state: WizardState;
  fileName: string;
  library: Library;
  channels: Schedule[];
  replacing: Schedule | null;
  onChange(update: (state: WizardState) => WizardState): void;
}) {
  const { settings } = useSettings();
  const shows =
    state.showMode === 'all'
      ? 'Todos os programas'
      : state.picked.map((id) => library.shows.find((show) => show.id === id)?.title ?? id).join(' → ');
  const choice = bumperChoice(library, state);
  const lines: Array<[string, string]> = [
    ['Canal', state.name.trim()],
    ['Horários', sortedRanges(state.ranges).map(formatRange).join(' e ')],
    ['Dias', daysSummary(state.days)],
    ['Programas', shows],
    ['Comerciais', state.adMode === 'custom' ? `Regras próprias: ${adSummary(state.ad)}` : `Configuração geral: ${adSummary(settings.adBreaks)}`],
    [
      'Vinhetas',
      `${state.brand === '' ? 'Qualquer marca' : state.brand}, ${state.era === null ? 'qualquer época' : state.era}${choice[0]!.ref ? ` · abertura ${choice[0]!.ref}` : ''}`,
    ],
    ['Arquivo', `${library.root}grades/${fileName}.yaml`],
  ];
  const lostAgenda = replacing?.agenda?.length ?? 0;
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
          No Chrome e no Edge, o app pede permissão para gravar na pasta só quando você salva. Nos outros casos, o arquivo é baixado.
        </p>
      )}
    </>
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

function redownload(result: SaveResult | ReplaceResult) {
  if (result.kind !== 'downloaded' || !result.yaml) return;
  downloadText(result.path.slice(result.path.lastIndexOf('/') + 1), result.yaml);
  if ('replaces' in result && result.backupName && result.backupYaml) downloadText(result.backupName, result.backupYaml);
}
