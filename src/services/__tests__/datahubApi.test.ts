import { afterEach, describe, expect, it } from 'vitest';
import { getBaseUrl } from '../datahubApi';

type EnvWindow = Window & { __ENV__?: { VITE_API_URL?: string } };

describe('getBaseUrl', () => {
  afterEach(() => {
    delete (window as EnvWindow).__ENV__;
  });

  it('uses the API origin even when it differs from the page host', () => {
    // The session cookie is host-only on the API host: a relative call on the
    // frontend host carries no credentials and is rejected with 401.
    (window as EnvWindow).__ENV__ = { VITE_API_URL: 'https://api.example.test/' };
    expect(window.location.hostname).not.toBe('api.example.test');
    expect(getBaseUrl()).toBe('https://api.example.test');
  });

  it('returns an empty origin when VITE_API_URL is not injected', () => {
    expect(getBaseUrl()).toBe('');
  });
});
