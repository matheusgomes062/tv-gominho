import { planDay, scanLibrary, type Library, type LibrarySource, type Schedule } from '@tv-gominho/nucleo';
import { describe, expect, it } from 'vitest';
import {
  MAX_COUNT,
  addBlock,
  addItem,
  buildEditor,
  checkEditor,
  defaultItem,
  editedYaml,
  interstitialCategories,
  isDirty,
  moveItem,
  newestBlock,
  openEditor,
  prepareSave,
  refCategory,
  refChoices,
  refIsFile,
  removeBlock,
  removeItem,
  setBlockTime,
  setDays,
  setDescription,
  setName,
  settleBlocks,
  timeProblem,
  toggleDay,
  updateItem,
  type EditorState,
} from './editor-model';

function memorySource(files: Record<string, string>): LibrarySource {
  return {
    files: Object.keys(files),
    async readText(path) {
      const text = files[path];
      if (text === undefined) throw new Error(`No such file: ${path}`);
      return text;
    },
  };
}

const GRADE = `nome: Manhãs da Turma
descricao: Programação das manhãs.
data_inicio: 2003-03-03
dias: [seg, ter, qua, qui, sex]
vinhetas_intervalo: intervalos/tv-globinho
intervalos:
  a_cada: 11
  comerciais: 2

blocos:
  - horario: "08:00"
    itens:
      - vinheta: aberturas/2003
      - programa: dbz
      - comerciais: 3
      - programa: bob
        episodios: 2
  - horario: "10:30"
    itens:
      - programa: dbz
      - vinheta: encerramentos

agenda:
  "2003-03-05":
    - bloco: "08:00"
      item: 2
      episodio: 4
    - bloco: "08:00"
      item: 4
      episodio: 2
    - bloco: "10:30"
      item: 1
      episodio: 1

posicoes:
  "2003-03-10":
    dbz: 2
`;

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`programas/dbz/episodios/00${n}.mp4`, ''])),
  'programas/bob/programa.yaml': 'titulo: Bob',
  ...Object.fromEntries([1, 2, 3].map((n) => [`programas/bob/episodios/00${n}.mp4`, ''])),
  'programas/digimon/programa.yaml': 'titulo: Digimon',
  'programas/digimon/episodios/001.mp4': '',
  'vinhetas/aberturas/2003/a1.mp4': '',
  'vinhetas/aberturas/2003/a2.mp4': '',
  'vinhetas/aberturas/2004/b1.mp4': '',
  'vinhetas/aberturas/solta.mp4': '',
  'vinhetas/encerramentos/fim.mp4': '',
  'vinhetas/intervalos/tv-globinho/entrada.mp4': '',
  'vinhetas/comerciais/c1.mp4': '',
  'grades/manhas.yaml': GRADE,
};

async function setup(grade = GRADE): Promise<{ library: Library; schedule: Schedule }> {
  const library = await scanLibrary(memorySource({ ...FILES, 'grades/manhas.yaml': grade }));
  return { library, schedule: library.schedules.find((entry) => entry.id === 'manhas')! };
}

/** A grade parsed from the text, without anything the engine added; the path is not part of the comparison. */
const shape = (schedule: Schedule) => ({ ...schedule, path: '' });

const stateOf = async (grade?: string) => {
  const { library, schedule } = await setup(grade);
  return { library, schedule, state: openEditor(schedule) };
};

const block = (state: EditorState, time: string) => state.blocks.find((entry) => entry.time === time)!;
const keyOf = (state: EditorState, time: string, index: number) => block(state, time).items[index]!.key;
const typesOf = (state: EditorState, time: string) => block(state, time).items.map((item) => item.type);

describe('opening a grade', () => {
  it('shows the blocks and items as they are in the file', async () => {
    const { state } = await stateOf();
    expect(state.name).toBe('Manhãs da Turma');
    expect(state.description).toBe('Programação das manhãs.');
    expect(state.days).toEqual(['seg', 'ter', 'qua', 'qui', 'sex']);
    expect(state.blocks.map((entry) => entry.time)).toEqual(['08:00', '10:30']);
    expect(block(state, '08:00').items.map(({ key: _key, from: _from, ...item }) => item)).toEqual([
      { type: 'interstitial', ref: 'aberturas/2003' },
      { type: 'show', show: 'dbz', count: 1 },
      { type: 'commercials', count: 3 },
      { type: 'show', show: 'bob', count: 2 },
    ]);
    expect(state.path).toBe('grades/manhas.yaml');
  });

  it('is not changed until something is edited', async () => {
    const { state } = await stateOf();
    expect(isDirty(state)).toBe(false);
    expect(isDirty(setName(state, 'Outro'))).toBe(true);
    expect(isDirty(setName(setName(state, 'Outro'), 'Manhãs da Turma'))).toBe(false);
  });

  it('keeps the times with seconds a hand-written grade may have', async () => {
    const { state } = await stateOf(GRADE.replace('"10:30"', '"10:30:15"').replace('bloco: "10:30"', 'bloco: "10:30:15"'));
    expect(state.blocks.map((entry) => entry.time)).toEqual(['08:00', '10:30:15']);
    expect(editedYaml(buildEditor(state).schedule, '2026-10-22')).toContain('horario: "10:30:15"');
  });
});

describe('saving without edits', () => {
  it('writes a grade that reads back the same, with every section the editor does not touch', async () => {
    const { schedule, state } = await stateOf();
    const { schedule: built, droppedPicks } = buildEditor(state);
    expect(droppedPicks).toEqual([]);
    expect(built).toEqual(schedule);

    const yaml = editedYaml(built, '2026-10-22');
    const read = await setup(yaml);
    expect(shape(read.schedule)).toEqual(shape(schedule));
    expect(read.library.warnings).toEqual([]);
    for (const section of ['data_inicio: 2003-03-03', 'vinhetas_intervalo: "intervalos/tv-globinho"', 'a_cada: 11', 'comerciais: 2', 'agenda:', 'posicoes:']) {
      expect(yaml).toContain(section);
    }
  });

  it('adds no saved positions when only the channel name changes', async () => {
    const { library, schedule, state } = await stateOf();
    const { schedule: saved } = prepareSave(setName(state, 'Novo nome'), library, '2026-10-22');
    expect(saved).toEqual({ ...schedule, name: 'Novo nome' });
  });

  it('airs exactly the same episodes for weeks, even if the positions were recomputed', async () => {
    const { library, schedule, state } = await stateOf();
    const { schedule: saved } = prepareSave(state, library, '2003-03-05');
    const dates = ['2003-03-03', '2003-03-05', '2003-03-06', '2003-03-10', '2003-03-14', '2003-04-01'];
    for (const date of dates) expect(planDay(saved, library, date)).toEqual(planDay(schedule, library, date));
  });
});

describe('blocks', () => {
  it('adds a block two hours after the last one, empty or with items, and keeps them sorted', async () => {
    const { state } = await stateOf();
    const added = addBlock(state, [{ type: 'show', show: 'digimon', count: 1 }]);
    expect(added.blocks.map((entry) => entry.time)).toEqual(['08:00', '10:30', '12:30']);
    expect(newestBlock(added)!.time).toBe('12:30');
    expect(newestBlock(added)!.items).toHaveLength(1);
    expect(addBlock(state).blocks.at(-1)!.items).toEqual([]);
  });

  it('starts the first block at 08:00 and never reuses a time', async () => {
    const { state } = await stateOf();
    const empty = removeBlock(removeBlock(state, state.blocks[0]!.key), state.blocks[1]!.key);
    expect(addBlock(empty).blocks.map((entry) => entry.time)).toEqual(['08:00']);
    const late = addBlock(setBlockTime(state, state.blocks[1]!.key, '22:00'));
    expect(late.blocks.map((entry) => entry.time)).toEqual(['00:00', '08:00', '22:00']);
    const times = new Set(addBlock(addBlock(late)).blocks.map((entry) => entry.time));
    expect(times.size).toBe(5);
  });

  it('removes a block', async () => {
    const { state } = await stateOf();
    const removed = removeBlock(state, state.blocks[0]!.key);
    expect(removed.blocks.map((entry) => entry.time)).toEqual(['10:30']);
  });

  it('keeps a half-typed time as it is and sorts the blocks once it is settled', async () => {
    const { state } = await stateOf();
    const first = state.blocks[0]!.key;
    const typing = setBlockTime(state, first, '12:');
    expect(typing.blocks.map((entry) => entry.time)).toEqual(['12:', '10:30']);
    expect(settleBlocks(typing).blocks.map((entry) => entry.time)).toEqual(['10:30', '12:']);

    const moved = settleBlocks(setBlockTime(state, first, '12:05'));
    expect(moved.blocks.map((entry) => entry.time)).toEqual(['10:30', '12:05']);
    expect(moved.blocks[1]!.key).toBe(first);
  });

  it('writes valid times in the HH:MM form', async () => {
    const { state } = await stateOf();
    const settled = settleBlocks(setBlockTime(state, state.blocks[0]!.key, '9:15'));
    expect(settled.blocks.map((entry) => entry.time)).toEqual(['09:15', '10:30']);
  });

  it('accepts HH:MM and rejects anything else', () => {
    expect(timeProblem('08:00')).toBeNull();
    expect(timeProblem('8:00')).toBeNull();
    expect(timeProblem('23:59')).toBeNull();
    expect(timeProblem('')).toMatch(/horário/);
    for (const bad of ['24:00', '12:60', '8', '08h00', 'manhã', '08:0', '12:00:99']) expect(timeProblem(bad), bad).toMatch(/não é um horário/);
  });

  it('refuses two blocks at the same start and says which', async () => {
    const { state } = await stateOf();
    const clash = setBlockTime(state, state.blocks[1]!.key, '8:00');
    const check = checkEditor(clash);
    expect(check.errors).toEqual(['Dois blocos começam às 08:00. Cada bloco precisa de um horário só dele.']);
    expect(Object.keys(check.blocks)).toHaveLength(2);
    expect(() => buildEditor(clash)).toThrow(/Dois blocos/);
  });

  it('refuses a block without items, and a grade without blocks', async () => {
    const { state } = await stateOf();
    const empty = addBlock(state);
    expect(checkEditor(empty).errors).toEqual(['O bloco das 12:30 está sem itens.']);
    const none = removeBlock(removeBlock(state, state.blocks[0]!.key), state.blocks[1]!.key);
    expect(checkEditor(none).errors).toEqual(['O canal precisa de pelo menos um bloco.']);
  });

  it('builds the blocks in time order whatever the order on screen', async () => {
    const { state } = await stateOf();
    const swapped = setBlockTime(setBlockTime(state, state.blocks[0]!.key, '11:00'), state.blocks[1]!.key, '07:00');
    expect(buildEditor(swapped).schedule.blocks.map((entry) => entry.start)).toEqual([7 * 3600, 11 * 3600]);
  });
});

describe('items', () => {
  it('adds an item at the end of a block', async () => {
    const { state, library } = await stateOf();
    const at = block(state, '10:30').key;
    const added = addItem(addItem(state, at, defaultItem('commercials', library)), at, { type: 'show', show: 'bob', count: 3 });
    expect(typesOf(added, '10:30')).toEqual(['show', 'interstitial', 'commercials', 'show']);
    expect(block(added, '10:30').items.at(-1)).toMatchObject({ show: 'bob', count: 3 });
    const keys = block(added, '10:30').items.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('removes an item', async () => {
    const { state } = await stateOf();
    const removed = removeItem(state, block(state, '08:00').key, keyOf(state, '08:00', 2));
    expect(typesOf(removed, '08:00')).toEqual(['interstitial', 'show', 'show']);
  });

  it('moves an item up and down, and stops at the ends', async () => {
    const { state } = await stateOf();
    const at = block(state, '08:00').key;
    const shows = (s: EditorState) => block(s, '08:00').items.map((item) => (item.type === 'show' ? item.show : item.type));
    expect(shows(state)).toEqual(['interstitial', 'dbz', 'commercials', 'bob']);
    expect(shows(moveItem(state, at, keyOf(state, '08:00', 3), -1))).toEqual(['interstitial', 'dbz', 'bob', 'commercials']);
    expect(shows(moveItem(state, at, keyOf(state, '08:00', 0), 1))).toEqual(['dbz', 'interstitial', 'commercials', 'bob']);
    expect(shows(moveItem(state, at, keyOf(state, '08:00', 0), -1))).toEqual(shows(state));
    expect(shows(moveItem(state, at, keyOf(state, '08:00', 3), 1))).toEqual(shows(state));
  });

  it('changes the quantity of episodes, the show, the vinheta and the commercials', async () => {
    const { state } = await stateOf();
    const at = block(state, '08:00').key;
    let next = updateItem(state, at, keyOf(state, '08:00', 3), { count: 4 });
    next = updateItem(next, at, keyOf(state, '08:00', 1), { show: 'digimon' });
    next = updateItem(next, at, keyOf(state, '08:00', 0), { ref: 'aberturas/2004/b1.mp4' } as never);
    next = updateItem(next, at, keyOf(state, '08:00', 2), { count: 5 });
    const built = buildEditor(next).schedule.blocks[0]!.items;
    expect(built).toEqual([
      { type: 'interstitial', ref: 'aberturas/2004/b1.mp4' },
      { type: 'show', show: 'digimon', count: 1 },
      { type: 'commercials', count: 5 },
      { type: 'show', show: 'bob', count: 4 },
    ]);
  });

  it('does not turn an item into another kind', async () => {
    const { state } = await stateOf();
    const changed = updateItem(state, block(state, '08:00').key, keyOf(state, '08:00', 2), { type: 'show', show: 'bob', count: 1 });
    expect(changed).toEqual(state);
  });

  it('starts new items from the library', async () => {
    const { library } = await stateOf();
    expect(defaultItem('show', library)).toEqual({ type: 'show', show: 'bob', count: 1 });
    expect(defaultItem('interstitial', library)).toEqual({ type: 'interstitial', ref: 'aberturas' });
    expect(defaultItem('commercials', library)).toEqual({ type: 'commercials', count: 3 });
  });

  it('refuses quantities that are not a whole number from 1 up', async () => {
    const { state } = await stateOf();
    const at = block(state, '08:00').key;
    for (const bad of [0, -1, 1.5, Number.NaN, MAX_COUNT + 1]) {
      const check = checkEditor(updateItem(state, at, keyOf(state, '08:00', 3), { count: bad }));
      expect(check.errors, String(bad)).toEqual([`Use de 1 a ${MAX_COUNT} episódios.`]);
      expect(check.items[keyOf(state, '08:00', 3)]).toBeDefined();
    }
    expect(checkEditor(updateItem(state, at, keyOf(state, '08:00', 2), { count: 0 })).errors).toEqual([`Use de 1 a ${MAX_COUNT} comerciais.`]);
    expect(checkEditor(updateItem(state, at, keyOf(state, '08:00', 3), { count: MAX_COUNT })).errors).toEqual([]);
  });

  it('refuses an item with nothing chosen', async () => {
    const { state } = await stateOf();
    const at = block(state, '08:00').key;
    expect(checkEditor(updateItem(state, at, keyOf(state, '08:00', 1), { show: ' ' })).errors).toEqual(['Escolha o programa.']);
    expect(checkEditor(updateItem(state, at, keyOf(state, '08:00', 0), { ref: '' } as never)).errors).toEqual(['Escolha a vinheta.']);
  });
});

describe('choosing a vinheta', () => {
  it('lists the categories of the library, plus the one a grade already uses', async () => {
    const { library } = await stateOf();
    expect(interstitialCategories(library)).toEqual(['aberturas', 'comerciais', 'encerramentos', 'intervalos']);
    expect(interstitialCategories(library, 'Chamadas')).toContain('chamadas');
  });

  it('offers the whole category, each subfolder to draw from and each specific file', async () => {
    const { library } = await stateOf();
    expect(refChoices(library, 'aberturas').map(({ ref, kind, count }) => [ref, kind, count])).toEqual([
      ['aberturas', 'category', 4],
      ['aberturas/2003', 'folder', 2],
      ['aberturas/2004', 'folder', 1],
      ['aberturas/2003/a1.mp4', 'file', 1],
      ['aberturas/2003/a2.mp4', 'file', 1],
      ['aberturas/2004/b1.mp4', 'file', 1],
      ['aberturas/solta.mp4', 'file', 1],
    ]);
    expect(refChoices(library, 'aberturas').map((choice) => choice.label).slice(0, 3)).toEqual([
      'Sortear de toda a pasta aberturas',
      'Sortear da pasta 2003',
      'Sortear da pasta 2004',
    ]);
  });

  it('offers nested subfolders at every depth', async () => {
    const library = await scanLibrary(memorySource({ 'vinhetas/intervalos/tv-globinho/2003/a.mp4': '', 'vinhetas/intervalos/tv-globinho/2003/b.mp4': '' }));
    expect(refChoices(library, 'intervalos').map((choice) => choice.ref)).toEqual([
      'intervalos',
      'intervalos/tv-globinho',
      'intervalos/tv-globinho/2003',
      'intervalos/tv-globinho/2003/a.mp4',
      'intervalos/tv-globinho/2003/b.mp4',
    ]);
  });

  it('tells a file from a folder and finds the category', () => {
    expect(refIsFile('aberturas/2003/a1.mp4')).toBe(true);
    expect(refIsFile('aberturas/2003')).toBe(false);
    expect(refCategory('Aberturas/2003')).toBe('aberturas');
  });

  it('writes whichever was chosen as the vinheta of the grade', async () => {
    const { state, library } = await stateOf();
    const at = block(state, '08:00').key;
    for (const choice of refChoices(library, 'aberturas')) {
      const built = buildEditor(updateItem(state, at, keyOf(state, '08:00', 0), { ref: choice.ref } as never)).schedule;
      expect(built.blocks[0]!.items[0]).toEqual({ type: 'interstitial', ref: choice.ref });
    }
  });
});

describe('warnings for what the library does not have', () => {
  it('reuses the messages of the grade', async () => {
    const { state, library } = await stateOf();
    const at = block(state, '08:00').key;
    let next = updateItem(state, at, keyOf(state, '08:00', 1), { show: 'naoexiste' });
    next = updateItem(next, at, keyOf(state, '08:00', 0), { ref: 'aberturas/1999' } as never);
    const check = checkEditor(next, library);
    expect(check.errors).toEqual([]);
    expect(check.warnings[keyOf(state, '08:00', 1)]).toBe('A grade usa o programa "naoexiste", que não existe em programas/. Ele será pulado.');
    expect(check.warnings[keyOf(state, '08:00', 0)]).toBe('A grade usa a vinheta "aberturas/1999", que não existe em vinhetas/. Ela será pulada.');
    expect(Object.keys(check.warnings)).toHaveLength(2);

    // Word for word what the library reading says about the same grade.
    const text = (await setup(editedYaml(buildEditor(next).schedule, '2026-10-22'))).library.warnings.map((warning) => warning.message);
    expect(text).toContain(check.warnings[keyOf(state, '08:00', 1)]);
    expect(text).toContain(check.warnings[keyOf(state, '08:00', 0)]);
  });

  it('does not warn about a grade that is fine, and still lets one with warnings be saved', async () => {
    const { state, library } = await stateOf();
    expect(checkEditor(state, library).warnings).toEqual({});
    const broken = updateItem(state, block(state, '08:00').key, keyOf(state, '08:00', 1), { show: 'naoexiste' });
    expect(() => buildEditor(broken)).not.toThrow();
  });
});

describe('name, description and days', () => {
  it('edits them and writes them to the grade', async () => {
    const { state } = await stateOf();
    let next = setName(state, '  Tardes  ');
    next = setDescription(next, 'Só à tarde.');
    next = setDays(next, ['sab', 'dom']);
    const built = buildEditor(next).schedule;
    expect(built.name).toBe('Tardes');
    expect(built.description).toBe('Só à tarde.');
    expect(built.days).toEqual(['dom', 'sab']);
  });

  it('drops the description when it is cleared', async () => {
    const { state } = await stateOf();
    const built = buildEditor(setDescription(state, '  ')).schedule;
    expect('description' in built).toBe(false);
    expect(editedYaml(built, '2026-10-22')).not.toContain('descricao');
  });

  it('turns days on and off in the order of the week', async () => {
    const { state } = await stateOf();
    expect(toggleDay(state, 'sab').days).toEqual(['sab', 'seg', 'ter', 'qua', 'qui', 'sex'].sort((a, b) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'].indexOf(a) - ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'].indexOf(b)));
    expect(toggleDay(state, 'seg').days).toEqual(['ter', 'qua', 'qui', 'sex']);
  });

  it('refuses an empty name, a name that is too long and no days', async () => {
    const { state } = await stateOf();
    expect(checkEditor(setName(state, '   ')).errors).toEqual(['Dê um nome ao canal.']);
    expect(checkEditor(setName(state, 'x'.repeat(61))).errors[0]).toMatch(/no máximo 60/);
    expect(checkEditor(setDays(state, [])).errors).toEqual(['Escolha pelo menos um dia da semana.']);
    expect(checkEditor(setDescription(state, 'x'.repeat(301))).errors[0]).toMatch(/descrição/);
  });
});

describe('what the editor does not edit', () => {
  it('keeps data_inicio, vinhetas_intervalo and the break rules whatever is edited', async () => {
    const { state } = await stateOf();
    let next = addBlock(state, [{ type: 'show', show: 'digimon', count: 1 }]);
    next = setDays(next, ['seg', 'ter']);
    const built = buildEditor(next).schedule;
    expect(built.startDate).toBe('2003-03-03');
    expect(built.breakBumpersRef).toBe('intervalos/tv-globinho');
    expect(built.adBreaks).toEqual({ every: 11, ads: 2 });
    expect(built.id).toBe('manhas');
  });

  it('keeps the agenda on the same items when blocks move and items are reordered', async () => {
    const { state } = await stateOf();
    // The 10:30 block goes to 07:00 (first), and in the 08:00 block bob and the commercials swap places.
    let next = setBlockTime(state, block(state, '10:30').key, '07:00');
    next = moveItem(next, block(next, '08:00').key, keyOf(next, '08:00', 3), -1);
    const built = buildEditor(next);
    expect(built.droppedPicks).toEqual([]);
    expect(built.schedule.agenda).toEqual([
      { date: '2003-03-05', blockStart: 7 * 3600, item: 1, episode: '1' },
      { date: '2003-03-05', blockStart: 8 * 3600, item: 2, episode: '4' },
      { date: '2003-03-05', blockStart: 8 * 3600, item: 3, episode: '2' },
    ]);
    // ...which the grade reads back without a warning.
    const read = await setup(editedYaml(built.schedule, '2026-10-22'));
    expect(read.library.warnings).toEqual([]);
    expect(read.schedule.agenda).toEqual(built.schedule.agenda);
  });

  it('drops the agenda choices of removed items, other shows, removed blocks and turned-off days', async () => {
    const { state } = await stateOf();
    const at = block(state, '08:00').key;
    const removed = buildEditor(removeItem(state, at, keyOf(state, '08:00', 3)));
    expect(removed.droppedPicks.map((pick) => pick.item)).toEqual([4]);
    expect(removed.schedule.agenda).toHaveLength(2);

    const swapped = buildEditor(updateItem(state, at, keyOf(state, '08:00', 1), { show: 'digimon' }));
    expect(swapped.droppedPicks.map((pick) => [pick.blockStart, pick.item])).toEqual([[8 * 3600, 2]]);

    const noBlock = buildEditor(removeBlock(state, block(state, '10:30').key));
    expect(noBlock.droppedPicks.map((pick) => pick.blockStart)).toEqual([10.5 * 3600]);

    // 2003-03-05 is a Wednesday.
    const noWednesday = buildEditor(toggleDay(state, 'qua'));
    expect(noWednesday.droppedPicks).toHaveLength(3);
    expect(noWednesday.schedule.agenda).toBeUndefined();

    const added = buildEditor(addItem(state, at, { type: 'show', show: 'bob', count: 1 }));
    expect(added.droppedPicks).toEqual([]);
  });

  it('keeps the agenda of a show that changes only in quantity or case', async () => {
    const { state } = await stateOf();
    const at = block(state, '08:00').key;
    const next = updateItem(updateItem(state, at, keyOf(state, '08:00', 3), { count: 1 }), at, keyOf(state, '08:00', 1), { show: 'DBZ' });
    expect(buildEditor(next).droppedPicks).toEqual([]);
  });

  it('drops the saved positions of shows that left the blocks, and of days turned off', async () => {
    const { state } = await stateOf();
    // 2003-03-10 is a Monday; dbz is saved on it.
    expect(buildEditor(state).schedule.positions).toEqual([{ date: '2003-03-10', show: 'dbz', episode: '2' }]);
    let next = removeItem(state, block(state, '08:00').key, keyOf(state, '08:00', 1));
    next = removeItem(next, block(next, '10:30').key, keyOf(next, '10:30', 0));
    expect(buildEditor(next).schedule.positions).toBeUndefined();
    expect(buildEditor(toggleDay(state, 'seg')).schedule.positions).toBeUndefined();
  });
});

describe('saving with saved positions', () => {
  it('keeps every show where it was after more airings per day', async () => {
    const { state, library, schedule } = await stateOf();
    const at = block(state, '10:30').key;
    const next = addItem(addItem(state, at, { type: 'show', show: 'bob', count: 1 }), at, { type: 'show', show: 'dbz', count: 2 });
    const date = '2003-03-12';
    const { schedule: saved } = prepareSave(next, library, date);

    const episodes = (grade: Schedule, show: string, day: string) =>
      planDay(grade, library, day).blocks.flatMap((b) => b.items.flatMap((item) => (item.kind === 'episode' && item.show.id === show ? [item.episodeIndex] : [])));
    const first = (list: number[]) => list[0];
    for (const show of ['dbz', 'bob']) {
      // The new grade starts the show on the edit date where the old one had it...
      expect(first(episodes(saved, show, date))).toBe(first(episodes(schedule, show, date)));
    }
    // ...and goes on from there without a jump.
    expect(saved.positions!.some((position) => position.date === date && position.show === 'dbz')).toBe(true);
  });

  it('records positions when the days change, since days off do not spend episodes', async () => {
    const { state, library } = await stateOf();
    const { schedule: saved } = prepareSave(toggleDay(state, 'sex'), library, '2003-03-12');
    expect(saved.positions!.some((position) => position.date === '2003-03-12')).toBe(true);
  });

  it('refuses to save an invalid grade', async () => {
    const { state, library } = await stateOf();
    expect(() => prepareSave(setName(state, ''), library, '2026-10-22')).toThrow(/nome/);
  });
});

describe('the file', () => {
  it('quotes show names YAML could read as something else, and reads them back', async () => {
    const odd = await scanLibrary(
      memorySource({
        'programas/007/programa.yaml': 'titulo: Zero zero sete',
        'programas/007/episodios/001.mp4': '',
        'programas/a: b/episodios/001.mp4': '',
        'grades/x.yaml': 'blocos:\n  - horario: "08:00"\n    itens:\n      - programa: "007"\n      - programa: "a: b"\n',
      }),
    );
    const schedule = odd.schedules[0]!;
    const yaml = editedYaml(buildEditor(openEditor(schedule)).schedule, '2026-10-22');
    expect(yaml).toContain('programa: "007"');
    const again = await scanLibrary(memorySource({ 'programas/007/episodios/001.mp4': '', 'programas/a: b/episodios/001.mp4': '', 'grades/x.yaml': yaml }));
    expect(again.schedules[0]!.blocks).toEqual(schedule.blocks);
  });

  it('says in a comment who edited it, without estimated times', async () => {
    const { state } = await stateOf();
    const yaml = editedYaml(buildEditor(state).schedule, '2026-10-22');
    expect(yaml.startsWith('# Editada pelo app em 2026-10-22.')).toBe(true);
    expect(yaml).not.toContain('no fim, com os intervalos');
  });
});
