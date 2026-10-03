"use strict";
(() => {
  // src/core/messages.ts
  var MSG_GET_STATUS = "aoc:get-status";
  var MSG_GET_DIAGNOSTICS = "aoc:get-diagnostics";

  // src/core/platforms.ts
  var PLATFORM_IDS = ["polymarketUs", "kalshi", "prophetx", "novig"];
  var PLATFORMS = [
    {
      id: "polymarketUs",
      name: "Polymarket US",
      hosts: ["polymarket.us"],
      matches: ["https://polymarket.us/*"],
      domainLabel: "polymarket.us",
      verification: "unverified"
    },
    {
      id: "kalshi",
      name: "Kalshi",
      hosts: ["kalshi.com"],
      matches: ["https://kalshi.com/*"],
      domainLabel: "kalshi.com",
      verification: "unverified"
    },
    {
      id: "prophetx",
      name: "ProphetX",
      hosts: ["www.prophetx.co", "prophetx.co"],
      matches: ["https://www.prophetx.co/*", "https://prophetx.co/*"],
      domainLabel: "prophetx.co",
      verification: "unverified"
    },
    {
      id: "novig",
      name: "Novig",
      hosts: ["novig.com", "app.novig.us"],
      matches: ["https://novig.com/*", "https://app.novig.us/*"],
      domainLabel: "novig.com",
      verification: "unverified"
    }
  ];
  function getPlatform(id) {
    const platform = PLATFORMS.find((p) => p.id === id);
    if (!platform) throw new Error(`Unknown platform ${id}`);
    return platform;
  }
  function platformForHost(hostname) {
    const host = hostname.toLowerCase();
    return PLATFORMS.find((p) => p.hosts.includes(host)) ?? null;
  }
  function unsupportedLookalikeMessage(hostname) {
    const host = hostname.toLowerCase();
    if (host === "polymarket.com" || host.endsWith(".polymarket.com")) {
      return "This is the international Polymarket site (polymarket.com), a separate platform that is not supported. Polymarket US is at polymarket.us.";
    }
    if (host.endsWith(".polymarket.us") && host !== "polymarket.us") {
      return "Only the Polymarket US trading site (polymarket.us) is supported, not its other subdomains.";
    }
    if (host.endsWith(".kalshi.com") && host !== "kalshi.com") {
      return "Only the main Kalshi site (kalshi.com) is supported, not its other subdomains.";
    }
    return null;
  }

  // src/core/odds.ts
  var ROUNDING_MODES = ["whole", "tenth", "five"];
  var MINUS = "\u2212";
  var MAX_INTEGER_DIGITS = 6;
  var MAX_FRACTION_DIGITS = 8;
  function parseDecimal(text) {
    const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
    if (!match) return null;
    const intPart = match[1] ?? "";
    const fracPart = match[2] ?? "";
    if (intPart === "" && fracPart === "") return null;
    if (intPart.length > MAX_INTEGER_DIGITS || fracPart.length > MAX_FRACTION_DIGITS) return null;
    return {
      num: BigInt((intPart || "0") + fracPart),
      den: 10n ** BigInt(fracPart.length),
      decimals: fracPart.length
    };
  }
  function gcd(a, b) {
    while (b !== 0n) [a, b] = [b, a % b];
    return a;
  }
  function reduce(num, den) {
    if (num === 0n) return { num: 0n, den: 1n };
    const g = gcd(num, den);
    return { num: num / g, den: den / g };
  }
  function probabilityFromDecimal(text, scale) {
    const parsed = parseDecimal(text);
    if (!parsed) return null;
    const den = scale === "percent" ? parsed.den * 100n : parsed.den;
    if (parsed.num > den) return null;
    return reduce(parsed.num, den);
  }
  function isValidProbability(p) {
    return p.den > 0n && p.num >= 0n && p.num <= p.den;
  }
  function toAmericanOdds(p) {
    if (!isValidProbability(p)) throw new RangeError("Probability must be between 0 and 1");
    const { num, den } = p;
    if (num === 0n) return { kind: "none", reason: "zero" };
    if (num === den) return { kind: "none", reason: "one" };
    const twice = 2n * num;
    if (twice === den) return { kind: "finite", sign: 1, num: 1n, den: 1n };
    if (twice < den) return { kind: "finite", sign: 1, num: den - num, den: num };
    return { kind: "finite", sign: -1, num, den: den - num };
  }
  function oddsToNumber(odds) {
    if (odds.kind === "none") return odds.reason === "zero" ? Infinity : -Infinity;
    return odds.sign * 100 * Number(odds.num) / Number(odds.den);
  }
  function roundedMagnitudeTenths(odds, mode) {
    const { num, den } = odds;
    switch (mode) {
      case "whole":
        return (200n * num + den) / (2n * den) * 10n;
      case "tenth":
        return (2000n * num + den) / (2n * den);
      case "five":
        return (40n * num + den) / (2n * den) * 50n;
    }
  }
  function formatAmericanOdds(odds, mode = "whole") {
    if (odds.kind === "none") return null;
    const tenths = roundedMagnitudeTenths(odds, mode);
    const sign = odds.sign === 1 ? "+" : MINUS;
    const body = mode === "tenth" ? `${tenths / 10n}.${tenths % 10n}` : `${tenths / 10n}`;
    return sign + body;
  }
  function describeNoOdds(reason) {
    return reason === "zero" ? "No finite American odds: a 0% price implies the outcome never happens." : "No finite American odds: a 100% price leaves no profit to quote.";
  }

  // src/core/settings.ts
  var DISPLAY_ORDERS = ["odds-first", "price-first", "price-only"];
  var THEMES = ["auto", "light", "dark"];
  var DEFAULT_SETTINGS = {
    enabled: true,
    platforms: { polymarketUs: true, kalshi: true, prophetx: true, novig: true },
    displayOrder: "price-first",
    rounding: "whole",
    theme: "auto"
  };
  var SETTINGS_KEY = "settings";
  function pick(value, allowed, fallback) {
    return typeof value === "string" && allowed.includes(value) ? value : fallback;
  }
  function normalizeSettings(raw) {
    const obj = raw !== null && typeof raw === "object" ? raw : {};
    const rawPlatforms = obj.platforms !== null && typeof obj.platforms === "object" ? obj.platforms : {};
    const platforms = {};
    for (const id of PLATFORM_IDS) {
      platforms[id] = typeof rawPlatforms[id] === "boolean" ? rawPlatforms[id] : DEFAULT_SETTINGS.platforms[id];
    }
    return {
      enabled: typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_SETTINGS.enabled,
      platforms,
      displayOrder: pick(obj.displayOrder, DISPLAY_ORDERS, DEFAULT_SETTINGS.displayOrder),
      rounding: pick(obj.rounding, ROUNDING_MODES, DEFAULT_SETTINGS.rounding),
      theme: pick(obj.theme, THEMES, DEFAULT_SETTINGS.theme)
    };
  }
  function chromeSettingsStore(area = chrome.storage.local, areaName = "local") {
    return {
      async load() {
        const data = await area.get(SETTINGS_KEY);
        return normalizeSettings(data[SETTINGS_KEY]);
      },
      async save(settings2) {
        await area.set({ [SETTINGS_KEY]: normalizeSettings(settings2) });
      },
      subscribe(listener) {
        const handler = (changes, name) => {
          if (name !== areaName || !(SETTINGS_KEY in changes)) return;
          listener(normalizeSettings(changes[SETTINGS_KEY]?.newValue));
        };
        chrome.storage.onChanged.addListener(handler);
        return () => chrome.storage.onChanged.removeListener(handler);
      }
    };
  }

  // src/core/parse.ts
  var SPACE_CHARS = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
  var ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff\u00ad]/g;
  function normalizeSpaces(text) {
    return text.replace(ZERO_WIDTH, "").replace(SPACE_CHARS, " ").replace(/\s+/g, " ");
  }
  function parsePercentInput(input) {
    let text = normalizeSpaces(input).trim();
    if (text.endsWith("%")) text = text.slice(0, -1).trim();
    if (text === "") return { ok: false, error: "empty" };
    if (/^[-\u2212]\s*(\d|\.\d)/.test(text)) return { ok: false, error: "out-of-range" };
    if (/^\d*,\d+$/.test(text)) text = text.replace(",", ".");
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return { ok: false, error: "invalid" };
    if (!parseDecimal(text)) return { ok: false, error: "invalid" };
    const probability = probabilityFromDecimal(text, "percent");
    if (!probability) return { ok: false, error: "out-of-range" };
    return { ok: true, probability, digits: text };
  }

  // src/popup/model.ts
  var SUPPORTED_LIST = "Works on Polymarket US (polymarket.us), Kalshi, ProphetX and Novig.";
  function hostOf(url) {
    if (!url) return null;
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }
  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }
  function describeStatus(input) {
    const { settings: settings2, url, status } = input;
    const host = hostOf(url);
    const platform = status ? getPlatform(status.platformId) : host ? platformForHost(host) : null;
    const name = platform?.name ?? "";
    const currentPlatform = platform?.id ?? null;
    const note = platform?.verification === "unverified" ? `The ${name} integration was built from ${name}'s public documentation and tested on representative pages; it has not yet been verified on the live site.` : "";
    if (!settings2.enabled) {
      return {
        state: "off",
        title: "Converter is off",
        detail: platform ? `Turn it on to see American odds on ${name}.` : "Turn it on to see American odds on supported sites.",
        note: "",
        currentPlatform
      };
    }
    if (status) {
      if (!status.platformEnabled) {
        return { state: "warn", title: `${name} is switched off`, detail: `Turn ${name} on under Sites.`, note: "", currentPlatform };
      }
      if (status.pageExcluded) {
        return {
          state: "idle",
          title: `${name}: this page is left unchanged`,
          detail: "Account, portfolio, wallet and help pages are deliberately not converted.",
          note,
          currentPlatform
        };
      }
      if (status.detected === 0) {
        return {
          state: "idle",
          title: `${name}: supported page, no prices detected yet`,
          detail: status.platformId === "kalshi" ? "Prices are detected in cents (62\xA2) or percent (62%). Payout multipliers such as 1.6x are not converted." : "Open a market list, event page or order panel. Only prices shown as % or \xA2/$ on $1 contracts are converted.",
          note,
          currentPlatform
        };
      }
      if (status.displayOrder === "price-only") {
        return {
          state: "active",
          title: `${name}: ${plural(status.detected, "price")} detected`,
          detail: "Showing original prices only. Choose \u201COdds first\u201D or \u201CPrice first\u201D to show conversions.",
          note,
          currentPlatform
        };
      }
      const extras = [];
      if (status.noRoom > 0) extras.push(`${plural(status.noRoom, "label")} hidden where there was no room`);
      if (status.skipped > 0) extras.push(`${plural(status.skipped, "other number")} left unchanged (fees, volume, changes\u2026)`);
      return {
        state: "active",
        title: `${name}: ${plural(status.shown, "price")} converted`,
        detail: extras.join(" \xB7 "),
        note,
        currentPlatform
      };
    }
    if (platform) {
      return {
        state: "warn",
        title: `${name}: reload this tab to activate`,
        detail: "The converter starts when a page loads. Pages opened before the extension was installed or updated need a reload.",
        note,
        currentPlatform
      };
    }
    if (host) {
      const lookalike = unsupportedLookalikeMessage(host);
      return {
        state: "off",
        title: "This site isn\u2019t supported",
        detail: lookalike ?? SUPPORTED_LIST,
        note: "",
        currentPlatform: null
      };
    }
    return { state: "off", title: "No supported page in this tab", detail: SUPPORTED_LIST, note: "", currentPlatform: null };
  }
  function trimmed(value, decimals) {
    return value.toFixed(decimals).replace(/\.?0+$/, "");
  }
  function calculate(input, rounding) {
    const parsed = parsePercentInput(input);
    if (!parsed.ok) {
      if (parsed.error === "empty") {
        return { output: "\u2014", detail: "Enter a percentage between 0 and 100.", error: false, none: false };
      }
      if (parsed.error === "invalid") {
        return { output: "\u2014", detail: "That isn\u2019t a number. Try 52.38 or 60%.", error: true, none: false };
      }
      return { output: "\u2014", detail: "A probability must be between 0% and 100%.", error: true, none: false };
    }
    const odds = toAmericanOdds(parsed.probability);
    if (odds.kind === "none") {
      return { output: "No odds", detail: describeNoOdds(odds.reason), error: false, none: true };
    }
    const formatted = formatAmericanOdds(odds, rounding) ?? "";
    const precise = oddsToNumber(odds);
    const preciseText = (precise > 0 ? "+" : MINUS) + trimmed(Math.abs(precise), 3);
    return {
      output: formatted,
      detail: `${parsed.digits}% = ${preciseText} before rounding. Equivalent odds before fees.`,
      error: false,
      none: false
    };
  }
  function displayExample(order, rounding) {
    const odds = calculate("60", rounding).output;
    if (order === "odds-first") return { before: "", odds, after: " \xB7 60%" };
    if (order === "price-first") return { before: "60% \xB7 ", odds, after: "" };
    return { before: "60%", odds: "", after: " (original prices only)" };
  }

  // src/popup/popup.ts
  var store = chromeSettingsStore();
  var settings;
  var target = { id: null, url: null };
  function byId(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing #${id}`);
    return el;
  }
  var enabledInput = byId("enabled");
  var sitesList = byId("sites");
  var roundingSelect = byId("rounding");
  var themeSelect = byId("theme");
  var calcInput = byId("calc-input");
  var calcOutput = byId("calc-output");
  var calcDetail = byId("calc-detail");
  var statusSection = byId("status");
  var diagButton = byId("copy-diagnostics");
  var diagMessage = byId("diag-message");
  var diagFallback = byId("diag-fallback");
  function buildSites() {
    sitesList.replaceChildren();
    for (const platform of PLATFORMS) {
      const li = document.createElement("li");
      li.className = "site";
      li.dataset.platform = platform.id;
      const text = document.createElement("div");
      text.className = "site-text";
      const nameEl = document.createElement("span");
      nameEl.className = "site-name";
      nameEl.textContent = platform.name;
      const domain = document.createElement("span");
      domain.className = "site-domain";
      domain.textContent = platform.domainLabel;
      text.append(nameEl, domain);
      li.append(text);
      if (platform.verification === "unverified") {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "Unverified";
        badge.title = "Built from public documentation and representative tests; not yet checked on the live site.";
        li.append(badge);
      }
      const label = document.createElement("label");
      label.className = "switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.id = `site-${platform.id}`;
      input.addEventListener("change", () => {
        void update({ platforms: { ...settings.platforms, [platform.id]: input.checked } });
      });
      const track = document.createElement("span");
      track.className = "track";
      track.setAttribute("aria-hidden", "true");
      const sr = document.createElement("span");
      sr.className = "visually-hidden";
      sr.textContent = `Convert prices on ${platform.name}`;
      label.append(input, track, sr);
      li.append(label);
      sitesList.append(li);
    }
  }
  function applyTheme(theme) {
    if (theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }
  function renderExample() {
    const example = byId("display-example");
    const { before, odds, after } = displayExample(settings.displayOrder, settings.rounding);
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = odds;
    example.replaceChildren("Example: ", before, ...odds ? [pill] : [], after);
  }
  function renderSettings() {
    enabledInput.checked = settings.enabled;
    for (const platform of PLATFORMS) {
      const input = document.getElementById(`site-${platform.id}`);
      if (input) input.checked = settings.platforms[platform.id];
    }
    for (const radio of Array.from(document.querySelectorAll('input[name="displayOrder"]'))) {
      radio.checked = radio.value === settings.displayOrder;
    }
    roundingSelect.value = settings.rounding;
    themeSelect.value = settings.theme;
    applyTheme(settings.theme);
    renderExample();
    renderCalculator();
  }
  function renderCalculator() {
    const view = calculate(calcInput.value, settings.rounding);
    calcOutput.textContent = view.output;
    calcOutput.classList.toggle("none", view.none);
    calcDetail.textContent = view.detail;
    calcDetail.classList.toggle("error", view.error);
    calcInput.setAttribute("aria-invalid", String(view.error));
  }
  async function update(patch) {
    settings = { ...settings, ...patch };
    renderSettings();
    await store.save(settings);
    setTimeout(() => void refreshStatus(), 150);
  }
  async function findTarget() {
    const param = new URLSearchParams(location.search).get("tabId");
    if (param !== null) {
      const id = Number(param);
      try {
        const tab2 = await chrome.tabs.get(id);
        return { id, url: tab2.url ?? tab2.pendingUrl ?? null };
      } catch {
        return { id, url: null };
      }
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return { id: tab?.id ?? null, url: tab?.url ?? tab?.pendingUrl ?? null };
  }
  function isPageStatus(value) {
    return !!value && typeof value === "object" && "platformId" in value && "detected" in value;
  }
  async function refreshStatus() {
    let status = null;
    if (target.id !== null) {
      try {
        const response = await chrome.tabs.sendMessage(target.id, { type: MSG_GET_STATUS });
        if (isPageStatus(response)) status = response;
      } catch {
        status = null;
      }
    }
    const view = describeStatus({ settings, url: target.url, status });
    statusSection.dataset.state = view.state;
    byId("status-title").textContent = view.title;
    byId("status-detail").textContent = view.detail;
    byId("status-note").textContent = view.note;
    for (const li of Array.from(sitesList.children)) {
      li.classList.toggle("current", li.dataset.platform === view.currentPlatform);
    }
  }
  async function copyDiagnostics() {
    diagMessage.textContent = "";
    diagFallback.hidden = true;
    if (target.id === null) {
      diagMessage.textContent = "Open a supported page first.";
      return;
    }
    let report = null;
    try {
      report = await chrome.tabs.sendMessage(target.id, { type: MSG_GET_DIAGNOSTICS });
    } catch {
      report = null;
    }
    if (!report || !Array.isArray(report.entries)) {
      diagMessage.textContent = "Diagnostics are available on supported pages only (reload the tab if needed).";
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
  async function init() {
    settings = await store.load();
    buildSites();
    renderSettings();
    byId("version").textContent = `v${chrome.runtime.getManifest().version}`;
    enabledInput.addEventListener("change", () => void update({ enabled: enabledInput.checked }));
    for (const radio of Array.from(document.querySelectorAll('input[name="displayOrder"]'))) {
      radio.addEventListener("change", () => {
        if (radio.checked && DISPLAY_ORDERS.includes(radio.value)) {
          void update({ displayOrder: radio.value });
        }
      });
    }
    roundingSelect.addEventListener("change", () => void update({ rounding: roundingSelect.value }));
    themeSelect.addEventListener("change", () => void update({ theme: themeSelect.value }));
    calcInput.addEventListener("input", renderCalculator);
    diagButton.addEventListener("click", () => void copyDiagnostics());
    store.subscribe((next) => {
      settings = next;
      renderSettings();
    });
    target = await findTarget();
    await refreshStatus();
  }
  void init();
})();
