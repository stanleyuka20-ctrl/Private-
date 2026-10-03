/**
 * Popup wiring: settings controls, page status, calculator and diagnostics.
 */
import { MSG_GET_DIAGNOSTICS, MSG_GET_STATUS, type DiagnosticsReport, type PageStatus } from '../core/messages';
import { PLATFORMS } from '../core/platforms';
import { DISPLAY_ORDERS, chromeSettingsStore, type DisplayOrder, type Settings, type ThemePreference } from '../core/settings';
import type { RoundingMode } from '../core/odds';
import { calculate, describeStatus, displayExample } from './model';

const store = chromeSettingsStore();
let settings: Settings;
let target: { id: number | null; url: string | null } = { id: null, url: null };

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const enabledInput = byId<HTMLInputElement>('enabled');
const sitesList = byId<HTMLUListElement>('sites');
const roundingSelect = byId<HTMLSelectElement>('rounding');
const themeSelect = byId<HTMLSelectElement>('theme');
const calcInput = byId<HTMLInputElement>('calc-input');
const calcOutput = byId<HTMLOutputElement>('calc-output');
const calcDetail = byId<HTMLParagraphElement>('calc-detail');
const statusSection = byId<HTMLElement>('status');
const diagButton = byId<HTMLButtonElement>('copy-diagnostics');
const diagMessage = byId<HTMLParagraphElement>('diag-message');
const diagFallback = byId<HTMLTextAreaElement>('diag-fallback');

function buildSites(): void {
  sitesList.replaceChildren();
  for (const platform of PLATFORMS) {
    const li = document.createElement('li');
    li.className = 'site';
    li.dataset.platform = platform.id;

    const text = document.createElement('div');
    text.className = 'site-text';
    const nameEl = document.createElement('span');
    nameEl.className = 'site-name';
    nameEl.textContent = platform.name;
    const domain = document.createElement('span');
    domain.className = 'site-domain';
    domain.textContent = platform.domainLabel;
    text.append(nameEl, domain);
    li.append(text);

    if (platform.verification === 'unverified') {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Unverified';
      badge.title = 'Built from public documentation and representative tests; not yet checked on the live site.';
      li.append(badge);
    }

    const label = document.createElement('label');
    label.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.id = `site-${platform.id}`;
    input.addEventListener('change', () => {
      void update({ platforms: { ...settings.platforms, [platform.id]: input.checked } });
    });
    const track = document.createElement('span');
    track.className = 'track';
    track.setAttribute('aria-hidden', 'true');
    const sr = document.createElement('span');
    sr.className = 'visually-hidden';
    sr.textContent = `Convert prices on ${platform.name}`;
    label.append(input, track, sr);
    li.append(label);
    sitesList.append(li);
  }
}

function applyTheme(theme: ThemePreference): void {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function renderExample(): void {
  const example = byId<HTMLParagraphElement>('display-example');
  const { before, odds, after } = displayExample(settings.displayOrder, settings.rounding);
  const pill = document.createElement('span');
  pill.className = 'pill';
  pill.textContent = odds;
  example.replaceChildren('Example: ', before, ...(odds ? [pill] : []), after);
}

function renderSettings(): void {
  enabledInput.checked = settings.enabled;
  for (const platform of PLATFORMS) {
    const input = document.getElementById(`site-${platform.id}`) as HTMLInputElement | null;
    if (input) input.checked = settings.platforms[platform.id];
  }
  for (const radio of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="displayOrder"]'))) {
    radio.checked = radio.value === settings.displayOrder;
  }
  roundingSelect.value = settings.rounding;
  themeSelect.value = settings.theme;
  applyTheme(settings.theme);
  renderExample();
  renderCalculator();
}

function renderCalculator(): void {
  const view = calculate(calcInput.value, settings.rounding);
  calcOutput.textContent = view.output;
  calcOutput.classList.toggle('none', view.none);
  calcDetail.textContent = view.detail;
  calcDetail.classList.toggle('error', view.error);
  calcInput.setAttribute('aria-invalid', String(view.error));
}

async function update(patch: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...patch };
  renderSettings();
  await store.save(settings);
  setTimeout(() => void refreshStatus(), 150);
}

async function findTarget(): Promise<{ id: number | null; url: string | null }> {
  // ?tabId=N lets the popup page be opened in a tab for a specific page (used by automated tests).
  const param = new URLSearchParams(location.search).get('tabId');
  if (param !== null) {
    const id = Number(param);
    try {
      const tab = await chrome.tabs.get(id);
      return { id, url: tab.url ?? tab.pendingUrl ?? null };
    } catch {
      return { id, url: null };
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { id: tab?.id ?? null, url: tab?.url ?? tab?.pendingUrl ?? null };
}

function isPageStatus(value: unknown): value is PageStatus {
  return !!value && typeof value === 'object' && 'platformId' in value && 'detected' in value;
}

async function refreshStatus(): Promise<void> {
  let status: PageStatus | null = null;
  if (target.id !== null) {
    try {
      const response: unknown = await chrome.tabs.sendMessage(target.id, { type: MSG_GET_STATUS });
      if (isPageStatus(response)) status = response;
    } catch {
      status = null;
    }
  }
  const view = describeStatus({ settings, url: target.url, status });
  statusSection.dataset.state = view.state;
  byId('status-title').textContent = view.title;
  byId('status-detail').textContent = view.detail;
  byId('status-note').textContent = view.note;
  for (const li of Array.from(sitesList.children) as HTMLElement[]) {
    li.classList.toggle('current', li.dataset.platform === view.currentPlatform);
  }
}

async function copyDiagnostics(): Promise<void> {
  diagMessage.textContent = '';
  diagFallback.hidden = true;
  if (target.id === null) {
    diagMessage.textContent = 'Open a supported page first.';
    return;
  }
  let report: DiagnosticsReport | null = null;
  try {
    report = (await chrome.tabs.sendMessage(target.id, { type: MSG_GET_DIAGNOSTICS })) as DiagnosticsReport | null;
  } catch {
    report = null;
  }
  if (!report || !Array.isArray(report.entries)) {
    diagMessage.textContent = 'Diagnostics are available on supported pages only (reload the tab if needed).';
    return;
  }
  const json = JSON.stringify(report, null, 2);
  const summary = `Report of ${report.entries.length} price-like numbers on this page. It includes the text around each one, so review it before sharing.`;
  try {
    await navigator.clipboard.writeText(json);
    diagMessage.textContent = `Copied. ${summary}`;
  } catch {
    diagFallback.value = json;
    diagFallback.hidden = false;
    diagFallback.focus();
    diagFallback.select();
    diagMessage.textContent = `Copy the text below. ${summary}`;
  }
}

async function init(): Promise<void> {
  settings = await store.load();
  buildSites();
  renderSettings();
  byId('version').textContent = `v${chrome.runtime.getManifest().version}`;

  enabledInput.addEventListener('change', () => void update({ enabled: enabledInput.checked }));
  for (const radio of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="displayOrder"]'))) {
    radio.addEventListener('change', () => {
      if (radio.checked && (DISPLAY_ORDERS as readonly string[]).includes(radio.value)) {
        void update({ displayOrder: radio.value as DisplayOrder });
      }
    });
  }
  roundingSelect.addEventListener('change', () => void update({ rounding: roundingSelect.value as RoundingMode }));
  themeSelect.addEventListener('change', () => void update({ theme: themeSelect.value as ThemePreference }));
  calcInput.addEventListener('input', renderCalculator);
  diagButton.addEventListener('click', () => void copyDiagnostics());

  store.subscribe((next) => {
    settings = next;
    renderSettings();
  });

  target = await findTarget();
  await refreshStatus();
}

void init();
