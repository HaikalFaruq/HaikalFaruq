#!/usr/bin/env node
// Renders the SVG graphics that README.md shows, in light and dark variants.
//
//   node scripts/render.mjs           all cards (needs GITHUB_TOKEN)
//   node scripts/render.mjs --static  header and stack only, no network
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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const LOGIN = 'HaikalFaruq';
const TIME_ZONE = 'Asia/Jakarta';
// This profile repo, and a third-party project copied for self-hosting.
const IGNORED_REPOS = new Set(['HaikalFaruq', 'github-readme-streak-stats']);
const WIDTH = 900;

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

const BASE_CSS = `
.rise{animation:rise .7s cubic-bezier(.2,.7,.2,1) both}
.fade{animation:fade .8s ease-out both}
.pulse{transform-box:fill-box;transform-origin:center;opacity:0;animation:pulse 2.6s ease-out 2s infinite}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes pulse{0%{opacity:.7;transform:scale(1)}100%{opacity:0;transform:scale(3.2)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

function frame({ height, title, G, defs = '', css = '', body, t }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${esc(title)}">` +
    `<title>${esc(title)}</title>` +
    `<style>${BASE_CSS}${css}</style>` +
    `<defs>${G.defs()}${defs}<clipPath id="card"><rect width="${WIDTH}" height="${height}" rx="14"/></clipPath></defs>` +
    `<g clip-path="url(#card)"><rect width="${WIDTH}" height="${height}" fill="${t.surface}"/>${body}</g>` +
    `<rect x=".5" y=".5" width="${WIDTH - 1}" height="${height - 1}" rx="13.5" fill="none" stroke="${t.border}"/>` +
    `</svg>`
  );
}

const delay = (ms) => `style="animation-delay:${Math.round(ms)}ms"`;

function cardHeading(G, t, { title, subtitle, note }) {
  return (
    `<g class="fade">` +
    text(G, title, { x: 32, y: 46, size: 18, style: 'sans-600', fill: t.ink }) +
    (note ? text(G, note.toUpperCase(), { x: WIDTH - 32, y: 45, size: 10.5, style: 'mono-500', fill: t.muted, anchor: 'end', tracking: 0.08 }) : '') +
    text(G, subtitle, { x: 32, y: 69, size: 13.5, style: 'sans-400', fill: t.ink2 }) +
    `</g>`
  );
}

// A row of four stat tiles: label, value, and an optional unit after the value.
function statTiles(G, t, tiles, y = 96) {
  const tileW = (WIDTH - 64) / 4;
  let out = '';
  tiles.forEach(([label, value, unit], i) => {
    const x = 32 + i * tileW + (i ? 20 : 0);
    if (i) out += `<rect x="${num(32 + i * tileW)}" y="${y}" width="1" height="58" fill="${t.grid}"/>`;
    const vw = measure(value, 'sans-600', 28, -0.01);
    out +=
      `<g class="rise" ${delay(100 + i * 70)}>` +
      text(G, label, { x, y: y + 18, size: 12.5, style: 'sans-400', fill: t.muted }) +
      text(G, value, { x, y: y + 52, size: 28, style: 'sans-600', fill: t.ink, tracking: -0.01 }) +
      (unit ? text(G, unit, { x: x + vw + 6, y: y + 52, size: 13.5, style: 'sans-500', fill: t.ink2 }) : '') +
      `</g>`;
  });
  return out;
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
.col{transform-box:fill-box;transform-origin:bottom;animation:grow .8s cubic-bezier(.2,.7,.2,1) both}
@keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}`;

// ---------------------------------------------------------------------------
// Header

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
const HEADER_H = 280;
const iso = (x, y, z) => [(x - y) * COS30, (x + y) * SIN30 - z];

// An exploded isometric stack (data, API, client) with a request travelling
// down the right edge and the response coming back up the left edge.
function header(t) {
  const G = new Glyphs();
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
      `<g class="plate" ${delay(120 + i * 150)}>` +
      poly([[S, 0, z], [S, S, z], [S, S, top], [S, 0, top]], `fill="${t.plateRight}" ${edge}`) +
      poly([[0, S, z], [S, S, z], [S, S, top], [0, S, top]], `fill="${t.plateLeft}" ${edge}`) +
      quad(0, 0, S, S, top, `fill="${t.plateTop}" ${edge}`) +
      // The label lies flat on the top face, reading along the front left edge.
      text(G, label, { size: 11, style: 'mono-500', fill: t.muted, tracking: 0.16, matrix: [COS30, SIN30, -COS30, SIN30, lx, ly] }) +
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
  const packet = (x, y, cls, color) =>
    `<g class="${cls}"><circle cx="${num(x)}" cy="${num(y)}" r="7" fill="${color}" opacity=".22"/><circle cx="${num(x)}" cy="${num(y)}" r="3.2" fill="${color}"/></g>`;

  const stack =
    plate(LEVELS[0], 0) +
    `<g class="plate" ${delay(120)}>${rails(S, 0)}${rails(0, S)}</g>` +
    plate(LEVELS[1], 1) +
    plate(LEVELS[2], 2) +
    `<g class="plate" ${delay(560)}>${shadow(12, 16, 72, 70)}${shadow(82, 28, 106, 84)}${browser}${phone}</g>` +
    packet(rx, rTop, 'req', t.warm) +
    packet(lx, lBottom, 'res', t.accent);

  // Fit the illustration into the right side of the card.
  const corners = LEVELS.flatMap(({ z, top }) => [[0, 0], [S, 0], [S, S], [0, S]].flatMap(([x, y]) => [iso(x, y, z), iso(x, y, top)]));
  corners.push(iso(12, 16, CARD_Z), iso(72, 16, CARD_Z));
  const minX = Math.min(...corners.map((p) => p[0]));
  const maxX = Math.max(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => p[1]));
  const maxY = Math.max(...corners.map((p) => p[1]));
  const box = { x: 604, y: 26, w: 266, h: 230 };
  const k = Math.min(box.w / (maxX - minX), box.h / (maxY - minY));
  const ox = box.x + (box.w - (maxX - minX) * k) / 2 - minX * k;
  const oy = box.y + (box.h - (maxY - minY) * k) / 2 - minY * k;
  const cx = num((ox + ((minX + maxX) / 2) * k) / WIDTH, 3);
  const cy = num((oy + ((minY + maxY) / 2) * k) / HEADER_H, 3);

  const css = `
.plate{animation:rise .8s cubic-bezier(.2,.7,.2,1) both}
.float{animation:float 5s ease-in-out 1.2s infinite alternate}
.req,.res{opacity:0;animation:req 4.8s cubic-bezier(.45,0,.55,1) 1.4s infinite}
.res{animation-name:res}
.ping{opacity:0;animation:ping 4.8s ease-out 1.4s infinite}
@keyframes float{from{transform:translateY(0)}to{transform:translateY(-4px)}}
@keyframes req{0%{opacity:0;transform:translateY(0)}6%{opacity:1}40%{opacity:1;transform:translateY(${travel}px)}46%,100%{opacity:0;transform:translateY(${travel}px)}}
@keyframes res{0%,48%{opacity:0;transform:translateY(0)}54%{opacity:1}88%{opacity:1;transform:translateY(-${travel}px)}94%,100%{opacity:0;transform:translateY(-${travel}px)}}
@keyframes ping{0%,86%{opacity:0}91%{opacity:.9}100%{opacity:0}}`;

  const defs =
    `<pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.1" fill="${t.dots}"/></pattern>` +
    `<radialGradient id="dotFade" cx="${cx}" cy="${cy}" r=".6"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<mask id="dotMask"><rect width="${WIDTH}" height="${HEADER_H}" fill="url(#dotFade)"/></mask>` +
    `<radialGradient id="glow" cx="${cx}" cy="${cy}" r=".3"><stop offset="0" stop-color="${t.accent}" stop-opacity=".18"/><stop offset="1" stop-color="${t.accent}" stop-opacity="0"/></radialGradient>`;

  // Availability sits at the end of the meta row, with a live status dot.
  const cta = 'OPEN TO NEW PROJECTS';
  const ctaX = 554 - measure(cta, 'mono-500', 11, 0.1);
  const body =
    `<rect width="${WIDTH}" height="${HEADER_H}" fill="url(#dots)" mask="url(#dotMask)"/>` +
    `<rect width="${WIDTH}" height="${HEADER_H}" fill="url(#glow)"/>` +
    `<g class="rise" ${delay(0)}>${text(G, 'SOFTWARE ENGINEER · FULL STACK WEB AND MOBILE', { x: 44, y: 76, size: 11.5, style: 'mono-500', fill: t.accent, tracking: 0.12 })}</g>` +
    `<g class="rise" ${delay(90)}>${text(G, 'Muhammad Haikal Faruq', { x: 42, y: 126, size: 44, style: 'sans-600', fill: t.ink, tracking: -0.02 })}</g>` +
    `<g class="rise" ${delay(180)}>${text(G, 'Reliable web and mobile products, delivered end to end.', { x: 44, y: 162, size: 17, style: 'sans-500', fill: t.ink })}</g>` +
    `<g class="rise" ${delay(250)}>${text(G, 'Clean architecture, tested releases, and support long after launch.', { x: 44, y: 186, size: 15, style: 'sans-400', fill: t.ink2 })}</g>` +
    `<g class="fade" ${delay(360)}><rect x="44" y="208" width="510" height="1" fill="${t.border}"/>` +
    text(G, 'BEKASI, INDONESIA', { x: 44, y: 238, size: 11, style: 'mono-400', fill: t.muted, tracking: 0.1 }) +
    `<circle class="pulse" cx="${num(ctaX - 13)}" cy="234.5" r="3.5" fill="${t.live}"/>` +
    `<circle cx="${num(ctaX - 13)}" cy="234.5" r="3.5" fill="${t.live}"/>` +
    text(G, cta, { x: ctaX, y: 238, size: 11, style: 'mono-500', fill: t.ink2, tracking: 0.1 }) +
    `</g>` +
    `<g transform="translate(${num(ox)} ${num(oy)}) scale(${num(k, 4)})">${stack}</g>`;

  return frame({
    height: HEADER_H,
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

function stack(t) {
  const G = new Glyphs();
  const x0 = 196, slot = 96, tile = 46, rowH = 92;
  let body = cardHeading(G, t, { title: 'Stack', subtitle: 'Tools I use to design, build, and ship products.' });
  let n = 0;
  STACK.forEach(([label, tools], row) => {
    const y = 100 + row * rowH;
    if (row) body += `<rect x="32" y="${y - 14}" width="${WIDTH - 64}" height="1" fill="${t.grid}"/>`;
    body += `<g class="fade" ${delay(120 + row * 90)}>${text(G, label.toUpperCase(), { x: 32, y: y + tile / 2 + 4, size: 10.5, style: 'mono-500', fill: t.muted, tracking: 0.1 })}</g>`;
    tools.forEach(([name, slug], i) => {
      const icon = ICONS[slug];
      if (!icon) throw new Error(`scripts/icons.json has no "${slug}"; add it with scripts/build-icons.mjs`);
      const sx = x0 + i * slot;
      const tx = sx + (slot - tile) / 2;
      let size = 11.5;
      while (measure(name, 'sans-500', size) > slot - 6 && size > 9.5) size -= 0.5;
      body +=
        `<g class="rise" ${delay(160 + n++ * 22)}>` +
        `<rect x="${num(tx)}" y="${y}" width="${tile}" height="${tile}" rx="12" fill="${t.raised}" stroke="${t.border}"/>` +
        `<path transform="translate(${num(tx + 11)} ${y + 11})" fill="${logoColor(icon.hex, t)}" d="${icon.path}"/>` +
        text(G, name, { x: sx + slot / 2, y: y + tile + 19, size, style: 'sans-500', fill: t.ink2, anchor: 'middle' }) +
        `</g>`;
    });
  });
  return frame({
    height: 100 + STACK.length * rowH - 10,
    title: `Stack. ${STACK.map(([l, tools]) => `${l}: ${tools.map(([name]) => name).join(', ')}`).join('. ')}.`,
    G, body, t,
  });
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

// ---------------------------------------------------------------------------
// GitHub stats

function stats(t, s) {
  const G = new Glyphs();
  let body = cardHeading(G, t, {
    title: 'GitHub stats',
    subtitle: `Everything since I joined GitHub in ${s.memberSince}. Private repositories are included.`,
    note: `Updated ${s.updated}`,
  });
  body += statTiles(G, t, [
    ['All-time contributions', fmt(s.allTime), ''],
    [`Contributions in ${s.year}`, fmt(s.thisYear), ''],
    ['Best day', fmt(s.bestDay.count), `on ${dayLabel(s.bestDay.date, true)}`],
    ['On GitHub since', String(s.memberSince), ''],
  ]);

  const top = 234, base = 312;
  const chart = (x0, x1, caption, rows, highlight) => {
    const max = Math.max(1, ...rows.map((r) => r.value));
    const slot = (x1 - x0) / rows.length;
    let out = `<g class="fade" ${delay(300)}>${text(G, caption, { x: x0, y: 196, size: 12.5, style: 'sans-500', fill: t.ink2 })}</g>`;
    out += `<rect x="${x0}" y="${base}" width="${x1 - x0}" height="1" fill="${t.axis}"/>`;
    rows.forEach((r, i) => {
      const cx = x0 + slot * (i + 0.5);
      const h = r.value ? Math.max(3, (r.value / max) * (base - top)) : 0;
      const strong = !highlight || r.value === max;
      if (h) out += column(cx - 12, 24, base - h, base, strong ? t.accent : t.other, 380 + i * 60);
      if (!highlight || strong) {
        out += `<g class="fade" ${delay(900 + i * 60)}>${text(G, r.label, { x: cx, y: base - h - 8, size: 11, style: 'mono-500', fill: t.ink2, anchor: 'middle' })}</g>`;
      }
      out += text(G, r.name, { x: cx, y: base + 18, size: 10.5, style: 'mono-400', fill: t.muted, anchor: 'middle' });
    });
    return out;
  };
  body += chart(32, 428, 'Contributions per year', s.perYear.map((y) => ({ name: String(y.year), value: y.total, label: fmt(y.total) })), false);
  body += chart(472, WIDTH - 32, 'Average per weekday, last 12 months', s.weekdays.map((d) => ({ name: d.name, value: d.avg, label: d.avg.toFixed(1) })), true);

  const busiest = s.weekdays.reduce((a, b) => (b.avg > a.avg ? b : a));
  return frame({
    height: 356,
    title: `GitHub stats: ${fmt(s.allTime)} contributions since ${s.memberSince}, ${fmt(s.thisYear)} in ${s.year}, best day ${s.bestDay.count}, busiest weekday ${busiest.name}.`,
    G, css: COLUMN_CSS, body, t,
  });
}

// ---------------------------------------------------------------------------
// 3D contribution calendar

// Every day of the last year as an isometric column, one row per weekday,
// raised by the square root of its count so a single big day does not flatten
// the rest. Weeks drop in from left to right.
function calendar(t, s) {
  const G = new Glyphs();
  const C = 11;
  const F = 9;
  const H = 72;
  const W = s.weeks.length;
  const max = Math.max(1, ...s.weeks.flat().map((d) => d.count));
  const height = (count) => (count ? 3 + H * Math.sqrt(count / max) : 1.5);

  const ox = (WIDTH - (W + 7) * C * COS30) / 2 + 7 * C * COS30;
  const oy = 30 + H;
  const P = (x, y, z) => {
    const [X, Y] = iso(x, y, z);
    return `${num(ox + X, 1)},${num(oy + Y, 1)}`;
  };
  const face = (cls, pts) => `<path class="${cls}" d="M${pts.join('L')}Z"/>`;
  const topFace = (x, y, h) => [P(x, y, h), P(x + F, y, h), P(x + F, y + F, h), P(x, y + F, h)];

  // Weeks go back to front and days within a week go back to front, which is
  // enough for the columns to overlap correctly.
  let grid = '';
  s.weeks.forEach((week, i) => {
    let bars = '';
    for (const d of week) {
      const x = i * C;
      const y = d.weekday * C;
      const h = height(d.count);
      bars +=
        face(`r${d.level}`, [P(x + F, y, 0), P(x + F, y + F, 0), P(x + F, y + F, h), P(x + F, y, h)]) +
        face(`l${d.level}`, [P(x, y + F, 0), P(x + F, y + F, 0), P(x + F, y + F, h), P(x, y + F, h)]) +
        face(`t${d.level}`, topFace(x, y, h));
      if (d.date === s.today) bars += `<path class="today" d="M${topFace(x, y, h).join('L')}Z" fill="none" stroke="${t.live}" stroke-width="1.6"/>`;
    }
    grid += `<g class="wk" ${delay(250 + i * 16)}>${bars}</g>`;
  });

  const R = WIDTH - 32;
  const first = s.weeks[0][0].date;
  const week = s.busiestWeek;
  let body =
    grid +
    // Headline in the empty top right corner.
    `<g class="fade" ${delay(200)}>` +
    text(G, 'Contribution calendar', { x: R, y: 46, size: 18, style: 'sans-600', fill: t.ink, anchor: 'end' }) +
    text(G, 'Every day of the last 12 months, private work included.', { x: R, y: 69, size: 13.5, style: 'sans-400', fill: t.ink2, anchor: 'end' }) +
    `</g>` +
    `<g class="rise" ${delay(500)}>` +
    text(G, fmt(s.total), { x: R, y: 124, size: 40, style: 'sans-600', fill: t.ink, anchor: 'end', tracking: -0.02 }) +
    text(G, 'contributions', { x: R, y: 146, size: 13.5, style: 'sans-400', fill: t.ink2, anchor: 'end' }) +
    text(G, `BUSIEST WEEK ${fmt(week.total)} · ${dayLabel(week.start).toUpperCase()} TO ${dayLabel(week.end).toUpperCase()}`, { x: R, y: 172, size: 10.5, style: 'mono-500', fill: t.muted, anchor: 'end', tracking: 0.06 }) +
    `</g>`;

  // Range and legend in the empty bottom left corner.
  const cardH = Math.ceil(oy + (W + 7) * C * SIN30 + 28);
  const ly = cardH - 34;
  const lx = 32 + measure('Less', 'sans-400', 11) + 16;
  body +=
    `<g class="fade" ${delay(900)}>` +
    text(G, `${dayLabel(first, true).toUpperCase()} TO ${dayLabel(s.today, true).toUpperCase()}`, { x: 32, y: ly - 24, size: 10.5, style: 'mono-500', fill: t.muted, tracking: 0.06 }) +
    text(G, 'Less', { x: 32, y: ly + 4, size: 11, style: 'sans-400', fill: t.muted });
  t.levels.forEach((_, l) => {
    const X = lx + l * 22;
    const cube = (x, y, z) => {
      const [a, b] = iso(x, y, z);
      return `${num(X + a, 1)},${num(ly + b, 1)}`;
    };
    const h = 3 + l * 2.5;
    body +=
      face(`r${l}`, [cube(8, 0, 0), cube(8, 8, 0), cube(8, 8, h), cube(8, 0, h)]) +
      face(`l${l}`, [cube(0, 8, 0), cube(8, 8, 0), cube(8, 8, h), cube(0, 8, h)]) +
      face(`t${l}`, [cube(0, 0, h), cube(8, 0, h), cube(8, 8, h), cube(0, 8, h)]);
  });
  body += text(G, 'More', { x: lx + 5 * 22 + 4, y: ly + 4, size: 11, style: 'sans-400', fill: t.muted }) + `</g>`;

  const css =
    t.levels.map((c, l) => `.t${l}{fill:${c}}.l${l}{fill:${shade(c, 0.84)}}.r${l}{fill:${shade(c, 0.7)}}`).join('') +
    `
.wk{animation:drop .7s cubic-bezier(.2,.7,.2,1) both}
.today{animation:blink 2.4s ease-in-out 1.6s infinite;opacity:0}
@keyframes drop{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}
@keyframes blink{0%,100%{opacity:0}50%{opacity:1}}`;

  return frame({
    height: cardH,
    title: `Contribution calendar: ${fmt(s.total)} contributions from ${dayLabel(first, true)} to ${dayLabel(s.today, true)}, busiest week ${week.total}.`,
    G, css, body, t,
  });
}

// ---------------------------------------------------------------------------
// Activity

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

function activity(t, s) {
  const G = new Glyphs();
  const { series, total, activeDays, current, longest, updated } = s;
  let body = cardHeading(G, t, {
    title: 'Contributions',
    subtitle: 'Daily contributions over the last 31 days. Private repositories are included.',
    note: `Updated ${updated}`,
  });

  const days = (n) => (n === 1 ? 'day' : 'days');
  body += statTiles(G, t, [
    ['Last 12 months', fmt(total), ''],
    ['Active days, 12 months', fmt(activeDays), ''],
    ['Current streak', String(current), days(current)],
    ['Longest streak', String(longest), days(longest)],
  ]);

  const plot = { x0: 70, x1: WIDTH - 36, y0: 196, y1: 318 };
  const peak = Math.max(...series.map((d) => d.count));
  const max = niceMax(Math.max(peak, 1));
  const X = (i) => plot.x0 + (i / (series.length - 1)) * (plot.x1 - plot.x0);
  const Y = (v) => plot.y1 - (v / max) * (plot.y1 - plot.y0);

  for (const v of [0, max / 2, max]) {
    body += `<rect x="${plot.x0}" y="${num(Y(v) - 0.5)}" width="${plot.x1 - plot.x0}" height="1" fill="${v ? t.grid : t.axis}"/>`;
    body += text(G, String(v), { x: plot.x0 - 12, y: Y(v) + 3.5, size: 10.5, style: 'mono-400', fill: t.muted, anchor: 'end' });
  }
  const lastIndex = series.length - 1;
  for (let i = 0; i <= lastIndex; i += 6) {
    const anchor = i === 0 ? 'start' : i === lastIndex ? 'end' : 'middle';
    body += text(G, dayLabel(series[i].date), { x: X(i), y: plot.y1 + 22, size: 10.5, style: 'mono-400', fill: t.muted, anchor });
  }

  const pts = series.map((d, i) => [X(i), Y(d.count)]);
  const { d, length } = monotone(pts);
  const dash = Math.ceil(length * 1.02);
  body +=
    `<path class="area" d="${d}L${num(plot.x1)},${plot.y1}L${plot.x0},${plot.y1}Z" fill="${t.accent}" fill-opacity="${t.washOpacity}"/>` +
    `<path class="line" d="${d}" fill="none" stroke="${t.accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="${dash}"/>`;

  const peakIndex = series.findIndex((x) => x.count === peak);
  for (const i of new Set([peakIndex, lastIndex])) {
    const [cx, cy] = pts[i];
    const isLast = i === lastIndex;
    if (isLast) body += `<circle class="pulse" cx="${num(cx)}" cy="${num(cy)}" r="4" fill="none" stroke="${t.accent}" stroke-width="2"/>`;
    body += `<circle class="dot" cx="${num(cx)}" cy="${num(cy)}" r="4" fill="${t.accent}" stroke="${t.surface}" stroke-width="2"/>`;
    const lx = Math.min(Math.max(cx, plot.x0 + 12), plot.x1 - 6);
    body += `<g class="fade" ${delay(1500)}>${text(G, String(series[i].count), { x: lx, y: cy - 12, size: 11.5, style: 'mono-500', fill: t.ink2, anchor: isLast ? 'end' : 'middle' })}</g>`;
  }

  const css = `
.line{stroke-dashoffset:0;animation:draw 1.6s cubic-bezier(.4,0,.2,1) .25s both}
.area{animation:fade .9s ease-out 1s both}
.dot{transform-box:fill-box;transform-origin:center;animation:pop .45s cubic-bezier(.3,1.6,.5,1) 1.45s both}
@keyframes draw{from{stroke-dashoffset:${dash}}to{stroke-dashoffset:0}}
@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}`;

  return frame({
    height: 362,
    title: `Contributions: ${total} in the last 12 months, ${activeDays} active days, current streak ${current} ${days(current)}, longest streak ${longest} ${days(longest)}.`,
    G, css, body, t,
  });
}

// ---------------------------------------------------------------------------
// Languages

const duration = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

function languages(t, data) {
  const G = new Glyphs();
  const wakatime = data.source === 'wakatime';
  let body = cardHeading(G, t, wakatime
    ? { title: 'Languages', subtitle: `Time in the editor over the last 7 days: ${duration(data.total)}.`, note: 'WakaTime · last 7 days' }
    : { title: 'Languages', subtitle: 'Share of code in repositories I pushed to in the last 12 months.', note: 'GitHub · by code size' });

  const rows = data.rows;
  const barX = 196, barMax = WIDTH - 32 - barX - 86;
  const top = rows[0].value;
  rows.forEach((row, i) => {
    const y = 106 + i * 32;
    const w = Math.max(4, (row.value / top) * barMax);
    const x1 = barX + w;
    const r = 4;
    const color = row.other ? t.other : t.accent;
    const valueText = wakatime ? duration(row.value) : `${row.share.toFixed(1)}%`;
    body +=
      `<g class="fade" ${delay(120 + i * 70)}>${text(G, row.name, { x: 32, y: y + 5, size: 14, style: 'sans-500', fill: row.other ? t.ink2 : t.ink })}</g>` +
      `<path class="bar" ${delay(200 + i * 70)} d="M${barX},${y - 6}H${num(x1 - r)}A${r},${r} 0 0 1 ${num(x1)},${y - 6 + r}V${y + 6 - r}A${r},${r} 0 0 1 ${num(x1 - r)},${y + 6}H${barX}Z" fill="${color}"/>` +
      `<g class="fade" ${delay(520 + i * 70)}>${text(G, valueText, { x: x1 + 10, y: y + 4.5, size: 12, style: 'mono-400', fill: t.ink2 })}</g>`;
  });
  const css = `
.bar{transform-box:fill-box;transform-origin:left center;animation:grow .9s cubic-bezier(.2,.7,.2,1) both}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}`;
  return frame({
    height: 106 + (rows.length - 1) * 32 + 34,
    title: `Languages: ${rows.map((r) => `${r.name} ${wakatime ? duration(r.value) : `${r.share.toFixed(1)}%`}`).join(', ')}`,
    G, css, body, t,
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

  // Today is still in progress, so the chart ends yesterday and a streak
  // survives an empty today.
  const series = [];
  for (let i = 31; i >= 1; i--) {
    const date = shiftDay(today, -i);
    series.push({ date, count: count(date) });
  }

  let activeDays = 0;
  for (let i = 0; i < 365; i++) if (count(shiftDay(today, -i)) > 0) activeDays++;

  let current = 0;
  for (let d = count(today) > 0 ? today : shiftDay(today, -1); count(d) > 0; d = shiftDay(d, -1)) current++;

  let longest = 0;
  let run = 0;
  let bestDay = { date: today, count: 0 };
  for (const date of [...counts.keys()].filter((d) => d <= today).sort()) {
    run = count(date) > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
    if (count(date) > bestDay.count) bestDay = { date, count: count(date) };
  }

  const perYear = [...contributionYears].sort().map((year) => ({
    year,
    total: [...counts].reduce((sum, [date, n]) => (date.startsWith(`${year}-`) ? sum + n : sum), 0),
  }));
  const year = Number(today.slice(0, 4));

  // Weekday averages over the last 52 complete weeks, Monday first.
  const sums = Array(7).fill(0);
  for (let i = 1; i <= 364; i++) sums[weekdayOf(shiftDay(today, -i))] += count(shiftDay(today, -i));
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((w) => ({ name: WEEKDAYS[w], avg: sums[w] / 52 }));

  const busiestWeek = weeks
    .map((w) => ({ total: w.reduce((a, d) => a + d.count, 0), start: w[0].date, end: w.at(-1).date }))
    .reduce((a, b) => (b.total > a.total ? b : a));

  const updated = dayLabel(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date()), true);
  return {
    today, updated, weeks, series, activeDays, current, longest, bestDay, perYear, year, weekdays, busiestWeek,
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

// ---------------------------------------------------------------------------

function write(name, svg) {
  const file = join(ASSETS, name);
  if (existsSync(file) && readFileSync(file, 'utf8') === svg) return;
  writeFileSync(file, svg);
  console.log(`wrote assets/${name} (${(svg.length / 1024).toFixed(1)} KB)`);
}

const eachTheme = (name, render) => {
  for (const [mode, t] of Object.entries(THEMES)) write(`${name}-${mode}.svg`, render(t));
};

async function main() {
  eachTheme('header', header);
  eachTheme('stack', stack);
  if (process.argv.includes('--static')) return;

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required for the data cards (or pass --static).');

  const data = await contributions(token);
  eachTheme('stats', (t) => stats(t, data));
  eachTheme('calendar', (t) => calendar(t, data));
  eachTheme('activity', (t) => activity(t, data));
  console.log(`contributions: ${data.total} in 12 months, ${data.allTime} all time, streak ${data.current}/${data.longest}`);

  let langs = null;
  if (process.env.WAKATIME_API_KEY) {
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
      return;
    }
  }
  eachTheme('languages', (t) => languages(t, langs));
  console.log(`languages (${langs.source}): ${langs.rows.map((r) => `${r.name} ${r.share.toFixed(1)}%`).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
