import { apiKeyProblem } from '@tv-gominho/nucleo';
import { NOTICE } from './ia-model';
import type { AiStatus } from './sources/types';

// Configurações → "Assistente de IA": what the section says and offers for each state of the key. No DOM or fetch:
// the section (overlays/AiSettings.tsx) shows this, and the sources (server.ts, ai-browser.ts) do the work.

export { apiKeyProblem };

/** Why the AI is off when the app was opened straight from a file. */
export const FILE_ORIGIN_BLOCKED =
  'Aberto direto de um arquivo (file://), o app não guarda nem usa a chave: nesse modo, qualquer outra página do disco aberta neste navegador poderia ler a chave. Para usar a IA, abra o app pelo tv-gominho servir ou por um endereço http.';

/**
 * Whether a key may be kept in this browser. Not from a file: every page opened from the disk shares the same
 * storage (origin "null"), so any of them could read it.
 */
export function browserKeyAllowed(protocol: string, origin: string): boolean {
  return protocol !== 'file:' && origin !== 'null';
}

/** The answer of GET /__tv-gominho/ia/estado (serve/ia-config.ts in the CLI) as the app's status, or null when it is not one. */
export function aiStatusFromServer(value: unknown): AiStatus | null {
  if (typeof value !== 'object' || value === null) return null;
  const data = value as Record<string, unknown>;
  const key = data.chave === 'salva' ? 'saved' : data.chave === 'ambiente' ? 'env' : data.chave === 'nenhuma' ? 'none' : null;
  if (key === null || typeof data.ligada !== 'boolean') return null;
  return {
    place: 'server',
    key,
    // Only "…" and four characters, whatever the server sent.
    ...(key === 'saved' && typeof data.final === 'string' && /^….{1,4}$/u.test(data.final) ? { ending: data.final } : {}),
    enabled: data.ligada,
    available: data.disponivel === true,
    canManage: data.local === true,
    model: typeof data.modelo === 'string' ? data.modelo : '',
  };
}

/** One line about the key. */
export function keyLabel(status: AiStatus): string {
  if (status.fileOrigin) return status.key === 'saved' ? `Chave ${status.ending ?? ''} guardada antes neste navegador, ignorada aqui` : 'Sem chave';
  if (status.key === 'env') return 'Chave definida no computador (variável de ambiente ANTHROPIC_API_KEY)';
  if (status.key === 'none') return 'Sem chave';
  if (status.ending) return `Chave ${status.ending}`;
  return status.place === 'server' ? 'Chave salva no computador que roda o servidor' : 'Chave salva neste navegador';
}

/** One line about whether "Pedir para a IA" shows in "Montar a semana". */
export function stateLabel(status: AiStatus): string {
  if (status.fileOrigin) return 'Indisponível com o app aberto direto de um arquivo.';
  if (status.available) return 'Ligada: “Pedir para a IA” aparece em “Montar a semana”.';
  if (status.key === 'none') return status.enabled ? 'Ligada, mas sem chave: coloque uma chave para usar.' : 'Desligada. Precisa de uma chave e de ser ligada.';
  return 'Desligada: a chave fica guardada, mas nenhum pedido é feito.';
}

export interface AiControls {
  /** The paste field and "Salvar". */
  editKey: boolean;
  /** "Remover chave". */
  remove: boolean;
  /** "Ligar"/"Desligar". */
  toggle: boolean;
  /** Why this screen only shows the state (a TV on the network), or null. */
  readOnly: string | null;
}

export function aiControls(status: AiStatus): AiControls {
  // From a file: nothing to paste or switch on, only a key stored earlier to remove.
  if (status.fileOrigin) return { editKey: false, remove: status.key === 'saved' && status.canManage, toggle: false, readOnly: FILE_ORIGIN_BLOCKED };
  if (!status.canManage) {
    return {
      editKey: false,
      remove: false,
      toggle: false,
      readOnly:
        status.place === 'server'
          ? 'Para colocar, trocar ou tirar a chave e para ligar ou desligar a IA, use o navegador do computador que roda o servidor (http://localhost). Este aparelho usa a IA com o PIN.'
          : 'Este navegador não deixa guardar dados deste site (janela anônima ou dados bloqueados), então não dá para guardar a chave aqui.',
    };
  }
  return { editKey: status.key !== 'env', remove: status.key === 'saved', toggle: true, readOnly: null };
}

/** What the section tells before the key is used: what it costs, what is sent and where the key lives. */
export function aiNotices(status: AiStatus): string[] {
  const where =
    status.place === 'server'
      ? 'A chave fica guardada só no computador que roda o servidor, numa pasta de dados do app (nunca na biblioteca nem no pendrive), e nunca é mostrada inteira em tela nenhuma.'
      : 'A chave fica guardada só neste navegador, neste aparelho. Qualquer código que rode nesta página poderia lê-la; o app não carrega código de outros sites, mas só guarde a chave num aparelho seu. Para tirar, use “Remover chave”.';
  return [NOTICE.cost, NOTICE.sent, where, NOTICE.review];
}

export const REMOVE_CONFIRM = 'Remover a chave? A IA para de funcionar até você colar uma chave de novo.';
