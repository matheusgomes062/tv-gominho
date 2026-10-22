import { localIsoDate, type Blocklist, type Library, type Show } from '@tv-gominho/nucleo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { KeyHints, Overlay } from '../components/Overlay';
import {
  blocklistPath,
  buildSavePlan,
  canBlockEpisode,
  copyBlocklist,
  isEpisodeBlocked,
  sameBlocklist,
  showStatus,
  summarize,
  toggleEpisode,
  toggleShow,
} from '../blocklist-model';
import type { DownloadReason, WriteAccess } from '../sources/save';
import { requestWriteAccess } from '../sources/save';
import { download, saveFiles, type SaveFile, type SaveFilesResult } from '../sources/save-files';
import type { BrowserLibrary, ServerEditing } from '../sources/types';
import { PinPage } from './WeekWizard';

interface Props {
  source: BrowserLibrary;
  library: Library;
  /** Reads the library again after the files were written; false if that failed. */
  onSaved(): Promise<boolean>;
  onBack(): void;
}

type Phase =
  | { name: 'editing'; show?: string }
  | { name: 'saving' }
  // Saving through `tv-gominho servir --editar` and this device is not paired yet: the PIN, then the same files.
  | { name: 'pin'; editing: ServerEditing; files: SaveFile[]; message?: string }
  | { name: 'done'; result: SaveFilesResult; files: SaveFile[]; reread: boolean };

/**
 * "Não passar": the shows and episodes the dynamic mode never picks by itself (nao-passar.yaml). A show can
 * be blocked whole, or opened to block single episodes. Saving writes the list and, because the list moves the
 * sequence of each show, the saved positions of the grades too. Everything is reachable with arrows, OK and Back.
 */
export function BlocklistScreen({ source, library, onSaved, onBack }: Props) {
  const [list, setList] = useState<Blocklist>(() => copyBlocklist(library.blocklist));
  const [phase, setPhase] = useState<Phase>({ name: 'editing' });
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  const shows = useMemo(() => library.shows.filter((show) => show.episodes.length > 0), [library]);
  const changed = !sameBlocklist(list, library.blocklist);
  const summary = summarize(library, list);
  const openShow = phase.name === 'editing' ? shows.find((show) => show.id === phase.show) : undefined;

  useEffect(() => {
    const container = body.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>('[data-autofocus]') ?? container.querySelector<HTMLElement>('[data-nav]') ?? container.parentElement?.querySelector<HTMLElement>('[data-save]');
    target?.focus();
  }, [phase.name, openShow?.id]);

  const goBack = () => {
    if (phase.name === 'saving') return;
    if (phase.name === 'done') return onBack();
    if (phase.name === 'pin') return setPhase({ name: 'editing' });
    if (openShow) return setPhase({ name: 'editing' });
    onBack();
  };

  async function save() {
    if (!changed) return;
    setError(null);
    setPhase({ name: 'saving' });
    // First of all: the permission prompt needs the click that got us here.
    const access = await requestWriteAccess(source);
    try {
      const texts = new Map<string, string>();
      for (const schedule of library.schedules) texts.set(schedule.path, await source.readText(schedule.path));
      const plan = buildSavePlan(library, list, localIsoDate(new Date()), blocklistPath(source.files, library.root), texts);
      if (plan.problems.length > 0) {
        const first = plan.problems[0]!;
        throw new Error(`${first.path}: ${first.message} Nada foi gravado.`);
      }
      // The grades first, the list last: if a grade fails, the list stays as it was and nothing skips.
      const files: SaveFile[] = [...plan.grades.map(({ path, text }) => ({ path, text })), { path: plan.list.path, text: plan.list.text }];
      await write(files, access);
    } catch (failure) {
      setError(`Não foi possível salvar: ${(failure as Error).message}`);
      setPhase({ name: 'editing' });
    }
  }

  async function write(files: SaveFile[], access: WriteAccess, message?: string) {
    setPhase({ name: 'saving' });
    const result = await saveFiles(source, access, files);
    if (result === 'needs-pin') {
      if (source.editing) setPhase({ name: 'pin', editing: source.editing, files, message });
      return;
    }
    const reread = result.written.length > 0 ? await onSaved().catch(() => false) : true;
    setPhase({ name: 'done', result, files, reread });
  }

  return (
    <Overlay edge="left" label="Não passar" onBack={goBack} className="wizard-overlay">
      <div className="wizard">
        <header className="panel-header">
          <Icon name="close" />
          <h1>{openShow ? openShow.title : 'Não passar'}</h1>
          <button className="panel-close" onClick={onBack} aria-label="Fechar" title="Fechar" tabIndex={-1} disabled={phase.name === 'saving'}>
            <Icon name="close" />
          </button>
        </header>

        <p className="panel-note np-summary" data-np-summary>
          {openShow
            ? 'Marque os episódios que o modo dinâmico nunca escolhe sozinho. Um episódio que você escolher à mão na agenda continua passando.'
            : summary.shows + summary.episodes === 0
              ? 'Nada bloqueado. O modo dinâmico pode escolher qualquer episódio.'
              : `Bloqueado: ${summary.shows} ${summary.shows === 1 ? 'programa inteiro' : 'programas inteiros'} e ${summary.episodes} ${summary.episodes === 1 ? 'episódio' : 'episódios'} avulsos.`}
        </p>

        <div className="wizard-body" ref={body} key={`${phase.name}-${openShow?.id ?? ''}`}>
          {phase.name === 'done' ? (
            <DonePage result={phase.result} files={phase.files} reread={phase.reread} onClose={onBack} />
          ) : phase.name === 'pin' ? (
            <PinPage
              editing={phase.editing}
              message={phase.message}
              onPaired={() =>
                void write(phase.files, 'unavailable', 'O computador pediu o PIN de novo. Confira o número no terminal.').catch((failure) => {
                  setError(`Não foi possível salvar: ${(failure as Error).message}`);
                  setPhase({ name: 'editing' });
                })
              }
              onCancel={goBack}
            />
          ) : phase.name === 'saving' ? (
            <p className="wizard-busy" role="status">
              Salvando a lista e ajustando as grades para nenhum programa pular episódio…
            </p>
          ) : openShow ? (
            <EpisodeList library={library} list={list} show={openShow} onChange={setList} />
          ) : (
            <ShowList library={library} list={list} shows={shows} error={error} onChange={setList} onOpen={(id) => setPhase({ name: 'editing', show: id })} />
          )}
        </div>

        {phase.name === 'editing' && (
          <footer className="wizard-footer">
            <button data-nav className="action-tile" onClick={goBack}>
              <Icon name="back" className="action-icon" />
              <span>{openShow ? 'Voltar à lista' : 'Fechar sem salvar'}</span>
            </button>
            <button data-nav data-save className="action-tile primary" aria-disabled={changed ? undefined : true} onClick={() => void save()}>
              <Icon name="check" className="action-icon" />
              <span>{changed ? 'Salvar' : 'Sem mudanças'}</span>
            </button>
          </footer>
        )}

        <KeyHints
          hints={[
            ['↑ ↓ ← →', 'escolher'],
            ['OK', 'marcar'],
            ['Voltar', openShow ? 'voltar à lista' : 'fechar'],
          ]}
        />
      </div>
    </Overlay>
  );
}

// ---------------------------------------------------------------- lists

function ShowList({
  library,
  list,
  shows,
  error,
  onChange,
  onOpen,
}: {
  library: Library;
  list: Blocklist;
  shows: Show[];
  error: string | null;
  onChange(list: Blocklist): void;
  onOpen(id: string): void;
}) {
  if (shows.length === 0) return <p className="panel-note">A biblioteca ainda não tem programas com episódios.</p>;
  return (
    <>
      <div className="wizard-list" role="group" aria-label="Programas">
        {shows.map((show, i) => {
          const status = showStatus(library, list, show);
          return (
            <div className="np-item" key={show.id} data-show={show.id}>
              <button
                data-nav
                data-autofocus={i === 0 ? '' : undefined}
                data-toggle-show={show.id}
                className="row wizard-row"
                role="checkbox"
                aria-checked={status.state === 'all' ? true : status.state === 'some' ? 'mixed' : false}
                onClick={() => onChange(toggleShow(library, list, show))}
              >
                <Icon name="episode" className="row-lead" />
                <span className="row-text">
                  <span className="row-label">{show.title}</span>
                  <span className="row-meta">
                    {status.state === 'all'
                      ? 'Bloqueado inteiro'
                      : status.state === 'some'
                        ? `${status.blocked} de ${status.total} episódios bloqueados`
                        : `${status.total} ${status.total === 1 ? 'episódio' : 'episódios'}`}
                  </span>
                </span>
                <span className="wizard-mark" data-on={status.state === 'all'} data-partial={status.state === 'some'}>
                  {status.state === 'all' ? <Icon name="close" /> : status.state === 'some' ? <span aria-hidden="true">–</span> : null}
                </span>
              </button>
              <button data-nav data-open-show={show.id} className="action-tile" onClick={() => onOpen(show.id)} aria-label={`Episódios de ${show.title}`}>
                <span>Episódios</span>
                <Icon name="chevronRight" className="action-icon" />
              </button>
            </div>
          );
        })}
      </div>
      <p className="panel-note">OK no programa bloqueia ou libera ele inteiro. Em “Episódios” você marca só alguns.</p>
      {error && (
        <p className="wizard-problem" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function EpisodeList({ library, list, show, onChange }: { library: Library; list: Blocklist; show: Show; onChange(list: Blocklist): void }) {
  const status = showStatus(library, list, show);
  return (
    <>
      <button data-nav data-autofocus data-toggle-all className="row wizard-row" onClick={() => onChange(toggleShow(library, list, show))}>
        <Icon name="close" className="row-lead" />
        <span className="row-text">
          <span className="row-label">{status.state === 'all' ? 'Liberar o programa inteiro' : 'Bloquear o programa inteiro'}</span>
        </span>
        <span />
      </button>
      <div className="wizard-list" role="group" aria-label={`Episódios de ${show.title}`}>
        {show.episodes.map((episode, index) => {
          const blocked = isEpisodeBlocked(library, list, show, index);
          const nameable = canBlockEpisode(show, index);
          return (
            <button
              key={episode.path}
              data-nav
              data-episode={index}
              className="row wizard-row"
              role="checkbox"
              aria-checked={blocked}
              aria-disabled={nameable ? undefined : true}
              onClick={() => onChange(toggleEpisode(library, list, show, index))}
            >
              <Icon name="episode" className="row-lead" />
              <span className="row-text">
                <span className="row-label">
                  {episode.number !== null ? `${episode.number}. ` : ''}
                  {episode.title}
                </span>
                {(episode.season || !nameable) && (
                  <span className="row-meta">{[episode.season, nameable ? '' : 'Sem número no nome do arquivo: não dá para bloquear sozinho'].filter(Boolean).join(' · ')}</span>
                )}
              </span>
              <span className="wizard-mark" data-on={blocked}>
                {blocked && <Icon name="close" />}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- result

const REASONS: Record<DownloadReason, string> = {
  'no-folder': 'Este navegador, ou o jeito como a biblioteca foi aberta, não deixa o app gravar na pasta.',
  denied: 'A permissão para gravar na pasta não foi dada.',
  failed: 'Não deu para gravar um dos arquivos.',
};

function nameOf(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

function DonePage({ result, files, reread, onClose }: { result: SaveFilesResult; files: SaveFile[]; reread: boolean; onClose(): void }) {
  const grades = files.length - 1;
  if (result.pending.length === 0) {
    return (
      <div className="wizard-done" data-result="written">
        <h2>Lista salva</h2>
        <p>
          O arquivo <code>{nameOf(files.at(-1)!.path)}</code> foi gravado
          {grades > 0 ? `, junto com ${grades === 1 ? 'a grade' : `as ${grades} grades`} que ${grades === 1 ? 'guarda' : 'guardam'} a posição de cada programa` : ''}.{' '}
          {reread ? 'A TV já usa a nova lista.' : 'Não consegui reler a biblioteca: escolha a pasta de novo para a TV usar a nova lista.'}
        </p>
        <div className="wizard-footer">
          <button data-nav data-autofocus className="action-tile primary" onClick={onClose}>
            <span>Fechar</span>
          </button>
        </div>
      </div>
    );
  }
  const pending = files.filter((file) => result.pending.includes(file.path));
  const listPending = pending.some((file) => file === files.at(-1));
  return (
    <div className="wizard-done" data-result="pending">
      <h2>{result.written.length > 0 ? 'Faltou gravar arquivos' : 'Arquivos baixados'}</h2>
      <p>
        {REASONS[result.reason ?? 'failed']} Então o app baixou {pending.length === 1 ? 'o arquivo' : 'os arquivos'} que faltava{pending.length === 1 ? '' : 'm'}:{' '}
        {pending.map((file, i) => (
          <span key={file.path}>
            {i > 0 && ', '}
            <code>{nameOf(file.path)}</code>
          </span>
        ))}
        .
      </p>
      {result.written.length > 0 && (
        <p>
          Já gravados: {result.written.map(nameOf).join(', ')}.{' '}
          {listPending ? 'A lista não foi trocada, então nada pula.' : ''}
        </p>
      )}
      <p>Para valer:</p>
      <ol className="wizard-instructions">
        {pending.map((file) => (
          <li key={file.path}>
            Copie <code>{nameOf(file.path)}</code> (da pasta de downloads) para <code>{file.path.slice(0, file.path.lastIndexOf('/') + 1) || 'a pasta da biblioteca'}</code>, trocando o arquivo que já está lá.
          </li>
        ))}
        {pending.length > 1 && <li>Troque todos de uma vez: as grades guardam a posição de cada programa e precisam combinar com a lista nova.</li>}
        <li>Abra a biblioteca de novo (recarregue a página ou escolha a pasta outra vez).</li>
      </ol>
      <div className="wizard-footer">
        <button data-nav data-autofocus className="action-tile primary" onClick={onClose}>
          <span>Entendi</span>
        </button>
        <button data-nav className="action-tile" onClick={() => download(pending)}>
          <Icon name="download" className="action-icon" />
          <span>Baixar de novo</span>
        </button>
      </div>
    </div>
  );
}
