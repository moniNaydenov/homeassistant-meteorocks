/**
 * meteorocks-card — Lovelace card replicating the meteo.rocks forecast page.
 *
 * Sections (all on by default, toggle via config.sections):
 *   current    — fc2 current-conditions cc-card (glyph, temp chip, wind ring)
 *   nowcast    — 30-min precipitation bar card
 *   forecast   — multi-day overview + hourly detail (desktop strip / mobile accordion)
 *   map        — Leaflet nowcasting radar map with animated frame timeline
 *   satellite  — sat24 satellite image
 *
 * Data comes from the integration's authenticated view /api/meteorocks/<entry>/data;
 * the card refetches only when the weather entity's data_version attribute changes.
 *
 * Example config:
 *   type: custom:meteorocks-card
 *   entity: weather.meteo_rocks
 *   dark_mode: auto            # auto | true | false
 *   sections:
 *     map: false
 */
(function () {
  "use strict";

  const STATIC = "/meteorocks_static";
  const NOWCAST_TILES = "https://tiles.meteo.rocks/nowcasting";

  // The site's font (Exo 2, bundled). @font-face must live in the document,
  // not the shadow root, so inject the stylesheet into <head> once.
  if (!document.getElementById("meteorocks-fonts")) {
    const fontLink = document.createElement("link");
    fontLink.id = "meteorocks-fonts";
    fontLink.rel = "stylesheet";
    fontLink.href = STATIC + "/fonts/exo2.css";
    document.head.appendChild(fontLink);
  }
  const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const MODEL_BOUNDS = [
    [44.27843418470268, 22.35741230236595],
    [41.164829829492625, 28.724628165802386],
  ];

  const STRINGS = {
    en: {
      lastactive: "Last active",
      pressure: "Pressure",
      sun: "Sun",
      moon: "Moon",
      now: "NOW",
      ago: "ago",
      lastmodelrunsince: "Last updated",
      nowcastTitle: "Rain in the next hour",
      noRain: "No precipitation expected in the next half-hour.",
      forecastTitle: "Weather in the next days",
      axisTemp: "Temp. °C",
      axisDir: "Direction",
      axisWind: "Wind m/s",
      axisRain: "Rain mm",
      axisPop: "Chance",
      windUnit: "m/s",
      disclaimer:
        'We use an experimental model provided by <a href="https://deepmind.google/science/weathernext/" target="_blank" rel="noopener">Google Deepmind - Google Weathernext2</a>. There may be inaccuracies.',
      loadingMap: "Loading map",
      satellite: "Satellite",
    },
    bg: {
      lastactive: "Последна актуализация",
      pressure: "Атм. налягане",
      sun: "Слънце",
      moon: "Луна",
      now: "СЕГА",
      ago: "",
      lastmodelrunsince: "Последна актуализация преди",
      nowcastTitle: "Валежи следващите 30 минути",
      noRain: "Без очаквани валежи в следващия половин час.",
      forecastTitle: "Прогноза за следващите дни",
      axisTemp: "Темп. °C",
      axisDir: "Посока",
      axisWind: "Вятър м/с",
      axisRain: "Валеж мм",
      axisPop: "Вероятност",
      windUnit: "м/с",
      disclaimer:
        'Използваме експериментал модел, предоставен от <a href="https://deepmind.google/science/weathernext/" target="_blank" rel="noopener">Google Deepmind - Google Weathernext2</a>. Възможни са неточности.',
      loadingMap: "Зареждане на карта",
      satellite: "Сателит",
    },
  };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function icon(name, extra) {
    return (
      '<ha-icon class="mri ' + (extra || "") + '" icon="' + name + '"></ha-icon>'
    );
  }

  function meteocon(name, animated, cls) {
    const dir = animated ? "meteocons-animated" : "meteocons";
    return (
      '<img class="weather-icon ' + (cls || "") + '" src="' + STATIC + "/" + dir + "/" +
      esc(name || "not-available") + '.svg" alt="" />'
    );
  }

  /* Leaflet loader — script goes into document.head (UMD -> window.L), the CSS
     text is cached and injected per shadow root with image paths rewritten. */
  let leafletScriptPromise = null;
  let leafletCssPromise = null;

  function loadLeaflet() {
    if (!leafletScriptPromise) {
      leafletScriptPromise = new Promise(function (resolve, reject) {
        if (window.L) {
          resolve();
          return;
        }
        const s = document.createElement("script");
        s.src = STATIC + "/vendor/leaflet/leaflet.js";
        s.onload = resolve;
        s.onerror = function () {
          leafletScriptPromise = null;
          reject(new Error("leaflet load failed"));
        };
        document.head.appendChild(s);
      });
    }
    if (!leafletCssPromise) {
      leafletCssPromise = fetch(STATIC + "/vendor/leaflet/leaflet.css")
        .then(function (r) { return r.text(); })
        .then(function (css) {
          return css.replace(/url\(images\//g, "url(" + STATIC + "/vendor/leaflet/images/");
        })
        .catch(function () { leafletCssPromise = null; return ""; });
    }
    return Promise.all([leafletScriptPromise, leafletCssPromise]).then(function (r) {
      return r[1];
    });
  }

  /* ───────────────────────────── styles ─────────────────────────────
     Ported from s/scss/_forecast.scss (fc2/cc/nowcast), _moon.scss and the
     map timeline bits of _map.scss. Viewport media queries become container
     queries so the card adapts to its own column width. */
  const CARD_CSS = `
:host { display: block; }
.mr-container { container-type: inline-size; }
.fc2 {
  --fc-surface-1: #eef3f9; --fc-surface-2: #e7eff6; --fc-surface-bright: #ffffff;
  --fc-ink: #1a1c1e; --fc-ink-2: #42474e; --fc-ink-3: #5c626a; --fc-ink-4: #9aa0a8;
  --fc-outline-var: #c2c7ce; --fc-hairline: #e2e6eb;
  --fc-primary: #0b6fb1; --fc-primary-container: #cfe5f6; --fc-on-primary-container: #062a4a;
  --fc-rain: #0288d1; --fc-hover: rgba(11,111,177,.05); --fc-surface-3: #dfe9f2;
  --fc-secondary-container: #d3e4f4; --fc-ok: #2e7d32;
  --fc-mono: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --fc-shadow-xs: 0 1px 2px rgba(0,0,0,.06), 0 1px 3px 1px rgba(0,0,0,.03);
  --fc-shadow-sm: 0 1px 2px rgba(0,0,0,.06), 0 2px 6px 2px rgba(0,0,0,.05);
  font-family: 'Exo 2', Roboto, 'Segoe UI', sans-serif;
  color: var(--fc-ink);
  margin-bottom: 16px;
}
.fc2.dark-mode {
  --fc-surface-1: #161c22; --fc-surface-2: #1b232b; --fc-surface-bright: #10161b;
  --fc-ink: #e2e2e6; --fc-ink-2: #c2c7ce; --fc-ink-3: #9aa0a6; --fc-ink-4: #6b7178;
  --fc-outline-var: #3a424b; --fc-hairline: #2a323b;
  --fc-primary: #8fcdff; --fc-primary-container: #08436e; --fc-on-primary-container: #dceaf7;
  --fc-rain: #4fc3f7; --fc-hover: rgba(143,205,255,.08); --fc-surface-3: #202a33;
  --fc-secondary-container: #08436e; --fc-ok: #7fce86;
}
.fc2 h3 { color: var(--fc-ink); font-size: 22.4px; font-weight: 500; margin: 0 0 8px; padding: 0 8px; }
.fc2 a { color: var(--fc-primary); }
.mri { --mdc-icon-size: 1em; display: inline-flex; align-items: center; }
img.weather-icon { display: block; }

/* ── current conditions (cc-card) ── */
.cc-card {
  background: var(--fc-surface-1); border-radius: 24px; box-shadow: var(--fc-shadow-sm);
  overflow: hidden; color: var(--fc-ink); margin-bottom: 12px;
}
.cc-card .cc-top { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 14px; padding: 16px 22px 14px; }
.cc-card .cc-loc { display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1 1 auto; font-size: 18px; font-weight: 600; letter-spacing: -.01em; }
.cc-card .cc-loc .pin { color: var(--fc-primary); display: flex; flex: 0 0 auto; --mdc-icon-size: 20px; }
.cc-card .cc-loc-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cc-card .cc-upd { font-size: 11px; font-family: var(--fc-mono); color: var(--fc-ink-3); white-space: nowrap; text-align: right; flex: 0 1 auto; margin-left: auto; }
.cc-card .cc-hero { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; padding: 6px 22px 16px; }
.cc-card .cc-hero-l { display: flex; align-items: center; gap: 18px; min-width: 0; }
.cc-card .cc-glyph { width: 80px; height: 80px; border-radius: 20px; flex: 0 0 auto; display: grid; place-items: center; overflow: hidden; }
.cc-card .cc-glyph > .weather-icon { width: 80px; height: 80px; margin: 0; }
.cc-card .cc-tempchip { display: inline-flex; align-items: center; font-size: 68px; font-weight: 600; line-height: 1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; padding: 6px 22px; border-radius: 18px; }
.cc-card .cc-tempchip .deg { font-weight: 300; opacity: .7; }
.cc-card .cc-wind { position: relative; width: 96px; height: 96px; flex: 0 0 auto; }
.cc-card .cc-wind-ring { position: absolute; inset: 0; }
.cc-card .cc-wind-ring .ring { fill: var(--fc-surface-2); stroke: var(--fc-outline-var); stroke-width: 1.2; }
.cc-card .cc-wind-ring .tick { stroke: var(--fc-ink-4); stroke-width: 1.1; }
.cc-card .cc-wind-ring .nlabel { fill: var(--fc-ink-3); font-size: 6.5px; font-family: var(--fc-mono); }
.cc-card .cc-wind-pointer { position: absolute; inset: 0; transform-origin: 50% 50%; }
.cc-card .cc-wind-pointer .tri { fill: var(--fc-primary); }
.cc-card .cc-wind-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
.cc-card .cc-wind-avg { font-size: 16px; font-weight: 600; color: var(--fc-ink); font-variant-numeric: tabular-nums; letter-spacing: -.02em; line-height: 1.1; }
.cc-card .cc-wind-gust { font-size: 11px; font-weight: 500; color: var(--fc-ink-3); font-family: var(--fc-mono); font-variant-numeric: tabular-nums; line-height: 1.15; }
.cc-card .cc-wind-u { font-size: 7.5px; color: var(--fc-ink-4); font-family: var(--fc-mono); }
.cc-card .cc-cond { padding: 0 22px 16px; font-size: 15px; color: var(--fc-ink-2); line-height: 1.45; border-bottom: 1px solid var(--fc-hairline); }
.cc-card .cc-stats { display: grid; }
.cc-card .cc-stats.cols3 { grid-template-columns: repeat(3, 1fr); }
.cc-card .cc-stat { padding: 11px 16px 12px; min-width: 0; border-right: 1px solid var(--fc-hairline); border-bottom: 1px solid var(--fc-hairline); display: flex; flex-direction: column; gap: 4px; }
.cc-card .cc-stat .k { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; color: var(--fc-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cc-card .cc-stat .v { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--fc-ink); display: flex; align-items: center; gap: 6px; letter-spacing: -.01em; min-width: 0; }
.cc-card .cc-stat .v small { font-size: 11.5px; font-weight: 500; color: var(--fc-ink-3); letter-spacing: 0; }
.cc-card .cc-stat .v .ic { color: var(--fc-ink-3); display: inline-flex; flex: 0 0 auto; }
.cc-card .cc-stat .v .cc-amber { color: #f4a72c; --mdc-icon-size: 18px; }
.cc-card .cc-stat.tm .v { font-size: 13.5px; }
.cc-card .cc-stats.cols3 .cc-stat:nth-child(3n) { border-right: none; }
.cc-card .cc-stats.cols3 .cc-stat:nth-last-child(-n+3) { border-bottom: none; }
@container (max-width: 420px) {
  .cc-card .cc-tempchip { font-size: 52px; padding: 5px 16px; }
  .cc-card .cc-stats.cols3 { grid-template-columns: repeat(2, 1fr); }
  .cc-card .cc-stats.cols3 .cc-stat:nth-child(3n) { border-right: 1px solid var(--fc-hairline); }
  .cc-card .cc-stats.cols3 .cc-stat:nth-child(2n) { border-right: none; }
  .cc-card .cc-stats.cols3 .cc-stat:nth-last-child(-n+3) { border-bottom: 1px solid var(--fc-hairline); }
  .cc-card .cc-stats.cols3 .cc-stat:nth-last-child(-n+2) { border-bottom: none; }
}
span.moon-phase {
  background-image: url('${STATIC}/moonphases.png');
  background-repeat: no-repeat; background-size: auto 100%;
  width: 25.6px; height: 28.8px; display: inline-block; flex: 0 0 auto;
}
span.moon-phase.phase-0 { background-position: 0 0; }
span.moon-phase.phase-1 { background-position: 12.5% 0; }
span.moon-phase.phase-2 { background-position: 25% 0; }
span.moon-phase.phase-3 { background-position: 37.5% 0; }
span.moon-phase.phase-4 { background-position: 50% 0; }
span.moon-phase.phase-5 { background-position: 62.5% 0; }
span.moon-phase.phase-6 { background-position: 75% 0; }
span.moon-phase.phase-7 { background-position: 87.5% 0; }
span.moon-phase.phase-8 { background-position: 100% 0; }

/* ── nowcasting bar card ── */
.cc-nowcard { background: var(--fc-surface-1); border-radius: 24px; box-shadow: var(--fc-shadow-sm); padding: 16px 22px 18px; margin-bottom: 12px; }
.cc-nowcard .cc-now-head { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 2px 12px; margin-bottom: 14px; }
.cc-nowcard .cc-now-title { font-size: 15px; font-weight: 600; letter-spacing: -.01em; color: var(--fc-ink); flex: 1 0 auto; }
.cc-nowcard .cc-now-upd { font-size: 11px; font-family: var(--fc-mono); color: var(--fc-ink-3); white-space: nowrap; text-align: right; flex: 0 1 auto; margin-left: auto; }
.cc-nowcard .cc-now-chart { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 5px; align-items: end; }
.cc-nowcard .cc-now-cell { display: flex; flex-direction: column; align-items: center; gap: 7px; min-width: 0; }
.cc-nowcard .cc-now-mm { font-size: 11.5px; font-family: var(--fc-mono); font-variant-numeric: tabular-nums; font-weight: 500; min-height: 14px; line-height: 1; color: var(--fc-ink-2); }
.cc-nowcard .cc-now-track { width: 100%; height: 56px; display: flex; align-items: flex-end; background: var(--fc-surface-2); border-radius: 7px; overflow: hidden; }
.cc-nowcard .cc-now-bar { width: 100%; border-radius: 6px 6px 4px 4px; min-height: 3px; transition: height .2s; }
.cc-nowcard .cc-now-time { font-size: 10.5px; font-family: var(--fc-mono); color: var(--fc-ink-3); min-height: 13px; line-height: 1; }
.cc-nowcard .cc-now-dry { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-radius: 14px; background: var(--fc-surface-3); color: var(--fc-ink-2); font-size: 13px; }
.cc-nowcard .cc-now-dry .ic { color: var(--fc-primary); display: inline-flex; flex: 0 0 auto; --mdc-icon-size: 18px; }

/* ── forecast: day overview + hourly ── */
.fc2-card { background: var(--fc-surface-1); border-radius: 24px; box-shadow: var(--fc-shadow-sm); overflow: hidden; margin-bottom: 12px; }
.fc2-days { display: flex; gap: 2px; padding: 8px 8px 6px; }
.fc2-day { position: relative; cursor: pointer; display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; border-radius: 16px; padding-bottom: 12px; transition: background .16s; }
.fc2-day:hover:not(.sel) { background: var(--fc-hover); }
.fc2-day.sel { background: var(--fc-primary-container); }
.fc2-day.sel .fc2-dname, .fc2-day.sel .fc2-ddate { color: var(--fc-on-primary-container); }
.fc2-day.sel .fc2-ddate { opacity: .72; white-space: nowrap; }
.fc2-dhead { text-align: center; padding: 12px 4px 9px; }
.fc2-dname { font-weight: 600; font-size: 16px; letter-spacing: .05em; text-transform: uppercase; color: var(--fc-ink); }
.fc2-ddate { font-size: 13px; color: var(--fc-ink-3); font-family: var(--fc-mono); margin-top: 3px; }
.fc2-band { height: 76px; margin: 0 9px; border-radius: 13px; overflow: hidden; position: relative; display: grid; place-items: center; }
.fc2-night { position: absolute; right: 6px; bottom: 6px; width: 30px; height: 30px; border-radius: 50%; background: rgba(17,29,48,.88); overflow: hidden; display: grid; place-items: center; box-shadow: 0 1px 4px rgba(0,0,0,.35); }
.fc2-night .weather-icon { width: 20px; height: 20px; margin: 0; }
.fc2-temps { display: flex; flex-direction: column; gap: 4px; padding: 12px 10px 0; }
.fc2-chip { border-radius: 9px; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; letter-spacing: -.01em; line-height: 1; white-space: nowrap; }
.fc2-chip.hi { padding: 9px 0; font-size: 22px; }
.fc2-chip.lo { padding: 6px 0; font-size: 16px; }
.fc2-dfoot { display: flex; flex-direction: column; gap: 8px; padding: 13px 10px 2px; }
.fc2-frow { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 14.5px; color: var(--fc-ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.fc2-frow small { color: var(--fc-ink-3); }
.fc2-arrow { color: var(--fc-ink-2); display: inline-flex; --mdc-icon-size: 16px; }
.fc2-day.sel .fc2-frow { color: var(--fc-on-primary-container); }
.fc2-day.sel .fc2-frow small { color: inherit; }
.fc2-hhead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 22px; }
.fc2-htitle { font-size: 21px; font-weight: 600; letter-spacing: -.01em; text-transform: capitalize; color: var(--fc-ink); }
.fc2-htitle .sub { color: var(--fc-ink-3); font-weight: 400; margin-left: 9px; font-size: 16px; text-transform: none; }
.fc2-hbody { display: flex; border-top: 1px solid var(--fc-outline-var); }
.fc2-axis { flex: 0 0 152px; width: 152px; background: var(--fc-surface-2); }
.fc2-axrow { display: flex; align-items: center; gap: 9px; padding: 0 16px; color: var(--fc-ink-2); font-size: 14px; }
.fc2-axrow .mri { color: var(--fc-ink-3); flex: 0 0 auto; --mdc-icon-size: 16px; }
.fc2-axrow.blank { color: transparent; }
.fc2-scroll { flex: 1; overflow-x: auto; }
.fc2-hours { display: flex; min-width: 100%; }
.fc2-hourly-desktop .fc2-hours { display: none; }
.fc2-hourly-desktop .fc2-hours.shown { display: flex; }
.fc2-hour { flex: 1 1 0; min-width: 44px; display: flex; flex-direction: column; }
.fc2-hour:not(:first-child) .fc2-lower { border-left: 1px solid var(--fc-hairline); }
.fc2-c { display: flex; align-items: center; justify-content: center; }
.fc2-lower { display: flex; flex-direction: column; }
.fc2-wind { display: contents; }
.fc2-mhead { display: none; }
.fc2-time { font-family: var(--fc-mono); font-size: 15px; font-weight: 500; color: var(--fc-ink-2); }
.fc2-time sup { font-size: 11px; color: var(--fc-ink-3); }
.fc2-htemp { padding: 0 5px; }
.fc2-htemp .fc2-chip { width: 100%; padding: 7px 0; font-size: 16px; }
.fc2-dir { display: flex; flex-direction: column; align-items: center; gap: 1px; line-height: 1; }
.fc2-dir .ar { font-size: 16px; color: var(--fc-ink); display: inline-flex; }
.fc2-dir .ab { font-size: 12px; color: var(--fc-ink-3); font-family: var(--fc-mono); }
.fc2-spd { font-size: 14px; color: var(--fc-ink-2); font-family: var(--fc-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.fc2-mm { font-size: 14px; font-family: var(--fc-mono); color: var(--fc-rain); white-space: nowrap; }
.fc2-mm.zero { color: var(--fc-ink-4); }
.fc2-pop { font-size: 14px; font-family: var(--fc-mono); color: var(--fc-rain); font-weight: 500; white-space: nowrap; }
.fc2-pop.zero { color: var(--fc-ink-4); font-weight: 400; }
.fc2 .r-time { height: 30px; } .fc2 .r-band { height: 72px; } .fc2 .r-temp { height: 42px; }
.fc2 .r-dir { height: 36px; } .fc2 .r-spd { height: 26px; } .fc2 .r-mm { height: 26px; } .fc2 .r-pop { height: 30px; }
.fc2-band > .weather-icon, .fc2 .r-band > .weather-icon { width: 67.2px; height: 67.2px; margin: 0; }
.fc2-expand { display: none; }
.fc2-chev { display: none; }
.forecast-lastmodelrun { font-size: 12px; color: var(--fc-ink-3); padding: 0 16px 16px; }
@keyframes fc2drop { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

@container (max-width: 760px) {
  .fc2-days { flex-direction: column; gap: 8px; padding: 10px; }
  .fc2-day { flex: 0 0 auto; flex-direction: row; align-items: center; gap: 11px; padding: 8px 10px; border-radius: 14px; }
  .fc2-dhead { text-align: left; padding: 0; flex: 0 0 50px; }
  .fc2-dname { font-size: 17px; }
  .fc2-band { margin: 0; flex: 0 0 74px; height: 67.2px; border-radius: 12px; }
  .fc2-night { width: 24px; height: 24px; right: 5px; bottom: 5px; }
  .fc2-night .weather-icon { width: 16px; height: 16px; }
  .fc2-temps { flex-direction: row; gap: 5px; padding: 0; flex: 0 0 auto; }
  .fc2-chip.hi { padding: 6px 9px; font-size: 18px; }
  .fc2-chip.lo { padding: 6px 9px; font-size: 15px; }
  .fc2-dfoot { padding: 0; margin-left: auto; gap: 4px; align-items: flex-end; }
  .fc2-frow { justify-content: flex-end; font-size: 13.5px; white-space: nowrap; }
  .fc2-hhead { padding: 14px 16px; }
  .fc2-htitle { font-size: 18px; }
  .fc2-hbody { flex-direction: column; }
  .fc2-axis { display: none; }
  .fc2-scroll { overflow-x: visible; }
  .fc2-hours { flex-direction: column; min-width: 0; }
  .fc2-hour { flex-direction: row; align-items: stretch; min-width: 0; border-bottom: 1px solid var(--fc-hairline); }
  .fc2-hour:last-child { border-bottom: none; }
  .fc2-hour:not(:first-child) .fc2-lower { border-left: none; }
  .fc2-hour .fc2-c.r-time { flex: 0 0 36px; height: auto; }
  .fc2-time { font-size: 16px; font-weight: 600; }
  .fc2-hour .fc2-c.r-band { flex: 0 0 76px; height: auto; border-radius: 0; }
  .fc2-lower { flex-direction: row; flex: 1; align-items: center; }
  .fc2-lower .fc2-c { flex: 1; height: auto; padding: 9px 2px; }
  .fc2-lower .fc2-c.r-temp { flex: 0 0 58px; }
  .fc2-htemp .fc2-chip { font-size: 15px; white-space: nowrap; }
  .fc2-wind { display: flex; flex: 1.6; flex-direction: row-reverse; align-items: center; justify-content: center; gap: 7px; min-width: 0; }
  .fc2-wind .fc2-c { flex: 0 0 auto; padding: 9px 0; }
  .fc2-mhead { display: flex; align-items: stretch; border-bottom: 1px solid var(--fc-hairline); color: var(--fc-ink-3); }
  .fc2-mhead .fc2-c.r-time { flex: 0 0 36px; height: auto; }
  .fc2-mhead .fc2-c.r-band { flex: 0 0 76px; height: auto; }
  .fc2-mhead .fc2-lower { flex-direction: row; flex: 1; }
  .fc2-mhead .fc2-lower .fc2-c { flex: 1; padding: 8px 2px; }
  .fc2-mhead .fc2-lower .fc2-c.r-wind-h { flex: 1.6; }
  .fc2-mhead .mri { --mdc-icon-size: 15px; }
  .fc2-hourly-desktop { display: none; }
  .fc2-expand { display: none; }
  .fc2-day.sel + .fc2-expand { display: block; background: var(--fc-surface-bright); border-radius: 14px; overflow: hidden; margin: 1px 0 5px; box-shadow: var(--fc-shadow-xs); animation: fc2drop .22s ease; }
  .fc2-day.sel + .fc2-expand .fc2-hhead { padding: 12px 14px 7px; }
  .fc2-day.sel + .fc2-expand .fc2-htitle { font-size: 17px; }
  .fc2-day.sel + .fc2-expand .fc2-hbody { border-top: 1px solid var(--fc-outline-var); }
  .fc2-chev { display: flex; align-items: center; flex: 0 0 auto; margin-left: 2px; color: var(--fc-ink-3); transition: transform .2s ease; --mdc-icon-size: 16px; }
  .fc2-day.sel .fc2-chev { transform: rotate(180deg); color: var(--fc-on-primary-container); }
}
@container (max-width: 470px) {
  .fc2-hour .fc2-c.r-time, .fc2-mhead .fc2-c.r-time { flex: 0 0 30px; } .fc2-time { font-size: 15px; }
  .fc2-hour .fc2-c.r-band, .fc2-mhead .fc2-c.r-band { flex: 0 0 60px; }
  .fc2-lower .fc2-c.r-temp { flex: 0 0 52px; }
  .fc2-htemp .fc2-chip { font-size: 14px; }
  .fc2-wind { flex: 2; gap: 5px; }
  .fc2-mhead .fc2-lower .fc2-c.r-wind-h { flex: 2; }
  .fc2-lower .fc2-c.r-pop { flex: 0.8; }
  .fc2-spd { font-size: 12px; } .fc2-mm, .fc2-pop { font-size: 12px; }
  .fc2-dir .ar { font-size: 14px; } .fc2-dir .ab { font-size: 10px; }
  .fc2 .r-band > .weather-icon { width: 48px; height: 48px; }
}
@container (max-width: 400px) {
  .fc2 .fc2-days { padding: 8px; gap: 7px; }
  .fc2-day { gap: 6px; padding: 7px 8px; }
  .fc2-dhead { flex: 0 0 38px; }
  .fc2-dname { font-size: 15px; letter-spacing: .03em; } .fc2-ddate { font-size: 12px; }
  .fc2-night { width: 20px; height: 20px; right: 4px; bottom: 4px; }
  .fc2-night .weather-icon { width: 13px; height: 13px; }
  .fc2-temps { gap: 4px; }
  .fc2-chip.hi { padding: 6px 6px; font-size: 16px; } .fc2-chip.lo { padding: 5px 6px; font-size: 14px; }
  .fc2-dfoot { gap: 3px; } .fc2-frow { font-size: 12px; gap: 4px; }
  .fc2-hour .fc2-c.r-time { flex: 0 0 28px; } .fc2-time { font-size: 14px; } .fc2-time sup { font-size: 10px; }
  .fc2-hour .fc2-c.r-band { flex: 0 0 52px; }
  .fc2-lower .fc2-c { padding: 8px 1px; } .fc2-lower .fc2-c.r-temp { flex: 0 0 52px; }
  .fc2-htemp .fc2-chip { font-size: 13px; padding: 6px 0; }
  .fc2-wind { flex: 2.2; gap: 4px; }
  .fc2-mhead .fc2-lower .fc2-c.r-wind-h { flex: 2.2; }
  .fc2-lower .fc2-c.r-pop { flex: 0.7; }
  .fc2-mhead .fc2-c.r-time { flex: 0 0 28px; }
  .fc2-mhead .fc2-c.r-band { flex: 0 0 52px; }
  .fc2-expand .fc2-hhead { padding: 10px 12px 6px; } .fc2-expand .fc2-htitle { font-size: 16px; }
  .fc2-band > .weather-icon, .fc2 .r-band > .weather-icon { width: 32px; height: 32px; }
}
@media (prefers-reduced-motion: reduce) {
  .fc2-day.sel + .fc2-expand { animation: none !important; }
}

/* ── nowcasting map ── */
.mr-mapcard { background: var(--fc-surface-1); border-radius: 24px; box-shadow: var(--fc-shadow-sm); overflow: hidden; margin-bottom: 12px; }
.mr-maph { position: relative; height: 420px; width: 100%; }
.mr-map { height: 100%; width: 100%; background: var(--fc-surface-2); }
.mr-map-title { position: absolute; z-index: 1000; top: 8px; left: 64px; font-weight: 700; color: #1a1c1e; text-shadow: 0 0 3px #fff; font-size: 14px; }
.mr-timeline-holder { overflow-x: auto; overflow-y: hidden; scroll-behavior: smooth; padding: 12px; }
.mr-timeline { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px 0; }
.mr-timeline .times { display: flex; flex-wrap: nowrap; }
.mr-timeline .time { width: 80px; height: 48px; cursor: pointer; color: var(--fc-primary); border-left: 1px solid #ddd; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; display: flex; flex-direction: column; flex: 0 0 auto; justify-content: center; align-items: center; font-size: 16px; }
.fc2.dark-mode .mr-timeline .time { border-color: var(--fc-outline-var); }
.mr-timeline .time:last-child { border-right: 1px solid #ddd; border-bottom-right-radius: 8px; border-top-right-radius: 8px; }
.fc2.dark-mode .mr-timeline .time:last-child { border-right-color: var(--fc-outline-var); }
.mr-timeline .time:first-child { border-bottom-left-radius: 8px; border-top-left-radius: 8px; }
.mr-timeline .time.past { background-color: #edf3fb; border-color: #fff; border-top-color: #edf3fb; border-bottom-color: #edf3fb; }
.fc2.dark-mode .mr-timeline .time.past { background-color: var(--fc-surface-2); border-color: var(--fc-surface-2); }
.mr-timeline .time.active { background-color: var(--fc-primary); border-color: var(--fc-primary); font-weight: bold; color: #fff; }
.fc2.dark-mode .mr-timeline .time.active { color: #062a4a; }
.mr-timeline .time .nowlbl { margin-top: -3.2px; font-size: 12px; }
.mr-play { width: 48px; height: 48px; border-radius: 50%; background-color: var(--fc-primary); color: #fff; margin-right: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; --mdc-icon-size: 26px; }
.fc2.dark-mode .mr-play { color: #062a4a; }
.mr-timeline-info { flex: 1 1 100%; text-align: center; font-size: 12px; color: var(--fc-ink-3); }
.mr-timeline-info .radars { font-size: 11px; }
@container (max-width: 470px) { .mr-timeline .time { width: 54.4px; } .mr-maph { height: 340px; } }

/* current-position marker (port of the site's fa-stack divIcon: white disc,
   meteoblue ring + center dot, brief beat animation) */
.mr-pos { display: block; width: 26px; height: 26px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); position: relative; animation: mr-beat 1s ease-in-out 8 alternate; }
.mr-pos-dot { position: absolute; inset: 4px; border-radius: 50%; border: 2px solid #009de0; }
.mr-pos-dot::after { content: ''; position: absolute; top: 50%; left: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: #009de0; }
@keyframes mr-beat { from { transform: scale(1); } to { transform: scale(1.25); } }
@media (prefers-reduced-motion: reduce) { .mr-pos { animation: none; } }

/* ── satellite ── */
.mr-sat { background: var(--fc-surface-1); border-radius: 24px; box-shadow: var(--fc-shadow-sm); overflow: hidden; margin-bottom: 12px; }
.mr-sat img { width: 100%; height: auto; display: block; }

.mr-error { padding: 12px 16px; border-radius: 12px; background: #fde7e9; color: #8a1c25; font-size: 13px; }
.mr-tappable { cursor: pointer; -webkit-tap-highlight-color: transparent; }
`;

  class MeteorocksCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._dataVersion = null;
      this._data = null;
      this._selDay = 0;
      this._dark = null;
      this._map = null;
      this._playing = false;
      this._playTimer = null;
      this._nowcastStart = null;
      this._fetching = false;
    }

    setConfig(config) {
      if (!config || !config.entity) {
        throw new Error("meteorocks-card: 'entity' is required (the meteorocks weather entity)");
      }
      const sections = Object.assign(
        { current: true, nowcast: true, forecast: true, map: true, satellite: true },
        config.sections || {}
      );
      const previous = this._config;
      this._config = Object.assign(
        {
          dark_mode: "auto",
          tap_action: { action: "more-info" },
          hold_action: { action: "none" },
        },
        config,
        { sections: sections }
      );
      if (this._root) this._applyTappable();

      // Live-apply on reconfiguration (dashboard editor preview): clear hosts of
      // sections that got switched off, tear down the map if it went away, and
      // refetch when the entity changed.
      if (previous && this._root) {
        if (previous.entity !== this._config.entity) {
          this._dataVersion = null;
          return; // next `set hass` refetches and re-renders
        }
        if (!sections.map && this._map) {
          this._playing = false;
          clearTimeout(this._playTimer);
          this._map.remove();
          this._map = null;
        }
        const hostBySection = {
          current: ".mrs-current",
          nowcast: ".mrs-nowcast",
          forecast: ".mrs-forecast",
          map: ".mrs-map",
          satellite: ".mrs-satellite",
        };
        for (const key in hostBySection) {
          if (!sections[key]) {
            const host = this._root.querySelector(hostBySection[key]);
            if (host) host.innerHTML = "";
          }
        }
        if (this._hass) {
          const dark = this._isDark(this._hass);
          if (dark !== this._dark) {
            this._dark = dark;
            this._root.classList.toggle("dark-mode", dark);
          }
        }
        if (this._data) this._render();
      }
    }

    /* dark_mode: "auto" follows the HA theme; also accepts true/false and the
       editor's "on"/"off" strings. */
    _isDark(hass) {
      const mode = this._config.dark_mode;
      if (mode === "auto" || mode == null) {
        return !!(hass.themes && hass.themes.darkMode);
      }
      return mode === true || mode === "on" || mode === "true";
    }

    /* ── tap / hold actions ──
       Standard HA actions on the sections that have no controls of their own
       (current conditions, nowcast bars, satellite). The forecast tables, map
       and timeline keep their built-in interactions. Execution is delegated to
       the frontend via the hass-action event, so every action type HA knows
       (more-info, navigate, url, perform-action, ...) works. */

    static get _tappableHosts() {
      return [".mrs-current", ".mrs-nowcast", ".mrs-satellite"];
    }

    _hasAction(name) {
      const action = this._config[name];
      return !!(action && action.action && action.action !== "none");
    }

    _bindActions() {
      const card = this;
      MeteorocksCard._tappableHosts.forEach(function (selector) {
        const host = card._root.querySelector(selector);
        if (!host) return;
        host.addEventListener("click", function (ev) {
          if (card._held) {
            card._held = false;
            return;
          }
          if (ev.composedPath().some(function (el) { return el.tagName === "A"; })) {
            return; // let real links (e.g. the disclaimer) work untouched
          }
          card._fireAction("tap");
        });
        host.addEventListener("pointerdown", function () {
          card._held = false;
          clearTimeout(card._holdTimer);
          if (!card._hasAction("hold_action")) return;
          card._holdTimer = setTimeout(function () {
            card._held = true;
            card._fireAction("hold");
          }, 500);
        });
        ["pointerup", "pointercancel", "pointerleave"].forEach(function (type) {
          host.addEventListener(type, function () {
            clearTimeout(card._holdTimer);
          });
        });
      });
    }

    _applyTappable() {
      const tappable = this._hasAction("tap_action") || this._hasAction("hold_action");
      const card = this;
      MeteorocksCard._tappableHosts.forEach(function (selector) {
        const host = card._root.querySelector(selector);
        if (host) host.classList.toggle("mr-tappable", tappable);
      });
    }

    _fireAction(action) {
      if (!this._hasAction(action + "_action")) return;
      const event = new Event("hass-action", { bubbles: true, composed: true });
      event.detail = {
        config: {
          entity: this._config.entity,
          tap_action: this._config.tap_action,
          hold_action: this._config.hold_action,
        },
        action: action,
      };
      this.dispatchEvent(event);
    }

    static getConfigElement() {
      return document.createElement("meteorocks-card-editor");
    }

    getCardSize() {
      return 12;
    }

    static getStubConfig(hass) {
      const entity = Object.keys(hass.states).find(function (id) {
        return id.startsWith("weather.") && hass.states[id].attributes.meteorocks_entry_id;
      });
      return { entity: entity || "weather.meteo_rocks" };
    }

    set hass(hass) {
      this._hass = hass;
      const st = hass.states[this._config.entity];
      if (!st) {
        this._renderError("Entity not found: " + this._config.entity);
        return;
      }
      const dark = this._isDark(hass);
      if (dark !== this._dark) {
        this._dark = dark;
        if (this._root) this._root.classList.toggle("dark-mode", dark);
      }
      const version = st.attributes.data_version;
      if (version !== this._dataVersion && !this._fetching) {
        this._fetching = true;
        const entryId = st.attributes.meteorocks_entry_id;
        const card = this;
        hass
          .callApi("GET", "meteorocks/" + entryId + "/data")
          .then(function (data) {
            card._dataVersion = version;
            card._data = data;
            card._render();
          })
          .catch(function (err) {
            card._renderError("Data fetch failed: " + (err && err.message ? err.message : err));
          })
          .finally(function () {
            card._fetching = false;
          });
      }
    }

    get _str() {
      const lang = (this._data && this._data.language) || "bg";
      return STRINGS[lang] || STRINGS.bg;
    }

    _renderError(message) {
      if (!this.shadowRoot) return;
      if (this._root) {
        const box = this._root.querySelector(".mr-error");
        if (box) {
          box.textContent = message;
          return;
        }
      }
      this.shadowRoot.innerHTML =
        "<style>" + CARD_CSS + "</style>" +
        '<div class="mr-container"><div class="fc2"><div class="mr-error">' +
        esc(message) + "</div></div></div>";
      this._root = null;
      this._map = null;
    }

    /* ─────────── skeleton + section rendering ─────────── */

    _render() {
      if (!this._data) return;
      if (!this._root) {
        this.shadowRoot.innerHTML =
          "<style>" + CARD_CSS + "</style>" +
          '<div class="mr-container"><div class="fc2' + (this._dark ? " dark-mode" : "") + '">' +
          '<div class="mrs-current"></div>' +
          '<div class="mrs-nowcast"></div>' +
          '<div class="mrs-forecast"></div>' +
          '<div class="mrs-map"></div>' +
          '<div class="mrs-satellite"></div>' +
          "</div></div>";
        this._root = this.shadowRoot.querySelector(".fc2");
        this._leafletStyleInjected = false;
        this._bindActions();
        this._applyTappable();
      }
      const s = this._config.sections;
      if (s.current) this._renderCurrent();
      if (s.nowcast) this._renderNowcast();
      if (s.forecast) this._renderForecast();
      if (s.map) this._renderMap();
      if (s.satellite) this._renderSatellite();
    }

    _renderCurrent() {
      const payload = this._data.current || {};
      const cur = payload.current;
      const host = this._root.querySelector(".mrs-current");
      if (!cur) {
        host.innerHTML = "";
        return;
      }
      const str = this._str;
      host.innerHTML =
        '<div class="cc-card">' +
        '<div class="cc-top">' +
        '<div class="cc-loc"><span class="pin">' + icon("mdi:map-marker") + "</span>" +
        '<span class="cc-loc-name">' + esc(this._data.name) + "</span></div>" +
        '<div class="cc-upd">' + esc(str.lastactive) + " " + esc(payload.pagelastupdated || "") + "</div>" +
        "</div>" +
        '<div class="cc-hero">' +
        '<div class="cc-hero-l">' +
        '<div class="cc-glyph" style="background: ' + esc(cur.sky_gradient || "") + '">' +
        meteocon(cur.weathericon, true) + "</div>" +
        '<div class="cc-tempchip" style="background: ' + esc(cur.temp_chip_bg) + "; color: " + esc(cur.temp_chip_fg) + '">' +
        "<span>" + esc(cur.temp) + '</span><span class="deg">&deg;</span></div>' +
        "</div>" +
        '<div class="cc-wind">' +
        '<svg class="cc-wind-ring" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">' +
        '<circle cx="48" cy="48" r="44" class="ring"/>' +
        '<line x1="48" y1="4" x2="48" y2="8" class="tick"/>' +
        '<line x1="92" y1="48" x2="88" y2="48" class="tick"/>' +
        '<line x1="48" y1="92" x2="48" y2="88" class="tick"/>' +
        '<line x1="4" y1="48" x2="8" y2="48" class="tick"/>' +
        '<text x="48" y="14" text-anchor="middle" class="nlabel">N</text>' +
        "</svg>" +
        '<div class="cc-wind-pointer" style="transform: rotate(' + Number(cur.winddirection || 0) + 'deg)">' +
        '<svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true"><path d="M 48 15 L 52.2 6 L 43.8 6 Z" class="tri"/></svg>' +
        "</div>" +
        '<div class="cc-wind-center">' +
        '<div class="cc-wind-avg">' + esc(cur.windspeed_average) + "</div>" +
        '<div class="cc-wind-gust">' + esc(cur.windspeed_max) + "</div>" +
        '<div class="cc-wind-u">' + esc(str.windUnit) + "</div>" +
        "</div></div></div>" +
        '<div class="cc-cond">' + esc(cur.weatherstring) + ", " + esc(cur.windspeed_average_text) + ".</div>" +
        '<div class="cc-stats cols3">' +
        '<div class="cc-stat"><div class="k">' + esc(str.pressure) + '</div><div class="v"><span>' +
        esc(cur.pressure) + "</span> <small>hPa</small></div></div>" +
        '<div class="cc-stat tm"><div class="k">' + esc(str.sun) + '</div><div class="v">' +
        icon("mdi:white-balance-sunny", "cc-amber") + " <span>" + esc(cur.sunrise || "-") +
        "</span>&ndash;<span>" + esc(cur.sunset || "-") + "</span></div></div>" +
        '<div class="cc-stat tm"><div class="k">' + esc(str.moon) + '</div><div class="v">' +
        '<span class="moon-phase phase-' + Number(cur.moonphase || 0) + '"></span> <span>' +
        esc(cur.moonrise || "-") + "</span>&ndash;<span>" + esc(cur.moonset || "-") + "</span></div></div>" +
        "</div></div>";
    }

    _renderNowcast() {
      const nowcasting = this._data.nowcasting || {};
      const table = nowcasting.table || {};
      const host = this._root.querySelector(".mrs-nowcast");
      if (!table.data || !table.data.length) {
        host.innerHTML = "";
        return;
      }
      const str = this._str;
      let body;
      if (table.anyrain) {
        body =
          '<div class="cc-now-chart">' +
          table.data
            .map(function (bucket) {
              return (
                '<div class="cc-now-cell">' +
                '<div class="cc-now-mm">' + (bucket.hasrain ? esc(bucket.mm) : "") + "</div>" +
                '<div class="cc-now-track"><div class="cc-now-bar" style="height: ' +
                esc(bucket.barheight) + "; background: " + esc(bucket.barcolor) + '"></div></div>' +
                '<div class="cc-now-time">' + (bucket.showtime ? esc(bucket.timestampstr) : "") + "</div>" +
                "</div>"
              );
            })
            .join("") +
          "</div>";
      } else {
        body =
          '<div class="cc-now-dry"><span class="ic">' + icon("mdi:white-balance-sunny") +
          "</span><span>" + esc(str.noRain) + "</span></div>";
      }
      host.innerHTML =
        '<div class="cc-nowcard">' +
        '<div class="cc-now-head">' +
        '<div class="cc-now-title">' + esc(str.nowcastTitle) + "</div>" +
        '<div class="cc-now-upd">' + esc(str.lastmodelrunsince) + " " +
        esc(table.lastmodelrunsince || "") + " " + esc(str.ago) + "</div>" +
        "</div>" +
        '<div class="mr-now-body">' + body + "</div>" +
        "</div>";
    }

    /* ── forecast section ── */

    _hourCells(day) {
      const card = this;
      return (day.hours || [])
        .map(function (hour) {
          return (
            '<div class="fc2-hour ' + esc(hour.timeclass || "") + '">' +
            '<div class="fc2-c r-time"><span class="fc2-time">' + esc(hour.hourlabel) + "<sup>00</sup></span></div>" +
            '<div class="fc2-c r-band" style="background: ' + esc(hour.sky_gradient || "") + '">' +
            meteocon(hour.weathericon, false) + "</div>" +
            '<div class="fc2-lower">' +
            '<div class="fc2-c r-temp fc2-htemp"><span class="fc2-chip" style="background: ' +
            esc(hour.temp_max_chip_bg) + "; color: " + esc(hour.temp_max_chip_fg) + '">' +
            esc(hour.temp_range) + "</span></div>" +
            '<div class="fc2-wind">' +
            '<div class="fc2-c r-dir"><span class="fc2-dir"><span class="ar">' +
            card._windArrow(hour.winddirection) + '</span><span class="ab">' +
            esc(hour.winddirection_abbr || "") + "</span></span></div>" +
            '<div class="fc2-c r-spd"><span class="fc2-spd">' + esc(hour.windspeed_average) +
            " - " + esc(hour.windspeed_max) + "</span></div>" +
            "</div>" +
            '<div class="fc2-c r-mm"><span class="fc2-mm ' + (hour.has_rainfall ? "" : "zero") + '">' +
            (hour.rainfall_str || "") + "</span></div>" +
            '<div class="fc2-c r-pop"><span class="fc2-pop ' + (hour.has_probability ? "" : "zero") + '">' +
            esc(hour.probability) + "%</span></div>" +
            "</div></div>"
          );
        })
        .join("");
    }

    _windArrow(deg) {
      return (
        '<ha-icon class="mri" icon="mdi:arrow-down-thin" style="transform: rotate(' +
        Number(deg || 0) + 'deg)"></ha-icon>'
      );
    }

    _renderForecast() {
      const forecast = this._data.forecast || {};
      const days = (forecast.data && forecast.data.days) || [];
      const host = this._root.querySelector(".mrs-forecast");
      if (!days.length) {
        host.innerHTML = "";
        return;
      }
      const card = this;
      const str = this._str;
      if (this._selDay >= days.length) this._selDay = 0;

      const daysHtml = days
        .map(function (day, i) {
          const sel = i === card._selDay;
          return (
            '<div class="fc2-day' + (sel ? " sel" : "") + '" data-day="' + i + '">' +
            '<div class="fc2-dhead"><div class="fc2-dname">' + esc(day.date_weekday_short) + "</div>" +
            '<div class="fc2-ddate">' + esc(day.date_monthday) + " " + esc(day.date_month_short) + "</div></div>" +
            '<div class="fc2-band" style="background: ' + esc(day.sky_gradient || "") + '">' +
            meteocon(day.weathericon, false) +
            '<span class="fc2-night">' + meteocon(day.night_weathericon, false) + "</span>" +
            "</div>" +
            '<div class="fc2-temps">' +
            '<div class="fc2-chip hi" style="background: ' + esc(day.temp_max_chip_bg) + "; color: " +
            esc(day.temp_max_chip_fg) + '">' + esc(day.temp_max_int) + "&deg;</div>" +
            (day.temp_same
              ? ""
              : '<div class="fc2-chip lo" style="background: ' + esc(day.temp_min_chip_bg) + "; color: " +
                esc(day.temp_min_chip_fg) + '">' + esc(day.temp_min_int) + "&deg;</div>") +
            "</div>" +
            '<div class="fc2-dfoot">' +
            '<div class="fc2-frow"><span class="fc2-arrow">' + card._windArrow(day.winddirection) + "</span>" +
            esc(day.windspeed_average) + " - " + esc(day.windspeed_max) + " <small>" + esc(str.windUnit) + "</small></div>" +
            '<div class="fc2-frow">' + icon("mdi:water") + " " + (day.rainfall_str || "") + "</div>" +
            '<div class="fc2-frow">' + esc(day.pressure) + " <small>hPa</small></div>" +
            "</div>" +
            '<span class="fc2-chev">' + icon("mdi:chevron-down") + "</span>" +
            "</div>" +
            /* mobile accordion panel */
            '<div class="fc2-expand">' +
            '<div class="fc2-hhead"><div class="fc2-htitle">' + esc(day.date_weekday) +
            '<span class="sub">' + esc(day.date_monthday) + " " + esc(day.date_month_short) + "</span></div></div>" +
            '<div class="fc2-hbody">' +
            '<div class="fc2-mhead" aria-hidden="true">' +
            '<div class="fc2-c r-time"></div><div class="fc2-c r-band"></div>' +
            '<div class="fc2-lower">' +
            '<div class="fc2-c r-temp">' + icon("mdi:thermometer") + "</div>" +
            '<div class="fc2-c r-wind-h">' + icon("mdi:weather-windy") + "</div>" +
            '<div class="fc2-c r-mm">' + icon("mdi:water") + "</div>" +
            '<div class="fc2-c r-pop">' + icon("mdi:umbrella") + "</div>" +
            "</div></div>" +
            '<div class="fc2-scroll"><div class="fc2-hours">' + card._hourCells(day) + "</div></div>" +
            "</div></div>"
          );
        })
        .join("");

      const selected = days[this._selDay] || days[0];
      const hoursHtml = days
        .map(function (day, i) {
          return (
            '<div class="fc2-hours' + (i === card._selDay ? " shown" : "") + '" data-day-group="' + i + '">' +
            card._hourCells(day) + "</div>"
          );
        })
        .join("");

      host.innerHTML =
        '<section class="forecast-detailed">' +
        "<h3>" + esc(str.forecastTitle) + "</h3>" +
        '<div class="fc2-card"><div class="fc2-days">' + daysHtml + "</div></div>" +
        '<div class="fc2-card fc2-hourly-desktop">' +
        '<div class="fc2-hhead"><div class="fc2-htitle mr-hsel">' + esc(selected.date_weekday) +
        '<span class="sub">' + esc(selected.date_monthday) + " " + esc(selected.date_month_short) + "</span></div></div>" +
        '<div class="fc2-hbody">' +
        '<div class="fc2-axis">' +
        '<div class="fc2-axrow r-time blank"></div><div class="fc2-axrow r-band blank"></div>' +
        '<div class="fc2-axrow r-temp">' + icon("mdi:thermometer") + esc(str.axisTemp) + "</div>" +
        '<div class="fc2-axrow r-dir">' + icon("mdi:compass") + esc(str.axisDir) + "</div>" +
        '<div class="fc2-axrow r-spd">' + icon("mdi:weather-windy") + esc(str.axisWind) + "</div>" +
        '<div class="fc2-axrow r-mm">' + icon("mdi:water") + esc(str.axisRain) + "</div>" +
        '<div class="fc2-axrow r-pop">' + icon("mdi:umbrella") + esc(str.axisPop) + "</div>" +
        "</div>" +
        '<div class="fc2-scroll mr-hscroll">' + hoursHtml + "</div>" +
        "</div></div>" +
        '<div class="forecast-lastmodelrun">' + esc(str.lastmodelrunsince) + " " +
        esc(forecast.lastmodelrunsince || "") + " " + esc(str.ago) + ". " + str.disclaimer + "</div>" +
        "</section>";

      host.querySelectorAll(".fc2-day").forEach(function (el) {
        el.addEventListener("click", function () {
          card._selectDay(Number(el.dataset.day));
        });
      });
    }

    _selectDay(index) {
      if (index === this._selDay) {
        // Mobile accordion behaves like the site: tapping the open day keeps it open.
        return;
      }
      this._selDay = index;
      const host = this._root.querySelector(".mrs-forecast");
      host.querySelectorAll(".fc2-day").forEach(function (el) {
        el.classList.toggle("sel", Number(el.dataset.day) === index);
      });
      host.querySelectorAll(".fc2-hours[data-day-group]").forEach(function (el) {
        el.classList.toggle("shown", Number(el.dataset.dayGroup) === index);
      });
      const days = ((this._data.forecast || {}).data || {}).days || [];
      const day = days[index];
      const title = host.querySelector(".mr-hsel");
      if (title && day) {
        title.innerHTML =
          esc(day.date_weekday) + '<span class="sub">' + esc(day.date_monthday) + " " +
          esc(day.date_month_short) + "</span>";
      }
    }

    /* ── Leaflet nowcasting map ── */

    _renderMap() {
      const nowcasting = this._data.nowcasting || {};
      const timeline = nowcasting.timeline;
      const host = this._root.querySelector(".mrs-map");
      if (!timeline || !timeline.maptimes || !timeline.maptimes.length) {
        if (!this._map) host.innerHTML = "";
        return;
      }
      const card = this;
      if (!this._map) {
        if (this._mapPending) return;
        this._mapPending = true;
        host.innerHTML =
          '<div class="mr-mapcard">' +
          '<div class="mr-maph"><div class="mr-map-title"></div><div class="mr-map"></div></div>' +
          '<div class="mr-timeline-holder"><div class="mr-timeline">' +
          '<div class="mr-play">' + icon("mdi:play") + "</div>" +
          '<div class="times"></div>' +
          '<div class="mr-timeline-info"></div>' +
          "</div></div></div>";
        host.querySelector(".mr-play").addEventListener("click", function () {
          card._playPause();
        });
        loadLeaflet()
          .then(function (css) {
            card._mapPending = false;
            if (!card._root) return; // card got torn down while loading
            if (!card._leafletStyleInjected) {
              const style = document.createElement("style");
              style.textContent = css;
              card.shadowRoot.appendChild(style);
              card._leafletStyleInjected = true;
            }
            card._initLeaflet(host.querySelector(".mr-map"));
            card._buildTimeline((card._data.nowcasting || {}).timeline || timeline);
          })
          .catch(function () {
            card._mapPending = false;
            host.innerHTML = '<div class="mr-error">Map failed to load</div>';
          });
        return;
      }
      // Map exists — rebuild the timeline only when a new model run arrived.
      if (Number(nowcasting.timestamp_start) !== this._nowcastStart) {
        this._buildTimeline(timeline);
      } else {
        this._updateTimelineInfo(timeline);
      }
    }

    _initLeaflet(container) {
      const L = window.L;
      const lat = Number(this._data.lat) || 42.6977;
      const lon = Number(this._data.lon) || 23.3217;
      this._map = L.map(container, {
        minZoom: 6,
        maxZoom: 14,
        scrollWheelZoom: false,
      }).setView([lat, lon], 8);
      L.tileLayer(OSM_TILES, {
        opacity: 0.6,
        minZoom: 6,
        maxZoom: 14,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(this._map);

      const layerOptions = {
        tms: 1, opacity: 0.6, minZoom: 6, maxZoom: 14,
        bounds: MODEL_BOUNDS, maxNativeZoom: 10,
      };
      this._layerA = L.tileLayer("", layerOptions).addTo(this._map);
      this._layerB = L.tileLayer("", layerOptions).addTo(this._map);
      const card = this;
      this._layerSwitchInProgress = false;
      this._layerA.on("load", function () { card._switchLayers(); });
      this._layerB.on("load", function () { card._switchLayers(); });
      [this._layerA, this._layerB].forEach(function (layer) {
        const el = layer.getContainer();
        if (el) el.style.transition = "opacity .2s";
      });

      L.marker([lat, lon], {
        icon: L.divIcon({
          className: "",
          html: '<span class="mr-pos"><span class="mr-pos-dot"></span></span>',
          iconSize: [26, 26],
        }),
        zIndexOffset: 1000,
        interactive: false,
      }).addTo(this._map);

      requestAnimationFrame(function () { card._map.invalidateSize(); });
      this._resizeObserver = new ResizeObserver(function () {
        if (card._map) card._map.invalidateSize();
      });
      this._resizeObserver.observe(container);
    }

    /* Two cross-fading tile layers, ported from s/js/map.js switchLayers().
       Leaflet owns the container opacity, so fade via setOpacity (the CSS
       transition set on the containers animates it). */
    _switchLayers() {
      if (!this._layerSwitchInProgress) return;
      this._layerSwitchInProgress = false;
      const previous = this._layerA;
      this._layerA = this._layerB;
      this._layerB = previous;
      const hide = this._layerB;
      this._layerA.setOpacity(0.6);
      setTimeout(function () { hide.setOpacity(0); }, 200);
    }

    _showFrame(timeoffset) {
      const nowcasting = this._data.nowcasting || {};
      const start = Number(nowcasting.timestamp_start) || 0;
      const times = this._root.querySelectorAll(".mr-timeline .time");
      times.forEach(function (el) {
        el.classList.toggle("active", Number(el.dataset.timeoffset) === Number(timeoffset));
      });
      const active = this._root.querySelector(
        '.mr-timeline .time[data-timeoffset="' + timeoffset + '"]'
      );
      const title = this._root.querySelector(".mr-map-title");
      if (title && active) title.textContent = active.dataset.label || "";
      if (!this._layerB) return;
      this._layerB.setUrl("");
      this._layerSwitchInProgress = true;
      this._layerB.setUrl(
        NOWCAST_TILES + "/result_" + timeoffset + "/{z}/{x}/{y}.png?rev=" + start
      );
    }

    _buildTimeline(timeline) {
      const nowcasting = this._data.nowcasting || {};
      this._nowcastStart = Number(nowcasting.timestamp_start) || 0;
      const card = this;
      const times = this._root.querySelector(".mr-timeline .times");
      const str = this._str;
      times.innerHTML = timeline.maptimes
        .map(function (t) {
          const cls =
            (t.past && !t.now ? " past" : "") + (t.now ? " now active" : "");
          return (
            '<div class="time' + cls + '" data-timeoffset="' + esc(t.timeoffset) +
            '" data-label="' + esc(t.label || t.title) + '">' + esc(t.title) +
            (t.now ? '<span class="nowlbl">' + esc(str.now) + "</span>" : "") +
            "</div>"
          );
        })
        .join("");
      times.querySelectorAll(".time").forEach(function (el) {
        el.addEventListener("click", function () {
          card._showFrame(Number(el.dataset.timeoffset));
        });
      });
      this._updateTimelineInfo(timeline);
      this._clickActiveFrame();
    }

    _updateTimelineInfo(timeline) {
      const info = this._root.querySelector(".mr-timeline-info");
      if (!info) return;
      let html = "";
      if (timeline.nextupdatestr) html += "<div>" + esc(timeline.nextupdatestr) + "</div>";
      if (timeline.radarscountstr) html += "<div>" + esc(timeline.radarscountstr) + "</div>";
      if (timeline.radars) html += '<div class="radars">' + esc(timeline.radars) + "</div>";
      info.innerHTML = html;
    }

    /* Active frame -> last past frame -> first frame (site behavior). */
    _clickActiveFrame() {
      const times = this._root.querySelectorAll(".mr-timeline .time");
      if (!times.length) return;
      let target = this._root.querySelector(".mr-timeline .time.now");
      if (!target) {
        const past = this._root.querySelectorAll(".mr-timeline .time.past");
        if (past.length) target = past[past.length - 1];
      }
      if (!target) target = times[0];
      this._showFrame(Number(target.dataset.timeoffset));
    }

    _playPause() {
      const btn = this._root.querySelector(".mr-play ha-icon");
      if (this._playing) {
        this._playing = false;
        clearTimeout(this._playTimer);
        if (btn) btn.setAttribute("icon", "mdi:play");
      } else {
        this._playing = true;
        if (btn) btn.setAttribute("icon", "mdi:pause");
        this._playStep();
      }
    }

    /* 2s per frame, 6s dwell before wrapping from the last frame (site timing). */
    _playStep() {
      if (!this._playing) return;
      const card = this;
      const times = Array.prototype.slice.call(
        this._root.querySelectorAll(".mr-timeline .time")
      );
      if (!times.length) return;
      let delay = 2000;
      const activeIndex = times.findIndex(function (el) {
        return el.classList.contains("active");
      });
      let next = activeIndex + 1;
      if (next === times.length - 1) delay = 6000;
      if (next >= times.length) next = 0;
      this._showFrame(Number(times[next].dataset.timeoffset));
      this._playTimer = setTimeout(function () { card._playStep(); }, delay);
    }

    /* ── satellite ── */

    _renderSatellite() {
      const host = this._root.querySelector(".mrs-satellite");
      const url = this._data.sat24url;
      if (!url) {
        host.innerHTML = "";
        return;
      }
      let img = host.querySelector("img");
      if (!img) {
        host.innerHTML = '<div class="mr-sat"><img alt="' + esc(this._str.satellite) + '" /></div>';
        img = host.querySelector("img");
      }
      if (img.getAttribute("src") !== url) img.setAttribute("src", url);
    }

    disconnectedCallback() {
      this._playing = false;
      clearTimeout(this._playTimer);
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      if (this._map) {
        this._map.remove();
        this._map = null;
      }
      this._mapPending = false;
      this._leafletStyleInjected = false;
      this._root = null;
      this._dataVersion = null;
    }
  }

  /* ── visual card editor (ha-form based) ── */

  const EDITOR_LABELS = {
    en: {
      entity: "Weather entity",
      dark_mode: "Appearance",
      show_current: "Current weather",
      show_nowcast: "Rain next 30 minutes",
      show_forecast: "Daily / hourly forecast",
      show_map: "Nowcasting radar map",
      show_satellite: "Satellite image",
      auto: "Auto (follow theme)",
      on: "Dark",
      off: "Light",
      tap_action: "Tap action",
      hold_action: "Hold action",
    },
    bg: {
      entity: "Weather обект",
      dark_mode: "Изглед",
      show_current: "Текущо време",
      show_nowcast: "Валежи следващите 30 минути",
      show_forecast: "Прогноза по дни и часове",
      show_map: "Радарна карта (nowcasting)",
      show_satellite: "Сателитно изображение",
      auto: "Автоматично (според темата)",
      on: "Тъмен",
      off: "Светъл",
      tap_action: "Действие при докосване",
      hold_action: "Действие при задържане",
    },
  };

  const SECTION_KEYS = {
    show_current: "current",
    show_nowcast: "nowcast",
    show_forecast: "forecast",
    show_map: "map",
    show_satellite: "satellite",
  };

  class MeteorocksCardEditor extends HTMLElement {
    setConfig(config) {
      this._config = config || {};
      this._renderForm();
    }

    set hass(hass) {
      this._hass = hass;
      this._renderForm();
    }

    get _labels() {
      const lang = this._hass && this._hass.language && this._hass.language.startsWith("bg") ? "bg" : "en";
      return EDITOR_LABELS[lang];
    }

    _formData() {
      const sections = Object.assign(
        { current: true, nowcast: true, forecast: true, map: true, satellite: true },
        (this._config && this._config.sections) || {}
      );
      const mode = this._config.dark_mode;
      const darkMode =
        mode === true || mode === "on" || mode === "true"
          ? "on"
          : mode === false || mode === "off" || mode === "false"
            ? "off"
            : "auto";
      const data = { entity: this._config.entity || "", dark_mode: darkMode };
      if (this._config.tap_action) data.tap_action = this._config.tap_action;
      if (this._config.hold_action) data.hold_action = this._config.hold_action;
      for (const formKey in SECTION_KEYS) data[formKey] = sections[SECTION_KEYS[formKey]];
      return data;
    }

    _schema() {
      const labels = this._labels;
      return [
        {
          name: "entity",
          required: true,
          selector: { entity: { filter: [{ integration: "meteorocks", domain: "weather" }] } },
        },
        {
          name: "dark_mode",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "auto", label: labels.auto },
                { value: "on", label: labels.on },
                { value: "off", label: labels.off },
              ],
            },
          },
        },
        {
          name: "",
          type: "grid",
          schema: Object.keys(SECTION_KEYS).map(function (formKey) {
            return { name: formKey, selector: { boolean: {} } };
          }),
        },
        {
          name: "tap_action",
          selector: { ui_action: { default_action: "more-info" } },
        },
        {
          name: "hold_action",
          selector: { ui_action: { default_action: "none" } },
        },
      ];
    }

    _renderForm() {
      if (!this._config) return;
      if (!this._form) {
        this._form = document.createElement("ha-form");
        const editor = this;
        this._form.computeLabel = function (schema) {
          return editor._labels[schema.name] || schema.name;
        };
        this._form.addEventListener("value-changed", function (ev) {
          editor._valueChanged(ev.detail.value);
        });
        this.appendChild(this._form);
      }
      if (this._hass) this._form.hass = this._hass;
      this._form.data = this._formData();
      this._form.schema = this._schema();
    }

    _valueChanged(value) {
      const sections = {};
      for (const formKey in SECTION_KEYS) sections[SECTION_KEYS[formKey]] = value[formKey] !== false;
      const config = Object.assign({}, this._config, {
        entity: value.entity,
        dark_mode: value.dark_mode || "auto",
        sections: sections,
      });
      delete config.tap_action;
      delete config.hold_action;
      if (value.tap_action) config.tap_action = value.tap_action;
      if (value.hold_action) config.hold_action = value.hold_action;
      if (JSON.stringify(config) === JSON.stringify(this._config)) return;
      this._config = config;
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: config },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  customElements.define("meteorocks-card", MeteorocksCard);
  customElements.define("meteorocks-card-editor", MeteorocksCardEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "meteorocks-card",
    name: "Meteo.rocks",
    description: "meteo.rocks forecast: current conditions, nowcasting, forecast, radar map, satellite",
    preview: true,
    documentationURL: "https://github.com/moninaydenov/homeassistant-meteorocks",
  });
})();
