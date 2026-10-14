#!/usr/bin/env node
// Renders the SVG graphics that README.md shows: every card in a light and a
// dark variant, each at a wide (900px) and a narrow (440px) layout. README.md
// picks between them with <picture>: the wide files through media queries that
// combine the color scheme with (min-width: 701px), the narrow ones through a
// plain "(prefers-color-scheme:dark)" source and the <img> fallback. GitHub's
// <themed-picture> element rewrites any media query containing the text
// "prefers-color-scheme: dark" (with that spacing) to follow the viewer's GitHub
// theme, dropping the rest of the query, so only the wide sources use that
// spelling; viewers who force a theme get the wide layout on phones, in the
// right theme, and viewers who sync with the system get everything.
//
//   node scripts/render.mjs                 all cards (needs GITHUB_TOKEN)
//   node scripts/render.mjs --static        header and stack only, no network
//   node scripts/render.mjs --cache FILE    reuse fetched data from FILE when it
//                                           exists (handy while editing layouts)
//
// GITHUB_TOKEN      reads the contribution calendar (the Actions token is enough)
// PROFILE_TOKEN     optional token that can read private repositories; without it
//                   the languages card keeps its last version instead of showing
//                   public coursework only
// WAKATIME_API_KEY  optional; with at least an hour of WakaTime data in the last
//                   7 days it drives the languages card
//
// GitHub loads these files as <img>, where web fonts and external images are not
// available, so text is drawn from Geist outlines (glyphs.json) and logos from
// Simple Icons paths (icons.json).
//
// The calendar card links to an interactive version of itself (site/, published
// to GitHub Pages), which reads the same days from assets/contributions.json.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const LOGIN = 'HaikalFaruq';
const TIME_ZONE = 'Asia/Jakarta';
// This profile repo, and a third-party project copied for self-hosting.
const IGNORED_REPOS = new Set(['HaikalFaruq', 'github-readme-streak-stats']);
// The komarev counter was added to README.md on 2025-08-24.
const VIEWS_SINCE = 'Aug 2025';

// Two layouts of every card. `m` is the card's inner margin.
const LAYOUTS = {
  wide: { W: 900, m: 32, narrow: false, suffix: '' },
  narrow: { W: 440, m: 24, narrow: true, suffix: '-narrow' },
};

const THEMES = {
  light: {
    surface: '#ffffff', raised: '#f6f8fa', border: '#d8dee4',
    ink: '#162f4a', ink2: '#56606c', muted: '#66727f',
    grid: '#e6ebf0', axis: '#c9d2db', dots: '#c3ccd6',
    accent: '#2368b0', washOpacity: 0.1, other: '#8b97a4', warm: '#b86e00', live: '#1a7f37', logoContrast: 1.3,
    plateTop: '#f3f7fb', plateLeft: '#e4ecf4', plateRight: '#d6e1ec', plateEdge: '#9fb6ce',
    levels: ['#e4ebf2', '#b7d0ea', '#7eaee0', '#3f84cc', '#1c5a9f'],
  },
  dark: {
    surface: '#0e1a28', raised: '#13233a', border: '#22324a',
    ink: '#e6edf3', ink2: '#a9b8c8', muted: '#7f91a5',
    grid: '#1b2a3b', axis: '#2a3c51', dots: '#243750',
    accent: '#3f8ee8', washOpacity: 0.14, other: '#5a6d84', warm: '#e3a33b', live: '#3fb950', logoContrast: 2.2,
    plateTop: '#132a44', plateLeft: '#0f2238', plateRight: '#0b1a2c', plateEdge: '#2f5b8c',
    levels: ['#1d3350', '#1f4470', '#26609f', '#3a86d8', '#7cb8fb'],
  },
};

// ---------------------------------------------------------------------------
// Text and color

const FONTS = JSON.parse(readFileSync(join(ROOT, 'scripts/glyphs.json'), 'utf8'));
const ICONS = JSON.parse(readFileSync(join(ROOT, 'scripts/icons.json'), 'utf8'));
const num = (v, digits = 2) => Number(v.toFixed(digits)).toString();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => n.toLocaleString('en-US');

class Glyphs {
  used = new Map();

  ref(style, ch) {
    const key = `${style}:${ch}`;
    if (!this.used.has(key)) {
      this.used.set(key, { id: `g${this.used.size.toString(36)}`, d: FONTS[style].glyphs[ch][1] });
    }
    return this.used.get(key).id;
  }

  defs() {
    return [...this.used.values()].map((g) => `<path id="${g.id}" d="${g.d}"/>`).join('');
  }
}

function layout(str, style, tracking = 0) {
  const font = FONTS[style];
  const chars = [...str].map((c) => (font.glyphs[c] ? c : '?'));
  const pos = [];
  let pen = 0;
  chars.forEach((c, i) => {
    pos.push(pen);
    pen += font.glyphs[c][0] + (font.kern[c + (chars[i + 1] ?? '')] ?? 0);
    if (i < chars.length - 1) pen += tracking * font.upm;
  });
  return { chars, pos, width: pen };
}

const measure = (str, style, size, tracking = 0) => (layout(str, style, tracking).width * size) / FONTS[style].upm;

// Greedy word wrap to `maxWidth`.
function wrap(str, style, size, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of str.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, style, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// Returns a <g> that draws `str` with its baseline at y. `matrix` places the text
// on an arbitrary plane (used for the isometric labels in the header).
function text(G, str, { x = 0, y = 0, size, style = 'sans-400', fill, anchor = 'start', tracking = 0, matrix }) {
  const { chars, pos, width } = layout(str, style, tracking);
  const scale = size / FONTS[style].upm;
  const shift = anchor === 'end' ? width : anchor === 'middle' ? width / 2 : 0;
  const uses = chars
    .map((c, i) => (c === ' ' ? '' : `<use href="#${G.ref(style, c)}" x="${Math.round(pos[i] - shift)}"/>`))
    .join('');
  const place = matrix ? `matrix(${matrix.map((v) => num(v, 4)).join(' ')})` : `translate(${num(x)} ${num(y)})`;
  return `<g fill="${fill}" transform="${place} scale(${num(scale, 5)})">${uses}</g>`;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, k) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * k));
const shade = (hex, k) => toHex(rgb(hex).map((v) => v * k));

function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = rgb(hex).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Brand color where it stands out on the tile, otherwise nudged toward the ink.
// Black, white, and gray logos (Next.js, Vercel) simply take the ink color. The
// light theme accepts less contrast so yellow and lime logos keep their color.
function logoColor(hex, t) {
  const brand = `#${hex}`;
  const [r, g, b] = rgb(brand);
  if (Math.max(r, g, b) - Math.min(r, g, b) < 24) return t.ink;
  for (let k = 0; k <= 1; k += 0.1) {
    const c = mix(brand, t.ink, k);
    if (contrast(c, t.raised) >= t.logoContrast) return c;
  }
  return t.ink;
}

// ---------------------------------------------------------------------------
// SVG scaffolding

// Entrances are short: the frame of a card (headings, axes, labels) is in place
// at once and only the data layer moves, so a card never looks like it is
// still loading.
const BASE_CSS = `
.rise{animation:rise .5s cubic-bezier(.2,.7,.2,1) both}
.fade{animation:fade .45s ease-out both}
.pulse{transform-box:fill-box;transform-origin:center;opacity:0;animation:pulse 2.6s ease-out 2s infinite}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes pulse{0%{opacity:.7;transform:scale(1)}100%{opacity:0;transform:scale(3.2)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

function frame({ L, height, title, G, defs = '', css = '', body, t }) {
  const W = L.W;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(title)}">` +
    `<title>${esc(title)}</title>` +
    `<style>${BASE_CSS}${css}</style>` +
    `<defs>${G.defs()}${defs}<clipPath id="card"><rect width="${W}" height="${height}" rx="14"/></clipPath></defs>` +
    `<g clip-path="url(#card)"><rect width="${W}" height="${height}" fill="${t.surface}"/>${body}</g>` +
    `<rect x=".5" y=".5" width="${W - 1}" height="${height - 1}" rx="13.5" fill="none" stroke="${t.border}"/>` +
    `</svg>`
  );
}

const delay = (ms) => `style="animation-delay:${Math.round(ms)}ms"`;

// Title, subtitle, and an optional note in the top right corner. Returns the
// markup and the y where the card's content starts. Narrow cards wrap the
// subtitle and move a note that does not fit under it.
function cardHeading(G, t, L, { title, subtitle, note }) {
  const { m, W, narrow } = L;
  const inner = W - 2 * m;
  const titleSize = narrow ? 17 : 18;
  const subSize = narrow ? 13 : 13.5;
  let svg = text(G, title, { x: m, y: 46, size: titleSize, style: 'sans-600', fill: t.ink });
  const noteFits = note && measure(title, 'sans-600', titleSize) + measure(note.toUpperCase(), 'mono-500', 10.5, 0.08) + 24 <= inner;
  if (note && noteFits) svg += text(G, note.toUpperCase(), { x: W - m, y: 45, size: 10.5, style: 'mono-500', fill: t.muted, anchor: 'end', tracking: 0.08 });
  const lines = wrap(subtitle, 'sans-400', subSize, inner);
  let y = 69;
  for (const line of lines) {
    svg += text(G, line, { x: m, y, size: subSize, style: 'sans-400', fill: t.ink2 });
    y += 18;
  }
  if (note && !noteFits) {
    svg += text(G, note.toUpperCase(), { x: m, y: y + 2, size: 10.5, style: 'mono-500', fill: t.muted, tracking: 0.08 });
    y += 20;
  }
  return { svg, bottom: y + 9 };
}

// Stat tiles: label, value, and an optional unit after the value. Four across
// on wide cards, two by two on narrow ones. Returns the y below the tiles.
function statTiles(G, t, L, tiles, y) {
  const { m, W, narrow } = L;
  const cols = narrow ? 2 : 4;
  const tileW = (W - 2 * m) / cols;
  const valueSize = narrow ? 26 : 28;
  const rowH = 58;
  const rowGap = 18;
  let out = '';
  tiles.forEach(([label, value, unit], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ty = y + row * (rowH + rowGap);
    const x = m + col * tileW + (col ? 20 : 0);
    if (col) out += `<rect x="${num(m + col * tileW)}" y="${ty}" width="1" height="${rowH}" fill="${t.grid}"/>`;
    if (row && !col) out += `<rect x="${m}" y="${ty - rowGap / 2}" width="${W - 2 * m}" height="1" fill="${t.grid}"/>`;
    const vw = measure(value, 'sans-600', valueSize, -0.01);
    out +=
      text(G, label, { x, y: ty + 18, size: 12.5, style: 'sans-400', fill: t.muted }) +
      `<g class="rise" ${delay(60 + i * 50)}>` +
      text(G, value, { x, y: ty + 52, size: valueSize, style: 'sans-600', fill: t.ink, tracking: -0.01 }) +
      (unit ? text(G, unit, { x: x + vw + 6, y: ty + 52, size: 13.5, style: 'sans-500', fill: t.ink2 }) : '') +
      `</g>`;
  });
  const rows = Math.ceil(tiles.length / cols);
  return { svg: out, bottom: y + rows * rowH + (rows - 1) * rowGap };
}

// A column with a rounded top and a square base, as the charts here use.
function column(x, w, top, base, fill, ms) {
  const r = Math.min(4, (base - top) / 2, w / 2);
  return (
    `<path class="col" ${delay(ms)} d="M${num(x)},${num(base)}V${num(top + r)}A${num(r)},${num(r)} 0 0 1 ${num(x + r)},${num(top)}` +
    `H${num(x + w - r)}A${num(r)},${num(r)} 0 0 1 ${num(x + w)},${num(top + r)}V${num(base)}Z" fill="${fill}"/>`
  );
}

const COLUMN_CSS = `
.col{transform-box:fill-box;transform-origin:bottom;animation:grow .6s cubic-bezier(.2,.7,.2,1) both}
@keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}`;

// ---------------------------------------------------------------------------
// Header

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
const iso = (x, y, z) => [(x - y) * COS30, (x + y) * SIN30 - z];

// An exploded isometric stack (data, API, client) with a request travelling
// down the right edge and the response coming back up the left edge.
function header(t, L) {
  const G = new Glyphs();
  const { m, W, narrow } = L;
  const S = 120;
  const T = 6;
  const GAP = 62;
  const LEVELS = ['DATA', 'API', 'CLIENT'].map((label, i) => ({ label, z: i * GAP, top: i * GAP + T }));
  const CARD_Z = LEVELS[2].top + 12;

  const xy = (p) => iso(...p).map((v) => num(v)).join(',');
  const poly = (list, attrs) => `<polygon points="${list.map(xy).join(' ')}" ${attrs}/>`;
  const quad = (x0, y0, x1, y1, z, attrs) => poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], attrs);
  const seg = (a, b, attrs) => {
    const [x1, y1] = iso(...a);
    const [x2, y2] = iso(...b);
    return `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" ${attrs}/>`;
  };
  const dot = (p, r, fill) => {
    const [cx, cy] = iso(...p);
    return `<circle cx="${num(cx)}" cy="${num(cy)}" r="${r}" fill="${fill}"/>`;
  };
  const edge = `stroke="${t.plateEdge}" stroke-width="1" stroke-linejoin="round"`;
  const faint = `stroke="${t.ink2}" stroke-opacity=".45" stroke-width="2.4" stroke-linecap="round"`;

  // A circle on the ground plane projects to an axis aligned ellipse.
  const cylinder = (cx, cy, z, r, h) => {
    const [X, Yb] = iso(cx, cy, z);
    const Yt = Yb - h;
    const rx = r * 1.2247;
    const ry = r * 0.7071;
    const radii = `${num(rx)},${num(ry)}`;
    const arc = (y) => `M${num(X - rx)},${num(y)}A${radii} 0 0 0 ${num(X + rx)},${num(y)}`;
    return (
      `<path d="M${num(X - rx)},${num(Yt)}V${num(Yb)}A${radii} 0 0 0 ${num(X + rx)},${num(Yb)}V${num(Yt)}Z" fill="${t.plateRight}" ${edge}/>` +
      `<path d="${arc(Yt + h / 2)}" fill="none" ${edge}/>` +
      `<ellipse cx="${num(X)}" cy="${num(Yt)}" rx="${num(rx)}" ry="${num(ry)}" fill="${t.plateTop}" ${edge}/>`
    );
  };

  const faces = {
    DATA: (z) => cylinder(66, 92, z, 11, 20) + cylinder(98, 82, z, 11, 20),
    API: (z) => {
      const n = [[46, 100, z], [78, 110, z], [106, 96, z], [108, 60, z]];
      const links = [[0, 1], [1, 2], [2, 3], [1, 3]].map(([a, b]) => seg(n[a], n[b], `stroke="${t.plateEdge}" stroke-width="1.2"`)).join('');
      return links + n.map((p) => dot(p, 3, t.accent)).join('');
    },
    CLIENT: () => '',
  };

  const plate = ({ label, z, top }, i) => {
    const [lx, ly] = iso(10, S - 9, top);
    return (
      `<g class="plate" ${delay(80 + i * 120)}>` +
      poly([[S, 0, z], [S, S, z], [S, S, top], [S, 0, top]], `fill="${t.plateRight}" ${edge}`) +
      poly([[0, S, z], [S, S, z], [S, S, top], [0, S, top]], `fill="${t.plateLeft}" ${edge}`) +
      quad(0, 0, S, S, top, `fill="${t.plateTop}" ${edge}`) +
      // The label lies flat on the top face, reading along the front left edge.
      text(G, label, { size: 12, style: 'mono-500', fill: t.ink2, tracking: 0.16, matrix: [COS30, SIN30, -COS30, SIN30, lx, ly] }) +
      faces[label](top) +
      `</g>`
    );
  };

  // Client cards float above the top plate and cast a flat shadow on it.
  const shadow = (x0, y0, x1, y1) => quad(x0, y0, x1, y1, LEVELS[2].top, `fill="${t.accent}" fill-opacity=".12"`);
  const card = (x0, y0, x1, y1, inner) =>
    `<g class="float">${quad(x0, y0, x1, y1, CARD_Z, `fill="${t.surface}" stroke="${t.accent}" stroke-width="1.3" stroke-linejoin="round"`)}${inner}</g>`;
  const browser = card(12, 16, 72, 70,
    `<g class="ping">${quad(12, 16, 72, 25, CARD_Z, `fill="${t.accent}"`)}</g>` +
      seg([12, 25, CARD_Z], [72, 25, CARD_Z], `stroke="${t.accent}" stroke-opacity=".7"`) +
      [0, 1, 2].map((k) => dot([17 + k * 5, 20.5, CARD_Z], 1.3, t.accent)).join('') +
      seg([20, 35, CARD_Z], [62, 35, CARD_Z], faint) +
      seg([20, 44, CARD_Z], [50, 44, CARD_Z], faint) +
      quad(20, 51, 44, 63, CARD_Z, `fill="${t.accent}" fill-opacity=".28"`),
  );
  const phone = card(82, 28, 106, 84,
    seg([91, 33, CARD_Z], [97, 33, CARD_Z], `stroke="${t.accent}" stroke-width="2" stroke-linecap="round"`) +
      [44, 52, 60].map((y, k) => seg([87, y, CARD_Z], [101 - k * 3, y, CARD_Z], faint)).join('') +
      seg([90, 78, CARD_Z], [98, 78, CARD_Z], `stroke="${t.ink2}" stroke-opacity=".5" stroke-width="1.6" stroke-linecap="round"`),
  );

  const rails = (x, y) =>
    LEVELS.slice(0, 2).map((lv, i) => seg([x, y, lv.top], [x, y, LEVELS[i + 1].z], `stroke="${t.plateEdge}" stroke-dasharray="2 3"`)).join('');
  const [rx, rTop] = iso(S, 0, LEVELS[2].z);
  const [lx, lBottom] = iso(0, S, LEVELS[0].top);
  const travel = num(iso(S, 0, LEVELS[0].top)[1] - rTop);
  // The packets are the only looping motion on the page, so they stay small
  // and quiet: a 2.8px dot with a faint halo on a 6s cycle.
  const packet = (x, y, cls, color) =>
    `<g class="${cls}"><circle cx="${num(x)}" cy="${num(y)}" r="6" fill="${color}" opacity=".16"/><circle cx="${num(x)}" cy="${num(y)}" r="2.8" fill="${color}"/></g>`;

  const stack =
    plate(LEVELS[0], 0) +
    `<g class="plate" ${delay(80)}>${rails(S, 0)}${rails(0, S)}</g>` +
    plate(LEVELS[1], 1) +
    plate(LEVELS[2], 2) +
    `<g class="plate" ${delay(440)}>${shadow(12, 16, 72, 70)}${shadow(82, 28, 106, 84)}${browser}${phone}</g>` +
    packet(rx, rTop, 'req', t.warm) +
    packet(lx, lBottom, 'res', t.accent);

  // Fit the illustration into its box: right of the text on wide cards, under
  // it on narrow ones.
  const corners = LEVELS.flatMap(({ z, top }) => [[0, 0], [S, 0], [S, S], [0, S]].flatMap(([x, y]) => [iso(x, y, z), iso(x, y, top)]));
  corners.push(iso(12, 16, CARD_Z), iso(72, 16, CARD_Z));
  const minX = Math.min(...corners.map((p) => p[0]));
  const maxX = Math.max(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => p[1]));
  const maxY = Math.max(...corners.map((p) => p[1]));

  // Text block. On wide cards it sits left of the illustration.
  const cta = 'OPEN TO NEW PROJECTS';
  let textBlock = '';
  let textBottom;
  let box;
  let height;
  if (!narrow) {
    height = 280;
    box = { x: 604, y: 26, w: 266, h: 230 };
    const ctaX = 554 - measure(cta, 'mono-500', 11, 0.1);
    textBlock =
      `<g class="rise" ${delay(0)}>${text(G, 'SOFTWARE ENGINEER · FULL STACK WEB AND MOBILE', { x: 44, y: 76, size: 11.5, style: 'mono-500', fill: t.accent, tracking: 0.12 })}</g>` +
      `<g class="rise" ${delay(60)}>${text(G, 'Muhammad Haikal Faruq', { x: 42, y: 126, size: 44, style: 'sans-600', fill: t.ink, tracking: -0.02 })}</g>` +
      `<g class="rise" ${delay(120)}>${text(G, 'Reliable web and mobile products, delivered end to end.', { x: 44, y: 162, size: 17, style: 'sans-500', fill: t.ink })}</g>` +
      `<g class="rise" ${delay(170)}>${text(G, 'Clean architecture, tested releases, and support long after launch.', { x: 44, y: 186, size: 15, style: 'sans-400', fill: t.ink2 })}</g>` +
      `<g class="fade" ${delay(260)}><rect x="44" y="208" width="510" height="1" fill="${t.border}"/>` +
      text(G, 'BEKASI, INDONESIA', { x: 44, y: 238, size: 11, style: 'mono-400', fill: t.muted, tracking: 0.1 }) +
      `<circle class="pulse" cx="${num(ctaX - 13)}" cy="234.5" r="3.5" fill="${t.live}"/>` +
      `<circle cx="${num(ctaX - 13)}" cy="234.5" r="3.5" fill="${t.live}"/>` +
      text(G, cta, { x: ctaX, y: 238, size: 11, style: 'mono-500', fill: t.ink2, tracking: 0.1 }) +
      `</g>`;
  } else {
    const inner = W - 2 * m;
    const sub = wrap('Clean architecture, tested releases, and support long after launch.', 'sans-400', 13.5, inner);
    let y = 52;
    textBlock += `<g class="rise" ${delay(0)}>${text(G, 'SOFTWARE ENGINEER · FULL STACK WEB AND MOBILE', { x: m, y, size: 10.5, style: 'mono-500', fill: t.accent, tracking: 0.1 })}</g>`;
    y += 40;
    textBlock += `<g class="rise" ${delay(60)}>${text(G, 'Muhammad Haikal Faruq', { x: m - 2, y, size: 32, style: 'sans-600', fill: t.ink, tracking: -0.02 })}</g>`;
    y += 30;
    textBlock += `<g class="rise" ${delay(120)}>${text(G, 'Reliable web and mobile products,', { x: m, y, size: 15, style: 'sans-500', fill: t.ink })}</g>`;
    y += 20;
    textBlock += `<g class="rise" ${delay(120)}>${text(G, 'delivered end to end.', { x: m, y, size: 15, style: 'sans-500', fill: t.ink })}</g>`;
    y += 22;
    for (const line of sub) {
      textBlock += `<g class="rise" ${delay(170)}>${text(G, line, { x: m, y, size: 13.5, style: 'sans-400', fill: t.ink2 })}</g>`;
      y += 18;
    }
    y += 6;
    const ctaX = W - m - measure(cta, 'mono-500', 10.5, 0.1);
    textBlock +=
      `<g class="fade" ${delay(260)}><rect x="${m}" y="${y}" width="${inner}" height="1" fill="${t.border}"/>` +
      text(G, 'BEKASI, INDONESIA', { x: m, y: y + 27, size: 10.5, style: 'mono-400', fill: t.muted, tracking: 0.1 }) +
      `<circle class="pulse" cx="${num(ctaX - 12)}" cy="${y + 23.5}" r="3.5" fill="${t.live}"/>` +
      `<circle cx="${num(ctaX - 12)}" cy="${y + 23.5}" r="3.5" fill="${t.live}"/>` +
      text(G, cta, { x: ctaX, y: y + 27, size: 10.5, style: 'mono-500', fill: t.ink2, tracking: 0.1 }) +
      `</g>`;
    textBottom = y + 40;
    box = { x: m, y: textBottom + 6, w: inner, h: 190 };
    height = box.y + box.h + 22;
  }

  const k = Math.min(box.w / (maxX - minX), box.h / (maxY - minY));
  const ox = box.x + (box.w - (maxX - minX) * k) / 2 - minX * k;
  const oy = box.y + (box.h - (maxY - minY) * k) / 2 - minY * k;
  const cx = num((ox + ((minX + maxX) / 2) * k) / W, 3);
  const cy = num((oy + ((minY + maxY) / 2) * k) / height, 3);

  const css = `
.plate{animation:rise .6s cubic-bezier(.2,.7,.2,1) both}
.float{animation:float 5s ease-in-out 1.2s infinite alternate}
.req,.res{opacity:0;animation:req 6s cubic-bezier(.45,0,.55,1) 1.6s infinite}
.res{animation-name:res}
.ping{opacity:0;animation:ping 6s ease-out 1.6s infinite}
@keyframes float{from{transform:translateY(0)}to{transform:translateY(-4px)}}
@keyframes req{0%{opacity:0;transform:translateY(0)}6%{opacity:1}40%{opacity:1;transform:translateY(${travel}px)}46%,100%{opacity:0;transform:translateY(${travel}px)}}
@keyframes res{0%,48%{opacity:0;transform:translateY(0)}54%{opacity:1}88%{opacity:1;transform:translateY(-${travel}px)}94%,100%{opacity:0;transform:translateY(-${travel}px)}}
@keyframes ping{0%,86%{opacity:0}91%{opacity:.9}100%{opacity:0}}`;

  const defs =
    `<pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.1" fill="${t.dots}"/></pattern>` +
    `<radialGradient id="dotFade" cx="${cx}" cy="${cy}" r="${narrow ? 0.9 : 0.6}"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<mask id="dotMask"><rect width="${W}" height="${height}" fill="url(#dotFade)"/></mask>` +
    `<radialGradient id="glow" cx="${cx}" cy="${cy}" r="${narrow ? 0.5 : 0.3}"><stop offset="0" stop-color="${t.accent}" stop-opacity=".18"/><stop offset="1" stop-color="${t.accent}" stop-opacity="0"/></radialGradient>`;

  const body =
    `<rect width="${W}" height="${height}" fill="url(#dots)" mask="url(#dotMask)"/>` +
    `<rect width="${W}" height="${height}" fill="url(#glow)"/>` +
    textBlock +
    `<g transform="translate(${num(ox)} ${num(oy)}) scale(${num(k, 4)})">${stack}</g>`;

  return frame({
    L, height,
    title: 'Muhammad Haikal Faruq. Software engineer building reliable web and mobile products, open to new projects.',
    G, defs, css, body, t,
  });
}

// ---------------------------------------------------------------------------
// Stack

const STACK = [
  ['Web', [['Next.js', 'nextdotjs'], ['React', 'react'], ['TypeScript', 'typescript'], ['JavaScript', 'javascript'], ['Tailwind CSS', 'tailwindcss'], ['shadcn/ui', 'shadcnui'], ['Framer Motion', 'framer']]],
  ['Mobile', [['Expo', 'expo'], ['React Native', 'react'], ['Flutter', 'flutter'], ['Dart', 'dart'], ['Kotlin', 'kotlin'], ['Jetpack Compose', 'jetpackcompose'], ['Xcode', 'xcode']]],
  ['Backend & data', [['Node.js', 'nodedotjs'], ['PostgreSQL', 'postgresql'], ['Drizzle', 'drizzle'], ['Convex', 'convex'], ['Supabase', 'supabase'], ['Firebase', 'firebase'], ['Python', 'python']]],
  ['Tools & release', [['Git', 'git'], ['GitHub Actions', 'githubactions'], ['Vercel', 'vercel'], ['Vitest', 'vitest'], ['Postman', 'postman'], ['App Store', 'appstore'], ['Google Play', 'googleplay']]],
];

const STACK_TITLE = `Stack. ${STACK.map(([l, tools]) => `${l}: ${tools.map(([name]) => name).join(', ')}`).join('. ')}.`;

const icon = (slug) => {
  const i = ICONS[slug];
  if (!i) throw new Error(`scripts/icons.json has no "${slug}"; add it with scripts/build-icons.mjs`);
  return i;
};

function stack(t, L) {
  const G = new Glyphs();
  const { m, W, narrow } = L;
  const head = cardHeading(G, t, L, { title: 'Stack', subtitle: 'Tools I use to design, build, and ship products.' });
  let body = head.svg;
  let n = 0;

  if (!narrow) {
    // Tiles in a row per category, with the category name in a left column.
    const x0 = 196, slot = 96, tile = 46, rowH = 90;
    STACK.forEach(([label, tools], row) => {
      const y = head.bottom + 4 + row * rowH;
      if (row) body += `<rect x="${m}" y="${y - 14}" width="${W - 2 * m}" height="1" fill="${t.grid}"/>`;
      body += text(G, label.toUpperCase(), { x: m, y: y + tile / 2 + 4, size: 10.5, style: 'mono-500', fill: t.muted, tracking: 0.1 });
      tools.forEach(([name, slug], i) => {
        const ic = icon(slug);
        const sx = x0 + i * slot;
        const tx = sx + (slot - tile) / 2;
        let size = 11.5;
        while (measure(name, 'sans-500', size) > slot - 6 && size > 9.5) size -= 0.5;
        body +=
          `<g class="rise" ${delay(40 + n++ * 14)}>` +
          `<rect x="${num(tx)}" y="${y}" width="${tile}" height="${tile}" rx="12" fill="${t.raised}" stroke="${t.border}"/>` +
          `<path transform="translate(${num(tx + 11)} ${y + 11})" fill="${logoColor(ic.hex, t)}" d="${ic.path}"/>` +
          text(G, name, { x: sx + slot / 2, y: y + tile + 19, size, style: 'sans-500', fill: t.ink2, anchor: 'middle' }) +
          `</g>`;
      });
    });
    return frame({ L, height: head.bottom + 4 + STACK.length * rowH - 12, title: STACK_TITLE, G, body, t });
  }

  // Narrow: a wrapped row of chips (logo and name) under each category name.
  const inner = W - 2 * m;
  const chipH = 30;
  let y = head.bottom + 2;
  STACK.forEach(([label, tools], row) => {
    if (row) body += `<rect x="${m}" y="${y - 12}" width="${inner}" height="1" fill="${t.grid}"/>`;
    body += text(G, label.toUpperCase(), { x: m, y: y + 10, size: 10.5, style: 'mono-500', fill: t.muted, tracking: 0.1 });
    let cx = m;
    let cy = y + 22;
    for (const [name, slug] of tools) {
      const ic = icon(slug);
      const tw = measure(name, 'sans-500', 12);
      const cw = Math.round(10 + 16 + 7 + tw + 11);
      if (cx + cw > m + inner + 0.5) {
        cx = m;
        cy += chipH + 8;
      }
      body +=
        `<g class="rise" ${delay(40 + n++ * 14)}>` +
        `<rect x="${cx}" y="${cy}" width="${cw}" height="${chipH}" rx="9" fill="${t.raised}" stroke="${t.border}"/>` +
        `<path transform="translate(${cx + 10} ${cy + 7}) scale(0.6667)" fill="${logoColor(ic.hex, t)}" d="${ic.path}"/>` +
        text(G, name, { x: cx + 33, y: cy + 19.5, size: 12, style: 'sans-500', fill: t.ink2 }) +
        `</g>`;
      cx += cw + 8;
    }
    y = cy + chipH + 24;
  });
  return frame({ L, height: y - 24 + 22, title: STACK_TITLE, G, body, t });
}

// ---------------------------------------------------------------------------
// Dates

const DAY = 86400000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shiftDay = (iso, days) => isoDay(Date.parse(`${iso}T00:00:00Z`) + days * DAY);
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const dayLabel = (iso, withYear = false) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
};
// "6 to 12 Sep" when both days share a month, else "28 Sep to 4 Oct".
const rangeLabel = (a, b) => (a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8))} to ${dayLabel(b)}` : `${dayLabel(a)} to ${dayLabel(b)}`);
const plural = (n, word) => `${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// GitHub stats: everything since the account was created

function stats(t, L, s) {
  const G = new Glyphs();
  const { m, W, narrow } = L;
  const head = cardHeading(G, t, L, {
    title: 'GitHub stats',
    subtitle: `Everything since I joined GitHub in ${s.memberSince}. Private repositories are included.`,
  });
  let body = head.svg;
  const tiles = statTiles(G, t, L, [
    ['All-time contributions', fmt(s.allTime), ''],
    [`Contributions in ${s.year}`, fmt(s.thisYear), ''],
    ['Best day', fmt(s.bestDay.count), `on ${dayLabel(s.bestDay.date, true)}`],
    [`Active days in ${s.year}`, fmt(s.activeThisYear), `of ${s.daysThisYear}`],
  ], head.bottom);
  body += tiles.svg;

  // Columns, with the value above each. Values under 4% of the tallest column
  // are drawn muted so the eye lands on the years that matter.
  const chart = (x0, x1, top, base, caption, rows, highlight, ms) => {
    const max = Math.max(1, ...rows.map((r) => r.value));
    const slot = (x1 - x0) / rows.length;
    const colW = Math.min(24, slot * 0.5);
    let out = text(G, caption, { x: x0, y: top - 34, size: 12.5, style: 'sans-500', fill: t.ink2 });
    out += `<rect x="${x0}" y="${base}" width="${x1 - x0}" height="1" fill="${t.axis}"/>`;
    rows.forEach((r, i) => {
      const cx = x0 + slot * (i + 0.5);
      const h = r.value ? Math.max(3, (r.value / max) * (base - top)) : 0;
      const strong = !highlight || r.value === max;
      const small = r.value / max < 0.04;
      if (h) out += column(cx - colW / 2, colW, base - h, base, strong ? t.accent : t.other, ms + i * 40);
      if (!highlight || strong) {
        out += `<g class="fade" ${delay(ms + 300 + i * 40)}>${text(G, r.label, { x: cx, y: base - h - 8, size: 11, style: 'mono-500', fill: small ? t.muted : t.ink2, anchor: 'middle' })}</g>`;
      }
      out += text(G, r.name, { x: cx, y: base + 18, size: 10.5, style: 'mono-400', fill: t.muted, anchor: 'middle' });
    });
    return out;
  };
  const perYear = s.perYear.map((y) => ({ name: String(y.year), value: y.total, label: fmt(y.total) }));
  const weekdays = s.weekdays.map((d) => ({ name: d.name, value: d.avg, label: d.avg.toFixed(1) }));
  let height;
  if (!narrow) {
    const top = tiles.bottom + 80, base = top + 78;
    body += chart(m, 428, top, base, 'Contributions per year', perYear, false, 250);
    body += chart(472, W - m, top, base, 'Average per weekday, last 12 months', weekdays, true, 250);
    height = base + 44;
  } else {
    const top1 = tiles.bottom + 76, base1 = top1 + 70;
    body += chart(m, W - m, top1, base1, 'Contributions per year', perYear, false, 250);
    const top2 = base1 + 90, base2 = top2 + 70;
    body += chart(m, W - m, top2, base2, 'Average per weekday, last 12 months', weekdays, true, 450);
    height = base2 + 44;
  }

  const busiest = s.weekdays.reduce((a, b) => (b.avg > a.avg ? b : a));
  return frame({
    L, height,
    title: `GitHub stats: ${fmt(s.allTime)} contributions since ${s.memberSince}, ${fmt(s.thisYear)} in ${s.year}, best day ${s.bestDay.count}, busiest weekday ${busiest.name}.`,
    G, css: COLUMN_CSS, body, t,
  });
}

// ---------------------------------------------------------------------------
// Contribution calendar: a year of days as a heat map that folds up into a
// skyline, and back down again.
//
// It is one scene. Every day is a box on a grid of weeks (x) by weekdays (y).
// The flat view is that grid seen straight down; the 3D view is the same grid
// from the corner. A single camera (an animated transform on the group that
// holds the grid) swings between the two while each week's bars rise, or
// settle, in a wave from the oldest week to the newest. README images cannot
// take input, so instead of a toggle the card alternates on its own: the
// skyline holds for nine seconds, folds flat, holds, and rises again. Bars
// live in grid units inside the camera group, so the scene stays coherent at
// every frame, and without animation (reduced motion) the attributes describe
// the skyline.

const YAW = (40 * Math.PI) / 180;
const ELEV = (35 * Math.PI) / 180;
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const BAR_W = 0.86;
const BAR_OFF = (1 - BAR_W) / 2;

// Schedule, ms after first paint: the flat grid rises after a second, holds
// as a skyline, folds flat, holds, and so on; after the third rise it rests.
// Every step is a one-shot animation with its own delay (five per element),
// so nothing is running between steps: a running animation keeps the whole
// image repainting at 60fps, a finished or pending one costs nothing.
const SWING = 1200;
const RISE = 650;
const HOLD_3D = 9000;
const HOLD_2D = 3500;
const STEPS_AT = [1000];
for (let i = 1; i < 5; i++) STEPS_AT[i] = STEPS_AT[i - 1] + SWING + (i % 2 ? HOLD_3D : HOLD_2D);
const UP = (i) => i % 2 === 0; // steps 0, 2, 4 rise; 1, 3 settle

function calendar(t, L, s) {
  const G = new Glyphs();
  const { m, W, narrow } = L;
  const weeks = s.weeks;
  const NW = weeks.length;
  const cells = [];
  weeks.forEach((w, x) => w.forEach((d) => cells.push({ ...d, x, y: d.weekday })));
  const max = Math.max(1, ...cells.map((c) => c.count));
  const hOf = (count) => (count ? 0.4 + (count / max) ** 0.85 * 6.8 : 0);

  // Camera. e = 0 looks straight down, e = 1 is the corner view.
  const cam = (e) => {
    const yaw = YAW * e;
    const elev = Math.PI / 2 + (ELEV - Math.PI / 2) * e;
    return { cs: Math.cos(yaw), sn: Math.sin(yaw), se: Math.sin(elev), ce: Math.cos(elev) };
  };
  const proj = (c, x, y, z) => [x * c.cs - y * c.sn, (x * c.sn + y * c.cs) * c.se - z * c.ce];
  const extent = (c, e) => {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    const add = (x, y, z) => {
      const [X, Y] = proj(c, x, y, z);
      if (X < minx) minx = X;
      if (X > maxx) maxx = X;
      if (Y < miny) miny = Y;
      if (Y > maxy) maxy = Y;
    };
    for (const d of cells) {
      const z = hOf(d.count) * e;
      add(d.x, d.y, z); add(d.x + 1, d.y, z); add(d.x, d.y + 1, z); add(d.x + 1, d.y + 1, z);
      add(d.x + 1, d.y + 1, 0); add(d.x, d.y + 1, 0); add(d.x + 1, d.y, 0);
    }
    // Room for the month labels along the front edge in 3D.
    add(0, 7 + 1.6 * e, 0);
    add(NW, 7 + 1.6 * e, 0);
    return { minx, maxx, miny, maxy };
  };

  // Layout: heading, then a bordered box holding the stage and a footer row
  // with the legend. The stage is sized for the skyline at the scale that
  // fits the width; the flat grid and its row of figures sit centred in it.
  const head = cardHeading(G, t, L, {
    title: 'Contribution calendar',
    subtitle: `Every day from ${dayLabel(s.weeks[0][0].date, true)} to ${dayLabel(s.today, true)}, private work included.`,
  });
  // README.md wraps this card in a link to the interactive version.
  head.svg += text(G, 'Interactive view ↗', { x: W - m, y: 46, size: 13, style: 'sans-500', fill: t.accent, anchor: 'end' });
  const boxX = m, boxW = W - 2 * m, boxTop = head.bottom + 4;
  const pad = narrow ? 10 : 20;
  const gutter = narrow ? 0 : 34; // weekday names left of the flat grid
  const stageTop = boxTop + 1;
  const ext1 = extent(cam(1), 1);
  const s1 = (boxW - 2 - 2 * pad) / (ext1.maxx - ext1.minx);
  const stageH = Math.ceil((ext1.maxy - ext1.miny) * s1 + 2 * pad);
  const stageBottom = stageTop + stageH;
  const left0 = boxX + 1 + pad + gutter;
  const aw0 = boxX + boxW - 1 - pad - left0;
  const s0 = aw0 / NW;
  const mapH = 7 * s0;
  // The flat view's block: month labels, the grid, and (wide) a row of figures.
  const rowH = narrow ? 0 : 58 + 34;
  const block = 22 + mapH + rowH;
  const mapTop = stageTop + Math.max(pad + 22, (stageH - block) / 2 + 22);

  // The camera as an SVG matrix for a given e, fitted and centred in a box
  // that grows from the flat grid's slot to the whole stage.
  const matrixAt = (e) => {
    const c = cam(e);
    const b = extent(c, e);
    const left = boxX + 1 + pad + gutter * (1 - e);
    const aw = boxX + boxW - 1 - pad - left;
    const top = mapTop + (stageTop + pad - mapTop) * e;
    const ah = mapH + (stageH - 2 * pad - mapH) * e;
    const bw = b.maxx - b.minx;
    const bh = b.maxy - b.miny;
    const sc = Math.min(aw / bw, ah / bh);
    const ox = left + (aw - bw * sc) / 2 - b.minx * sc;
    const oy = top + (ah - bh * sc) / 2 - b.miny * sc;
    return { c, sc, M: [sc * c.cs, sc * c.sn * c.se, -sc * c.sn, sc * c.cs * c.se, ox, oy] };
  };
  const M0 = matrixAt(0);
  const M1 = matrixAt(1);
  const at1 = (x, y, z = 0) => [M1.M[0] * x + M1.M[2] * y + M1.M[4], M1.M[1] * x + M1.M[3] * y + M1.M[5] - z * M1.c.ce * M1.sc];
  const at0 = (x, y) => [M0.M[0] * x + M0.M[2] * y + M0.M[4], M0.M[1] * x + M0.M[3] * y + M0.M[5]];

  // In grid units, "up" by one unit of height is this vector (so that the
  // camera matrix maps it to straight up on screen).
  const u = [(-M1.c.ce / M1.c.se) * M1.c.sn, (-M1.c.ce / M1.c.se) * M1.c.cs];

  // Bars, painted back to front for the corner view. Empty days are flat
  // tiles that never move; they are the floor the skyline stands on.
  const order = [...cells].sort((a, b) => a.x * M1.c.sn + a.y * M1.c.cs - (b.x * M1.c.sn + b.y * M1.c.cs));
  let bars = '';
  for (const d of order) {
    const h = hOf(d.count);
    const x0 = d.x + BAR_OFF, y0 = d.y + BAR_OFF;
    const x1 = x0 + BAR_W, y1 = y0 + BAR_W;
    if (!d.count) {
      bars += `<rect class="e${d.date === s.today ? ' td' : ''}" x="${num(x0)}" y="${num(y0)}" width="${BAR_W}" height="${BAR_W}" rx=".09"${d.date === s.today ? ' vector-effect="non-scaling-stroke"' : ''}/>`;
      continue;
    }
    const lx = num(u[0] * h), ly = num(u[1] * h);
    bars +=
      `<g class="l${d.level} w${d.x}${d.date === s.today ? ' td' : ''}" style="--h:${num(h)}">` +
      `<g transform="matrix(${BAR_W} 0 ${lx} ${ly} ${num(x0)} ${num(y1)})"><rect class="a" width="1" height="1"/></g>` +
      `<g transform="matrix(0 ${BAR_W} ${lx} ${ly} ${num(x1)} ${num(y0)})"><rect class="b" width="1" height="1"/></g>` +
      `<rect class="c" x="${num(x0)}" y="${num(y0)}" width="${BAR_W}" height="${BAR_W}" rx=".09" transform="translate(${lx} ${ly})"${d.date === s.today ? ' vector-effect="non-scaling-stroke"' : ''}/>` +
      `</g>`;
  }

  // Month labels: above the flat grid, then along the front edge in 3D.
  const months = [];
  for (let x = 0, prev = -1; x < NW; x++) {
    const mo = Number(weeks[x][0].date.slice(5, 7));
    if (mo !== prev) months.push({ x, label: MONTHS[mo - 1] });
    prev = mo;
  }
  if (months.length > 1 && months[1].x - months[0].x < 3) months.shift();
  let labels2d = '';
  let edge = -Infinity;
  for (const mo of months) {
    const [X, Y] = at0(mo.x + BAR_OFF, 0);
    const tw = measure(mo.label, 'mono-400', 10.5);
    if (X < edge || X + tw > boxX + boxW - pad) continue;
    labels2d += text(G, mo.label, { x: X, y: Y - 6, size: 10.5, style: 'mono-400', fill: t.muted });
    edge = X + tw + 8;
  }
  if (gutter) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const row of [1, 3, 5]) {
      const dow = weekdayOf(weeks[1][row].date);
      const [X, Y] = at0(0, row + 0.5);
      labels2d += text(G, names[dow], { x: X - 8, y: Y + 3.5, size: 10.5, style: 'mono-400', fill: t.muted, anchor: 'end' });
    }
  }
  let labels3d = '';
  const placed = [];
  edge = -Infinity;
  for (const mo of months) {
    const [X, Y] = at1(mo.x + 0.5, 7.3);
    const tw = measure(mo.label, 'mono-400', 10.5);
    if (X < edge || X + tw > boxX + boxW - 4) continue;
    labels3d += text(G, mo.label, { x: X, y: Y + 11, size: 10.5, style: 'mono-400', fill: t.muted });
    placed.push({ x: X, y: Y + 11, w: tw });
    edge = X + tw + (narrow ? 6 : 10);
  }

  // Figures. In 3D they sit in the two empty corners of the stage; flat, they
  // form a row under the grid (wide) or tiles under the box (narrow).
  const figures = [
    { label: 'Last 12 months', value: fmt(s.total), unit: plural(s.total, 'contribution'), sub: `on ${fmt(s.activeDays)} active days` },
    { label: 'Busiest week', value: fmt(s.busiestWeek.total), unit: plural(s.busiestWeek.total, 'contribution'), sub: rangeLabel(s.busiestWeek.start, s.busiestWeek.end) },
    { label: 'Longest streak', value: String(s.longest.days), unit: plural(s.longest.days, 'day'), sub: s.longest.days ? rangeLabel(s.longest.start, s.longest.end) : 'no streak yet' },
    { label: 'Current streak', value: String(s.current.days), unit: plural(s.current.days, 'day'), sub: s.current.days ? `since ${dayLabel(s.current.start)}` : 'none in progress' },
  ];
  const block3d = (x, y, align, f, size) => {
    const anchor = align === 'end' ? 'end' : 'start';
    const vw = measure(f.value, 'sans-600', size, -0.02);
    const uw = measure(f.unit, 'sans-400', 14);
    const vx = align === 'end' ? x - uw - 8 : x;
    const ux = align === 'end' ? x : x + vw + 8;
    return (
      text(G, f.label, { x, y, size: 12.5, style: 'sans-400', fill: t.muted, anchor }) +
      text(G, f.value, { x: vx, y: y + size + 4, size, style: 'sans-600', fill: t.ink, anchor, tracking: -0.02 }) +
      text(G, f.unit, { x: ux, y: y + size + 4, size: 14, style: 'sans-400', fill: t.ink2, anchor }) +
      text(G, f.sub, { x, y: y + size + 23, size: 12, style: 'sans-400', fill: t.muted, anchor })
    );
  };

  // Legend: five small bars, one per level, under the same camera, plus the
  // marker for today.
  const legendW = measure('Less', 'sans-400', 11) + 12 + 5 * 19 + 2 + measure('More', 'sans-400', 11);
  const legend = (x, y) => {
    const sc = 6.5;
    const c = M1.c;
    let out = text(G, 'Less', { x, y: y + 4, size: 11, style: 'sans-400', fill: t.muted });
    const lx = x + measure('Less', 'sans-400', 11) + 12;
    const Mlin = [sc * c.cs, sc * c.sn * c.se, -sc * c.sn, sc * c.cs * c.se];
    for (let l = 0; l < 5; l++) {
      const h = 0.25 + l * 0.85;
      out += `<g class="l${l}" transform="matrix(${Mlin.map((v) => num(v, 4)).join(' ')} ${num(lx + l * 19)} ${num(y + 4)})">`;
      out += `<g transform="matrix(1 0 ${num(u[0] * h, 3)} ${num(u[1] * h, 3)} 0 1)"><rect class="a" width="1" height="1"/></g>`;
      out += `<g transform="matrix(0 1 ${num(u[0] * h, 3)} ${num(u[1] * h, 3)} 1 0)"><rect class="b" width="1" height="1"/></g>`;
      out += `<rect class="c" width="1" height="1" rx=".09" transform="translate(${num(u[0] * h, 3)} ${num(u[1] * h, 3)})"/></g>`;
    }
    return out + text(G, 'More', { x: lx + 5 * 19 + 2, y: y + 4, size: 11, style: 'sans-400', fill: t.muted });
  };
  const todayMark = (x, y) =>
    `<rect x="${x}" y="${y - 5}" width="10" height="10" rx="2" fill="none" stroke="${t.live}" stroke-width="1.6"/>` +
    text(G, 'Today', { x: x + 17, y: y + 4, size: 11, style: 'sans-400', fill: t.muted });

  let extra = '';
  let footY = stageBottom + 24;
  const R = boxX + boxW - 1 - pad;
  if (!narrow) {
    // Skyline: figures in the corners the band leaves empty.
    const size = 40;
    let corners = block3d(R, stageTop + pad + 2, 'end', figures[0], size);
    corners += block3d(R, stageTop + pad + 2 + 92, 'end', figures[1], size);
    const bottomY = stageBottom - pad - 2 * 92 + 12;
    corners += block3d(boxX + 1 + pad, bottomY, 'start', figures[2], size);
    corners += block3d(boxX + 1 + pad, bottomY + 92, 'start', figures[3], size);
    extra += `<g class="cs">${corners}</g>`;
    // Flat: the same figures in a row under the grid.
    const row = statTiles(G, t, { ...L, m: boxX + 1 + pad }, figures.map((f) => [f.label, f.value, f.unit]), mapTop + mapH + 34);
    extra += `<g class="rs" opacity="0">${row.svg}</g>`;
    extra += todayMark(boxX + 1 + pad, footY - 1) + legend(R - legendW, footY);
  } else {
    extra += todayMark(boxX + 1 + pad, footY - 1) + legend(R - legendW, footY);
  }
  const boxBottom = footY + 22;
  let height = boxBottom + 24;
  if (narrow) {
    const tiles = statTiles(G, t, L, figures.map((f) => [f.label, f.value, f.unit]), boxBottom + 30);
    extra += tiles.svg;
    height = tiles.bottom + 30;
  }

  let body = head.svg;
  body +=
    `<rect x="${boxX + 0.5}" y="${boxTop + 0.5}" width="${boxW - 1}" height="${boxBottom - boxTop - 1}" rx="10" fill="none" stroke="${t.grid}"/>` +
    `<g class="g2" opacity="0">${labels2d}</g>` +
    `<g class="world" transform="matrix(${M1.M.map((v) => num(v, 4)).join(' ')})">${bars}</g>` +
    `<g class="g3">${labels3d}</g>` +
    extra;

  // Camera keyframes along the eased path, up and down.
  const mx = (M) => `matrix(${M.map((v) => num(v, 4)).join(',')})`;
  const STEPS = 12;
  let camUp = '';
  let camDown = '';
  for (let k = 0; k <= STEPS; k++) {
    const e = easeInOutCubic(k / STEPS);
    camUp += `${num((100 * k) / STEPS, 2)}%{transform:${mx(matrixAt(e).M)}}`;
    camDown += `${num((100 * k) / STEPS, 2)}%{transform:${mx(matrixAt(1 - e).M)}}`;
  }
  // A sequence of one-shot animations: the first fills both ways, the rest
  // forwards, so each step overrides the one before once it has started.
  const seq = (names, dur, timing, delays) =>
    names.map((n, i) => `${n} ${dur}ms ${timing} ${Math.round(delays[i])}ms ${i ? 'forwards' : 'both'}`).join(',');
  const alt = (a, b) => STEPS_AT.map((_, i) => (UP(i) ? a : b));
  const ease = 'cubic-bezier(.2,.7,.2,1)';
  // Each week's bars rise after their place in the wave, and settle in the
  // opposite order.
  let weekCss = '';
  for (let w = 0; w < NW; w++) {
    const f = NW > 1 ? w / (NW - 1) : 0;
    const d = STEPS_AT.map((at, i) => Math.round(at + SWING * (0.3 + 0.42 * (UP(i) ? f : 1 - f))));
    weekCss += `.w${w} .a,.w${w} .b,.w${w} .c{animation-delay:${d.join('ms,')}ms}`;
  }
  const lift = `translate(calc(var(--h)*${num(u[0], 4)}px),calc(var(--h)*${num(u[1], 4)}px))`;
  const css =
    t.levels.map((c, l) => `.l${l} .c{fill:${c}}.l${l} .a{fill:${shade(c, 0.84)}}.l${l} .b{fill:${shade(c, 0.68)}}`).join('') +
    `
.e{fill:${t.levels[0]}}
.td .c,.td.e{stroke:${t.live};stroke-width:1.6}
.world{animation:${seq(alt('up', 'down'), SWING, 'linear', STEPS_AT)}}
.a,.b{transform-box:fill-box;transform-origin:0 0;animation:${seq(alt('grow', 'shrink'), RISE, ease, STEPS_AT)}}
.c{animation:${seq(alt('lift', 'drop'), RISE, ease, STEPS_AT)}}
${weekCss}
.g2,.rs{animation:${seq(alt('out', 'in'), 350, 'ease-out', STEPS_AT.map((at, i) => (UP(i) ? at + 40 : at + SWING - 300)))}}
.g3{animation:${seq(alt('in', 'out'), 400, 'ease-out', STEPS_AT.map((at, i) => (UP(i) ? at + SWING * 0.72 : at)))}}
.cs{animation:${seq(alt('in', 'out'), 400, 'ease-out', STEPS_AT.map((at, i) => (UP(i) ? at + SWING * 0.8 : at - 100)))}}
@keyframes up{${camUp}}
@keyframes down{${camDown}}
@keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes shrink{from{transform:scaleY(1)}to{transform:scaleY(0)}}
@keyframes lift{from{transform:none}to{transform:${lift}}}
@keyframes drop{from{transform:${lift}}to{transform:none}}
@keyframes in{from{opacity:0}to{opacity:1}}
@keyframes out{from{opacity:1}to{opacity:0}}`;

  return frame({
    L, height,
    title: `Contribution calendar: ${fmt(s.total)} contributions on ${s.activeDays} active days from ${dayLabel(s.weeks[0][0].date, true)} to ${dayLabel(s.today, true)}. Busiest week ${s.busiestWeek.total}, longest streak ${s.longest.days} days, current streak ${s.current.days} days.`,
    G, css, body, t,
  });
}

// ---------------------------------------------------------------------------
// Recent activity: the last 31 days

function niceMax(v) {
  if (v <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

// Monotone cubic interpolation (Fritsch-Carlson): smooth, and never overshoots
// the data, so a zero day never dips below the baseline.
function monotone(points) {
  const n = points.length;
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1][0] - points[i][0];
    m[i] = (points[i + 1][1] - points[i][1]) / dx[i];
  }
  const tan = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    tan[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  }
  tan[n - 1] = m[n - 2];
  const segments = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = dx[i] / 3;
    segments.push([[x0, y0], [x0 + h, y0 + h * tan[i]], [x1 - h, y1 - h * tan[i + 1]], [x1, y1]]);
  }
  const d = `M${num(points[0][0])},${num(points[0][1])}` + segments.map(([, a, b, c]) => `C${[a, b, c].map((p) => `${num(p[0])},${num(p[1])}`).join(' ')}`).join('');
  let length = 0;
  for (const [p0, p1, p2, p3] of segments) {
    let prev = p0;
    for (let s = 1; s <= 16; s++) {
      const u = s / 16, v = 1 - u;
      const q = [0, 1].map((k) => v ** 3 * p0[k] + 3 * v * v * u * p1[k] + 3 * v * u * u * p2[k] + u ** 3 * p3[k]);
      length += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
      prev = q;
    }
  }
  return { d, length };
}

function activity(t, L, s) {
  const G = new Glyphs();
  const { m, W, narrow } = L;
  const { series, window: w } = s;
  const head = cardHeading(G, t, L, {
    title: 'Recent activity',
    subtitle: `Daily contributions over the last ${series.length} days. Private repositories are included.`,
  });
  let body = head.svg;
  const tiles = statTiles(G, t, L, [
    [`Last ${series.length} days`, fmt(w.total), ''],
    ['Active days', fmt(w.activeDays), `of ${series.length}`],
    ['Best day', fmt(w.best.count), `on ${dayLabel(w.best.date)}`],
    ['Average per day', w.average.toFixed(1), ''],
  ], head.bottom);
  body += tiles.svg;

  const plot = { x0: m + 38, x1: W - m - 4, y0: tiles.bottom + 42, y1: tiles.bottom + 42 + (narrow ? 110 : 122) };
  const peak = Math.max(...series.map((d) => d.count));
  const max = niceMax(Math.max(peak, 1));
  const X = (i) => plot.x0 + (i / (series.length - 1)) * (plot.x1 - plot.x0);
  const Y = (v) => plot.y1 - (v / max) * (plot.y1 - plot.y0);

  for (const v of [0, max / 2, max]) {
    body += `<rect x="${plot.x0}" y="${num(Y(v) - 0.5)}" width="${plot.x1 - plot.x0}" height="1" fill="${v ? t.grid : t.axis}"/>`;
    body += text(G, String(v), { x: plot.x0 - 12, y: Y(v) + 3.5, size: 10.5, style: 'mono-400', fill: t.muted, anchor: 'end' });
  }
  const lastIndex = series.length - 1;
  const every = narrow ? 10 : 6;
  for (let i = 0; i <= lastIndex; i += every) {
    const anchor = i === 0 ? 'start' : i === lastIndex ? 'end' : 'middle';
    body += text(G, dayLabel(series[i].date), { x: X(i), y: plot.y1 + 22, size: 10.5, style: 'mono-400', fill: t.muted, anchor });
  }

  const pts = series.map((d, i) => [X(i), Y(d.count)]);
  const { d, length } = monotone(pts);
  const dash = Math.ceil(length * 1.02);
  // The wash under the line is revealed by a clip that widens at the pace the
  // line is drawn, so it never shows ahead of the line.
  const defs = `<clipPath id="reveal"><rect class="reveal" x="${plot.x0}" y="${plot.y0 - 10}" width="${plot.x1 - plot.x0}" height="${plot.y1 - plot.y0 + 10}"/></clipPath>`;
  body +=
    `<path class="area" clip-path="url(#reveal)" d="${d}L${num(plot.x1)},${plot.y1}L${plot.x0},${plot.y1}Z" fill="${t.accent}" fill-opacity="${t.washOpacity}"/>` +
    `<path class="line" d="${d}" fill="none" stroke="${t.accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="${dash}"/>`;

  const peakIndex = series.findIndex((x) => x.count === peak);
  for (const i of new Set([peakIndex, lastIndex])) {
    const [cx, cy] = pts[i];
    const isLast = i === lastIndex;
    if (isLast) body += `<circle class="pulse" cx="${num(cx)}" cy="${num(cy)}" r="4" fill="none" stroke="${t.accent}" stroke-width="2"/>`;
    body += `<circle class="dot" cx="${num(cx)}" cy="${num(cy)}" r="4" fill="${t.accent}" stroke="${t.surface}" stroke-width="2"/>`;
    // The last value sits left of its dot when the line is climbing into it.
    const climbing = isLast && series[i].count > series[i - 1].count;
    const lx = isLast ? cx - 10 : Math.max(cx, plot.x0 + 12);
    const ly = climbing ? cy + 4 : cy - 12;
    body += `<g class="fade" ${delay(1000)}>${text(G, String(series[i].count), { x: lx, y: ly, size: 11.5, style: 'mono-500', fill: t.ink2, anchor: isLast ? 'end' : 'middle' })}</g>`;
  }

  const css = `
.line{stroke-dashoffset:0;animation:draw .9s cubic-bezier(.4,0,.2,1) .15s both}
.reveal{transform-box:fill-box;transform-origin:left;animation:reveal .9s cubic-bezier(.4,0,.2,1) .15s both}
.area{animation:fade .4s ease-out .3s both}
.dot{transform-box:fill-box;transform-origin:center;animation:pop .4s cubic-bezier(.3,1.6,.5,1) .95s both}
@keyframes draw{from{stroke-dashoffset:${dash}}to{stroke-dashoffset:0}}
@keyframes reveal{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}`;

  return frame({
    L, height: plot.y1 + 46,
    title: `Recent activity: ${w.total} contributions in the last ${series.length} days on ${w.activeDays} active days, best day ${w.best.count} on ${dayLabel(w.best.date, true)}, ${w.average.toFixed(1)} per day on average.`,
    G, defs, css, body, t,
  });
}

// ---------------------------------------------------------------------------
// Languages

const duration = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

function languages(t, L, data) {
  const G = new Glyphs();
  const { m, W, narrow } = L;
  const wakatime = data.source === 'wakatime';
  const head = cardHeading(G, t, L, wakatime
    ? { title: 'Languages', subtitle: `Time in the editor over the last 7 days: ${duration(data.total)}.`, note: 'WakaTime · last 7 days' }
    : { title: 'Languages', subtitle: 'Share of code in repositories I pushed to in the last 12 months.', note: 'GitHub · by code size' });
  let body = head.svg;

  const rows = data.rows;
  const nameSize = narrow ? 13 : 14;
  const nameW = Math.max(...rows.map((r) => measure(r.name, 'sans-500', nameSize)));
  const barX = m + Math.max(narrow ? 0 : 164, Math.ceil(nameW) + 20);
  const valueW = Math.max(...rows.map((r) => measure(wakatime ? duration(r.value) : `${r.share.toFixed(1)}%`, 'mono-400', 12)));
  const barMax = W - m - barX - valueW - 12;
  const top = rows[0].value;
  const rowH = narrow ? 30 : 32;
  const y0 = head.bottom + 10;
  rows.forEach((row, i) => {
    const y = y0 + i * rowH;
    const w = Math.max(4, (row.value / top) * barMax);
    const x1 = barX + w;
    const r = 4;
    const color = row.other ? t.other : t.accent;
    const valueText = wakatime ? duration(row.value) : `${row.share.toFixed(1)}%`;
    body +=
      text(G, row.name, { x: m, y: y + 5, size: nameSize, style: 'sans-500', fill: row.other ? t.ink2 : t.ink }) +
      `<path class="bar" ${delay(80 + i * 50)} d="M${barX},${y - 6}H${num(x1 - r)}A${r},${r} 0 0 1 ${num(x1)},${y - 6 + r}V${y + 6 - r}A${r},${r} 0 0 1 ${num(x1 - r)},${y + 6}H${barX}Z" fill="${color}"/>` +
      `<g class="fade" ${delay(380 + i * 50)}>${text(G, valueText, { x: x1 + 10, y: y + 4.5, size: 12, style: 'mono-400', fill: t.ink2 })}</g>`;
  });
  const css = `
.bar{transform-box:fill-box;transform-origin:left center;animation:grow .7s cubic-bezier(.2,.7,.2,1) both}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}`;
  return frame({
    L, height: y0 + (rows.length - 1) * rowH + 34,
    title: `Languages: ${rows.map((r) => `${r.name} ${wakatime ? duration(r.value) : `${r.share.toFixed(1)}%`}`).join(', ')}`,
    G, css, body, t,
  });
}

// ---------------------------------------------------------------------------
// Footer: when the graphics were last rendered, and the profile view count

function footer(t, L, meta) {
  const G = new Glyphs();
  const { m, W, narrow } = L;
  const updated = `UPDATED ${meta.updated.toUpperCase()}`;
  const viewsLabel = `PROFILE VIEWS SINCE ${VIEWS_SINCE.toUpperCase()}`;
  const views = meta.views == null ? null : fmt(meta.views);
  let body = '';
  let height;
  if (!narrow) {
    height = 54;
    const y = 32;
    body += text(G, updated, { x: m, y, size: 10.5, style: 'mono-400', fill: t.muted, tracking: 0.08 });
    if (views) {
      const lw = measure(viewsLabel, 'mono-400', 10.5, 0.08);
      body +=
        text(G, views, { x: W - m - lw - 10, y: y + 0.5, size: 14, style: 'sans-600', fill: t.ink, anchor: 'end', tracking: -0.01 }) +
        text(G, viewsLabel, { x: W - m, y, size: 10.5, style: 'mono-400', fill: t.muted, anchor: 'end', tracking: 0.08 });
    }
  } else {
    height = views ? 74 : 54;
    body += text(G, updated, { x: m, y: 32, size: 10.5, style: 'mono-400', fill: t.muted, tracking: 0.08 });
    if (views) {
      const vw = measure(views, 'sans-600', 14, -0.01);
      body +=
        text(G, views, { x: m, y: 54.5, size: 14, style: 'sans-600', fill: t.ink, tracking: -0.01 }) +
        text(G, viewsLabel, { x: m + vw + 10, y: 54, size: 10.5, style: 'mono-400', fill: t.muted, tracking: 0.08 });
    }
  }
  return frame({
    L, height,
    title: `Graphics updated ${meta.updated}.${views ? ` ${views} profile views since ${VIEWS_SINCE}.` : ''}`,
    G, body: `<g class="fade">${body}</g>`, t,
  });
}

// ---------------------------------------------------------------------------
// Data

async function graphql(token, query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-graphics' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) throw new Error(`GitHub GraphQL ${res.status}: ${JSON.stringify(json.errors ?? json.message ?? json)}`);
  return json.data;
}

const LEVEL = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Longest run of consecutive active days among `dates` (sorted, ISO).
function longestStreak(dates, count) {
  let best = { days: 0, start: null, end: null };
  let run = 0;
  let start = null;
  for (const date of dates) {
    if (count(date) > 0) {
      if (!run) start = date;
      run++;
      if (run > best.days) best = { days: run, start, end: date };
    } else run = 0;
  }
  return best;
}

async function contributions(token) {
  const { user } = await graphql(
    token,
    `query($login:String!){user(login:$login){createdAt contributionsCollection{contributionYears contributionCalendar{totalContributions weeks{contributionDays{date weekday contributionCount contributionLevel}}}}}}`,
    { login: LOGIN },
  );
  const { contributionYears, contributionCalendar } = user.contributionsCollection;
  const weeks = contributionCalendar.weeks.map((w) =>
    w.contributionDays.map((d) => ({ date: d.date, weekday: d.weekday, count: d.contributionCount, level: LEVEL.indexOf(d.contributionLevel) })),
  );
  const today = weeks.flat().map((d) => d.date).sort().at(-1);

  const counts = new Map();
  for (const year of contributionYears) {
    const data = await graphql(
      token,
      `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`,
      { login: LOGIN, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
    );
    for (const week of data.user.contributionsCollection.contributionCalendar.weeks) {
      for (const day of week.contributionDays) counts.set(day.date, day.contributionCount);
    }
  }
  const count = (iso) => counts.get(iso) ?? 0;
  const allDates = [...counts.keys()].filter((d) => d <= today).sort();

  // Today is still in progress, so the recent chart ends yesterday and a
  // streak survives an empty today.
  const series = [];
  for (let i = 31; i >= 1; i--) {
    const date = shiftDay(today, -i);
    series.push({ date, count: count(date) });
  }
  const windowTotal = series.reduce((a, d) => a + d.count, 0);
  const window = {
    total: windowTotal,
    activeDays: series.filter((d) => d.count > 0).length,
    best: series.reduce((a, d) => (d.count > a.count ? d : a), series[0]),
    average: windowTotal / series.length,
  };

  let activeDays = 0;
  for (let i = 0; i < 365; i++) if (count(shiftDay(today, -i)) > 0) activeDays++;

  let current = { days: 0, start: null };
  for (let d = count(today) > 0 ? today : shiftDay(today, -1); count(d) > 0; d = shiftDay(d, -1)) {
    current = { days: current.days + 1, start: d };
  }
  const yearAgo = shiftDay(today, -364);
  const longest = longestStreak(allDates.filter((d) => d >= yearAgo), count);

  let bestDay = { date: today, count: 0 };
  for (const date of allDates) if (count(date) > bestDay.count) bestDay = { date, count: count(date) };

  const perYear = [...contributionYears].sort().map((year) => ({
    year,
    total: [...counts].reduce((sum, [date, n]) => (date.startsWith(`${year}-`) ? sum + n : sum), 0),
  }));
  const year = Number(today.slice(0, 4));
  const activeThisYear = allDates.filter((d) => d.startsWith(`${year}-`) && count(d) > 0).length;
  const daysThisYear = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${year}-01-01T00:00:00Z`)) / DAY) + 1;

  // Weekday averages over the last 52 complete weeks, Monday first.
  const sums = Array(7).fill(0);
  for (let i = 1; i <= 364; i++) sums[weekdayOf(shiftDay(today, -i))] += count(shiftDay(today, -i));
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((w) => ({ name: WEEKDAYS[w], avg: sums[w] / 52 }));

  const busiestWeek = weeks
    .map((w) => ({ total: w.reduce((a, d) => a + d.count, 0), start: w[0].date, end: w.at(-1).date }))
    .reduce((a, b) => (b.total > a.total ? b : a));

  return {
    today, weeks, series, window, activeDays, current, longest, bestDay, perYear, year, activeThisYear, daysThisYear, weekdays, busiestWeek,
    total: contributionCalendar.totalContributions,
    allTime: perYear.reduce((a, y) => a + y.total, 0),
    thisYear: perYear.find((y) => y.year === year)?.total ?? 0,
    memberSince: Number(user.createdAt.slice(0, 4)),
  };
}

function topRows(entries) {
  const sum = entries.reduce((a, [, v]) => a + v, 0);
  const sorted = entries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const main = sorted.filter(([, v]) => v / sum >= 0.02).slice(0, 5);
  const rest = sum - main.reduce((a, [, v]) => a + v, 0);
  const rows = main.map(([name, value]) => ({ name, value, share: (100 * value) / sum }));
  if (rest / sum >= 0.005) rows.push({ name: 'Other', value: rest, share: (100 * rest) / sum, other: true });
  return rows;
}

async function wakatimeLanguages(key) {
  const res = await fetch('https://wakatime.com/api/v1/users/current/stats/last_7_days', {
    headers: { Authorization: `Basic ${Buffer.from(key).toString('base64')}` },
  });
  if (!res.ok) throw new Error(`WakaTime ${res.status}`);
  const { data } = await res.json();
  if (!data || data.total_seconds < 3600 || !data.languages?.length) return null;
  const langs = data.languages.filter((l) => l.name !== 'Other').map((l) => [l.name, l.total_seconds]);
  return { source: 'wakatime', total: data.total_seconds, rows: topRows(langs) };
}

async function repositoryLanguages(token) {
  const data = await graphql(
    token,
    `query($login:String!){user(login:$login){repositories(first:100,ownerAffiliations:OWNER,isFork:false,orderBy:{field:PUSHED_AT,direction:DESC}){nodes{name isPrivate isArchived pushedAt languages(first:20,orderBy:{field:SIZE,direction:DESC}){edges{size node{name}}}}}}}`,
    { login: LOGIN },
  );
  const since = Date.now() - 365 * DAY;
  const repos = data.user.repositories.nodes.filter((r) => !r.isArchived && !IGNORED_REPOS.has(r.name) && Date.parse(r.pushedAt) >= since);
  const bytes = new Map();
  for (const repo of repos) for (const { size, node } of repo.languages.edges) bytes.set(node.name, (bytes.get(node.name) ?? 0) + size);
  return { source: 'github', includesPrivate: repos.some((r) => r.isPrivate), rows: topRows([...bytes]) };
}

// The komarev badge counts profile views; README.md keeps loading it (as a 1px
// image) so the count keeps growing, and the footer shows the number in the
// profile's own type. The last successful read is kept in assets/meta.json.
const META_FILE = join(ASSETS, 'meta.json');
const readMeta = () => (existsSync(META_FILE) ? JSON.parse(readFileSync(META_FILE, 'utf8')) : {});

async function profileViews() {
  const res = await fetch(`https://komarev.com/ghpvc/?username=${LOGIN}`, { headers: { 'User-Agent': 'profile-graphics' } });
  if (!res.ok) throw new Error(`komarev ${res.status}`);
  const svg = await res.text();
  const m = [...svg.matchAll(/>([\d,]+)<\/text>/g)].pop();
  if (!m) throw new Error('komarev: no count in badge');
  return Number(m[1].replace(/,/g, ''));
}

function now() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.day} ${parts.month} ${parts.year} · ${parts.hour}:${parts.minute} WIB`;
}

// ---------------------------------------------------------------------------

function write(name, svg) {
  const file = join(ASSETS, name);
  if (existsSync(file) && readFileSync(file, 'utf8') === svg) return;
  writeFileSync(file, svg);
  console.log(`wrote assets/${name} (${(svg.length / 1024).toFixed(1)} KB)`);
}

// The calendar card's days for the interactive version, one day per line so
// the daily diff stays small.
const contributionsJson = (s) =>
  `{\n  "today": "${s.today}",\n  "days": [\n${s.weeks.flat().map((d) => `    {"date": "${d.date}", "count": ${d.count}}`).join(',\n')}\n  ]\n}\n`;

const eachVariant = (name, render) => {
  for (const L of Object.values(LAYOUTS)) {
    for (const [mode, t] of Object.entries(THEMES)) write(`${name}-${mode}${L.suffix}.svg`, render(t, L));
  }
};

async function main() {
  const args = process.argv.slice(2);
  eachVariant('header', header);
  eachVariant('stack', stack);
  if (args.includes('--static')) return;

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required for the data cards (or pass --static).');

  // --cache FILE keeps the fetched data between runs while working on layouts.
  const cacheFile = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : null;
  let cached = cacheFile && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : null;

  const data = cached?.data ?? (await contributions(token));
  eachVariant('stats', (t, L) => stats(t, L, data));
  eachVariant('calendar', (t, L) => calendar(t, L, data));
  write('contributions.json', contributionsJson(data));
  eachVariant('activity', (t, L) => activity(t, L, data));
  console.log(`contributions: ${data.total} in 12 months, ${data.allTime} all time, streak ${data.current.days}/${data.longest.days}`);

  const meta = readMeta();
  let views = cached?.views;
  if (views == null) {
    try {
      views = await profileViews();
    } catch (err) {
      console.warn(`Profile views kept from the last run: ${err.message}`);
      views = meta.views ?? null;
    }
  }
  const updated = now();
  eachVariant('footer', (t, L) => footer(t, L, { updated, views }));
  writeFileSync(META_FILE, `${JSON.stringify({ updated, views }, null, 2)}\n`);

  let langs = cached?.langs ?? null;
  if (!langs && process.env.WAKATIME_API_KEY) {
    try {
      langs = await wakatimeLanguages(process.env.WAKATIME_API_KEY);
      if (!langs) console.log('WakaTime has under an hour of activity in the last 7 days, using repository languages.');
    } catch (err) {
      console.warn(`WakaTime skipped: ${err.message}`);
    }
  }
  if (!langs) {
    const privateToken = process.env.PROFILE_TOKEN;
    const fromPrivate = privateToken
      ? await repositoryLanguages(privateToken).catch((err) => {
          console.warn(`PROFILE_TOKEN rejected, falling back to GITHUB_TOKEN: ${err.message}`);
          return null;
        })
      : null;
    langs = fromPrivate ?? (await repositoryLanguages(token));
    if (!langs.includesPrivate && existsSync(join(ASSETS, 'languages-light.svg'))) {
      console.log('Languages card kept as is: this token cannot see private repositories (set PROFILE_TOKEN).');
      langs = null;
    }
  }
  if (cacheFile && !cached) writeFileSync(cacheFile, JSON.stringify({ data, views, langs }));
  if (!langs) return;
  eachVariant('languages', (t, L) => languages(t, L, langs));
  console.log(`languages (${langs.source}): ${langs.rows.map((r) => `${r.name} ${r.share.toFixed(1)}%`).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
