import { localIsoDate, type Library, type Schedule, type ScheduleItem, type Weekday } from '@tv-gominho/nucleo';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { KeyHints, Overlay } from '../components/Overlay';
import {
  MAX_COUNT,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  addBlock,
  addItem,
  checkEditor,
  defaultItem,
  editedYaml,
  hasHandComments,
  interstitialCategories,
  isDirty,
  moveItem,
  newestBlock,
  openEditor,
  prepareSave,
  refCategory,
  refChoices,
  removeBlock,
  removeItem,
  setBlockTime,
  setDescription,
  setName,
  settleBlocks,
  toggleDay,
  updateItem,
  type EditorBlock,
  type EditorCheck,
  type EditorItem,
  type EditorState,
} from '../editor-model';
import { AgendaWeek } from './AgendaWeek';
import { downloadText, requestWriteAccess, type WriteAccess } from '../sources/save';
import { expectedBackupName, overwriteWithBackup, type ReplaceResult } from '../sources/overwrite';
import type { BrowserLibrary, ServerEditing } from '../sources/types';
import { PinPage } from './WeekWizard';
import { DAY_LABELS, DAY_ORDER } from '../wizard-model';

interface Props {
  source: BrowserLibrary;
  library: Library;
  /** The grade to edit, as the library read it. */
  schedule: Schedule;
  /** Reads the library again after the file was written into the folder; false if that failed. */
  onSaved(): Promise<boolean>;
  /** Tunes the channel with this id (the grade file name) and closes the editor. */
  onWatch(channelId: string): void;
  onBack(): void;
}

type Phase =
  | { name: 'editing' }
  | { name: 'saving' }
  // Saving through `tv-gominho servir --editar` and this device is not paired yet: the PIN, then the same save.
  | { name: 'pin'; editing: ServerEditing; again(message: string): Promise<void>; message?: string }
  | { name: 'done'; result: ReplaceResult; reread: boolean; dropped: number };

const KIND_LABEL: Record<ScheduleItem['type'], string> = { show: 'Programa', interstitial: 'Vinheta', commercials: 'Comerciais' };
const KIND_ICON: Record<ScheduleItem['type'], IconName> = { show: 'episode', interstitial: 'interstitials', commercials: 'ads' };

/**
 * The channel editor, for the computer (mouse and keyboard; the arrows and Back of the remote still work): the
 * blocks of a grade and the items in each, the name, description and days. The model is editor-model.ts; this
 * only draws it and saves. Saving writes the grade file over the old one, keeping every show where it was.
 */
export function ChannelEditor({ source, library, schedule, onSaved, onWatch, onBack }: Props) {
  const [state, setState] = useState<EditorState>(() => openEditor(schedule));
  const [phase, setPhase] = useState<Phase>({ name: 'editing' });
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [tab, setTab] = useState<'blocks' | 'agenda'>('blocks');
  const today = useMemo(() => localIsoDate(new Date()), []);
  // The file as it is on disk now: saving rewrites it from the model, which drops the comments written by hand.
  const [original, setOriginal] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    source.readText(schedule.path).then((text) => current && setOriginal(text), () => {});
    return () => {
      current = false;
    };
  }, [source, schedule.path]);
  const loosesComments = original !== null && hasHandComments(original);
  const backupName = useMemo(() => expectedBackupName(source, library, schedule.path, today), [source, library, schedule.path, today]);
  const refocus = useRef<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  const check = useMemo(() => checkEditor(state, library), [state, library]);
  const dirty = isDirty(state);
  const edit = (change: (current: EditorState) => EditorState) => {
    setLeaving(false);
    setState(change);
  };

  // After a change that moves or removes the thing that had focus, focus goes to the named control.
  useEffect(() => {
    if (!refocus.current) return;
    const target = body.current?.querySelector<HTMLElement>(`[data-focus="${refocus.current}"]`);
    refocus.current = null;
    target?.focus();
  });

  const goBack = () => {
    if (phase.name === 'saving') return;
    if (phase.name === 'pin') return setPhase({ name: 'editing' });
    if (phase.name === 'done' || !dirty || leaving) return onBack();
    setLeaving(true);
  };

  async function save() {
    if (check.errors.length > 0 || phase.name !== 'editing') return;
    setError(null);
    setPhase({ name: 'saving' });
    // First of all: the permission prompt needs the click (or key) that got us here.
    const access = await requestWriteAccess(source);
    try {
      const today = localIsoDate(new Date());
      const { schedule: edited, droppedPicks } = prepareSave(state, library, today);
      await write(access, today, editedYaml(edited, today), droppedPicks.length);
    } catch (failure) {
      setError(`Não foi possível salvar o canal: ${(failure as Error).message}`);
      setPhase({ name: 'editing' });
    }
  }

  /** Over the same file, after the copy of the old one (folder, server with PIN, or download). */
  async function write(access: WriteAccess, today: string, yaml: string, dropped: number, message?: string): Promise<void> {
    setPhase({ name: 'saving' });
    const result = await overwriteWithBackup(source, library, access, state.path, today, yaml);
    if (result === 'needs-pin') {
      if (!source.editing) throw new Error('o servidor não está disponível.');
      return setPhase({ name: 'pin', editing: source.editing, again: (again) => write(access, today, yaml, dropped, again), message });
    }
    const reread = result.kind === 'written' ? await onSaved().catch(() => false) : true;
    setPhase({ name: 'done', result, reread, dropped });
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  };

  const addNewBlock = () => {
    edit((current) => {
      const next = addBlock(current, library.shows.length > 0 ? [defaultItem('show', library)] : []);
      refocus.current = `time-${newestBlock(next)!.key}`;
      return next;
    });
  };

  // The result page starts on its first button.
  useEffect(() => {
    if (phase.name === 'done') body.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [phase.name]);

  return (
    <Overlay edge="left" label={`Editar o canal ${schedule.name}`} onBack={goBack} className="wizard-overlay editor-overlay">
      <div className="editor" onKeyDown={onKeyDown}>
        <header className="panel-header">
          <Icon name="clock" />
          <h1>Editar canal</h1>
          <button className="panel-close" onClick={goBack} aria-label="Fechar" title="Fechar" tabIndex={-1} disabled={phase.name === 'saving'}>
            <Icon name="close" />
          </button>
        </header>

        <div className="editor-body" ref={body}>
          {phase.name === 'done' ? (
            <DonePage result={phase.result} reread={phase.reread} dropped={phase.dropped} onWatch={() => onWatch(schedule.id)} onClose={onBack} />
          ) : phase.name === 'pin' ? (
            <PinPage
              editing={phase.editing}
              message={phase.message}
              onPaired={() =>
                void phase.again('O computador pediu o PIN de novo. Confira o número no terminal.').catch((failure) => {
                  setError(`Não foi possível salvar o canal: ${(failure as Error).message}`);
                  setPhase({ name: 'editing' });
                })
              }
              onCancel={goBack}
            />
          ) : phase.name === 'saving' ? (
            <p className="wizard-busy" role="status">
              Salvando o canal…
            </p>
          ) : (
            <>
              <p className="editor-file">
                Arquivo <code>{state.path}</code>
              </p>
              <div className="editor-tabs" role="tablist" aria-label="Partes do canal">
                {(['blocks', 'agenda'] as const).map((id) => (
                  <button
                    key={id}
                    data-nav
                    data-tab={id}
                    role="tab"
                    aria-selected={tab === id}
                    className="action-tile small"
                    onClick={() => setTab(id)}
                  >
                    <Icon name={id === 'blocks' ? 'clock' : 'calendar'} className="action-icon" />
                    <span>{id === 'blocks' ? 'Blocos' : `Agenda${state.picks.length > 0 ? ` (${state.picks.length})` : ''}`}</span>
                  </button>
                ))}
              </div>

              {tab === 'agenda' ? (
                <AgendaWeek state={state} library={library} today={today} edit={edit} />
              ) : (
                <>
                  <Fields state={state} edit={edit} />

                  <h2>Blocos</h2>
                  {state.blocks.map((block) => (
                    <BlockCard
                      key={block.key}
                      block={block}
                      check={check}
                      library={library}
                      edit={edit}
                      refocus={refocus}
                    />
                  ))}
                  <button data-nav data-focus="add-block" className="action-tile small" onClick={addNewBlock}>
                    <Icon name="plus" className="action-icon" />
                    <span>Adicionar bloco</span>
                  </button>
                  <p className="panel-note">
                    Os blocos ficam em ordem de horário. Um bloco começa no horário dele; se o anterior passar do horário, o bloco atrasa (veja docs/grade.md).
                  </p>
                </>
              )}
            </>
          )}
        </div>

        {phase.name === 'editing' && (
          <div className="editor-foot">
            {check.errors.length > 0 && (
              <ul className="editor-errors wizard-problem" role="alert">
                {check.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
            {error && (
              <p className="wizard-problem" role="alert">
                {error}
              </p>
            )}
            {loosesComments && (
              <p className="panel-note" data-comments-notice>
                Os comentários que você escreveu à mão neste arquivo (linhas com <code>#</code>) não são mantidos ao salvar. Antes de salvar, o app guarda uma cópia do arquivo atual em <code>grades/</code>, por exemplo <code>{backupName}</code>.
              </p>
            )}
            {leaving && (
              <p className="wizard-problem" role="alert" data-leaving>
                Há mudanças que ainda não foram salvas. Aperte Esc (ou Voltar) de novo para sair sem salvar, ou salve o canal.
              </p>
            )}
            <footer className="wizard-footer">
              <button data-nav data-leave className="action-tile" onClick={onBack}>
                <Icon name="back" className="action-icon" />
                <span>{dirty ? 'Sair sem salvar' : 'Fechar'}</span>
              </button>
              <button
                data-nav
                data-save
                className="action-tile primary"
                aria-disabled={check.errors.length > 0 || undefined}
                title="Ctrl+S"
                onClick={() => void save()}
              >
                <Icon name="check" className="action-icon" />
                <span>Salvar canal</span>
              </button>
            </footer>
          </div>
        )}

        <KeyHints
          hints={
            phase.name === 'done'
              ? [
                  ['← →', 'escolher'],
                  ['OK', 'confirmar'],
                  ['Esc', 'fechar'],
                ]
              : [
                  ['↑ ↓ ← →', 'mover entre os controles'],
                  ['Ctrl+S', 'salvar'],
                  ['Alt+↑ ↓', 'mover o item'],
                  ['Esc', 'voltar'],
                ]
          }
        />
      </div>
    </Overlay>
  );
}

// ---------------------------------------------------------------- pieces

/** Backspace deletes a letter in a field; it must not reach the "go back" handling of the overlay. */
const keepBackspace = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key === 'Backspace') event.stopPropagation();
};

function Fields({ state, edit }: { state: EditorState; edit(change: (current: EditorState) => EditorState): void }) {
  return (
    <div className="editor-fields">
      <label className="wizard-field">
        <span className="row-label">Nome do canal</span>
        <input
          data-nav
          data-nav-adjust
          data-autofocus
          data-name
          type="text"
          value={state.name}
          maxLength={MAX_NAME_LENGTH + 20}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => edit((current) => setName(current, event.target.value))}
          onKeyDown={keepBackspace}
        />
      </label>
      <label className="wizard-field">
        <span className="row-label">Descrição</span>
        <input
          data-nav
          data-nav-adjust
          data-description
          type="text"
          value={state.description}
          maxLength={MAX_DESCRIPTION_LENGTH + 20}
          autoComplete="off"
          onChange={(event) => edit((current) => setDescription(current, event.target.value))}
          onKeyDown={keepBackspace}
        />
      </label>
      <div className="editor-days" role="group" aria-label="Dias da semana">
        <span className="row-label">Dias</span>
        <div className="wizard-chips">
          {DAY_ORDER.map((day: Weekday) => {
            const on = state.days.includes(day);
            return (
              <button
                key={day}
                data-nav
                data-day={day}
                role="checkbox"
                aria-checked={on}
                className="action-tile day-chip small"
                onClick={() => edit((current) => toggleDay(current, day))}
              >
                {on && <Icon name="check" className="action-icon" />}
                <span>{DAY_LABELS[day]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface BlockProps {
  block: EditorBlock;
  check: EditorCheck;
  library: Library;
  edit(change: (current: EditorState) => EditorState): void;
  refocus: { current: string | null };
}

function BlockCard({ block, check, library, edit, refocus }: BlockProps) {
  const problem = check.blocks[block.key];
  const settle = () => edit(settleBlocks);
  const add = (kind: ScheduleItem['type']) => {
    edit((current) => {
      const next = addItem(current, block.key, defaultItem(kind, library));
      refocus.current = `item-${next.nextKey - 1}`;
      return next;
    });
  };
  return (
    <section className="editor-block" data-block={block.time} aria-label={`Bloco das ${block.time}`}>
      <div className="editor-block-head">
        <label className="editor-time">
          <span className="row-label">Começa às</span>
          <input
            data-nav
            data-nav-adjust
            data-time
            data-focus={`time-${block.key}`}
            className="editor-input"
            type="text"
            inputMode="numeric"
            value={block.time}
            size={8}
            maxLength={8}
            placeholder="08:00"
            autoComplete="off"
            aria-invalid={problem ? true : undefined}
            onChange={(event) => edit((current) => setBlockTime(current, block.key, event.target.value))}
            onBlur={settle}
            onKeyDown={(event) => {
              keepBackspace(event);
              if (event.key === 'Enter') {
                event.preventDefault();
                settle();
              }
            }}
          />
        </label>
        <button
          data-nav
          data-remove-block
          className="action-tile small"
          onClick={() => {
            refocus.current = 'add-block';
            edit((current) => removeBlock(current, block.key));
          }}
        >
          <Icon name="close" className="action-icon" />
          <span>Remover bloco</span>
        </button>
      </div>
      {problem && (
        <p className="editor-problem" role="alert">
          {problem}
        </p>
      )}

      <ol className="editor-items">
        {block.items.map((item, index) => (
          <ItemRow key={item.key} block={block} item={item} index={index} check={check} library={library} edit={edit} refocus={refocus} />
        ))}
      </ol>

      <div className="editor-add" role="group" aria-label="Acrescentar ao bloco">
        {(['show', 'interstitial', 'commercials'] as const).map((kind) => (
          <button key={kind} data-nav data-add={kind} className="action-tile small" onClick={() => add(kind)}>
            <Icon name="plus" className="action-icon" />
            <span>{KIND_LABEL[kind]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

interface ItemProps {
  block: EditorBlock;
  item: EditorItem;
  index: number;
  check: EditorCheck;
  library: Library;
  edit(change: (current: EditorState) => EditorState): void;
  refocus: { current: string | null };
}

function ItemRow({ block, item, index, check, library, edit, refocus }: ItemProps) {
  const problem = check.items[item.key];
  const warning = check.warnings[item.key];
  const last = index === block.items.length - 1;
  const move = (direction: 1 | -1, focus: string) => {
    refocus.current = focus;
    edit((current) => moveItem(current, block.key, item.key, direction));
  };
  const change = (patch: Partial<ScheduleItem>) => edit((current) => updateItem(current, block.key, item.key, patch));

  return (
    <li
      className="editor-item"
      data-item={item.type}
      data-warning={warning ? '' : undefined}
      onKeyDown={(event) => {
        // Alt+Up / Alt+Down moves the item while the focus stays on the same control.
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === 'ArrowUp' ? -1 : 1;
        if (direction === -1 ? index > 0 : !last) {
          const focused = (event.target as HTMLElement).getAttribute('data-focus');
          move(direction, focused ?? `item-${item.key}`);
        }
      }}
    >
      <span className="editor-item-kind">
        <Icon name={KIND_ICON[item.type]} className="row-lead" />
        <span className="row-label">{KIND_LABEL[item.type]}</span>
      </span>

      <div className="editor-item-controls">
        {item.type === 'show' && (
          <>
            <ShowSelect library={library} value={item.show} focus={`item-${item.key}`} onChange={(show) => change({ show })} />
            <CountField label="episódios" value={item.count} onChange={(count) => change({ count })} />
          </>
        )}
        {item.type === 'interstitial' && <RefSelects library={library} value={item.ref} focus={`item-${item.key}`} onChange={(ref) => change({ ref })} />}
        {item.type === 'commercials' && <CountField label="comerciais" value={item.count} focus={`item-${item.key}`} onChange={(count) => change({ count })} />}
      </div>

      <div className="editor-item-buttons">
        <IconButton icon="chevronUp" label="Subir o item" disabled={index === 0} focus={`up-${item.key}`} onClick={() => move(-1, `up-${item.key}`)} />
        <IconButton icon="chevronDown" label="Descer o item" disabled={last} focus={`down-${item.key}`} onClick={() => move(1, `down-${item.key}`)} />
        <IconButton
          icon="close"
          label="Remover o item"
          focus={`remove-${item.key}`}
          onClick={() => {
            const neighbour = block.items[index + 1] ?? block.items[index - 1];
            refocus.current = neighbour ? `remove-${neighbour.key}` : 'add-block';
            edit((current) => removeItem(current, block.key, item.key));
          }}
        />
      </div>

      {problem && (
        <p className="editor-problem" role="alert">
          {problem}
        </p>
      )}
      {!problem && warning && (
        <p className="editor-warning" data-item-warning>
          <Icon name="alert" className="editor-warning-icon" />
          {warning}
        </p>
      )}
    </li>
  );
}

function IconButton({ icon, label, disabled, focus, onClick }: { icon: IconName; label: string; disabled?: boolean; focus: string; onClick(): void }) {
  return (
    <button
      data-nav
      data-focus={focus}
      className="editor-icon-button"
      aria-label={label}
      title={label}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      <Icon name={icon} />
    </button>
  );
}

function ShowSelect({ library, value, focus, onChange }: { library: Library; value: string; focus: string; onChange(show: string): void }) {
  const known = library.shows.some((show) => show.id.toLowerCase() === value.toLowerCase());
  const current = library.shows.find((show) => show.id.toLowerCase() === value.toLowerCase())?.id ?? value;
  return (
    <select data-nav data-focus={focus} className="editor-input editor-select" aria-label="Programa" value={current} onChange={(event) => onChange(event.target.value)}>
      {!known && <option value={value}>{value.trim() === '' ? 'Escolha o programa' : `${value} (não existe na biblioteca)`}</option>}
      {library.shows.map((show) => (
        <option key={show.id} value={show.id}>
          {show.title === show.id ? show.id : `${show.title} (${show.id})`}
        </option>
      ))}
    </select>
  );
}

function RefSelects({ library, value, focus, onChange }: { library: Library; value: string; focus: string; onChange(ref: string): void }) {
  const category = refCategory(value);
  const categories = interstitialCategories(library, category);
  const choices = category ? refChoices(library, category) : [];
  const chosen = choices.find((choice) => choice.ref.toLowerCase() === value.toLowerCase());
  return (
    <>
      <select
        data-nav
        data-focus={focus}
        data-category
        className="editor-input editor-select"
        aria-label="Categoria da vinheta"
        value={category}
        onChange={(event) => onChange(event.target.value)}
      >
        {category === '' && <option value="">Escolha a categoria</option>}
        {categories.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </select>
      <select
        data-nav
        data-ref
        className="editor-input editor-select"
        aria-label="Qual vinheta"
        value={chosen?.ref ?? value}
        onChange={(event) => onChange(event.target.value)}
      >
        {!chosen && <option value={value}>{`${value} (não existe na biblioteca)`}</option>}
        {choices.map((choice) => (
          <option key={choice.ref} value={choice.ref}>
            {choice.kind === 'file' ? choice.label : `${choice.label} (${choice.count})`}
          </option>
        ))}
      </select>
    </>
  );
}

function CountField({ label, value, focus, onChange }: { label: string; value: number; focus?: string; onChange(count: number): void }) {
  return (
    <label className="editor-count">
      <input
        data-nav
        data-nav-adjust
        data-focus={focus}
        data-count
        className="editor-input"
        type="number"
        min={1}
        max={MAX_COUNT}
        step={1}
        value={Number.isNaN(value) ? '' : value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))}
        onKeyDown={keepBackspace}
      />
      <span className="row-meta">{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------- result

const fileOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

const REASONS: Record<'no-folder' | 'denied' | 'failed', string> = {
  'no-folder': 'Este navegador, ou o jeito como a biblioteca foi aberta, não deixa o app gravar na pasta.',
  denied: 'A permissão para gravar na pasta não foi dada.',
  failed: 'Não deu para gravar na pasta.',
};

function DonePage({ result, reread, dropped, onWatch, onClose }: { result: ReplaceResult; reread: boolean; dropped: number; onWatch(): void; onClose(): void }): ReactNode {
  const note =
    dropped > 0 ? (
      <p>
        {dropped === 1 ? 'Uma escolha da agenda' : `${dropped} escolhas da agenda`} apontava para um item, bloco ou dia que saiu do canal e não foi mantida.
      </p>
    ) : null;
  if (result.kind === 'written') {
    return (
      <div className="wizard-done" data-result="written">
        <h2>Canal salvo</h2>
        <p>
          O arquivo <code>{result.path}</code> foi gravado na pasta da biblioteca. Os programas continuam dos mesmos episódios.{' '}
          {reread ? 'A troca de canais já usa a versão nova.' : 'Não consegui reler a biblioteca: escolha a pasta de novo para ver as mudanças.'}
        </p>
        {note}
        {result.backupPath && (
          <p data-backup={result.backupPath}>
            O arquivo antigo está guardado em <code>{result.backupPath}</code>. A TV não o lê como canal. Para voltar atrás, apague o canal novo e tire o <code>.bak</code> e a data do nome da cópia.
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
  return (
    <div className="wizard-done" data-result="downloaded">
      <h2>Arquivo baixado</h2>
      <p>
        {REASONS[result.reason]} Então o app baixou o canal editado como arquivo: <code>{fileOf(result.path)}</code>{result.backupName && <>, e a cópia do arquivo antigo: <code>{result.backupName}</code></>}.
      </p>
      {note}
      <p>Para valer:</p>
      <ol className="wizard-instructions">
        <li>
          Copie <code>{result.backupName ?? 'a cópia'}</code> e <code>{fileOf(result.path)}</code> (na pasta de downloads) para a pasta <code>grades</code> da biblioteca, aceitando trocar <code>{fileOf(result.path)}</code>. O antigo continua na cópia <code>.bak</code>, que a TV não lê como canal.
        </li>
        <li>No pendrive ou no Raspberry Pi, é a mesma pasta <code>grades</code> da biblioteca.</li>
        <li>Abra a biblioteca de novo (recarregue a página ou escolha a pasta outra vez).</li>
      </ol>
      <div className="wizard-footer">
        <button data-nav data-autofocus className="action-tile primary" onClick={onClose}>
          <span>Entendi</span>
        </button>
        <button data-nav className="action-tile" onClick={() => {
            downloadText(fileOf(result.path), result.yaml);
            if (result.backupName && result.backupYaml) downloadText(result.backupName, result.backupYaml);
          }}>
          <Icon name="download" className="action-icon" />
          <span>Baixar de novo</span>
        </button>
      </div>
    </div>
  );
}
