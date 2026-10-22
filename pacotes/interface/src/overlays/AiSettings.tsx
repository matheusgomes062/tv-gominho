import { useEffect, useState, type KeyboardEvent } from 'react';
import { Icon } from '../components/Icon';
import { aiControls, aiNotices, apiKeyProblem, keyLabel, REMOVE_CONFIRM, stateLabel } from '../ai-settings-model';
import type { AiBackend, AiChange, AiStatus } from '../sources/types';

/**
 * "Assistente de IA": the Anthropic key and the switch of "Pedir para a IA". Self-contained (it only needs the
 * library's AI backend), so it can sit in any panel. The key field is write-only: once saved, only its last four
 * characters come back, and on a TV served over the network the section only shows the state.
 */
export function AiSettings({ ai }: { ai: AiBackend | undefined }) {
  const [status, setStatus] = useState<AiStatus | null | 'loading'>('loading');
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    let live = true;
    if (!ai) setStatus(null);
    else void ai.status().then((value) => live && setStatus(value));
    return () => {
      live = false;
    };
  }, [ai]);

  if (!ai) return <p className="panel-note">O assistente de IA não está disponível com esta biblioteca.</p>;
  if (status === 'loading') return <p className="panel-note">Carregando…</p>;
  if (status === null) return <p className="panel-note">Não deu para falar com o computador. Ele ainda está ligado?</p>;

  const controls = aiControls(status);

  async function run(action: () => Promise<AiChange>, after?: () => void) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) return setProblem(result.message);
    setProblem(null);
    setStatus(result.status);
    after?.();
  }

  function save() {
    const invalid = apiKeyProblem(draft);
    if (invalid) return setProblem(invalid);
    // The field empties once the key is saved: it is never shown again.
    void run(() => ai!.saveKey(draft), () => setDraft(''));
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Backspace deletes a letter here; it must not reach the "go back" key of the panel.
    if (event.key === 'Backspace') event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  };

  return (
    <div className="ai-settings" data-ai-settings>
      <p className="ai-status" data-ai-key={status.key}>
        <Icon name={status.available ? 'check' : 'power'} className="row-icon" />
        <span className="row-text">
          <span className="row-label">{keyLabel(status)}</span>
          <span className="row-meta">{stateLabel(status)}</span>
        </span>
      </p>

      {controls.readOnly && <p className="panel-note">{controls.readOnly}</p>}

      {controls.toggle && (
        <button
          data-nav
          data-ai-toggle
          className="row row-switch"
          role="switch"
          aria-checked={status.enabled}
          aria-disabled={busy || undefined}
          onClick={() => !busy && void run(() => ai.setEnabled(!status.enabled))}
        >
          <Icon name="power" className="row-lead" />
          <span className="row-text">
            <span className="row-label">Pedir para a IA</span>
            <span className="row-meta">Desligada por padrão. Só funciona com uma chave.</span>
          </span>
          <span className="row-control">
            <span className="row-state">{status.enabled ? 'Ligada' : 'Desligada'}</span>
            <span className="switch" data-on={status.enabled} aria-hidden="true">
              <i />
            </span>
          </span>
        </button>
      )}

      {controls.editKey && (
        <>
          <label className="wizard-field">
            <span className="row-label">{status.key === 'saved' ? 'Trocar a chave da Anthropic' : 'Chave da Anthropic'}</span>
            <input
              data-nav
              data-nav-adjust
              data-ai-key-input
              type="password"
              name="tv-gominho-ia-chave"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              value={draft}
              maxLength={400}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </label>
          <p className="panel-note">Crie a chave em console.anthropic.com, em API Keys, e cole aqui. Depois de salva, só o final dela aparece.</p>
        </>
      )}

      {problem && (
        <p className="wizard-problem" role="alert">
          {problem}
        </p>
      )}

      {(controls.editKey || controls.remove) && (
        <div className="wizard-footer">
          {controls.editKey && (
            <button data-nav data-ai-save className="action-tile primary" aria-disabled={busy || draft.trim() === '' || undefined} onClick={() => !busy && draft.trim() && save()}>
              <Icon name="check" className="action-icon" />
              <span>Salvar chave</span>
            </button>
          )}
          {controls.remove && !confirmRemove && (
            <button data-nav data-ai-remove className="action-tile" aria-disabled={busy || undefined} onClick={() => !busy && setConfirmRemove(true)}>
              <Icon name="close" className="action-icon" />
              <span>Remover chave</span>
            </button>
          )}
        </div>
      )}

      {confirmRemove && (
        <div className="ai-confirm" role="group" aria-label="Remover a chave">
          <p className="panel-note">{REMOVE_CONFIRM}</p>
          <div className="wizard-footer">
            <button data-nav data-ai-remove-cancel className="action-tile" onClick={() => setConfirmRemove(false)}>
              <span>Cancelar</span>
            </button>
            <button
              data-nav
              data-ai-remove-confirm
              className="action-tile primary"
              aria-disabled={busy || undefined}
              onClick={() => !busy && void run(() => ai.removeKey(), () => setConfirmRemove(false))}
            >
              <Icon name="close" className="action-icon" />
              <span>Sim, remover</span>
            </button>
          </div>
        </div>
      )}

      <ul className="panel-note ai-notices">
        {aiNotices(status).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
