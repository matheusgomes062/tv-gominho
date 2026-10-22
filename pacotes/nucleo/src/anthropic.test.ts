import { describe, expect, it } from 'vitest';
import { anthropicAnswer, anthropicRequest, anthropicStatusFailure, apiKeyProblem, BROWSER_ACCESS_HEADER, keyEnding } from './anthropic';

const KEY = 'sk-ant-falsa-0123456789abcdefWXYZ';
const CALL = { system: 's', prompt: 'p', schema: { type: 'object' } };

describe('anthropicRequest', () => {
  it('puts the key only in x-api-key, and the browser header only when asked', () => {
    const server = anthropicRequest(KEY, 'claude-opus-5-5', CALL);
    expect(server.headers['x-api-key']).toBe(KEY);
    expect(server.headers[BROWSER_ACCESS_HEADER]).toBeUndefined();
    expect(server.body).not.toContain(KEY);
    const browser = anthropicRequest(KEY, 'claude-opus-5-5', CALL, { browser: true });
    expect(browser.headers[BROWSER_ACCESS_HEADER]).toBe('true');
    expect(browser.body).toBe(server.body);
  });
});

describe('anthropicAnswer', () => {
  it('joins the text blocks, and turns the rest into messages of its own', () => {
    expect(anthropicAnswer({ stop_reason: 'end_turn', content: [{ type: 'thinking' }, { type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] })).toEqual({ text: '{"a":1}' });
    expect(anthropicAnswer({ stop_reason: 'refusal', content: [] })).toMatchObject({ status: 422 });
    expect(anthropicAnswer({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] })).toMatchObject({ status: 502 });
    expect(anthropicAnswer(null)).toMatchObject({ status: 502 });
    expect(anthropicAnswer({ content: 'x' })).toMatchObject({ status: 502 });
  });

  it('says what an HTTP error means without the API answer', () => {
    expect(anthropicStatusFailure(401).message).toContain('recusou a chave');
    expect(anthropicStatusFailure(429).status).toBe(429);
    expect(anthropicStatusFailure(418).message).toBe('A Anthropic recusou o pedido (erro 418).');
  });
});

describe('keys', () => {
  it('takes key-shaped text only, without echoing it', () => {
    expect(apiKeyProblem(KEY)).toBeNull();
    expect(apiKeyProblem(`  ${KEY}\n`)).toBeNull();
    expect(apiKeyProblem('')).toMatch(/Cole/);
    for (const bad of ['curta', 'sk-ant- com espaços no meio da chave', `${KEY}ç`, 'x'.repeat(401)]) {
      const problem = apiKeyProblem(bad);
      expect(problem).toMatch(/não parece uma chave/);
      expect(problem).not.toContain(bad);
    }
  });

  it('shows only the last four characters', () => {
    expect(keyEnding(KEY)).toBe('…WXYZ');
  });
});
