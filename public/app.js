const state = { coin: null };

function $(selector) {
  return document.querySelector(selector);
}

function setHtml(selector, html) {
  $(selector).innerHTML = html;
}

function fmt(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function probabilityLabel(value) {
  const probability = Number(value || 0);
  if (probability === 0) return "0";
  if (probability < 0.001) return probability.toExponential(4);
  return probability.toFixed(6);
}

function decimalProbabilityLabel(value) {
  return Number(value || 0).toFixed(15);
}

function percentLabel(value) {
  return `${(Number(value || 0) * 100).toFixed(6)}%`;
}

function metric(label, value, note = "") {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong>${note ? `<p>${note}</p>` : ""}</article>`;
}

function svgEl(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function chartBox(svg) {
  const width = svg.clientWidth || 600;
  const height = svg.clientHeight || 320;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";
  return { width, height, left: 52, right: 18, top: 24, bottom: 42 };
}

function scale(value, inputMin, inputMax, outputMin, outputMax) {
  if (inputMax === inputMin) return (outputMin + outputMax) / 2;
  return outputMin + ((value - inputMin) / (inputMax - inputMin)) * (outputMax - outputMin);
}

function drawAxes(svg, box, xTicks = 4, yTicks = 4) {
  const x0 = box.left;
  const y0 = box.height - box.bottom;
  const x1 = box.width - box.right;
  const y1 = box.top;
  svg.appendChild(svgEl("line", { class: "axis", x1: x0, y1: y0, x2: x1, y2: y0 }));
  svg.appendChild(svgEl("line", { class: "axis", x1: x0, y1: y0, x2: x0, y2: y1 }));
  for (let index = 1; index <= yTicks; index += 1) {
    const y = scale(index, 0, yTicks, y0, y1);
    svg.appendChild(svgEl("line", { class: "grid-line", x1: x0, y1: y, x2: x1, y2: y }));
  }
  for (let index = 1; index <= xTicks; index += 1) {
    const x = scale(index, 0, xTicks, x0, x1);
    svg.appendChild(svgEl("line", { class: "grid-line", x1: x, y1: y0, x2: x, y2: y1 }));
  }
}

function renderMetrics() {
  if (!state.coin) return;
  setHtml("#coin-metrics", [
    metric("Heads in one run", fmt(state.coin.single_heads), `${fmt(state.coin.single_tails)} tails`),
    metric("Monte Carlo estimate", probabilityLabel(state.coin.simulation_probability), `${fmt(state.coin.simulation_successes)} hits`),
    metric("Exact probability", decimalProbabilityLabel(state.coin.exact_probability), percentLabel(state.coin.exact_probability)),
    metric("Continuity-corrected z", state.coin.z_score.toFixed(3), `threshold > ${fmt(state.coin.threshold)}`),
  ].join(""));
}

function renderOutcome() {
  const svg = $("#coin-outcome-chart");
  const box = chartBox(svg);
  drawAxes(svg, box, 0, 4);
  if (!state.coin) return;
  const values = [
    ["Heads", state.coin.single_heads, "#2868c7"],
    ["Tails", state.coin.single_tails, "#15835b"],
  ];
  const max = Math.max(...values.map((item) => item[1]), 1);
  const baseline = box.height - box.bottom;
  const groupWidth = (box.width - box.left - box.right) / values.length;
  values.forEach(([label, value, color], index) => {
    const height = scale(value, 0, max, 0, baseline - box.top);
    const x = box.left + index * groupWidth + groupWidth * 0.2;
    const y = baseline - height;
    svg.appendChild(svgEl("rect", { x, y, width: groupWidth * 0.6, height, rx: 5, fill: color, opacity: 0.9 }));
    const name = svgEl("text", { class: "label", x: x + groupWidth * 0.3, y: baseline + 24, "text-anchor": "middle" });
    name.textContent = label;
    svg.appendChild(name);
    const valueLabel = svgEl("text", { class: "label", x: x + groupWidth * 0.3, y: Math.max(box.top + 16, y - 8), "text-anchor": "middle" });
    valueLabel.textContent = fmt(value);
    svg.appendChild(valueLabel);
  });
}

function renderDistribution() {
  const svg = $("#coin-distribution-chart");
  const box = chartBox(svg);
  drawAxes(svg, box, 4, 4);
  if (!state.coin?.histogram?.length) return;
  const bins = state.coin.histogram;
  const min = bins[0].start;
  const max = bins[bins.length - 1].end;
  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  const baseline = box.height - box.bottom;
  const barWidth = Math.max(3, (box.width - box.left - box.right) / bins.length - 2);
  bins.forEach((bin) => {
    const x = scale(bin.heads, min, max, box.left, box.width - box.right) - barWidth / 2;
    const height = scale(bin.count, 0, maxCount, 0, baseline - box.top);
    svg.appendChild(svgEl("rect", { x, y: baseline - height, width: barWidth, height, fill: "#2868c7", opacity: 0.78 }));
  });
  const thresholdX = scale(state.coin.threshold, min, max, box.left, box.width - box.right);
  svg.appendChild(svgEl("line", { x1: thresholdX, y1: box.top, x2: thresholdX, y2: baseline, stroke: "#c64242", "stroke-width": 2, "stroke-dasharray": "5 4" }));
  const label = svgEl("text", { class: "label", x: Math.min(thresholdX + 6, box.width - 145), y: box.top + 15 });
  label.textContent = `threshold ${fmt(state.coin.threshold)}`;
  svg.appendChild(label);
  const xLabel = svgEl("text", { class: "label", x: box.width - 155, y: box.height - 10 });
  xLabel.textContent = "Heads per experiment";
  svg.appendChild(xLabel);
}

function renderComparison() {
  const svg = $("#coin-comparison-chart");
  const box = chartBox(svg);
  drawAxes(svg, box, 0, 4);
  if (!state.coin) return;
  const values = [
    ["Exact", state.coin.exact_probability, "#2868c7"],
    ["CLT", state.coin.clt_probability, "#744db4"],
    ["Monte Carlo", state.coin.simulation_probability, "#15835b"],
  ];
  const max = Math.max(...values.map((item) => item[1]), state.coin.exact_probability * 1.2, 0.000001);
  const baseline = box.height - box.bottom;
  const groupWidth = (box.width - box.left - box.right) / values.length;
  values.forEach(([label, value, color], index) => {
    const height = value ? scale(value, 0, max, 0, baseline - box.top) : 0;
    const x = box.left + index * groupWidth + groupWidth * 0.2;
    svg.appendChild(svgEl("rect", { x, y: baseline - height, width: groupWidth * 0.6, height: Math.max(height, value ? 2 : 0), rx: 5, fill: color, opacity: 0.9 }));
    const name = svgEl("text", { class: "label", x: x + groupWidth * 0.3, y: baseline + 24, "text-anchor": "middle" });
    name.textContent = label;
    svg.appendChild(name);
    const valueLabel = svgEl("text", { class: "label", x: x + groupWidth * 0.3, y: Math.max(box.top + 16, baseline - height - 8), "text-anchor": "middle" });
    valueLabel.textContent = probabilityLabel(value);
    svg.appendChild(valueLabel);
  });
}

function renderTheory() {
  if (!state.coin) return;
  const rarityNote = state.coin.expected_successes < 10
    ? `At this experiment count, the exact value expects only ${state.coin.expected_successes.toFixed(2)} hits, so the Monte Carlo estimate will be noisy.`
    : `The exact value expects about ${state.coin.expected_successes.toLocaleString()} hits at this experiment count.`;
  setHtml("#coin-formula", `
    <div class="formula-block">
      <strong>X ~ Binomial(${fmt(state.coin.flips)}, 0.5)</strong>
      <span>mu = np = ${fmt(state.coin.theoretical_mean)}</span>
      <span>sigma = sqrt(npq) = ${state.coin.theoretical_std_dev.toFixed(2)}</span>
      <span>z = (${fmt(state.coin.threshold)} + 0.5 - mu) / sigma = ${state.coin.z_score.toFixed(3)}</span>
      <strong>Exact P(X &gt; ${fmt(state.coin.threshold)}) = ${decimalProbabilityLabel(state.coin.exact_probability)}</strong>
      <span>CLT approximation = ${decimalProbabilityLabel(state.coin.clt_probability)}</span>
      <span>CLT absolute error = ${decimalProbabilityLabel(state.coin.clt_absolute_error)}</span>
    </div>
    <p class="theory-note">${rarityNote}</p>
  `);
}

function renderReadout() {
  if (!state.coin) return;
  setHtml("#coin-readout", [
    `<div class="readout-item"><strong>${fmt(state.coin.sample_mean)}</strong><span>Simulated mean heads</span><em>theory ${fmt(state.coin.theoretical_mean)}</em></div>`,
    `<div class="readout-item"><strong>${state.coin.sample_std_dev.toFixed(2)}</strong><span>Simulated standard deviation</span><em>theory ${state.coin.theoretical_std_dev.toFixed(2)}</em></div>`,
    `<div class="readout-item"><strong>${decimalProbabilityLabel(state.coin.exact_probability)}</strong><span>Exact binomial probability</span><em>reference value</em></div>`,
    `<div class="readout-item"><strong>${probabilityLabel(state.coin.simulation_ci95_low)} - ${probabilityLabel(state.coin.simulation_ci95_high)}</strong><span>Simulation 95% interval</span><em>${fmt(state.coin.simulation_successes)} hits</em></div>`,
  ].join(""));
}

function renderAll() {
  renderMetrics();
  renderOutcome();
  renderDistribution();
  renderComparison();
  renderTheory();
  renderReadout();
}

function coinUrl(seed = "") {
  const params = new URLSearchParams({
    flips: $("#coin-flips").value,
    experiments: $("#coin-experiments").value,
    threshold: $("#coin-threshold").value,
  });
  if (seed) params.set("seed", seed);
  return `/api/coin-flips?${params.toString()}`;
}

async function loadCoin(seed = "20260701") {
  const response = await fetch(coinUrl(seed));
  if (!response.ok) throw new Error("Unable to load simulation");
  state.coin = await response.json();
  renderAll();
}

async function runSimulation() {
  const button = $("#coin-run");
  button.disabled = true;
  button.textContent = "Running...";
  try {
    await loadCoin(String(Date.now()));
  } finally {
    button.disabled = false;
    button.textContent = "Run simulation";
  }
}

$("#coin-run").addEventListener("click", runSimulation);
$("#coin-flips").addEventListener("input", () => {
  $("#coin-threshold").max = $("#coin-flips").value;
});
window.addEventListener("resize", () => requestAnimationFrame(renderAll));
loadCoin().catch((error) => {
  setHtml("#coin-formula", `<p class="error-message">${error.message}</p>`);
});
