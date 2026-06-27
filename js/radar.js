// radar.js — dependency-free SVG "radar sweep" renderer for the
// Live-ops Deconfliction Radar. Pure DOM/SVG (createElementNS), no libraries.
//
// Public API:
//   renderRadar(svgElement, model, options)
//     model   = RadarModel { initiatives:[{id,name,size,riskScore,riskBand}],
//                            links:[{id,source,target,sharedPlayers,overlapFraction,
//                                    impact,windowDays,overlapStart,overlapEnd}] }
//     options = { threshold:number(0..1),
//                 onSelectLink?:(link)=>void,
//                 onSelectInitiative?:(init)=>void }
//
// Rendering is idempotent: the svg's children are cleared on every call.
// All styling lives in radar.css (class names documented there). This module
// only assigns classes / minimal geometry attributes.

const SVG_NS = "http://www.w3.org/2000/svg";

// Logical canvas — consumers scale via the viewBox, never fixed px.
const VIEW = 1000;
const CENTER = VIEW / 2;
const OUTER_R = 440; // rim radius (the "None/clear" ring edge)

// Risk bands ordered from center (highest risk) outward.
// Each band owns a radial slot; blips sit at the slot's mid-radius.
const BANDS = ["High", "Medium", "Low", "None"];
const BAND_LABEL = {
  High: "High",
  Medium: "Medium",
  Low: "Low",
  None: "None / clear",
};

// Blip size clamps (logical units).
const BLIP_MIN = 9;
const BLIP_MAX = 26;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function el(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  if (attrs) {
    for (const k in attrs) {
      if (attrs[k] != null) node.setAttribute(k, String(attrs[k]));
    }
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Stable initiative order by id so angles never jump between renders.
function orderInitiatives(initiatives) {
  return [...initiatives].sort((a, b) =>
    String(a.id).localeCompare(String(b.id))
  );
}

// Map a band to the mid-radius of its ring slot.
// Inner edge of band i is at radius step*i, outer at step*(i+1).
function bandRadius(band) {
  const i = Math.max(0, BANDS.indexOf(band));
  const step = OUTER_R / BANDS.length;
  return step * i + step / 2;
}

// Distinct enrolled-player size -> blip radius (sqrt for area-ish scaling).
function blipRadius(size, maxSize) {
  if (!maxSize || maxSize <= 0) return BLIP_MIN;
  const t = Math.sqrt(clamp(size, 0, maxSize) / maxSize);
  return BLIP_MIN + t * (BLIP_MAX - BLIP_MIN);
}

function impactClass(impact) {
  switch (impact) {
    case "High":
      return "radar-link--high";
    case "Medium":
      return "radar-link--medium";
    default:
      return "radar-link--low";
  }
}

// Compute each initiative's screen position. Returns Map id -> {x,y,r,init,angle}.
function layout(initiatives) {
  const ordered = orderInitiatives(initiatives);
  const n = ordered.length || 1;
  const maxSize = ordered.reduce((m, it) => Math.max(m, it.size || 0), 0);
  const pos = new Map();
  ordered.forEach((init, idx) => {
    // Even angular distribution; start at top (-90deg) and go clockwise.
    const angle = -Math.PI / 2 + (idx / n) * Math.PI * 2;
    const r = bandRadius(init.riskBand);
    pos.set(init.id, {
      init,
      angle,
      r,
      x: CENTER + r * Math.cos(angle),
      y: CENTER + r * Math.sin(angle),
      blipR: blipRadius(init.size || 0, maxSize),
    });
  });
  return pos;
}

function buildDefs() {
  const defs = el("defs");

  // Sweep gradient (a faint rotating beam). Animation lives in CSS so it can
  // respect prefers-reduced-motion; here we just define the paint.
  const grad = el("linearGradient", {
    id: "radar-sweep-grad",
    x1: "0",
    y1: "0",
    x2: "1",
    y2: "0",
  });
  grad.appendChild(el("stop", { offset: "0%", "stop-color": "var(--radar-sweep, #4d9fff)", "stop-opacity": "0" }));
  grad.appendChild(el("stop", { offset: "100%", "stop-color": "var(--radar-sweep, #4d9fff)", "stop-opacity": "0.28" }));
  defs.appendChild(grad);
  return defs;
}

function buildBackground() {
  const g = el("g", { class: "radar-bg", "aria-hidden": "true" });
  const step = OUTER_R / BANDS.length;

  // Concentric ring per band (outer edge of each slot), labelled.
  BANDS.forEach((band, i) => {
    const ringR = step * (i + 1);
    g.appendChild(
      el("circle", {
        class: `radar-ring radar-ring--${band.toLowerCase()}`,
        cx: CENTER,
        cy: CENTER,
        r: ringR,
      })
    );
    // Band label along the top vertical axis, just inside the ring edge.
    const label = el("text", {
      class: "radar-ring-label",
      x: CENTER + 6,
      y: CENTER - (ringR - step / 2),
      "text-anchor": "start",
      "dominant-baseline": "middle",
    });
    label.textContent = BAND_LABEL[band];
    g.appendChild(label);
  });

  // Faint radial grid spokes.
  const spokes = 12;
  for (let s = 0; s < spokes; s++) {
    const a = (s / spokes) * Math.PI * 2;
    g.appendChild(
      el("line", {
        class: "radar-spoke",
        x1: CENTER,
        y1: CENTER,
        x2: CENTER + OUTER_R * Math.cos(a),
        y2: CENTER + OUTER_R * Math.sin(a),
      })
    );
  }

  // Rotating sweep wedge (a triangle from center to rim). CSS animates rotation.
  const sweep = el("path", {
    class: "radar-sweep",
    d: `M ${CENTER} ${CENTER} L ${CENTER + OUTER_R} ${CENTER} A ${OUTER_R} ${OUTER_R} 0 0 1 ${CENTER + OUTER_R * Math.cos(-0.5)} ${CENTER + OUTER_R * Math.sin(-0.5)} Z`,
    fill: "url(#radar-sweep-grad)",
  });
  g.appendChild(sweep);

  return g;
}

function buildLinks(model, pos, threshold, onSelectLink) {
  const g = el("g", { class: "radar-links" });
  const visibleByInit = new Set();
  let visibleCount = 0;
  let hiddenCount = 0;

  (model.links || []).forEach((link) => {
    const a = pos.get(link.source);
    const b = pos.get(link.target);
    if (!a || !b) return;

    const visible = (link.overlapFraction || 0) >= threshold;
    if (!visible) {
      hiddenCount++;
      return; // hidden links are not drawn at all
    }
    visibleCount++;
    visibleByInit.add(link.source);
    visibleByInit.add(link.target);

    const frac = clamp(link.overlapFraction || 0, 0, 1);
    const path = el("path", {
      class: `radar-link ${impactClass(link.impact)}`,
      d: `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} Q ${CENTER} ${CENTER} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
      // Width 1.5..7 and opacity 0.25..0.9 scale with overlap fraction.
      "stroke-width": (1.5 + frac * 5.5).toFixed(2),
      "stroke-opacity": (0.25 + frac * 0.65).toFixed(2),
      fill: "none",
      tabindex: "0",
      role: "button",
      "data-link-id": link.id,
      "aria-label": `Link ${a.init.name} to ${b.init.name}, overlap ${Math.round(frac * 100)} percent, impact ${link.impact}`,
    });
    const title = el("title");
    title.textContent = `${a.init.name} ↔ ${b.init.name} — ${Math.round(frac * 100)}% overlap (${link.impact})`;
    path.appendChild(title);

    if (typeof onSelectLink === "function") {
      const fire = () => onSelectLink(link);
      path.addEventListener("click", fire);
      path.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fire();
        }
      });
    }
    g.appendChild(path);
  });

  return { node: g, visibleByInit, visibleCount, hiddenCount };
}

function buildBlips(pos, visibleByInit, onSelectInitiative) {
  const g = el("g", { class: "radar-blips" });

  // Render in stable id order for deterministic DOM.
  const entries = [...pos.values()].sort((a, b) =>
    String(a.init.id).localeCompare(String(b.init.id))
  );

  entries.forEach(({ init, x, y, blipR }) => {
    const dimmed = !visibleByInit.has(init.id);
    const cls = [
      "radar-blip",
      `radar-blip--${(init.riskBand || "none").toLowerCase()}`,
      dimmed ? "is-dimmed" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const grp = el("g", {
      class: cls,
      tabindex: "0",
      role: "button",
      "data-init-id": init.id,
      "aria-label": `${init.name}, risk ${init.riskBand}, ${init.size} players`,
    });

    grp.appendChild(
      el("circle", { class: "radar-blip-dot", cx: x.toFixed(2), cy: y.toFixed(2), r: blipR.toFixed(2) })
    );
    // Subtle ping ring for non-dimmed blips (CSS-animated, motion-guarded).
    if (!dimmed) {
      grp.appendChild(
        el("circle", {
          class: "radar-blip-ping",
          cx: x.toFixed(2),
          cy: y.toFixed(2),
          r: blipR.toFixed(2),
        })
      );
    }

    // Label below the blip; nudged outward to reduce collisions with rings.
    const label = el("text", {
      class: "radar-blip-label",
      x: x.toFixed(2),
      y: (y + blipR + 16).toFixed(2),
      "text-anchor": "middle",
    });
    label.textContent = init.name;
    grp.appendChild(label);

    const title = el("title");
    title.textContent = `${init.name} — ${init.riskBand} risk, ${init.size} players`;
    grp.appendChild(title);

    if (typeof onSelectInitiative === "function") {
      const fire = () => onSelectInitiative(init);
      grp.addEventListener("click", fire);
      grp.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fire();
        }
      });
    }
    g.appendChild(grp);
  });

  return g;
}

/**
 * Render a radar scope into an <svg> element.
 * @param {SVGSVGElement} svgElement target svg (its children are cleared first)
 * @param {object} model RadarModel
 * @param {object} [options] { threshold, onSelectLink, onSelectInitiative }
 * @returns {{blips:number, visibleLinks:number, hiddenLinks:number}} render stats
 */
export function renderRadar(svgElement, model, options = {}) {
  if (!svgElement) throw new Error("renderRadar: svgElement is required");
  const safeModel = {
    initiatives: (model && model.initiatives) || [],
    links: (model && model.links) || [],
  };
  const threshold = clamp(
    typeof options.threshold === "number" ? options.threshold : 0,
    0,
    1
  );

  // Idempotent re-render.
  clear(svgElement);
  svgElement.setAttribute("viewBox", `0 0 ${VIEW} ${VIEW}`);
  svgElement.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svgElement.setAttribute("class", "radar-svg");
  svgElement.setAttribute("role", "img");
  svgElement.setAttribute(
    "aria-label",
    `Radar scope: ${safeModel.initiatives.length} initiatives, threshold ${Math.round(threshold * 100)} percent`
  );

  const pos = layout(safeModel.initiatives);

  svgElement.appendChild(buildDefs());
  svgElement.appendChild(buildBackground());

  const links = buildLinks(safeModel, pos, threshold, options.onSelectLink);
  svgElement.appendChild(links.node);

  svgElement.appendChild(
    buildBlips(pos, links.visibleByInit, options.onSelectInitiative)
  );

  return {
    blips: pos.size,
    visibleLinks: links.visibleCount,
    hiddenLinks: links.hiddenCount,
  };
}

export default renderRadar;
