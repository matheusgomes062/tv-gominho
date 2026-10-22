import { describe, expect, it } from 'vitest';
import { aiControls, aiNotices, aiStatusFromServer, keyLabel, stateLabel } from './ai-settings-model';
import type { AiStatus } from './sources/types';

const base: AiStatus = { place: 'server', key: 'none', enabled: false, available: false, canManage: true, model: 'claude-opus-5-5' };

describe('aiStatusFromServer', () => {
  it('reads the state of the server', () => {
    expect(aiStatusFromServer({ chave: 'salva', final: '…a1B2', ligada: true, disponivel: true, local: true, modelo: 'm' })).toEqual({
      place: 'server',
      key: 'saved',
      ending: '…a1B2',
      enabled: true,
      available: true,
      canManage: true,
      model: 'm',
    });
    expect(aiStatusFromServer({ chave: 'ambiente', ligada: false, disponivel: false, local: false })).toMatchObject({ key: 'env', canManage: false });
  });

  it('keeps no more than the end of a key, whatever the server sent', () => {
    const status = aiStatusFromServer({ chave: 'salva', final: 'sk-ant-inteira-0123456789', ligada: false });
    expect(status!.ending).toBeUndefined();
    expect(aiStatusFromServer({ chave: 'nenhuma', final: '…a1B2', ligada: false })!.ending).toBeUndefined();
  });

  it('refuses what is not a state', () => {
    expect(aiStatusFromServer(null)).toBeNull();
    expect(aiStatusFromServer({ chave: 'outra', ligada: true })).toBeNull();
    expect(aiStatusFromServer({ chave: 'salva' })).toBeNull();
  });
});

describe('labels', () => {
  it('names each state of the key', () => {
    expect(keyLabel(base)).toBe('Sem chave');
    expect(keyLabel({ ...base, key: 'saved', ending: '…a1B2' })).toBe('Chave …a1B2');
    expect(keyLabel({ ...base, key: 'saved', canManage: false })).toBe('Chave salva no computador que roda o servidor');
    expect(keyLabel({ ...base, key: 'env' })).toMatch(/definida no computador \(variável de ambiente/);
    expect(stateLabel({ ...base, key: 'saved', enabled: true, available: true })).toMatch(/^Ligada/);
    expect(stateLabel({ ...base, key: 'saved' })).toMatch(/^Desligada/);
  });
});

describe('aiControls', () => {
  it('lets this computer paste, remove and switch', () => {
    expect(aiControls(base)).toEqual({ editKey: true, remove: false, toggle: true, readOnly: null });
    expect(aiControls({ ...base, key: 'saved' })).toMatchObject({ editKey: true, remove: true });
    // ANTHROPIC_API_KEY: neither replaced nor removed from the app.
    expect(aiControls({ ...base, key: 'env' })).toMatchObject({ editKey: false, remove: false, toggle: true });
  });

  it('only shows the state on a TV, and says where to go', () => {
    const tv = aiControls({ ...base, key: 'saved', canManage: false });
    expect(tv).toMatchObject({ editKey: false, remove: false, toggle: false });
    expect(tv.readOnly).toMatch(/computador que roda o servidor/);
  });

  it('warns that a browser key lives in this browser', () => {
    expect(aiNotices({ ...base, place: 'browser' }).join(' ')).toMatch(/só neste navegador/);
    expect(aiNotices(base).join(' ')).toMatch(/nunca na biblioteca/);
    expect(aiNotices(base).join(' ')).toMatch(/custa/);
    expect(aiNotices({ ...base, place: 'browser', fileOrigin: true }).join(' ')).toMatch(/file:\/\//);
    expect(aiNotices({ ...base, place: 'browser' }).join(' ')).not.toMatch(/file:\/\//);
  });
});
