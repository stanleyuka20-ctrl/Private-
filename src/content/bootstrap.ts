/**
 * Content-script entry wiring: settings from chrome.storage, popup messages.
 */
import { MSG_GET_DIAGNOSTICS, MSG_GET_STATUS } from '../core/messages';
import { chromeSettingsStore } from '../core/settings';
import { Engine, pageSettled } from './engine';
import type { Adapter } from './types';

const GLOBAL_KEY = '__americanOddsConverter';

function contextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

export function bootstrap(adapter: Adapter): Engine {
  // A copy injected earlier into this page (e.g. before an extension update) steps aside.
  const scope = globalThis as unknown as Record<string, Engine | undefined>;
  const previous = scope[GLOBAL_KEY];
  if (previous && !previous.isDisposed) previous.dispose();

  const engine = new Engine({
    adapter,
    store: chromeSettingsStore(),
    isContextValid: contextValid,
    version: chrome.runtime.getManifest().version,
    whenReady: () => pageSettled(window),
  });
  scope[GLOBAL_KEY] = engine;

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (engine.isDisposed) return false;
    const type = (message as { type?: unknown } | null)?.type;
    if (type === MSG_GET_STATUS) {
      engine.flushNow();
      sendResponse(engine.getStatus());
    } else if (type === MSG_GET_DIAGNOSTICS) {
      engine.flushNow();
      sendResponse(engine.getDiagnostics());
    }
    return false;
  });

  void engine.start();
  return engine;
}
