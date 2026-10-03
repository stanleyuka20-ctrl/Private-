"use strict";
(() => {
  // src/content/adapters/kalshi.ts
  var kalshiAdapter = {
    id: "kalshi",
    units: { percent: true, cents: true, dollars: false },
    payoutPerContractUSD: 1,
    excludedPaths: [
      /^\/(account|portfolio|settings|deposit|withdraw|transfer|transfers|history|activity|statements|tax|documents|referral|referrals|rewards|help|docs|blog|legal|privacy|terms|careers|about|learn|news|sign-?in|sign-?up|login|register|onboarding)(\/|$)/i,
      /^\/pro\/help(\/|$)/i
    ],
    buttonQuoteKind: "price",
    unlabeledButtonQuotes: true,
    rowPercentIsEstimate: true
  };

  // src/core/messages.ts
  var MSG_GET_STATUS = "aoc:get-status";
  var MSG_GET_DIAGNOSTICS = "aoc:get-diagnostics";

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
  function spokenAmericanOdds(formatted) {
    return formatted.replace(MINUS, "minus ").replace("+", "plus ");
  }
  function describeNoOdds(reason) {
    return reason === "zero" ? "No finite American odds: a 0% price implies the outcome never happens." : "No finite American odds: a 100% price leaves no profit to quote.";
  }
  function formatScaled(scaled, decimals) {
    const digits = scaled.toString().padStart(decimals + 1, "0");
    const intPart = digits.slice(0, digits.length - decimals);
    const frac = digits.slice(digits.length - decimals).replace(/0+$/, "");
    return frac ? `${intPart}.${frac}` : intPart;
  }
  function formatPercentOf(p) {
    const scaled = (p.num * 1000000n + p.den / 2n) / p.den;
    const intPart = scaled / 10000n;
    const frac = (scaled % 10000n).toString().padStart(4, "0").replace(/0+$/, "");
    return frac ? `${intPart}.${frac}%` : `${intPart}%`;
  }
  function roundingRange(text, scale, mode = "whole") {
    const parsed = parseDecimal(text);
    if (!parsed) return null;
    const unitDen = scale === "percent" ? 100n : 1n;
    const den = parsed.den * unitDen * 2n;
    if (parsed.num * 2n > den) return null;
    const lowNum = parsed.num === 0n ? 0n : parsed.num * 2n - 1n;
    const highNumRaw = parsed.num * 2n + 1n;
    const highNum = highNumRaw > den ? den : highNumRaw;
    const low = reduce(lowNum, den);
    const high = reduce(highNum, den);
    const maxScaled = (scale === "percent" ? 100n : 1n) * 10n ** BigInt(parsed.decimals + 1);
    const lowScaled = parsed.num === 0n ? 0n : (parsed.num * 2n - 1n) * 5n;
    const highScaled = (parsed.num * 2n + 1n) * 5n > maxScaled ? maxScaled : (parsed.num * 2n + 1n) * 5n;
    return {
      lowPercent: formatPercentOf(low),
      highPercent: formatPercentOf(high),
      lowValue: formatScaled(lowScaled, parsed.decimals + 1),
      highValue: formatScaled(highScaled, parsed.decimals + 1),
      oddsAtLow: formatAmericanOdds(toAmericanOdds(low), mode),
      oddsAtHigh: formatAmericanOdds(toAmericanOdds(high), mode)
    };
  }

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
      async save(settings) {
        await area.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
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
  var TOKEN_RE = /\$ ?(\d+(?:\.\d+)?|\.\d+)|(\d+(?:\.\d+)?|\.\d+) ?(%|¢)/g;
  var SIGN_CHARS = "+-\u2212\u2013\u2014";
  var ARROW_CHARS = "\u25B2\u25BC\u25B3\u25BD\u2191\u2193\u2B06\u2B07\u23F6\u23F7\u25B4\u25BE";
  var QUALIFIER_CHARS = "<>\u2264\u2265~\u2248\xB1";
  function isDigit(ch) {
    return ch !== void 0 && ch >= "0" && ch <= "9";
  }
  function isLetter(ch) {
    return ch !== void 0 && new RegExp("\\p{L}", "u").test(ch);
  }
  function charBefore(text, index, skipSpace) {
    let i = index - 1;
    if (skipSpace && text[i] === " ") i -= 1;
    return i >= 0 ? text[i] : void 0;
  }
  function findPriceTokens(text) {
    const tokens = [];
    TOKEN_RE.lastIndex = 0;
    for (let m = TOKEN_RE.exec(text); m !== null; m = TOKEN_RE.exec(text)) {
      const start = m.index;
      const end = start + m[0].length;
      const next = text[end];
      const prev = text[start - 1];
      const isDollar = m[1] !== void 0;
      const digits = (isDollar ? m[1] : m[2]) ?? "";
      if (isDollar) {
        if (isDigit(next) || (next === "," || next === ".") && isDigit(text[end + 1])) continue;
        if (next !== void 0 && /[kmbt]/i.test(next) && !isLetter(text[end + 1])) continue;
        if (!digits.includes(".")) continue;
        const intPart = digits.split(".")[0] ?? "";
        if (intPart.replace(/^0+/, "").length > 1) continue;
      } else {
        if (isDigit(prev) || prev === "." || prev === "," && isDigit(text[start - 2])) continue;
      }
      const parsed = parseDecimal(digits);
      if (!parsed) continue;
      const unit = isDollar ? "dollars" : m[3] === "%" ? "percent" : "cents";
      const probability = probabilityFromDecimal(digits, unit === "dollars" ? "unit" : "percent");
      const before = charBefore(text, start, false);
      const beforeSpaced = charBefore(text, start, true);
      const signed = before !== void 0 && SIGN_CHARS.includes(before) || beforeSpaced !== void 0 && ARROW_CHARS.includes(beforeSpaced) || before !== void 0 && ARROW_CHARS.includes(before);
      let qualifier = null;
      if (beforeSpaced !== void 0 && QUALIFIER_CHARS.includes(beforeSpaced)) qualifier = beforeSpaced;
      else if (beforeSpaced === "=" && QUALIFIER_CHARS.includes(charBefore(text, start - 1, true) ?? "")) {
        qualifier = charBefore(text, start - 1, true) ?? null;
      }
      tokens.push({
        unit,
        raw: m[0],
        digits,
        decimals: parsed.decimals,
        start,
        end,
        probability,
        qualifier,
        signed
      });
    }
    return tokens;
  }
  var AMERICAN_RE = /(?<![\w.,$¢%\u2212+\-\u2013])[+\-\u2212\u2013] ?(\d{3,5})(?![\d.,%¢])/g;
  function containsAmericanOdds(text) {
    AMERICAN_RE.lastIndex = 0;
    for (let m = AMERICAN_RE.exec(text); m !== null; m = AMERICAN_RE.exec(text)) {
      if (Number(m[1]) >= 100) return true;
    }
    return false;
  }

  // src/content/dom.ts
  var LABEL_TAG = "aoc-odds-label";
  var HTML_NS = "http://www.w3.org/1999/xhtml";
  var EXCLUDED_TAGS = /* @__PURE__ */ new Set([
    "script",
    "style",
    "noscript",
    "template",
    "textarea",
    "input",
    "select",
    "option",
    "optgroup",
    "datalist",
    "output",
    "code",
    "pre",
    "kbd",
    "samp",
    "var",
    "canvas",
    "iframe",
    "object",
    "embed",
    "head",
    "title",
    "meta",
    "link"
  ]);
  var EXCLUDED_ROLES = /* @__PURE__ */ new Set(["textbox", "searchbox", "spinbutton", "slider", "combobox", "progressbar", "meter"]);
  var INTERACTIVE_SELECTOR = [
    "button",
    '[role="button"]',
    "a[href]",
    '[role="link"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="checkbox"]',
    '[role="switch"]',
    "summary",
    "label"
  ].join(",");
  var ORDER_ENTRY_SELECTOR = [
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])',
    "textarea",
    "select",
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[role="spinbutton"]',
    '[role="slider"]',
    '[role="textbox"]'
  ].join(",");
  function isElement(node) {
    return !!node && node.nodeType === 1;
  }
  function isText(node) {
    return !!node && node.nodeType === 3;
  }
  function isLabelHost(node) {
    return isElement(node) && node.localName === LABEL_TAG;
  }
  function isExcludedElement(el) {
    if (el.namespaceURI !== HTML_NS) return true;
    const tag = el.localName;
    if (tag === LABEL_TAG || EXCLUDED_TAGS.has(tag)) return true;
    const editable = el.getAttribute("contenteditable");
    if (editable !== null && editable !== "false") return true;
    if (el.isContentEditable === true) return true;
    const role = el.getAttribute("role");
    if (role !== null && EXCLUDED_ROLES.has(role)) return true;
    return el.hasAttribute("data-aoc-ignore");
  }
  var ExclusionCache = class {
    memo = /* @__PURE__ */ new Map();
    isExcludedDeep(el) {
      const path = [];
      let result = false;
      for (let cur = el; cur; cur = cur.parentElement) {
        const known = this.memo.get(cur);
        if (known !== void 0) {
          result = known;
          break;
        }
        path.push(cur);
        if (isExcludedElement(cur)) {
          result = true;
          break;
        }
      }
      for (const p of path) this.memo.set(p, result);
      return result;
    }
  };
  function edgeRect(node, which) {
    const range = node.ownerDocument.createRange();
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    if (rects.length === 0) return null;
    return (which === "first" ? rects[0] : rects[rects.length - 1]) ?? null;
  }
  function displayIsInline(el) {
    if (!el) return false;
    const display = el.ownerDocument.defaultView?.getComputedStyle(el).display ?? "";
    return display === "" || display.startsWith("inline") || display === "contents";
  }
  function createLayoutProbe(doc) {
    const root = doc.documentElement;
    const available = !!root && root.getBoundingClientRect().width > 0;
    return {
      available,
      inlineAdjacent(a, b) {
        if (available) {
          const ra = edgeRect(a, "last");
          const rb = edgeRect(b, "first");
          if (ra && rb && ra.width + ra.height > 0 && rb.width + rb.height > 0) {
            const midA = (ra.top + ra.bottom) / 2;
            const midB = (rb.top + rb.bottom) / 2;
            const sameLine = Math.abs(midA - midB) <= Math.max(ra.height, rb.height) / 2;
            const fontSize = Number.parseFloat(doc.defaultView?.getComputedStyle(b.parentElement ?? root).fontSize ?? "16") || 16;
            const gap = rb.left - ra.right;
            return sameLine && gap >= -2 && gap <= Math.max(3, fontSize * 0.3);
          }
        }
        return displayIsInline(a.parentElement) && displayIsInline(b.parentElement);
      }
    };
  }
  var BREAKING_ELEMENTS = /* @__PURE__ */ new Set(["br", "hr", "img", "wbr"]);
  var NUMERIC_FRAGMENT = /^\$?[\d.]{1,4}[%¢]?$/;
  function continuesNumber(prev, prevText, next, nextText, layout) {
    const a = prevText.trim();
    const b = nextText.trim();
    let candidate = false;
    if (/\d$/.test(a) && /^[%¢]/.test(b)) candidate = true;
    else if (a.endsWith("$") && /^[\d.]/.test(b)) candidate = true;
    else if (/[\d.]$/.test(a) && /^[\d.]/.test(b)) candidate = NUMERIC_FRAGMENT.test(a) && NUMERIC_FRAGMENT.test(b);
    return candidate && layout.inlineAdjacent(prev, next);
  }
  function visualText(root, limit, layout) {
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (isElement(node)) {
          if (isExcludedElement(node)) return NodeFilter.FILTER_REJECT;
          return BREAKING_ELEMENTS.has(node.localName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let text = "";
    const segments = [];
    let prev = null;
    let prevValue = "";
    let pendingBreak = false;
    let rawBudget = limit * 6 + 200;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (isElement(node)) {
        pendingBreak = true;
        continue;
      }
      const data = node.data;
      rawBudget -= data.length;
      if (rawBudget < 0) return null;
      let value = normalizeSpaces(data);
      if (value === "") continue;
      if (value === " ") {
        if (text !== "" && !text.endsWith(" ")) text += " ";
        continue;
      }
      if (text.endsWith(" ") && value.startsWith(" ")) {
        value = value.slice(1);
      } else if (prev && text !== "" && !text.endsWith(" ") && !value.startsWith(" ")) {
        const join = !pendingBreak && (prev.parentNode === node.parentNode || continuesNumber(prev, prevValue, node, value, layout));
        if (!join) text += " ";
      }
      pendingBreak = false;
      const start = text.length;
      text += value;
      segments.push({ node, start, end: text.length });
      prev = node;
      prevValue = value;
      if (text.trim().length > limit) return null;
    }
    let offset = 0;
    if (text.startsWith(" ")) {
      text = text.slice(1);
      offset = 1;
    }
    if (text.endsWith(" ")) text = text.slice(0, -1);
    const len = text.length;
    const fixed = segments.map((s) => ({
      node: s.node,
      start: Math.max(0, s.start - offset),
      end: Math.min(len, Math.max(0, s.end - offset))
    }));
    if (len > limit) return null;
    return { text, segments: fixed };
  }
  function segmentAt(vt, index) {
    for (const s of vt.segments) if (index >= s.start && index < s.end) return s;
    return null;
  }
  function closestWithin(el, selector, maxLevels) {
    let cur = el;
    for (let i = 0; cur && i <= maxLevels; i++, cur = cur.parentElement) {
      if (cur.matches(selector)) return cur;
    }
    return null;
  }
  function isDocumentRoot(el) {
    const doc = el.ownerDocument;
    return el === doc.body || el === doc.documentElement;
  }
  function toWords(text) {
    return text.toLowerCase().replace(/[^\p{L}\p{N}&/]+/gu, " ").trim().split(" ").filter((w) => w !== "" && w !== "/" && w !== "&");
  }
  function removeStrayLabels(doc) {
    for (const el of Array.from(doc.getElementsByTagName(LABEL_TAG))) el.remove();
  }

  // src/content/detect.ts
  var TOKEN_ELEMENT_LIMIT = 64;
  var INTERACTIVE_TEXT_LIMIT = 120;
  var ROW_TEXT_LIMIT = 240;
  var CAPTION_LIMIT = 40;
  var UNIT_CHARS = /[%¢$]/;
  function createScanContext(doc) {
    return { doc, layout: createLayoutProbe(doc), exclusion: new ExclusionCache(), tradeModes: /* @__PURE__ */ new Map() };
  }
  function unitTextNodes(root, sc) {
    if (isText(root)) {
      const parent = root.parentElement;
      return UNIT_CHARS.test(root.data) && parent && !sc.exclusion.isExcludedDeep(parent) ? [root] : [];
    }
    if (!isElement(root) || sc.exclusion.isExcludedDeep(root)) return [];
    const found = [];
    const walker = sc.doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (isElement(node)) return isExcludedElement(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        return UNIT_CHARS.test(node.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) found.push(n);
    return found;
  }
  function unitIndex(token) {
    return token.unit === "dollars" ? token.start : token.end - 1;
  }
  function findTokenElement(unitNode, sc) {
    let el = unitNode.parentElement;
    for (let depth = 0; el && depth <= 3; depth++, el = el.parentElement) {
      if (isDocumentRoot(el) || sc.exclusion.isExcludedDeep(el)) return null;
      const vt = visualText(el, TOKEN_ELEMENT_LIMIT, sc.layout);
      if (!vt) return null;
      const tokens = findPriceTokens(vt.text);
      const token = tokens.find((t) => segmentAt(vt, unitIndex(t))?.node === unitNode);
      if (token) {
        const first = segmentAt(vt, token.start)?.node;
        const last = segmentAt(vt, token.end - 1)?.node;
        if (!first || !last) return null;
        return { el, vt, token, tokenCount: tokens.length, firstNode: first, lastNode: last };
      }
    }
    return null;
  }
  function hitForElement(el, sc) {
    if (!el.isConnected || sc.exclusion.isExcludedDeep(el)) return null;
    const vt = visualText(el, TOKEN_ELEMENT_LIMIT, sc.layout);
    if (!vt) return null;
    const token = findPriceTokens(vt.text)[0];
    if (!token) return null;
    const unitNode = segmentAt(vt, unitIndex(token))?.node;
    if (!unitNode) return null;
    const hit = findTokenElement(unitNode, sc);
    return hit && hit.el === el ? hit : null;
  }
  var STRICT_EXCLUDED = /* @__PURE__ */ new Set([
    "vol",
    "volume",
    "fee",
    "fees",
    "cost",
    "costs",
    "payout",
    "payouts",
    "pays",
    "paid",
    "roi",
    "profit",
    "profits",
    "p&l",
    "pnl",
    "p/l",
    "balance",
    "balances",
    "cash",
    "funds",
    "portfolio",
    "equity",
    "position",
    "positions",
    "avg",
    "average",
    "filled",
    "fills",
    "spent",
    "chg",
    "24h",
    "7d",
    "1d",
    "1w",
    "1m",
    "1y",
    "apy",
    "apr",
    "yield",
    "bonus",
    "boost",
    "boosted",
    "promo",
    "promotion",
    "discount",
    "cashback",
    "rebate",
    "deposit",
    "deposits",
    "withdraw",
    "withdrawal",
    "credit",
    "credits",
    "max",
    "min",
    "slippage",
    "tolerance",
    "amount",
    "shares",
    "contracts",
    "qty",
    "quantity",
    "size",
    "liquidity",
    "depth",
    "holders",
    "leverage",
    "margin",
    "tax",
    "taxes",
    "commission",
    "rake",
    "vig",
    "ev",
    "kelly",
    "off",
    "reward",
    "rewards",
    "referral",
    "utilization"
  ]);
  var CAPTION_EXCLUDED = /* @__PURE__ */ new Set([
    "change",
    "changes",
    "return",
    "returns",
    "gain",
    "gains",
    "loss",
    "losses",
    "value",
    "interest",
    "rate",
    "rates",
    "today",
    "stop",
    "edge",
    "score",
    "traders",
    "accuracy",
    "winrate",
    "spread",
    "limit",
    "total",
    "totals",
    "range",
    "fill"
  ]);
  var MONEY_EXCLUDED = /* @__PURE__ */ new Set(["win", "wins", "won", "potential", "each", "per"]);
  var ESTIMATE_WORDS = /* @__PURE__ */ new Set(["chance", "chances", "probability", "prob", "implied", "likely", "likelihood", "forecast", "mid", "midpoint"]);
  var LAST_WORDS = /* @__PURE__ */ new Set(["last", "traded", "ltp"]);
  var SELL_WORDS = /* @__PURE__ */ new Set(["sell", "bid", "bids", "selling"]);
  var BUY_WORDS = /* @__PURE__ */ new Set(["buy", "ask", "asks", "offer", "offers", "buying"]);
  var SIDE_FILLER = /* @__PURE__ */ new Set([...BUY_WORDS, ...SELL_WORDS, "at", "price", "best", "for", "the", "contract", "contracts"]);
  var STRUCTURAL_WORDS = /* @__PURE__ */ new Set([
    "yes",
    "no",
    "buy",
    "sell",
    "bid",
    "ask",
    "last",
    "price",
    "prices",
    "chance",
    "chances",
    "odds",
    "trade",
    "traded",
    "best",
    "at",
    "for",
    "the",
    "a",
    "to",
    "of",
    "or",
    "and",
    "vs",
    "v",
    "moneyline",
    "spread",
    "total",
    "totals",
    "more",
    "less",
    "view",
    "details",
    "show",
    "hide",
    "all",
    "markets",
    "market",
    "vol",
    "volume",
    "new",
    "live",
    "probability"
  ]);
  function kindFromWords(words) {
    const kinds = /* @__PURE__ */ new Set();
    for (const w of words) {
      if (ESTIMATE_WORDS.has(w)) kinds.add("estimate");
      else if (LAST_WORDS.has(w)) kinds.add("last");
      else if (SELL_WORDS.has(w)) kinds.add("sell");
      else if (BUY_WORDS.has(w)) kinds.add("buy");
    }
    if (kinds.size > 1) return "conflict";
    return kinds.values().next().value ?? null;
  }
  function sideOf(words) {
    const core = words.filter((w) => !SIDE_FILLER.has(w));
    const yes = core.includes("yes");
    const no = core.includes("no");
    if (yes && no) return "both";
    const last = core[core.length - 1];
    return last === "yes" || last === "no" ? last : null;
  }
  function kindFromHeader(header) {
    const words = toWords(header);
    const side = sideOf(words);
    const s = side === "both" ? null : side;
    if (words.some((w) => SELL_WORDS.has(w))) return { kind: "sell", side: s };
    if (words.some((w) => w === "ask" || w === "asks" || w === "offer" || w === "buy")) return { kind: "buy", side: s };
    if (words.includes("last")) return { kind: "last", side: s };
    if (words.some((w) => w === "chance" || w === "probability" || w === "implied")) return { kind: "estimate", side: s };
    if (s && words.length === 1) return { kind: "price", side: s };
    return null;
  }
  var OUTCOME_COLUMNS = /* @__PURE__ */ new Set(["moneyline", "ml", "winner", "match winner", "to win", "1x2", "h2h", "head to head", "outcome"]);
  function isOutcomeColumn(header) {
    return OUTCOME_COLUMNS.has(toWords(header).join(" "));
  }
  function removeToken(text, token) {
    return `${text.slice(0, token.start)} ${text.slice(token.end)}`.replace(/\s+/g, " ").trim();
  }
  var LINE_RE = /^(?:[ou]\.?\s?)?[+\-\u2212]?\d+(?:\.\d+)?$/i;
  function classifyLabel(label) {
    if (label === "") return "empty";
    if (new RegExp("\\p{L}", "u").test(label) && !/[$€£]\s?\d/.test(label)) return "outcome";
    return LINE_RE.test(label) ? "outcome" : "other";
  }
  function outcomeFromLabel(label) {
    const kept = label.split(" ").filter((w) => {
      const lw = w.toLowerCase().replace(/[^\p{L}]/gu, "");
      return !BUY_WORDS.has(lw) && !SELL_WORDS.has(lw) && !LAST_WORDS.has(lw) && lw !== "price" && lw !== "at";
    }).join(" ").trim();
    if (kept === "") return null;
    return kept.length > 40 ? `${kept.slice(0, 40)}\u2026` : kept;
  }
  function captionText(node, sc) {
    if (isText(node)) return node.data.replace(/\s+/g, " ").trim();
    if (!isElement(node) || isLabelHost(node) || isExcludedElement(node)) return "";
    if (node.matches(INTERACTIVE_SELECTOR) || node.querySelector(INTERACTIVE_SELECTOR)) return "";
    const vt = visualText(node, CAPTION_LIMIT, sc.layout);
    return vt ? vt.text : null;
  }
  function collectCaptions(start, sc) {
    const before = [];
    const after = [];
    let cur = start;
    let scopeEl = start;
    for (let level = 0; level < 4; level++) {
      const parent = cur.parentElement;
      if (!parent || isDocumentRoot(parent) || sc.exclusion.isExcludedDeep(parent)) break;
      const siblings = Array.from(parent.childNodes);
      const idx = siblings.indexOf(cur);
      const texts = siblings.map((s, i) => i === idx ? "" : captionText(s, sc));
      scopeEl = parent;
      if (texts.every((t) => t === "")) {
        cur = parent;
        continue;
      }
      for (let i = idx - 1, taken = 0; i >= 0 && taken < 2; i--) {
        const t = texts[i];
        if (t === "") continue;
        if (t === null || t === void 0 || /\d/.test(t)) break;
        before.unshift(t);
        taken++;
      }
      for (let i = idx + 1, taken = 0; i < siblings.length && taken < 2; i++) {
        const t = texts[i];
        if (t === "") continue;
        if (t === null || t === void 0 || /\d/.test(t)) break;
        let next;
        for (let j = i + 1; j < siblings.length; j++) {
          if (texts[j] !== "") {
            next = texts[j];
            break;
          }
        }
        if (next !== void 0 && next !== null && /\d/.test(next)) break;
        after.push(t);
        taken++;
      }
      break;
    }
    return { before, after, scopeEl };
  }
  function columnIndex(row, cell) {
    let col = 0;
    for (const c of Array.from(row.children)) {
      if (c === cell) return col;
      col += c.colSpan || 1;
    }
    return -1;
  }
  function cellAtColumn(row, col) {
    let at = 0;
    for (const c of Array.from(row.children)) {
      const span = c.colSpan || 1;
      if (col >= at && col < at + span) return c;
      at += span;
    }
    return null;
  }
  function findCellHeader(el, sc) {
    const cell = closestWithin(el, 'td, th, [role="cell"], [role="gridcell"]', 4);
    if (!cell) return null;
    let header = null;
    if (cell.localName === "td" || cell.localName === "th") {
      const row = cell.parentElement;
      const table = cell.closest("table");
      if (row && row.localName === "tr" && table) {
        const col = columnIndex(row, cell);
        const headRow = table.tHead?.rows[0] ?? table.rows[0];
        if (headRow && headRow !== row && col >= 0) header = cellAtColumn(headRow, col);
      }
    } else {
      const row = cell.closest('[role="row"]');
      const grid = cell.closest('[role="grid"], [role="table"], [role="treegrid"]');
      if (row && grid) {
        const cells = Array.from(row.children).filter(
          (c) => /^(cell|gridcell|columnheader|rowheader)$/.test(c.getAttribute("role") ?? "")
        );
        const idx = cells.indexOf(cell);
        header = Array.from(grid.querySelectorAll('[role="columnheader"]'))[idx] ?? null;
      }
    }
    if (!header) return "";
    return visualText(header, CAPTION_LIMIT, sc.layout)?.text.toLowerCase() ?? "";
  }
  function outcomeLabelIn(vt, quoteEl) {
    for (const seg of vt.segments) {
      if (quoteEl.contains(seg.node)) continue;
      const text = vt.text.slice(seg.start, seg.end).trim();
      if (!new RegExp("\\p{L}{2,}", "u").test(text) || findPriceTokens(text).length > 0) continue;
      if (toWords(text).every((w) => STRUCTURAL_WORDS.has(w) || /^\d/.test(w))) continue;
      return text.length > 48 ? `${text.slice(0, 48)}\u2026` : text;
    }
    return null;
  }
  function findRow(quoteEl, sc) {
    let anc = quoteEl.parentElement;
    for (let i = 0; anc && i < 6 && !isDocumentRoot(anc); i++, anc = anc.parentElement) {
      if (sc.exclusion.isExcludedDeep(anc)) break;
      const vt = visualText(anc, ROW_TEXT_LIMIT, sc.layout);
      if (!vt) break;
      const label = outcomeLabelIn(vt, quoteEl);
      if (label) return { rowEl: anc, rowLabel: label, rowText: vt.text };
    }
    return { rowEl: null, rowLabel: null, rowText: null };
  }
  function isQuoteCaption(text) {
    return toWords(text).some(
      (w) => w === "price" || ESTIMATE_WORDS.has(w) || LAST_WORDS.has(w) || BUY_WORDS.has(w) || SELL_WORDS.has(w)
    );
  }
  function sameLabel(caption, rowLabel) {
    if (!rowLabel || isQuoteCaption(caption)) return false;
    const label = rowLabel.endsWith("\u2026") ? rowLabel.slice(0, -1) : rowLabel;
    return caption === label || rowLabel.endsWith("\u2026") && caption.startsWith(label);
  }
  function analyze(hit, sc) {
    let interactive = null;
    let label = "";
    let textBefore = hit.vt.text.slice(0, hit.token.start);
    let textAfter = hit.vt.text.slice(hit.token.end);
    const candidate = closestWithin(hit.el, INTERACTIVE_SELECTOR, 5);
    if (candidate && !isDocumentRoot(candidate)) {
      const vt = candidate === hit.el ? hit.vt : visualText(candidate, INTERACTIVE_TEXT_LIMIT, sc.layout);
      const tokens = vt ? findPriceTokens(vt.text) : [];
      const only = tokens[0];
      if (vt && tokens.length === 1 && only) {
        interactive = candidate;
        label = removeToken(vt.text, only);
        textBefore = vt.text.slice(0, only.start);
        textAfter = vt.text.slice(only.end);
      }
    }
    const row = findRow(interactive ?? hit.el, sc);
    let words;
    let nameWords = [];
    let captionBefore = "";
    let captionAfter = "";
    let scopeEl;
    if (interactive) {
      words = toWords(label);
      scopeEl = interactive;
    } else {
      const { token } = hit;
      label = removeToken(hit.vt.text, token);
      const captions = collectCaptions(hit.el, sc);
      const names = captions.before.filter((t) => sameLabel(t, row.rowLabel));
      nameWords = names.flatMap(toWords);
      words = [
        ...captions.before.filter((t) => !names.includes(t)).flatMap(toWords),
        ...toWords(hit.vt.text.slice(0, token.start)),
        ...toWords(hit.vt.text.slice(token.end)),
        ...captions.after.flatMap(toWords)
      ];
      scopeEl = captions.scopeEl;
      captionBefore = captions.before[captions.before.length - 1] ?? "";
      captionAfter = captions.after[0] ?? "";
    }
    const scopeText = scopeEl === hit.el ? hit.vt.text : visualText(scopeEl, INTERACTIVE_TEXT_LIMIT, sc.layout)?.text ?? null;
    return {
      hit,
      interactive,
      label,
      textBefore,
      textAfter,
      captionBefore,
      captionAfter,
      words,
      nameWords,
      side: sideOf(words),
      cellHeader: findCellHeader(hit.el, sc),
      rowEl: row.rowEl,
      rowLabel: row.rowLabel,
      rowText: row.rowText,
      scopeEl,
      scopeText
    };
  }
  var SELECTED_SELECTOR = [
    '[aria-selected="true"]',
    '[aria-pressed="true"]',
    '[aria-checked="true"]',
    '[data-state="active"]',
    '[data-state="on"]',
    '[data-state="checked"]',
    '[data-selected="true"]',
    '[data-active="true"]'
  ].join(",");
  function tradeMode(interactive, sc) {
    let anc = interactive.parentElement;
    for (let i = 0; anc && i < 5 && !isDocumentRoot(anc); i++, anc = anc.parentElement) {
      let mode = sc.tradeModes.get(anc);
      if (mode === void 0) {
        mode = null;
        for (const sel of Array.from(anc.querySelectorAll(SELECTED_SELECTOR))) {
          if (sel === interactive || sel.contains(interactive) || interactive.contains(sel)) continue;
          const text = visualText(sel, 12, sc.layout)?.text.toLowerCase();
          if (text === "buy" || text === "sell") {
            mode = text;
            break;
          }
        }
        sc.tradeModes.set(anc, mode);
      }
      if (mode) return mode;
    }
    return null;
  }
  function looksLikeOrderEntry(interactive, sc) {
    const parent = interactive.parentElement;
    if (!parent) return false;
    const grand = parent.parentElement;
    const scope = grand && !isDocumentRoot(grand) ? grand : parent;
    if (scope.querySelector(ORDER_ENTRY_SELECTOR)) return true;
    for (const sib of Array.from(parent.children)) {
      if (sib === interactive) continue;
      const text = visualText(sib, 16, sc.layout)?.text.toLowerCase() ?? "";
      if (/^(max|all|half|min|clear|reset|custom)$/.test(text)) return true;
    }
    return false;
  }
  function rowHasTradeControls(rowEl, sc) {
    for (const el of Array.from(rowEl.querySelectorAll(INTERACTIVE_SELECTOR))) {
      const text = visualText(el, 32, sc.layout)?.text;
      if (text && /\b(yes|no|buy|sell)\b/i.test(text)) return true;
    }
    return false;
  }
  function isExcludedContext(a, money, adapter) {
    const extra = adapter.extraExcludedWords ?? [];
    const strict = (w) => STRICT_EXCLUDED.has(w) || extra.includes(w);
    if (a.words.some(strict) || a.nameWords.some(strict)) return true;
    if (!a.interactive && a.words.some((w) => CAPTION_EXCLUDED.has(w))) return true;
    if (!money) return false;
    if (a.words.some((w) => MONEY_EXCLUDED.has(w))) return true;
    const name = a.nameWords.join(" ");
    return name === "win" || name === "to win" || name.startsWith("potential");
  }
  var COMPARISON_WORDS = /* @__PURE__ */ new Set([
    "above",
    "below",
    "over",
    "under",
    "than",
    "least",
    "most",
    "exceed",
    "exceeds",
    "exceeding",
    "beyond",
    "by",
    "reach",
    "reaches",
    "hit",
    "hits",
    "top",
    "tops",
    "past",
    "cross",
    "crosses",
    "surpass",
    "surpasses",
    "between",
    "from",
    "to",
    "within",
    "max",
    "min"
  ]);
  var OR_MORE = /^\s*(\+|or (more|less|higher|lower|above|below|greater|fewer|better|worse)\b|and (above|below|up|over|under)\b)/i;
  function lastWord(text) {
    const words = toWords(text);
    return words[words.length - 1];
  }
  function isThreshold(a) {
    const inner = lastWord(a.textBefore);
    if (inner !== void 0 && COMPARISON_WORDS.has(inner)) return true;
    const caption = lastWord(a.captionBefore);
    if (caption !== void 0 && COMPARISON_WORDS.has(caption) && caption !== "over" && caption !== "under") return true;
    return OR_MORE.test(a.textAfter) || OR_MORE.test(a.captionAfter);
  }
  function skip(reason) {
    return { ok: false, reason };
  }
  function classify(a, adapter, sc) {
    const { hit } = a;
    const t = hit.token;
    if (hit.tokenCount !== 1) return skip("multiple-prices");
    if (!adapter.units[t.unit]) return skip("unit-not-used");
    if (t.unit !== "percent" && adapter.payoutPerContractUSD !== 1) return skip("unit-not-used");
    if (t.signed) return skip("signed-change");
    if (t.qualifier) return skip("qualified-value");
    if (!t.probability) return skip("out-of-range");
    if (/@\s*$/.test(a.textBefore)) return skip("unrelated-label");
    if (isThreshold(a)) return skip("threshold-value");
    if ([hit.vt.text, a.label, a.scopeText, a.rowText].some((s) => s && containsAmericanOdds(s))) {
      return skip("existing-american-odds");
    }
    if (isExcludedContext(a, t.unit !== "percent", adapter)) return skip("unrelated-label");
    if (a.side === "both") return skip("ambiguous-label");
    let side = a.side;
    const wordKind = kindFromWords(a.words);
    if (wordKind === "conflict") return skip("ambiguous-label");
    let kind = wordKind;
    const outcome = outcomeFromLabel(a.label);
    if (!kind && a.cellHeader !== null) {
      const fromHeader = kindFromHeader(a.cellHeader);
      if (fromHeader) {
        kind = fromHeader.kind;
        side = side ?? fromHeader.side;
      } else if (!a.interactive) {
        return skip("table-column");
      } else if (classifyLabel(a.label) === "empty" && !isOutcomeColumn(a.cellHeader)) {
        return skip("table-column");
      }
    }
    if (a.interactive) {
      if (!kind) {
        const labelState = classifyLabel(a.label);
        if (labelState === "other") return skip("no-price-context");
        if (side) kind = tradeMode(a.interactive, sc) ?? adapter.buttonQuoteKind;
        else if (labelState === "outcome") kind = adapter.buttonQuoteKind;
        else {
          if (!adapter.unlabeledButtonQuotes) return skip("no-price-context");
          if (looksLikeOrderEntry(a.interactive, sc)) return skip("order-entry");
          if (!a.rowLabel) return skip("no-price-context");
          kind = adapter.buttonQuoteKind;
        }
      }
    } else if (!kind) {
      if (side || a.words.includes("price")) kind = "price";
      else if (t.unit === "percent" && adapter.rowPercentIsEstimate && hit.vt.text === t.raw && a.rowEl !== null && rowHasTradeControls(a.rowEl, sc)) {
        kind = "estimate";
      } else return skip("no-price-context");
    }
    if ((kind === "buy" || kind === "sell") && t.unit === "percent" && !side && !outcome && a.cellHeader === null) {
      return skip("no-price-context");
    }
    if (kind === "estimate" && t.unit !== "percent" && !a.words.some((w) => w === "mid" || w === "midpoint")) {
      return skip("no-price-context");
    }
    const decision = { ok: true, kind, side, outcome };
    return adapter.refine ? adapter.refine(a, decision) : decision;
  }

  // src/content/label.ts
  var SIDE_TEXT = { yes: "Yes", no: "No" };
  function describeSource(view) {
    const who = view.side ? SIDE_TEXT[view.side] : view.outcome;
    switch (view.kind) {
      case "buy":
        return who ? `price to buy ${who} (ask)` : "price to buy (ask)";
      case "sell":
        return who ? `price to sell ${who} (bid)` : "price to sell (bid)";
      case "last":
        return "last traded price \u2014 not an offer you can trade at";
      case "estimate":
        return "estimated chance shown by the site \u2014 not a price you can trade at";
      case "price":
        return who ? `price shown for ${who}` : "price shown on the page";
    }
  }
  function formatInUnit(value, unit) {
    if (unit === "percent") return `${value}%`;
    if (unit === "cents") return `${value}\xA2`;
    return `$${value}`;
  }
  function buildLabelModel(view) {
    const { token } = view;
    const probability = token.probability;
    if (!probability) throw new Error("Label requested for a token without a valid probability");
    const odds = toAmericanOdds(probability);
    const formatted = formatAmericanOdds(odds, view.rounding);
    const lines = [];
    if (formatted) lines.push(`Equivalent odds before fees: ${formatted}`);
    else lines.push("No equivalent American odds");
    lines.push(`Converted from ${token.raw}: ${describeSource(view)}.`);
    if (odds.kind === "none") lines.push(describeNoOdds(odds.reason));
    const scale = token.unit === "dollars" ? "unit" : "percent";
    const range = formatted ? roundingRange(token.digits, scale, view.rounding) : null;
    if (range && range.oddsAtLow !== range.oddsAtHigh) {
      const low = formatInUnit(range.lowValue, token.unit);
      const high = formatInUnit(range.highValue, token.unit);
      const from = range.oddsAtLow ?? "longer odds";
      const to = range.oddsAtHigh ?? "shorter odds";
      lines.push(`If ${token.raw} is a rounded figure (${low}\u2013${high}), the equivalent is ${from} to ${to}.`);
    }
    lines.push("Rounded source prices make conversions approximate. Actual execution prices may differ, and fees are not included.");
    const spoken = formatted ? `equivalent odds before fees, ${spokenAmericanOdds(formatted)}` : "no equivalent American odds";
    const key = [formatted ?? "n/a", view.kind, view.side ?? "", view.outcome ?? "", token.raw, view.placement].join("|");
    return { odds: formatted, tooltip: lines.join("\n"), spoken, key };
  }
  var STYLE_TEXT = `
:host {
  display: inline !important; position: static !important; float: none !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important; background: none !important;
  width: auto !important; height: auto !important; min-width: 0 !important; max-width: none !important;
  transform: none !important; visibility: visible !important; opacity: 1 !important;
  white-space: nowrap !important; text-indent: 0 !important; text-transform: none !important;
  letter-spacing: normal !important; flex: none !important; order: 0 !important;
  user-select: none !important; -webkit-user-select: none !important; pointer-events: auto !important;
}
.w { white-space: nowrap; font-family: inherit; font-style: normal; color: inherit; }
.w.after { margin-inline-start: 0.3em; }
.w.before { margin-inline-end: 0.3em; }
.sep { opacity: 0.6; font-weight: 400; }
.after .sep { margin-inline-end: 0.3em; }
.before .sep { margin-inline-start: 0.3em; }
.pill {
  display: inline-block; font-size: max(11px, 0.8em); font-weight: 650; line-height: 1.3;
  font-variant-numeric: tabular-nums; padding: 0 0.42em; border-radius: 0.55em;
  border: 1px solid rgba(127, 127, 127, 0.45);
  border-color: color-mix(in srgb, currentColor 30%, transparent);
  background: rgba(127, 127, 127, 0.12);
  background: color-mix(in srgb, currentColor 10%, transparent);
  vertical-align: 0.05em;
}
.k-last .pill, .k-estimate .pill { background: transparent; font-weight: 550; }
.k-last .pill { border-style: dashed; }
.k-estimate .pill { border-style: dotted; }
.tag { font-weight: 500; opacity: 0.8; margin-inline-start: 0.3em; font-size: 0.9em; }
.none .pill { font-weight: 500; }
.sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}
@media (forced-colors: active) {
  .pill { border: 1px solid CanvasText; background: Canvas; color: CanvasText; }
}
`;
  var sharedSheet;
  function styleSheet() {
    if (sharedSheet !== void 0) return sharedSheet;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE_TEXT);
      sharedSheet = sheet;
    } catch {
      sharedSheet = null;
    }
    return sharedSheet;
  }
  function createLabel(doc) {
    const host = doc.createElement(LABEL_TAG);
    const root = host.attachShadow({ mode: "open" });
    const sheet = styleSheet();
    if (sheet && "adoptedStyleSheets" in root) {
      try {
        root.adoptedStyleSheets = [sheet];
      } catch {
        appendStyle(doc, root);
      }
    } else {
      appendStyle(doc, root);
    }
    const wrap = doc.createElement("span");
    wrap.setAttribute("aria-hidden", "true");
    const sr = doc.createElement("span");
    sr.className = "sr";
    root.append(wrap, sr);
    return { host, root, wrap, sr };
  }
  function appendStyle(doc, root) {
    const style = doc.createElement("style");
    style.textContent = STYLE_TEXT;
    root.append(style);
  }
  function renderLabel(el, model, view) {
    const doc = el.host.ownerDocument;
    const { host, wrap, sr } = el;
    host.title = model.tooltip;
    host.setAttribute("data-aoc-odds", model.odds ?? "n/a");
    host.setAttribute("data-aoc-kind", view.kind);
    host.setAttribute("data-aoc-source", view.token.raw);
    if (view.side) host.setAttribute("data-aoc-side", view.side);
    else host.removeAttribute("data-aoc-side");
    const placeAfter = view.placement === "price-first";
    wrap.className = `w ${placeAfter ? "after" : "before"} k-${view.kind}${model.odds ? "" : " none"}`;
    const sep = doc.createElement("span");
    sep.className = "sep";
    sep.textContent = "\xB7";
    const pill = doc.createElement("span");
    pill.className = "pill";
    pill.textContent = model.odds ?? "n/a";
    if (view.kind === "last") {
      const tag = doc.createElement("span");
      tag.className = "tag";
      tag.textContent = "last";
      pill.append(tag);
    }
    wrap.replaceChildren(...placeAfter ? [sep, pill] : [pill, sep]);
    sr.textContent = model.spoken;
  }

  // src/content/engine.ts
  var DEFAULT_FLUSH_DELAY_MS = 50;
  var MAX_REINSERTS = 3;
  function pageSettled(win) {
    return new Promise((resolve) => {
      const idle = () => {
        if (typeof win.requestIdleCallback === "function") win.requestIdleCallback(() => resolve(), { timeout: 1500 });
        else win.setTimeout(resolve, 300);
      };
      if (win.document.readyState === "complete") idle();
      else win.addEventListener("load", idle, { once: true });
    });
  }
  function signatureOf(hit, a, d) {
    return [d.kind, d.side ?? "", d.outcome ?? "", a.rowLabel ?? "", hit.token.raw].join("|");
  }
  function describeElement(el) {
    const parts = [];
    for (let e = el, i = 0; e && i < 4 && !isDocumentRoot(e); e = e.parentElement, i++) {
      let s = e.localName;
      const role = e.getAttribute("role");
      if (role) s += `[role=${role}]`;
      const testId = e.getAttribute("data-testid") ?? e.getAttribute("data-test-id") ?? e.getAttribute("data-cy");
      if (testId) s += `[data-testid=${testId.slice(0, 40)}]`;
      const classes = typeof e.className === "string" ? e.className.trim().split(/\s+/).filter(Boolean) : [];
      if (classes.length) s += `.${classes.slice(0, 3).map((c) => c.slice(0, 24)).join(".")}`;
      parts.unshift(s);
    }
    return parts.join(" > ");
  }
  var Engine = class {
    stats = { flushes: 0, fullScans: 0, evaluations: 0, inserts: 0, removals: 0 };
    adapter;
    store;
    doc;
    win;
    isContextValid;
    flushDelay;
    version;
    whenReady;
    settings = DEFAULT_SETTINGS;
    annotations = /* @__PURE__ */ new Map();
    contextIndex = /* @__PURE__ */ new Map();
    skipped = /* @__PURE__ */ new Map();
    observer = null;
    discoveryRoots = /* @__PURE__ */ new Set();
    touchRoots = /* @__PURE__ */ new Set();
    labelsRemovedExternally = false;
    fullScanPending = false;
    lastActive = false;
    inFlush = false;
    flushTimer = null;
    roomChecks = /* @__PURE__ */ new Set();
    roomFrame = null;
    starting = false;
    started = false;
    disposed = false;
    unsubscribe = null;
    onNavigation = () => this.scheduleFlush();
    constructor(options) {
      this.adapter = options.adapter;
      this.store = options.store;
      this.doc = options.doc ?? document;
      const win = this.doc.defaultView;
      if (!win) throw new Error("Engine needs a document with a window");
      this.win = win;
      this.isContextValid = options.isContextValid ?? (() => true);
      this.flushDelay = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
      this.version = options.version ?? "0.0.0";
      this.whenReady = options.whenReady ?? (() => Promise.resolve());
    }
    async start() {
      if (this.starting || this.disposed) return;
      this.starting = true;
      removeStrayLabels(this.doc);
      try {
        this.settings = await this.store.load();
      } catch {
        this.settings = DEFAULT_SETTINGS;
      }
      await this.whenReady();
      if (this.disposed) return;
      try {
        this.settings = await this.store.load();
      } catch {
      }
      if (this.disposed) return;
      removeStrayLabels(this.doc);
      this.started = true;
      this.unsubscribe = this.store.subscribe((s) => this.applySettings(s));
      this.win.addEventListener("popstate", this.onNavigation);
      this.win.addEventListener("hashchange", this.onNavigation);
      const navigation = this.win.navigation;
      navigation?.addEventListener?.("currententrychange", this.onNavigation);
      navigation?.addEventListener?.("navigatesuccess", this.onNavigation);
      this.syncObserver();
      this.scheduleFlush();
    }
    dispose() {
      if (this.disposed) return;
      this.clearAll();
      this.disposed = true;
      this.observer?.disconnect();
      this.observer = null;
      this.unsubscribe?.();
      this.unsubscribe = null;
      if (this.flushTimer !== null) clearTimeout(this.flushTimer);
      if (this.roomFrame !== null) this.win.cancelAnimationFrame?.(this.roomFrame);
      this.win.removeEventListener("popstate", this.onNavigation);
      this.win.removeEventListener("hashchange", this.onNavigation);
      const navigation = this.win.navigation;
      navigation?.removeEventListener?.("currententrychange", this.onNavigation);
      navigation?.removeEventListener?.("navigatesuccess", this.onNavigation);
    }
    get isDisposed() {
      return this.disposed;
    }
    /** Runs any pending batch immediately (tests, and before answering the popup). */
    flushNow() {
      if (this.flushTimer !== null) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.flush();
    }
    // -------------------------------------------------------------------------
    // Settings and activity
    // -------------------------------------------------------------------------
    platformOn(s = this.settings) {
      return s.enabled && s.platforms[this.adapter.id];
    }
    pathExcluded() {
      const path = this.win.location.pathname;
      return this.adapter.excludedPaths.some((re) => re.test(path));
    }
    isActive() {
      return this.platformOn() && !this.pathExcluded();
    }
    applySettings(next) {
      if (this.disposed) return;
      const prev = this.settings;
      this.settings = next;
      this.syncObserver();
      if (!this.platformOn()) {
        this.clearAll();
        this.lastActive = false;
        return;
      }
      if (prev.displayOrder !== next.displayOrder || prev.rounding !== next.rounding) {
        this.mutate(() => {
          for (const ann of this.annotations.values()) {
            ann.noRoom = false;
            this.render(ann);
          }
        });
        this.scheduleRoomCheck();
      }
      this.scheduleFlush();
    }
    syncObserver() {
      if (this.disposed) return;
      if (this.platformOn()) {
        if (!this.observer) {
          this.observer = new MutationObserver((records) => this.onMutations(records));
          this.observer.observe(this.doc.documentElement, { childList: true, subtree: true, characterData: true });
        }
      } else if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
        this.discoveryRoots.clear();
        this.touchRoots.clear();
      }
    }
    // -------------------------------------------------------------------------
    // Mutation intake
    // -------------------------------------------------------------------------
    onMutations(records) {
      for (const r of records) {
        if (r.type === "characterData") {
          const parent = r.target.parentNode;
          if (isElement(parent)) {
            this.touchRoots.add(parent);
            this.discoveryRoots.add(parent);
          }
          continue;
        }
        if (isLabelHost(r.target)) continue;
        let external = false;
        for (const n of Array.from(r.addedNodes)) {
          if (isLabelHost(n)) continue;
          external = true;
          this.discoveryRoots.add(n);
        }
        for (const n of Array.from(r.removedNodes)) {
          if (isLabelHost(n)) this.labelsRemovedExternally = true;
          else external = true;
        }
        if (external) this.touchRoots.add(r.target);
      }
      if (!this.inFlush && (this.discoveryRoots.size || this.touchRoots.size || this.labelsRemovedExternally)) {
        this.scheduleFlush();
      }
    }
    /** Performs DOM writes and drops the observer records they caused. */
    mutate(write) {
      const pending = this.observer?.takeRecords() ?? [];
      if (pending.length) this.onMutations(pending);
      write();
      this.observer?.takeRecords();
    }
    scheduleFlush() {
      if (this.disposed || this.flushTimer !== null) return;
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.flushDelay);
    }
    flush() {
      if (this.disposed || !this.started) return;
      if (!this.isContextValid()) {
        this.dispose();
        return;
      }
      this.stats.flushes++;
      const active = this.isActive();
      if (!active) {
        this.discoveryRoots.clear();
        this.touchRoots.clear();
        this.labelsRemovedExternally = false;
        if (this.annotations.size || this.skipped.size) this.clearAll();
        this.lastActive = false;
        return;
      }
      if (!this.lastActive) {
        this.fullScanPending = true;
        this.lastActive = true;
      }
      this.inFlush = true;
      try {
        this.mutate(() => this.process());
      } finally {
        this.inFlush = false;
      }
      if (this.discoveryRoots.size || this.touchRoots.size || this.labelsRemovedExternally) this.scheduleFlush();
      this.scheduleRoomCheck();
    }
    collectRoots(nodes, expandSmall) {
      const elements = /* @__PURE__ */ new Set();
      for (const node of nodes) {
        let el = isText(node) ? node.parentElement : isElement(node) ? node : null;
        if (!el || !el.isConnected || isLabelHost(el)) continue;
        if (expandSmall && el.parentElement && !isDocumentRoot(el.parentElement)) {
          if (el.childElementCount <= 3 && (el.textContent?.length ?? 0) <= 16) el = el.parentElement;
        }
        elements.add(el);
      }
      const roots = [];
      for (const el of elements) {
        let covered = false;
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (elements.has(p)) {
            covered = true;
            break;
          }
        }
        if (!covered) roots.push(el);
      }
      return roots;
    }
    process() {
      const sc = createScanContext(this.doc);
      const full = this.fullScanPending;
      this.fullScanPending = false;
      if (full) this.stats.fullScans++;
      const body = this.doc.body ?? this.doc.documentElement;
      const discovery = full ? [body] : this.collectRoots(this.discoveryRoots, true);
      const touch = full ? [] : this.collectRoots(this.touchRoots, false);
      this.discoveryRoots.clear();
      this.touchRoots.clear();
      const labelsRemoved = this.labelsRemovedExternally;
      this.labelsRemovedExternally = false;
      const recheck = /* @__PURE__ */ new Set();
      for (const ann of this.annotations.values()) {
        if (full || !ann.el.isConnected) recheck.add(ann);
        else if (labelsRemoved && ann.label && ann.renderedKey && !ann.label.host.isConnected) recheck.add(ann);
      }
      for (const root of [...touch, ...discovery]) {
        for (let e = root; e; e = e.parentElement) {
          const set = this.contextIndex.get(e);
          if (set) for (const ann of set) recheck.add(ann);
        }
      }
      for (const ann of recheck) this.recheck(ann, sc);
      for (const el of Array.from(this.skipped.keys())) if (!el.isConnected) this.skipped.delete(el);
      const seen = /* @__PURE__ */ new Set();
      for (const root of discovery) {
        for (const node of unitTextNodes(root, sc)) {
          const hit = findTokenElement(node, sc);
          if (!hit || seen.has(hit.el)) continue;
          seen.add(hit.el);
          const existing = this.annotations.get(hit.el);
          if (existing) {
            if (!recheck.has(existing)) this.recheck(existing, sc);
            continue;
          }
          this.evaluate(hit, sc);
        }
      }
    }
    // -------------------------------------------------------------------------
    // Annotation lifecycle
    // -------------------------------------------------------------------------
    evaluate(hit, sc) {
      this.stats.evaluations++;
      const analysis = analyze(hit, sc);
      const decision = classify(analysis, this.adapter, sc);
      if (!decision.ok) {
        this.skipped.set(hit.el, decision.reason);
        return;
      }
      this.skipped.delete(hit.el);
      const ann = {
        el: hit.el,
        hit,
        analysis,
        decision,
        signature: signatureOf(hit, analysis, decision),
        label: null,
        renderedKey: "",
        noRoom: false,
        reinserts: 0,
        indexed: []
      };
      this.annotations.set(hit.el, ann);
      this.index(ann);
      this.render(ann);
    }
    recheck(ann, sc) {
      this.stats.evaluations++;
      const hit = hitForElement(ann.el, sc);
      if (!hit) {
        this.remove(ann);
        return;
      }
      const analysis = analyze(hit, sc);
      const decision = classify(analysis, this.adapter, sc);
      if (!decision.ok) {
        this.remove(ann);
        this.skipped.set(ann.el, decision.reason);
        return;
      }
      const signature = signatureOf(hit, analysis, decision);
      const unchanged = signature === ann.signature && hit.firstNode === ann.hit.firstNode && hit.lastNode === ann.hit.lastNode;
      const labelLost = !!ann.label && ann.renderedKey !== "" && !ann.label.host.isConnected;
      if (labelLost && unchanged && this.settings.displayOrder !== "price-only" && !ann.noRoom) ann.reinserts++;
      else if (!unchanged) {
        ann.reinserts = 0;
        ann.noRoom = false;
      }
      ann.hit = hit;
      ann.analysis = analysis;
      ann.decision = decision;
      ann.signature = signature;
      this.index(ann);
      this.render(ann);
    }
    index(ann) {
      this.unindex(ann);
      const els = [ann.el, ann.analysis.scopeEl];
      if (ann.analysis.rowEl) els.push(ann.analysis.rowEl);
      if (ann.analysis.interactive) els.push(ann.analysis.interactive);
      for (const el of new Set(els)) {
        let set = this.contextIndex.get(el);
        if (!set) this.contextIndex.set(el, set = /* @__PURE__ */ new Set());
        set.add(ann);
        ann.indexed.push(el);
      }
    }
    unindex(ann) {
      for (const el of ann.indexed) {
        const set = this.contextIndex.get(el);
        if (!set) continue;
        set.delete(ann);
        if (set.size === 0) this.contextIndex.delete(el);
      }
      ann.indexed = [];
    }
    remove(ann) {
      this.detachLabel(ann);
      this.unindex(ann);
      this.annotations.delete(ann.el);
      this.roomChecks.delete(ann);
    }
    detachLabel(ann) {
      if (ann.label?.host.isConnected) {
        ann.label.host.remove();
        this.stats.removals++;
      }
    }
    clearAll() {
      this.mutate(() => {
        for (const ann of this.annotations.values()) this.detachLabel(ann);
      });
      this.annotations.clear();
      this.contextIndex.clear();
      this.skipped.clear();
      this.roomChecks.clear();
    }
    render(ann) {
      const order = this.settings.displayOrder;
      if (order === "price-only" || ann.noRoom || ann.reinserts > MAX_REINSERTS) {
        this.detachLabel(ann);
        return;
      }
      const placement = order === "odds-first" ? "odds-first" : "price-first";
      const view = {
        kind: ann.decision.kind,
        side: ann.decision.side,
        outcome: ann.decision.outcome,
        token: ann.hit.token,
        rounding: this.settings.rounding,
        placement
      };
      const model = buildLabelModel(view);
      if (!ann.label) ann.label = createLabel(this.doc);
      if (model.key !== ann.renderedKey) {
        renderLabel(ann.label, model, view);
        ann.renderedKey = model.key;
      }
      this.place(ann, placement);
    }
    /** Node right after which (or before which) the label goes: next to the price itself. */
    anchor(hit, placement) {
      let node = placement === "price-first" ? hit.lastNode : hit.firstNode;
      const raw = hit.token.raw.replace(/\s+/g, "");
      while (node.parentElement && node.parentElement !== hit.el) {
        const text = (node.parentElement.textContent ?? "").replace(/\s+/g, "");
        if (text === "" || !raw.includes(text)) break;
        node = node.parentElement;
      }
      return node;
    }
    place(ann, placement) {
      const host = ann.label?.host;
      if (!host) return;
      const anchor = this.anchor(ann.hit, placement);
      const parent = anchor.parentNode;
      if (!parent) return;
      if (placement === "price-first") {
        if (anchor.nextSibling === host) return;
        parent.insertBefore(host, anchor.nextSibling);
      } else {
        if (anchor.previousSibling === host) return;
        parent.insertBefore(host, anchor);
      }
      this.stats.inserts++;
      this.roomChecks.add(ann);
    }
    // -------------------------------------------------------------------------
    // Room check: never let a label spill over neighbouring controls
    // -------------------------------------------------------------------------
    scheduleRoomCheck() {
      if (!this.roomChecks.size || this.roomFrame !== null || this.disposed) return;
      const root = this.doc.documentElement;
      if (!root || root.getBoundingClientRect().width === 0 || !this.win.requestAnimationFrame) {
        this.roomChecks.clear();
        return;
      }
      this.roomFrame = this.win.requestAnimationFrame(() => {
        this.roomFrame = null;
        this.checkRoom();
      });
    }
    clippingBox(host, ann) {
      if (ann.analysis.interactive) return ann.analysis.interactive;
      let el = host.parentElement;
      for (let i = 0; el && i < 4 && !isDocumentRoot(el); i++, el = el.parentElement) {
        const style = this.win.getComputedStyle(el);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") return el;
      }
      return null;
    }
    checkRoom() {
      if (this.disposed) return;
      const misfits = [];
      for (const ann of this.roomChecks) {
        const host = ann.label?.host;
        if (!host?.isConnected) continue;
        const box = this.clippingBox(host, ann);
        if (!box) continue;
        const hr = host.getBoundingClientRect();
        const br = box.getBoundingClientRect();
        if (hr.width === 0 && hr.height === 0 || br.width === 0 && br.height === 0) continue;
        const fits = hr.left >= br.left - 1 && hr.right <= br.right + 1 && hr.top >= br.top - 1 && hr.bottom <= br.bottom + 1;
        if (!fits) misfits.push(ann);
      }
      this.roomChecks.clear();
      if (!misfits.length) return;
      this.mutate(() => {
        for (const ann of misfits) {
          ann.noRoom = true;
          this.detachLabel(ann);
        }
      });
    }
    // -------------------------------------------------------------------------
    // Popup support
    // -------------------------------------------------------------------------
    getStatus() {
      const platform = getPlatform(this.adapter.id);
      let shown = 0;
      let noRoom = 0;
      for (const ann of this.annotations.values()) {
        if (ann.label?.host.isConnected) shown++;
        if (ann.noRoom) noRoom++;
      }
      const skippedByReason = {};
      for (const reason of this.skipped.values()) skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
      return {
        platformId: platform.id,
        platformName: platform.name,
        verification: platform.verification,
        enabled: this.settings.enabled,
        platformEnabled: this.settings.platforms[this.adapter.id],
        pageExcluded: this.pathExcluded(),
        displayOrder: this.settings.displayOrder,
        detected: this.annotations.size,
        shown,
        noRoom,
        skipped: this.skipped.size,
        skippedByReason
      };
    }
    /**
     * Read-only report of how each price-like number on the page was handled,
     * for tuning an integration. Built on request only; nothing is sent anywhere.
     */
    getDiagnostics(limit = 80) {
      const page = this.win.location.origin + this.win.location.pathname;
      const excluded = this.pathExcluded();
      const entries = [];
      if (!excluded) {
        const sc = createScanContext(this.doc);
        const seen = /* @__PURE__ */ new Set();
        for (const node of unitTextNodes(this.doc.body ?? this.doc.documentElement, sc)) {
          const hit = findTokenElement(node, sc);
          if (!hit || seen.has(hit.el)) continue;
          seen.add(hit.el);
          const a = analyze(hit, sc);
          const d = classify(a, this.adapter, sc);
          entries.push({
            text: hit.vt.text,
            token: hit.token.raw,
            decision: d.ok ? `convert:${d.kind}` : `skip:${d.reason}`,
            side: d.ok ? d.side : a.side === "both" ? "both" : a.side,
            outcome: d.ok ? d.outcome : null,
            label: a.label.slice(0, 60),
            words: a.words.slice(0, 10),
            cellHeader: a.cellHeader,
            rowLabel: a.rowLabel,
            element: describeElement(hit.el)
          });
          if (entries.length >= limit) break;
        }
      }
      return {
        extensionVersion: this.version,
        platformId: this.adapter.id,
        page,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        pageExcluded: excluded,
        status: this.getStatus(),
        entries
      };
    }
  };

  // src/content/bootstrap.ts
  var GLOBAL_KEY = "__americanOddsConverter";
  function contextValid() {
    try {
      return typeof chrome !== "undefined" && !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }
  function bootstrap(adapter) {
    const scope = globalThis;
    const previous = scope[GLOBAL_KEY];
    if (previous && !previous.isDisposed) previous.dispose();
    const engine = new Engine({
      adapter,
      store: chromeSettingsStore(),
      isContextValid: contextValid,
      version: chrome.runtime.getManifest().version,
      whenReady: () => pageSettled(window)
    });
    scope[GLOBAL_KEY] = engine;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (engine.isDisposed) return false;
      const type = message?.type;
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

  // src/content/entries/kalshi.ts
  bootstrap(kalshiAdapter);
})();
