import { describe, expect, it } from 'vitest';
import {
  RANGE_PRESETS,
  ADVANCED_STEPS,
  QUICK_PRESET,
  STEPS,
  advanceLabel,
  advanceNav,
  applyQuickPreset,
  backNav,
  changeStep,
  openStep,
  startNav,
  addRange,
  applyPreset,
  DAYS_CHOICES,
  daysChoiceOf,
  daysSummary,
  existingGradeFiles,
  firstProblemStep,
  initialState,
  movePicked,
  moveRangeEdge,
  nextStep,
  previousStep,
  rangesProblem,
  removeRange,
  slugify,
  stepProblem,
  stepTime,
  toBlocks,
  toGenerateOptions,
  toggleDay,
  togglePicked,
  uniqueFileName,
  gradePath,
  type TimeRange,
  type WizardState,
} from './wizard-model';

const h = (hours: number, minutes = 0) => hours * 3600 + minutes * 60;
const range = (from: number, to: number): TimeRange => ({ start: h(from), end: h(to) });

describe('steps', () => {
  it('are four screens, from "Quando?" to "Salvar", and Back from the first leaves the wizard', () => {
    expect(STEPS.map((step) => step.id)).toEqual(['when', 'shows', 'review', 'save']);
    expect(nextStep('when')).toBe('shows');
    expect(nextStep('review')).toBe('save');
    expect(nextStep('save')).toBe('save');
    expect(previousStep('shows')).toBe('when');
    expect(previousStep('when')).toBeNull();
  });

  it('keeps commercials, bumpers and replacing a channel behind "Ajustes avançados"', () => {
    expect(ADVANCED_STEPS.map((step) => step.id)).toEqual(['advanced', 'commercials', 'bumpers', 'replace']);
    expect(ADVANCED_STEPS.map((step) => step.title)).toEqual(['Ajustes avançados', 'Comerciais', 'Vinhetas', 'Trocar um canal existente']);
    for (const step of ADVANCED_STEPS) expect(STEPS.map((entry) => entry.id)).not.toContain(step.id);
  });
});

describe('navigation between screens', () => {
  it('goes on with Avançar and back with Voltar, and Voltar from the first screen leaves', () => {
    let nav = startNav();
    nav = advanceNav(nav);
    expect(nav.step).toBe('shows');
    nav = advanceNav(nav);
    expect(nav.step).toBe('review');
    expect(backNav(nav)!.step).toBe('shows');
    expect(backNav(backNav(nav)!)!.step).toBe('when');
    expect(backNav(startNav())).toBeNull();
  });

  it('opens the advanced screens from the review and comes back to it', () => {
    const review = advanceNav(advanceNav(startNav()));
    const advanced = openStep(review, 'advanced');
    expect(advanceLabel(advanced)).toBe('Pronto');
    const commercials = openStep(advanced, 'commercials');
    expect(advanceNav(commercials).step).toBe('advanced');
    expect(advanceNav(advanceNav(commercials)).step).toBe('review');
    expect(backNav(commercials)!.step).toBe('advanced');
  });

  it('"Mudar" opens a screen and "Pronto" returns to the one that asked, answers untouched', () => {
    const save = advanceNav(advanceNav(advanceNav(startNav())));
    expect(save.step).toBe('save');
    const changing = changeStep(save, 'shows');
    expect(changing.step).toBe('shows');
    expect(advanceLabel(changing)).toBe('Pronto');
    expect(advanceNav(changing).step).toBe('save');
    expect(backNav(changing)!.step).toBe('save');
    // The same from an advanced screen.
    const bumpers = changeStep(save, 'bumpers');
    expect(advanceNav(bumpers).step).toBe('save');
  });

  it('keeps "Pronto" through the advanced list opened from a screen reached with "Mudar"', () => {
    const save = advanceNav(advanceNav(advanceNav(startNav())));
    const review = changeStep(save, 'review');
    const advanced = openStep(review, 'advanced');
    const back = advanceNav(advanced);
    expect(back.step).toBe('review');
    expect(advanceLabel(back)).toBe('Pronto');
    expect(advanceNav(back).step).toBe('save');
  });

  it('labels the main path "Avançar"', () => {
    expect(advanceLabel(startNav())).toBe('Avançar');
  });
});

describe('the one-press shortcut', () => {
  it('sets the morning range and the weekdays whatever was chosen before', () => {
    const odd = { ...applyPreset(initialState(), 'afternoon'), days: ['sab' as const] };
    const state = applyQuickPreset(odd);
    expect(state.preset).toBe('morning');
    expect(state.ranges).toEqual([range(8, 12)]);
    expect(state.days).toEqual(['seg', 'ter', 'qua', 'qui', 'sex']);
    expect(QUICK_PRESET.label).toBe('Manhã, seg a sex');
  });

  it('is what the wizard already starts with: pressing it on the defaults changes nothing', () => {
    expect(applyQuickPreset(initialState())).toEqual(initialState());
  });
});

describe('time ranges', () => {
  it('has the presets morning, afternoon and both', () => {
    const state = initialState();
    expect(applyPreset(state, 'morning').ranges).toEqual([range(8, 12)]);
    expect(applyPreset(state, 'afternoon').ranges).toEqual([range(14, 18)]);
    expect(applyPreset(state, 'both').ranges).toEqual([range(8, 12), range(14, 18)]);
    expect(RANGE_PRESETS.map((preset) => preset.id)).toContain('custom');
  });

  it('keeps what is on screen when switching to custom, to fine-tune it', () => {
    const both = applyPreset(initialState(), 'both');
    expect(applyPreset(both, 'custom').ranges).toEqual(both.ranges);
    expect(applyPreset(both, 'custom').ranges).not.toBe(both.ranges);
  });

  it('accepts ranges that fit and do not overlap, in any order', () => {
    expect(rangesProblem([range(8, 12)])).toBeNull();
    expect(rangesProblem([range(14, 18), range(8, 12)])).toBeNull();
    expect(rangesProblem([range(8, 12), range(12, 14)])).toBeNull();
  });

  it('refuses no range, too many, an end before the start and overlaps', () => {
    expect(rangesProblem([])).toMatch(/pelo menos uma faixa/);
    expect(rangesProblem([range(8, 9), range(10, 11), range(12, 13), range(14, 15)])).toMatch(/no máximo 3/);
    expect(rangesProblem([range(12, 8)])).toMatch(/terminar depois de começar/);
    expect(rangesProblem([range(8, 8)])).toMatch(/terminar depois/);
    expect(rangesProblem([{ start: h(8), end: h(8, 10) }])).toMatch(/curta demais/);
    expect(rangesProblem([range(8, 12), range(11, 14)])).toMatch(/08:00–12:00 e 11:00–14:00 se sobrepõem/);
  });

  it('steps a time by 15 minutes and stops at the ends of the day', () => {
    expect(stepTime(h(8), 1)).toBe(h(8, 15));
    expect(stepTime(h(8, 7), -1)).toBe(h(7, 45));
    expect(stepTime(0, -1)).toBe(0);
    expect(stepTime(h(23, 45), 1)).toBe(h(23, 45));
  });

  it('never leaves a broken range when an edge moves', () => {
    const ranges = [range(8, 12)];
    expect(moveRangeEdge(ranges, 0, 'end', 1)).toEqual([{ start: h(8), end: h(12, 15) }]);
    // The end stops 15 minutes after the start.
    const short = [{ start: h(8), end: h(8, 15) }];
    expect(moveRangeEdge(short, 0, 'end', -1)).toEqual(short);
    // The start pushes the end along.
    expect(moveRangeEdge(short, 0, 'start', 1)).toEqual([{ start: h(8, 15), end: h(8, 30) }]);
    const moved = moveRangeEdge([range(8, 12), range(14, 18)], 1, 'start', -1);
    expect(moved[0]).toEqual(range(8, 12));
    expect(moved[1]).toEqual({ start: h(13, 45), end: h(18) });
  });

  it('adds a range after the last one up to three, and removes down to one', () => {
    const two = addRange([range(8, 12)]);
    expect(two).toEqual([range(8, 12), range(14, 16)]);
    const three = addRange(two);
    expect(three).toHaveLength(3);
    expect(addRange(three)).toBe(three);
    expect(rangesProblem(three)).toBeNull();
    expect(removeRange(three, 1)).toHaveLength(2);
    expect(removeRange([range(8, 12)], 0)).toHaveLength(1);
  });

  it('turns ranges into blocks in time order, with the length of each', () => {
    expect(toBlocks([range(14, 18), range(8, 11)])).toEqual([
      { start: h(8), length: h(3) },
      { start: h(14), length: h(4) },
    ]);
  });
});

describe('days', () => {
  it('toggles days and names the common choices', () => {
    expect(toggleDay(['seg'], 'ter')).toEqual(['seg', 'ter']);
    expect(toggleDay(['seg', 'ter'], 'seg')).toEqual(['ter']);
    expect(daysSummary(['seg', 'ter', 'qua', 'qui', 'sex'])).toBe('Segunda a sexta');
    expect(daysSummary(['dom', 'sab'])).toBe('Fim de semana');
    expect(daysSummary(['qua', 'seg'])).toBe('Segunda, Quarta');
  });

  it('offers the days as one single choice: three shortcuts and "Escolher dias"', () => {
    expect(DAYS_CHOICES.map((choice) => choice.label)).toEqual(['Seg a sex', 'Fim de semana', 'Todos os dias', 'Escolher dias']);
    expect(daysChoiceOf(['seg', 'ter', 'qua', 'qui', 'sex'], false)).toBe('week');
    expect(daysChoiceOf(['sab', 'dom'], false)).toBe('weekend');
    expect(daysChoiceOf(['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'], false)).toBe('all');
    // Days that match no shortcut can only be "Escolher dias"; so can any days once the person asked to choose.
    expect(daysChoiceOf(['seg', 'qua'], false)).toBe('pick');
    expect(daysChoiceOf(['sab', 'dom'], true)).toBe('pick');
  });
});

describe('shows', () => {
  it('marks and unmarks shows keeping the order they were marked in', () => {
    expect(togglePicked(togglePicked([], 'dbz'), 'pokemon')).toEqual(['dbz', 'pokemon']);
    expect(togglePicked(['dbz', 'pokemon'], 'dbz')).toEqual(['pokemon']);
  });

  it('moves a marked show earlier or later, not past the ends', () => {
    expect(movePicked(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(movePicked(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    const same = ['a', 'b'];
    expect(movePicked(same, 'a', -1)).toBe(same);
    expect(movePicked(same, 'b', 1)).toBe(same);
    expect(movePicked(same, 'zzz', 1)).toBe(same);
  });
});

describe('validation by step', () => {
  const state = initialState();

  it('lets the default answers through', () => {
    expect(firstProblemStep(state, 5)).toBeNull();
  });

  it('needs at least one day', () => {
    expect(stepProblem('when', { ...state, days: [] }, 5)).toMatch(/pelo menos um dia/);
  });

  it('needs at least one show, in either mode', () => {
    expect(stepProblem('shows', state, 0)).toMatch(/não tem programas/);
    expect(stepProblem('shows', { ...state, showMode: 'pick', picked: [] }, 5)).toMatch(/pelo menos um programa/);
    expect(stepProblem('shows', { ...state, showMode: 'pick', picked: ['dbz'] }, 5)).toBeNull();
    expect(stepProblem('shows', { ...state, showMode: 'all' }, 5)).toBeNull();
  });

  it('needs a name that is not blank and not too long', () => {
    expect(stepProblem('review', { ...state, name: '   ' }, 5)).toMatch(/Dê um nome/);
    expect(stepProblem('review', { ...state, name: 'x'.repeat(41) }, 5)).toMatch(/no máximo 40/);
    expect(stepProblem('review', { ...state, name: 'Manhãs' }, 5)).toBeNull();
  });

  it('points to the first step that is not right', () => {
    expect(firstProblemStep({ ...state, days: [], name: '' }, 5)).toBe('when');
    expect(firstProblemStep({ ...state, ranges: [range(8, 12), range(10, 11)], days: [] }, 5)).toBe('when');
  });
});

describe('toGenerateOptions', () => {
  const state: WizardState = {
    ...initialState(),
    preset: 'both',
    ranges: [range(14, 18), range(8, 12)],
    days: ['sex', 'seg', 'qua'],
    showMode: 'pick',
    picked: ['pokemon', 'dbz'],
    name: '  Desenhos da manhã  ',
  };

  it('builds the generator options from the answers', () => {
    expect(toGenerateOptions(state, '2026-03-02')).toEqual({
      name: 'Desenhos da manhã',
      shows: ['pokemon', 'dbz'],
      blocks: [
        { start: h(8), length: h(4) },
        { start: h(14), length: h(4) },
      ],
      days: ['seg', 'qua', 'sex'],
      startDate: '2026-03-02',
      brand: '',
    });
  });

  it('leaves the shows to the generator when all are asked for', () => {
    expect(toGenerateOptions({ ...state, showMode: 'all' }, '2026-03-02').shows).toBeUndefined();
  });

  it('refuses answers that do not pass validation', () => {
    expect(() => toGenerateOptions({ ...state, days: [] }, '2026-03-02')).toThrow(/dia/);
    expect(() => toGenerateOptions({ ...state, ranges: [range(8, 12), range(11, 13)] }, '2026-03-02')).toThrow(/sobrepõem/);
    expect(() => toGenerateOptions({ ...state, showMode: 'pick', picked: [] }, '2026-03-02')).toThrow(/programa/);
    expect(() => toGenerateOptions({ ...state, name: '' }, '2026-03-02')).toThrow(/nome/);
  });
});

describe('file names', () => {
  it('turns a name into letters, digits and hyphens', () => {
    expect(slugify('Desenhos da Manhã!')).toBe('desenhos-da-manha');
    expect(slugify('  TV Gominho (2004)  ')).toBe('tv-gominho-2004');
    expect(slugify('Ação & Aventura')).toBe('acao-aventura');
    expect(slugify('!!!')).toBe('canal');
    expect(slugify('')).toBe('canal');
    expect(slugify('nul')).toBe('nul-canal');
    expect(slugify('a'.repeat(60))).toHaveLength(40);
    expect(slugify('abc-'.repeat(20))).not.toMatch(/-$/);
    expect(slugify('Desenhos da Manhã!')).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it('uses the slug when it is free', () => {
    expect(uniqueFileName('Manhãs', [])).toBe('manhas');
    expect(uniqueFileName('Manhãs', ['grades/tarde.yaml'])).toBe('manhas');
  });

  it('adds -2, -3... while the name is taken, in any case or extension', () => {
    expect(uniqueFileName('Manhãs', ['grades/manhas.yaml'])).toBe('manhas-2');
    expect(uniqueFileName('Manhãs', ['grades/Manhas.YAML', 'manhas-2.yml'])).toBe('manhas-3');
    expect(uniqueFileName('Manhãs', ['manhas', 'manhas-2', 'manhas-3'])).toBe('manhas-4');
  });

  it('puts the file in grades/ under the library root', () => {
    expect(gradePath('', 'manhas')).toBe('grades/manhas.yaml');
    expect(gradePath('biblioteca/', 'manhas')).toBe('biblioteca/grades/manhas.yaml');
  });

  it('finds the grade files of the library, and only those', () => {
    const files = ['grades/a.yaml', 'Grades/B.yml', 'grades/sub/c.yaml', 'grades/nota.txt', 'programas/x/programa.yaml', 'biblioteca/grades/d.yaml'];
    expect(existingGradeFiles(files, '')).toEqual(['grades/a.yaml', 'Grades/B.yml']);
    expect(existingGradeFiles(files, 'biblioteca/')).toEqual(['biblioteca/grades/d.yaml']);
  });
});
