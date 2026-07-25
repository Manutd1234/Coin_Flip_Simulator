const state = {
  players: [],
  playerSource: "",
  sentiment: null,
  coin: null,
  status: null,
  liveTimer: null,
};

const colors = ["#2868c7", "#15835b", "#bc7c19", "#744db4", "#14858a", "#c64242"];
const sentimentColors = { positive: "#15835b", neutral: "#2868c7", negative: "#c64242" };

function $(selector) {
  return document.querySelector(selector);
}

function setHtml(selector, html) {
  $(selector).innerHTML = html;
}

function fmt(value, suffix = "") {
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`;
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function chartBox(svg) {
  const width = svg.clientWidth || 600;
  const height = svg.clientHeight || 320;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";
  return { width, height, left: 48, right: 18, top: 22, bottom: 38 };
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
  for (let i = 1; i <= yTicks; i += 1) {
    const y = scale(i, 0, yTicks, y0, y1);
    svg.appendChild(svgEl("line", { class: "grid-line", x1: x0, y1: y, x2: x1, y2: y }));
  }
  for (let i = 1; i <= xTicks; i += 1) {
    const x = scale(i, 0, xTicks, x0, x1);
    svg.appendChild(svgEl("line", { class: "grid-line", x1: x, y1: y0, x2: x, y2: y1 }));
  }
}

function metric(label, value, note = "") {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong>${note ? `<p>${note}</p>` : ""}</article>`;
}

function initTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.tab}-panel`).classList.add("active");
      requestAnimationFrame(renderAll);
    });
  });
}

function probabilityLabel(value) {
  const probability = Number(value || 0);
  if (probability === 0) return "0";
  if (probability < 0.001) return probability.toExponential(2);
  return probability.toFixed(4);
}

function percentLabel(value) {
  return `${(Number(value || 0) * 100).toFixed(Number(value || 0) < 0.001 ? 4 : 2)}%`;
}

function populateFilters() {
  const positions = ["All positions", ...new Set(state.players.map((player) => player.position))];
  const styles = ["All styles", ...new Set(state.players.map((player) => player.style))];
  setHtml("#position-filter", positions.map((item) => `<option>${item}</option>`).join(""));
  setHtml("#style-filter", styles.map((item) => `<option>${item}</option>`).join(""));
  setHtml("#player-focus", [
    `<option value="">Auto top match</option>`,
    ...state.players
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((player) => `<option value="${escapeAttr(player.name)}">${player.name}</option>`),
  ].join(""));
  ["#player-search", "#position-filter", "#style-filter", "#player-focus"].forEach((selector) => {
    $(selector).addEventListener("input", renderPlayers);
  });
  $("#sentiment-window").addEventListener("input", renderSentiment);
  $("#match-query").addEventListener("change", refreshSentiment);
}

function escapeAttr(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function playerFallbackUrl(player) {
  return player.fallback_image_url || `/api/player-face?name=${encodeURIComponent(player.name)}&position=${encodeURIComponent(player.position || "")}`;
}

function playerImageUrl(player) {
  return player.image_url || playerFallbackUrl(player);
}

function playerImageTag(player, className) {
  const src = escapeAttr(playerImageUrl(player));
  const fallback = escapeAttr(playerFallbackUrl(player));
  return `<img class="${className}" src="${src}" alt="${escapeAttr(player.name)} face" loading="lazy" onerror="this.onerror=null;this.src='${fallback}'" />`;
}

function filteredPlayers() {
  const query = $("#player-search").value.trim().toLowerCase();
  const position = $("#position-filter").value;
  const style = $("#style-filter").value;
  return state.players.filter((player) => {
    const text = `${player.name} ${player.club} ${player.league} ${player.position} ${player.style}`.toLowerCase();
    return (!query || text.includes(query))
      && (position === "All positions" || player.position === position)
      && (style === "All styles" || player.style === style);
  });
}

function selectedPlayer(players) {
  const focused = $("#player-focus").value;
  if (focused) {
    return state.players.find((player) => player.name === focused) || players[0] || state.players[0];
  }
  return players.slice().sort((a, b) => b.contributions - a.contributions)[0] || state.players[0];
}

function renderStatus() {
  if (!state.status) return;
  const hasLive = state.status.x_bearer_token && state.status.sentiment_model.includes("Transformers");
  const status = $("#dashboard-status");
  status.classList.toggle("live", hasLive);
  status.classList.toggle("warn", !hasLive);
  const mode = hasLive ? "Live X API + Transformers" : "API hooks ready, demo fallback";
  status.innerHTML = `<span class="pulse"></span>${mode}`;
}

function renderPlayerMetrics(players) {
  const avgValue = players.length ? players.reduce((sum, player) => sum + player.market_value_m, 0) / players.length : 0;
  const goals = players.reduce((sum, player) => sum + player.goals, 0);
  const assists = players.reduce((sum, player) => sum + player.assists, 0);
  const styles = new Set(players.map((player) => player.style)).size;
  setHtml("#player-metrics", [
    metric("Players selected", players.length),
    metric("Goal contributions", goals + assists, `${goals} goals / ${assists} assists`),
    metric("Average value", `EUR ${fmt(avgValue, "M")}`, state.playerSource),
    metric("Style groups", styles, "KMeans-style clustering"),
  ].join(""));
}

function renderPlayerProfile(player) {
  if (!player) return;
  const pos = pitchPosition(player.position);
  setHtml("#player-profile", `
    <div class="profile-card">
      <div>
        <div class="player-avatar">${playerImageTag(player, "player-face")}</div>
        <div class="mini-pitch"><span class="position-dot" style="left:${pos.x}%; top:${pos.y}%"></span></div>
      </div>
      <div>
        <div class="player-title">
          <div>
            <h3>${player.name}</h3>
            <p>${player.position} / ${player.club}</p>
          </div>
          <span class="tag ${tagClass(player.style)}">${player.style}</span>
        </div>
        <div class="profile-facts">
          <div class="fact"><span>Age</span><strong>${player.age || "N/A"}</strong></div>
          <div class="fact"><span>League</span><strong>${player.league}</strong></div>
          <div class="fact"><span>Minutes</span><strong>${fmt(player.minutes)}</strong></div>
          <div class="fact"><span>Value</span><strong>EUR ${player.market_value_m}M</strong></div>
          <div class="fact"><span>Goals</span><strong>${player.goals}</strong></div>
          <div class="fact"><span>Assists</span><strong>${player.assists}</strong></div>
        </div>
      </div>
    </div>
  `);
}

function pitchPosition(position) {
  if (position.includes("Forward")) return { x: 48, y: 12 };
  if (position.includes("Winger")) return { x: 18, y: 22 };
  if (position.includes("Attacking")) return { x: 48, y: 29 };
  if (position.includes("Central")) return { x: 48, y: 48 };
  if (position.includes("Defensive")) return { x: 48, y: 63 };
  if (position.includes("Fullback")) return { x: 20, y: 70 };
  if (position.includes("Back")) return { x: 48, y: 76 };
  return { x: 48, y: 48 };
}

function renderAttributeBars(player) {
  if (!player) return;
  const maxValue = Math.max(...state.players.map((item) => item.market_value_m), 1);
  const attributes = [
    ["Finishing", Math.min(100, player.goals_per_90 * 150), "#2868c7"],
    ["Chance creation", Math.min(100, player.assists_per_90 * 170), "#15835b"],
    ["Discipline", Math.max(8, 100 - player.cards_per_90 * 190), "#bc7c19"],
    ["Workload", Math.min(100, player.minutes_per_match), "#744db4"],
    ["Market value", Math.min(100, player.market_value_m / maxValue * 100), "#14858a"],
  ];
  setHtml("#attribute-list", attributes.map(([label, value, color]) => `
    <div class="attribute-row">
      <div class="attribute-label"><span>${label}</span><strong>${Math.round(value)}</strong></div>
      <div class="attribute-track"><div class="attribute-fill" style="width:${value}%; background:${color}"></div></div>
    </div>
  `).join(""));
}

function renderClusterChart(players) {
  const svg = $("#cluster-chart");
  const box = chartBox(svg);
  drawAxes(svg, box);
  if (!players.length) return;
  const xValues = players.map((player) => player.x);
  const yValues = players.map((player) => player.y);
  const minX = Math.min(...xValues, 0);
  const maxX = Math.max(...xValues, 100);
  const minY = Math.min(...yValues, 0);
  const maxY = Math.max(...yValues, 100);
  const styles = [...new Set(state.players.map((player) => player.style))];

  players.forEach((player) => {
    const x = scale(player.x, minX, maxX, box.left, box.width - box.right);
    const y = scale(player.y, minY, maxY, box.height - box.bottom, box.top);
    const color = colors[styles.indexOf(player.style) % colors.length];
    const dot = svgEl("circle", { cx: x, cy: y, r: 6, fill: color, opacity: 0.86 });
    dot.appendChild(svgEl("title"));
    dot.querySelector("title").textContent = `${player.name}\n${player.style}\nG/90 ${player.goals_per_90}, A/90 ${player.assists_per_90}`;
    svg.appendChild(dot);
  });

  const xLabel = svgEl("text", { class: "label", x: box.width - 210, y: box.height - 8 });
  xLabel.textContent = "Finishing and creation profile";
  svg.appendChild(xLabel);
  const yLabel = svgEl("text", { class: "label", x: 8, y: 18 });
  yLabel.textContent = "Creativity / availability";
  svg.appendChild(yLabel);
}

function renderPlayerBars(players) {
  const svg = $("#player-bars");
  const box = chartBox(svg);
  drawAxes(svg, box, 0, 4);
  const top = [...players].sort((a, b) => b.contributions - a.contributions).slice(0, 8);
  const maxValue = Math.max(...top.map((player) => player.contributions), 1);
  const barHeight = Math.max(18, (box.height - box.top - box.bottom - 16) / Math.max(top.length, 1) - 9);
  top.forEach((player, index) => {
    const y = box.top + index * (barHeight + 9);
    const width = scale(player.contributions, 0, maxValue, 0, box.width - box.left - box.right - 110);
    svg.appendChild(svgEl("rect", { x: box.left + 100, y, width, height: barHeight, rx: 4, fill: colors[index % colors.length] }));
    const name = svgEl("text", { class: "label", x: box.left, y: y + barHeight * 0.68 });
    name.textContent = player.name.length > 13 ? `${player.name.slice(0, 12)}.` : player.name;
    svg.appendChild(name);
    const value = svgEl("text", { class: "label", x: box.left + 108 + width, y: y + barHeight * 0.68 });
    value.textContent = `${player.contributions} G+A`;
    svg.appendChild(value);
  });
}

function renderPlayerTable(players) {
  const rows = players
    .slice()
    .sort((a, b) => b.contributions - a.contributions)
    .map((player) => `
      <tr>
        <td>
          <div class="player-cell">
            ${playerImageTag(player, "table-face")}
            <div><strong>${player.name}</strong><br><span>${player.league}</span></div>
          </div>
        </td>
        <td>${player.club}</td>
        <td>${player.position}</td>
        <td><span class="tag ${tagClass(player.style)}">${player.style}</span></td>
        <td>${player.goals_per_90}</td>
        <td>${player.assists_per_90}</td>
        <td>${player.cards_per_90}</td>
        <td>EUR ${player.market_value_m}M</td>
      </tr>
    `)
    .join("");
  setHtml("#player-table", rows || `<tr><td colspan="8">No players match the current filters.</td></tr>`);
}

function tagClass(label) {
  if (label.includes("Goal")) return "blue";
  if (label.includes("Creative")) return "green";
  if (label.includes("Physical")) return "red";
  if (label.includes("High")) return "amber";
  return "violet";
}

function renderPlayers() {
  const players = filteredPlayers();
  const focus = selectedPlayer(players);
  renderPlayerMetrics(players);
  renderPlayerProfile(focus);
  renderAttributeBars(focus);
  renderClusterChart(players.length ? players : state.players);
  renderPlayerBars(players);
  renderPlayerTable(players);
}

function sentimentRows() {
  const data = state.sentiment?.timeline || [];
  const mode = $("#sentiment-window").value;
  const liveMinute = state.sentiment?.live_minute || 0;
  if (mode === "live") return data.filter((row) => row.minute <= liveMinute);
  if (mode === "last15") return data.filter((row) => row.minute >= Math.max(0, liveMinute - 15) && row.minute <= liveMinute);
  return data;
}

function sentimentSamples() {
  const samples = state.sentiment?.samples || [];
  const mode = $("#sentiment-window").value;
  const liveMinute = state.sentiment?.live_minute || 0;
  if (mode === "live") return samples.filter((row) => row.minute <= liveMinute);
  if (mode === "last15") return samples.filter((row) => row.minute >= Math.max(0, liveMinute - 15) && row.minute <= liveMinute);
  return samples;
}

function renderSentimentMetrics(rows) {
  const latest = rows.at(-1) || state.sentiment.timeline[0];
  const volume = rows.reduce((sum, row) => sum + row.volume, 0);
  const avgScore = rows.reduce((sum, row) => sum + row.score, 0) / Math.max(rows.length, 1);
  const top = mostCommon(rows, "top_player");
  setHtml("#sentiment-metrics", [
    metric("Live minute", `${state.sentiment.live_minute}'`, state.sentiment.source),
    metric("Posts tracked", fmt(volume), "Current dashboard window"),
    metric("Sentiment score", avgScore.toFixed(2), state.sentiment.model),
    metric("Most mentioned", top || "None", `Latest: ${latest?.top_hashtag || "#WorldCup"}`),
  ].join(""));
}

function renderSentimentLines(rows) {
  const svg = $("#sentiment-lines");
  const box = chartBox(svg);
  drawAxes(svg, box);
  if (!rows.length) return;
  const xMax = Math.max(...rows.map((row) => row.minute), 1);
  const series = [
    ["positive", "#15835b"],
    ["neutral", "#2868c7"],
    ["negative", "#c64242"],
  ];

  series.forEach(([key, color]) => {
    const points = rows.map((row) => {
      const x = scale(row.minute, 0, xMax, box.left, box.width - box.right);
      const y = scale(row[key], 0, 100, box.height - box.bottom, box.top);
      return `${x},${y}`;
    }).join(" ");
    svg.appendChild(svgEl("polyline", { points, fill: "none", stroke: color, "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  });

  state.sentiment.events.forEach((event) => {
    if (!rows.some((row) => row.minute === event.minute)) return;
    const x = scale(event.minute, 0, xMax, box.left, box.width - box.right);
    svg.appendChild(svgEl("line", { x1: x, y1: box.top, x2: x, y2: box.height - box.bottom, stroke: "#9aa7b9", "stroke-dasharray": "4 5" }));
    const label = svgEl("text", { class: "label", x: x + 4, y: box.top + 14 });
    label.textContent = event.label;
    svg.appendChild(label);
  });

  const legend = [
    ["Positive", "#15835b"],
    ["Neutral", "#2868c7"],
    ["Negative", "#c64242"],
  ];
  legend.forEach(([label, color], index) => {
    const x = box.left + index * 96;
    svg.appendChild(svgEl("circle", { cx: x, cy: box.height - 10, r: 5, fill: color }));
    const text = svgEl("text", { class: "label", x: x + 10, y: box.height - 6 });
    text.textContent = label;
    svg.appendChild(text);
  });
}

function renderVolumeBars(rows) {
  const svg = $("#volume-bars");
  const box = chartBox(svg);
  drawAxes(svg, box, 4, 4);
  if (!rows.length) return;
  const maxVolume = Math.max(...rows.map((row) => row.volume), 1);
  const barWidth = Math.max(2, (box.width - box.left - box.right) / rows.length - 1);
  rows.forEach((row) => {
    const x = scale(row.minute, rows[0].minute, rows.at(-1).minute || rows[0].minute + 1, box.left, box.width - box.right);
    const height = scale(row.volume, 0, maxVolume, 0, box.height - box.top - box.bottom);
    const y = box.height - box.bottom - height;
    const color = row.score > 0.12 ? "#15835b" : row.score < -0.12 ? "#c64242" : "#2868c7";
    svg.appendChild(svgEl("rect", { x, y, width: barWidth, height, fill: color, opacity: 0.86 }));
  });
}

function renderSentimentScatter(samples) {
  const svg = $("#sentiment-scatter");
  const box = chartBox(svg);
  drawAxes(svg, box);
  if (!samples.length) return;
  const maxMinute = Math.max(...samples.map((row) => row.minute), 1);
  const maxLikes = Math.max(...samples.map((row) => row.likes), 10);
  samples.slice(-350).forEach((row) => {
    const x = scale(row.minute, 0, maxMinute, box.left, box.width - box.right);
    const y = scale(row.likes, 0, maxLikes, box.height - box.bottom, box.top);
    const dot = svgEl("circle", {
      cx: x,
      cy: y,
      r: 4.5,
      fill: sentimentColors[row.sentiment] || "#2868c7",
      opacity: 0.72,
    });
    dot.appendChild(svgEl("title"));
    dot.querySelector("title").textContent = `${row.sentiment}\n${row.likes} likes\n${row.text || ""}`;
    svg.appendChild(dot);
  });
  const xLabel = svgEl("text", { class: "label", x: box.width - 145, y: box.height - 8 });
  xLabel.textContent = "Match minute";
  svg.appendChild(xLabel);
  const yLabel = svgEl("text", { class: "label", x: 8, y: 18 });
  yLabel.textContent = "Likes";
  svg.appendChild(yLabel);
}

function renderEvents(rows) {
  const html = state.sentiment.events.map((event) => {
    const before = averageScore(rows.filter((row) => row.minute >= event.minute - 5 && row.minute < event.minute));
    const after = averageScore(rows.filter((row) => row.minute > event.minute && row.minute <= event.minute + 5));
    const swing = after - before;
    const tone = swing > 0.08 ? "green" : swing < -0.08 ? "red" : "blue";
    return `
      <div class="event-item">
        <div>
          <strong>${event.minute}' · ${event.label}</strong>
          <span>${event.sentiment} event context</span>
        </div>
        <span class="tag ${tone}">${swing >= 0 ? "+" : ""}${swing.toFixed(2)}</span>
      </div>
    `;
  }).join("");
  setHtml("#event-list", html);
}

function renderTopics(rows) {
  const hashtag = mostCommon(rows, "top_hashtag");
  const player = mostCommon(rows, "top_player");
  const latest = rows.at(-1) || {};
  const error = state.sentiment.error ? `<br>${state.sentiment.error}` : "";
  setHtml("#topic-grid", `
    <div class="topic-item"><div><strong>${hashtag || "No hashtag"}</strong><span>Top hashtag in window</span></div><span class="tag blue">topic</span></div>
    <div class="topic-item"><div><strong>${player || "No player"}</strong><span>Most mentioned player</span></div><span class="tag green">player</span></div>
    <div class="topic-item"><div><strong>${latest.positive || 0}% positive</strong><span>Latest sentiment sample</span></div><span class="tag amber">${latest.minute || 0}'</span></div>
    <div class="topic-item"><div><strong>${state.sentiment.model}</strong><span>${state.sentiment.source}${error}</span></div><span class="tag violet">model</span></div>
  `);
}

function mostCommon(rows, key) {
  const counts = {};
  rows.forEach((row) => {
    counts[row[key]] = (counts[row[key]] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function averageScore(rows) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
}

function renderSentiment() {
  if (!state.sentiment) return;
  const rows = sentimentRows();
  renderSentimentMetrics(rows);
  renderSentimentLines(rows);
  renderVolumeBars(rows);
  renderEvents(state.sentiment.timeline);
  renderSentimentScatter(sentimentSamples());
  renderTopics(rows);
}

function renderCoinMetrics() {
  if (!state.coin) return;
  setHtml("#coin-metrics", [
    metric("Heads in one run", fmt(state.coin.single_heads), `${state.coin.single_tails.toLocaleString()} tails`),
    metric("Simulation probability", probabilityLabel(state.coin.simulation_probability), `${state.coin.simulation_successes.toLocaleString()} hits`),
    metric("CLT probability", probabilityLabel(state.coin.clt_probability), percentLabel(state.coin.clt_probability)),
    metric("Continuity-corrected z", state.coin.z_score.toFixed(3), `threshold > ${state.coin.threshold.toLocaleString()}`),
  ].join(""));
}

function renderCoinOutcome() {
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
    const name = svgEl("text", { class: "label", x: x + groupWidth * 0.3, y: baseline + 22, "text-anchor": "middle" });
    name.textContent = label;
    svg.appendChild(name);
    const valueLabel = svgEl("text", { class: "label", x: x + groupWidth * 0.3, y: Math.max(box.top + 16, y - 8), "text-anchor": "middle" });
    valueLabel.textContent = Number(value).toLocaleString();
    svg.appendChild(valueLabel);
  });
  const note = svgEl("text", { class: "label", x: box.width - 190, y: box.top + 12 });
  note.textContent = `${state.coin.flips.toLocaleString()} fair flips`;
  svg.appendChild(note);
}

function renderCoinDistribution() {
  const svg = $("#coin-distribution-chart");
  const box = chartBox(svg);
  drawAxes(svg, box, 4, 4);
  if (!state.coin?.histogram?.length) return;
  const bins = state.coin.histogram;
  const min = bins[0].start;
  const max = bins.at(-1).end;
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
  label.textContent = `threshold ${state.coin.threshold.toLocaleString()}`;
  svg.appendChild(label);
  const xLabel = svgEl("text", { class: "label", x: box.width - 155, y: box.height - 8 });
  xLabel.textContent = "Heads per experiment";
  svg.appendChild(xLabel);
}

function renderCoinComparison() {
  const svg = $("#coin-comparison-chart");
  const box = chartBox(svg);
  drawAxes(svg, box, 0, 4);
  if (!state.coin) return;
  const values = [
    ["CLT", state.coin.clt_probability, "#744db4"],
    ["Simulation", state.coin.simulation_probability, "#15835b"],
  ];
  const max = Math.max(...values.map((item) => item[1]), state.coin.clt_probability * 1.2, 0.000001);
  const baseline = box.height - box.bottom;
  const groupWidth = (box.width - box.left - box.right) / values.length;
  values.forEach(([label, value, color], index) => {
    const height = value ? scale(value, 0, max, 0, baseline - box.top) : 0;
    const x = box.left + index * groupWidth + groupWidth * 0.2;
    svg.appendChild(svgEl("rect", { x, y: baseline - height, width: groupWidth * 0.6, height: Math.max(height, value ? 2 : 0), rx: 5, fill: color, opacity: 0.9 }));
    const name = svgEl("text", { class: "label", x: x + groupWidth * 0.3, y: baseline + 22, "text-anchor": "middle" });
    name.textContent = label;
    svg.appendChild(name);
    const valueLabel = svgEl("text", { class: "label", x: x + groupWidth * 0.3, y: Math.max(box.top + 16, baseline - height - 8), "text-anchor": "middle" });
    valueLabel.textContent = probabilityLabel(value);
    svg.appendChild(valueLabel);
  });
  const caption = svgEl("text", { class: "label", x: box.left, y: box.top + 12 });
  caption.textContent = "Probability of exceeding the threshold";
  svg.appendChild(caption);
}

function renderCoinTheory() {
  if (!state.coin) return;
  const result = percentLabel(state.coin.clt_probability);
  const rarityNote = state.coin.expected_successes < 10
    ? `At this experiment count, the CLT expects only ${state.coin.expected_successes.toFixed(2)} threshold hits, so the empirical probability will be noisy.`
    : `The CLT expects about ${state.coin.expected_successes.toLocaleString()} threshold hits at this experiment count.`;
  setHtml("#coin-formula", `
    <div class="formula-block">
      <strong>X ~ Binomial(${state.coin.flips.toLocaleString()}, 0.5)</strong>
      <span>mu = np = ${state.coin.theoretical_mean.toLocaleString()}</span>
      <span>sigma = sqrt(npq) = ${state.coin.theoretical_std_dev.toFixed(2)}</span>
      <span>z = (${state.coin.threshold.toLocaleString()} + 0.5 - mu) / sigma = ${state.coin.z_score.toFixed(3)}</span>
      <strong>P(X &gt; ${state.coin.threshold.toLocaleString()}) ≈ P(Z &gt; ${state.coin.z_score.toFixed(3)}) = ${probabilityLabel(state.coin.clt_probability)}</strong>
    </div>
    <p class="theory-note">The CLT predicts a ${result} tail. The simulation estimates the same tail by repeating the ${state.coin.flips.toLocaleString()}-flip experiment ${state.coin.experiments.toLocaleString()} times. ${rarityNote}</p>
  `);
}

function renderCoinReadout() {
  if (!state.coin) return;
  setHtml("#coin-readout", [
    `<div class="topic-item"><div><strong>${state.coin.sample_mean.toLocaleString()}</strong><span>Simulated mean heads</span></div><span class="tag blue">theory ${state.coin.theoretical_mean.toLocaleString()}</span></div>`,
    `<div class="topic-item"><div><strong>${state.coin.sample_std_dev.toFixed(2)}</strong><span>Simulated standard deviation</span></div><span class="tag green">theory ${state.coin.theoretical_std_dev.toFixed(2)}</span></div>`,
    `<div class="topic-item"><div><strong>${state.coin.expected_successes.toFixed(2)}</strong><span>Expected hits from CLT</span></div><span class="tag violet">of ${state.coin.experiments.toLocaleString()}</span></div>`,
    `<div class="topic-item"><div><strong>${probabilityLabel(state.coin.simulation_ci95_low)}–${probabilityLabel(state.coin.simulation_ci95_high)}</strong><span>Simulation 95% interval</span></div><span class="tag amber">${state.coin.simulation_successes.toLocaleString()} hits</span></div>`,
  ].join(""));
}

function renderCoin() {
  renderCoinMetrics();
  renderCoinOutcome();
  renderCoinDistribution();
  renderCoinComparison();
  renderCoinTheory();
  renderCoinReadout();
}

function renderAll() {
  renderStatus();
  renderPlayers();
  renderSentiment();
  renderCoin();
}

function sentimentUrl() {
  const query = encodeURIComponent($("#match-query").value);
  return `/api/sentiment?query=${query}`;
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

async function loadData() {
  const [statusResponse, playerResponse, sentimentResponse, coinResponse] = await Promise.all([
    fetch("/api/status"),
    fetch("/api/players"),
    fetch(sentimentUrl()),
    fetch(coinUrl("20260701")),
  ]);
  state.status = await statusResponse.json();
  const playerPayload = await playerResponse.json();
  state.players = playerPayload.players;
  state.playerSource = playerPayload.source;
  state.sentiment = await sentimentResponse.json();
  state.coin = await coinResponse.json();
  populateFilters();
  renderAll();
}

async function runCoinSimulation() {
  const button = $("#coin-run");
  button.disabled = true;
  button.textContent = "Running...";
  try {
    const response = await fetch(coinUrl(String(Date.now())));
    state.coin = await response.json();
    renderCoin();
  } finally {
    button.disabled = false;
    button.textContent = "Run simulation";
  }
}

async function refreshSentiment() {
  const response = await fetch(sentimentUrl());
  state.sentiment = await response.json();
  renderStatus();
  renderSentiment();
}

window.addEventListener("resize", () => requestAnimationFrame(renderAll));
initTabs();
$("#coin-run").addEventListener("click", runCoinSimulation);
$("#coin-flips").addEventListener("input", () => {
  $("#coin-threshold").max = $("#coin-flips").value;
});
loadData().then(() => {
  state.liveTimer = setInterval(refreshSentiment, 4000);
});
