/* ═══════════════════════════════════════════════════════════
   UrboFlow — Frontend Application Logic (OPTIMIZED)
   - AbortController for cancellable requests
   - Debounced API calls
   - Skeleton loaders
   - Request timeouts & retry logic
   - Non-blocking progressive loading
   - Smart chart updates (data-only, no destroy/recreate)
   ═══════════════════════════════════════════════════════════ */

const API = '';

// ── State ──────────────────────────────────────────────────
let meta = null;
let trendChart = null;

let allZonesChart = null;
let heatmapChart = null;
let networkInstance = null;
let leafletMap = null;
let heatLayer = null;
let zoneMarkers = [];
let lastAllZonesData = null;

// AbortControllers for cancellable requests
let _abortControllers = {};

// Debounce timers
let _debounceTimers = {};

// ── Zone coordinates ───────────────────────────────────────
const ZONE_COORDS = {
    "Sector 1": [21.2094, 81.3780], "Sector 2": [21.2120, 81.3750],
    "Sector 3": [21.2150, 81.3720], "Sector 4": [21.2180, 81.3690],
    "Sector 5": [21.2210, 81.3660], "Sector 6": [21.2060, 81.3760],
    "Sector 7": [21.2085, 81.3730], "Sector 8": [21.2110, 81.3700],
    "Sector 9": [21.2140, 81.3670], "Sector 10": [21.2170, 81.3640],
    "Supela": [21.1950, 81.3800], "Nehru Nagar": [21.1980, 81.3850],
    "Bhilai 3": [21.2020, 81.3900], "Durg Station": [21.1900, 81.3780],
    "Civic Center": [21.2050, 81.3850], "Junwani": [21.2000, 81.3750],
    "Smriti Nagar": [21.2030, 81.3700], "Power House": [21.2100, 81.3650],
    "Padmanabhpur": [21.1930, 81.3720], "Kohka": [21.2230, 81.3600]
};

// ── Utilities ──────────────────────────────────────────────

function debounce(key, fn, delay = 300) {
    if (_debounceTimers[key]) clearTimeout(_debounceTimers[key]);
    _debounceTimers[key] = setTimeout(fn, delay);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const key = options._abortKey || url;

    // Cancel any previous in-flight request with same key
    if (_abortControllers[key]) {
        _abortControllers[key].abort();
    }

    const controller = new AbortController();
    _abortControllers[key] = controller;

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        delete _abortControllers[key];
        return res;
    } catch (err) {
        clearTimeout(timeoutId);
        delete _abortControllers[key];
        if (err.name === 'AbortError') {
            return null; // Silently ignore aborted requests
        }
        throw err;
    }
}

async function fetchJSON(url, options = {}, retries = 1) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetchWithTimeout(url, options);
            if (!res) return null; // Aborted
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${res.status}`);
            }
            return await res.json();
        } catch (err) {
            if (err.name === 'AbortError' || !err.message) return null;
            if (i === retries) throw err;
            // Wait before retry
            await new Promise(r => setTimeout(r, 300 * (i + 1)));
        }
    }
}

function showToast(message, type = 'error') {
    const toast = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
        <span class="toast-icon">${type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️'}</span>
        <span>${message}</span>
    `;
    toast.appendChild(el);

    // Animate in
    requestAnimationFrame(() => el.classList.add('toast-visible'));

    // Auto remove
    setTimeout(() => {
        el.classList.remove('toast-visible');
        setTimeout(() => el.remove(), 300);
    }, 4000);
}

function showSkeleton(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('skeleton-loading');
}

function hideSkeleton(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('skeleton-loading');
}

function setButtonLoading(btn, loading) {
    if (!btn) return;
    const text = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.btn-loading');
    if (text) text.classList.toggle('hidden', loading);
    if (loader) loader.classList.toggle('hidden', !loading);
    btn.disabled = loading;
}

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    startClock();

    // Critical path: load meta first (fast endpoint)
    await loadMeta();

    // Hide loader as soon as controls are ready
    document.getElementById('app-loader').classList.add('hidden');

    // Non-blocking: load everything else in parallel
    // Use requestAnimationFrame to avoid blocking the paint
    requestAnimationFrame(() => {
        // Stagger loads to avoid all hitting at once
        fetchWeather();
        initMap();

        setTimeout(() => loadGraph(), 50);
        setTimeout(() => loadTrends(), 100);
        setTimeout(() => predictAll(), 150);
        setTimeout(() => loadHistory(), 200);
        setTimeout(() => loadHeatmap(), 400);
    });

    // Auto-refresh every 60s (staggered)
    setInterval(() => {
        fetchWeather();
        setTimeout(() => predictAll(), 500);
    }, 60000);
});

// ── Theme Toggle ───────────────────────────────────────────
function initTheme() {
    const saved = localStorage.getItem('urboflow-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('theme-toggle').addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('urboflow-theme', next);

        // Update charts colors without destroying (just update options)
        debounce('theme-charts', () => {
            if (trendChart) updateChartTheme(trendChart);
            if (allZonesChart) updateChartTheme(allZonesChart);
            if (heatmapChart) updateChartTheme(heatmapChart);

            // Only reload graph if it exists (expensive)
            if (networkInstance) updateGraphTheme();
        }, 100);

        // Update map tiles
        if (leafletMap) updateMapTiles();
    });
}

function updateChartTheme(chart) {
    const colors = getChartColors();
    if (chart.options.scales) {
        Object.values(chart.options.scales).forEach(scale => {
            if (scale.grid) scale.grid.color = colors.gridColor;
            if (scale.ticks) scale.ticks.color = colors.textColor;
            if (scale.title) scale.title.color = colors.textColor;
        });
    }
    chart.update('none'); // 'none' mode skips animation for instant update
}

function updateGraphTheme() {
    if (!networkInstance || !networkInstance._nodesDS) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const fontColor = isDark ? '#f0f0ff' : '#1a1a2e';

    const updates = [];
    networkInstance._nodesDS.forEach(node => {
        updates.push({ id: node.id, font: { color: fontColor } });
    });
    networkInstance._nodesDS.update(updates);
}

let _mapTileLayer = null;
function updateMapTiles() {
    if (!leafletMap || !_mapTileLayer) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const tileUrl = isDark
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    _mapTileLayer.setUrl(tileUrl);
}

// ── Clock ──────────────────────────────────────────────────
function startClock() {
    const el = document.getElementById('header-clock');
    function update() {
        const now = new Date();
        const h = now.getHours();
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        el.textContent = `${h12}:${m}:${s} ${ampm}`;
    }
    update();
    setInterval(update, 1000);
}

// ── Load Meta ──────────────────────────────────────────────
async function loadMeta() {
    try {
        const data = await fetchJSON(`${API}/api/meta`);
        if (!data) return;
        meta = data;

        // Populate dropdowns with document fragment (minimal DOM ops)
        const zoneSelect = document.getElementById('zone-select');
        const zoneFrag = document.createDocumentFragment();
        meta.zones.forEach(z => {
            const opt = document.createElement('option');
            opt.value = z;
            opt.textContent = z;
            zoneFrag.appendChild(opt);
        });
        zoneSelect.appendChild(zoneFrag);

        const weatherSelect = document.getElementById('weather-select');
        const weatherFrag = document.createDocumentFragment();
        meta.weather_types.forEach(w => {
            const opt = document.createElement('option');
            opt.value = w;
            opt.textContent = w;
            weatherFrag.appendChild(opt);
        });
        weatherSelect.appendChild(weatherFrag);

        const hourSelect = document.getElementById('hour-display');
        const hourFrag = document.createDocumentFragment();
        for (let h = 0; h < 24; h++) {
            const opt = document.createElement('option');
            opt.value = h;
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = h % 12 || 12;
            opt.textContent = `${h12}:00 ${ampm}`;
            hourFrag.appendChild(opt);
        }
        hourSelect.appendChild(hourFrag);
        hourSelect.value = new Date().getHours();

        // Stats
        document.getElementById('stat-r2').textContent = `R² ${meta.model_r2}`;
        document.getElementById('stat-zone-count').textContent = meta.zones.length;
        document.getElementById('footer-mae').textContent = `MAE: ${meta.model_mae}`;
        document.getElementById('footer-r2').textContent = `R²: ${meta.model_r2}`;
    } catch (err) {
        showToast('Failed to load metadata. Is the server running?');
    }
}

// ── Get form values (reusable) ─────────────────────────────
function getFormValues() {
    return {
        zone: document.getElementById('zone-select').value,
        hour: parseInt(document.getElementById('hour-display').value),
        day_type: document.getElementById('day-select').value,
        weather: document.getElementById('weather-select').value,
        temperature: parseFloat(document.getElementById('temp-input').value),
        humidity: parseFloat(document.getElementById('humidity-input').value)
    };
}

// ── Predict ────────────────────────────────────────────────
async function predict() {
    const btn = document.getElementById('predict-btn');
    setButtonLoading(btn, true);
    showSkeleton('result-card');

    try {
        const payload = getFormValues();
        const data = await fetchJSON(`${API}/api/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            _abortKey: 'predict'
        });

        if (!data) return;

        if (data.error) {
            showToast(data.error);
            return;
        }

        showResult(data);

        // Non-blocking background updates
        requestAnimationFrame(() => {
            loadHistory();
            debounce('trends-after-predict', () => loadTrends(), 200);
        });
    } catch (err) {
        showToast('Prediction failed: ' + err.message);
    } finally {
        setButtonLoading(btn, false);
        hideSkeleton('result-card');
    }
}

function showResult(data) {
    const card = document.getElementById('result-card');
    card.classList.remove('hidden');

    document.getElementById('result-zone').textContent = data.zone;
    document.getElementById('result-time').textContent = data.hour_display;
    document.getElementById('result-day').textContent = data.day_type;
    document.getElementById('result-weather').textContent = data.weather;
    document.getElementById('result-neighbor').textContent = data.neighbor_demand.toFixed(1);

    const badge = document.getElementById('result-badge');
    badge.textContent = data.category;
    badge.className = 'result-badge ' + data.category.toLowerCase();

    // Peak alert
    if (data.is_peak) {
        const alertEl = document.getElementById('peak-alert');
        alertEl.classList.remove('hidden');
        document.getElementById('peak-alert-msg').textContent =
            `High demand in ${data.zone} at ${data.hour_display}! Predicted: ${data.predicted_demand} rides/hr`;
    }

    animateNumber(document.getElementById('result-demand'), data.predicted_demand);
}

function animateNumber(el, target) {
    const duration = 600;
    const startTime = performance.now();
    const startVal = parseFloat(el.textContent) || 0;

    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = (startVal + (target - startVal) * eased).toFixed(1);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// ── Predict All ────────────────────────────────────────────
async function predictAll() {
    const btn = document.querySelector('[onclick="predictAll()"]');
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.6';
    }

    try {
        const payload = getFormValues();
        delete payload.zone; // Not needed for predict-all

        const data = await fetchJSON(`${API}/api/predict-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            _abortKey: 'predict-all'
        });

        if (!data) return;
        lastAllZonesData = data;

        // Update stats
        document.getElementById('stat-best-zone').textContent = data.best_zone;
        document.getElementById('reco-zone').textContent = data.best_zone;
        document.getElementById('reco-demand').textContent = `Predicted: ${data.best_demand} rides/hr`;

        // Batch DOM updates
        requestAnimationFrame(() => {
            renderAllZonesChart(data.results);
            updateMapMarkers(data.results);
            if (networkInstance) updateGraphColors(data.results);
        });
    } catch (err) {
        console.error('Predict all failed:', err);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '';
        }
    }
}

// ── Trends ─────────────────────────────────────────────────
async function loadTrends() {
    showSkeleton('trend-chart');

    try {
        const payload = getFormValues();
        const data = await fetchJSON(`${API}/api/trends`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            _abortKey: 'trends'
        });

        if (!data) return;
        renderTrendChart(data);

        document.getElementById('peak-hour-display').textContent = data.peak_hour_display;
        document.getElementById('peak-demand-display').textContent = data.peak_demand + ' rides/hr';
    } catch (err) {
        console.error('Trends failed:', err);
    } finally {
        hideSkeleton('trend-chart');
    }
}

function getChartColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
        gridColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        textColor: isDark ? '#a0a0c0' : '#555580',
    };
}

function renderTrendChart(data) {
    const ctx = document.getElementById('trend-chart').getContext('2d');
    const colors = getChartColors();

    const labels = data.trend.map(t => t.hour_display);
    const demands = data.trend.map(t => t.demand);
    const categories = data.trend.map(t => t.category);

    const bgColors = categories.map(c => {
        if (c === 'High') return 'rgba(239, 68, 68, 0.3)';
        if (c === 'Medium') return 'rgba(245, 158, 11, 0.3)';
        return 'rgba(16, 185, 129, 0.3)';
    });

    if (trendChart) {
        // Update data without destroying chart (much faster, no flicker)
        trendChart.data.labels = labels;
        trendChart.data.datasets[0].data = demands;
        trendChart.data.datasets[0].pointBackgroundColor = bgColors;
        trendChart.data.datasets[0].pointBorderColor = bgColors.map(c => c.replace('0.3', '1'));
        trendChart.update('default');
        return;
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, 320);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.3)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.01)');

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Predicted Demand',
                data: demands,
                borderColor: '#6366f1',
                borderWidth: 2.5,
                backgroundColor: gradient,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: bgColors,
                pointBorderColor: bgColors.map(c => c.replace('0.3', '1')),
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 7,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(17,17,40,0.95)',
                    titleColor: '#f0f0ff',
                    bodyColor: '#a0a0c0',
                    borderColor: 'rgba(99,102,241,0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: (ctx) => {
                            const cat = categories[ctx.dataIndex];
                            return `Demand: ${ctx.parsed.y} rides/hr (${cat})`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: colors.gridColor },
                    ticks: { color: colors.textColor, font: { size: 10 }, maxRotation: 45 }
                },
                y: {
                    grid: { color: colors.gridColor },
                    ticks: { color: colors.textColor, font: { size: 10 } },
                    beginAtZero: true,
                    title: { display: true, text: 'Demand (rides/hr)', color: colors.textColor, font: { size: 11 } }
                }
            }
        }
    });
}

// ── All Zones Chart ────────────────────────────────────────
function renderAllZonesChart(results) {
    const ctx = document.getElementById('all-zones-chart').getContext('2d');
    const colors = getChartColors();

    const labels = results.map(r => r.zone);
    const demands = results.map(r => r.predicted_demand);
    const bgColors = results.map(r => {
        if (r.category === 'High') return 'rgba(239, 68, 68, 0.7)';
        if (r.category === 'Medium') return 'rgba(245, 158, 11, 0.7)';
        return 'rgba(16, 185, 129, 0.7)';
    });
    const borderColors = results.map(r => {
        if (r.category === 'High') return '#ef4444';
        if (r.category === 'Medium') return '#f59e0b';
        return '#10b981';
    });

    if (allZonesChart) {
        allZonesChart.data.labels = labels;
        allZonesChart.data.datasets[0].data = demands;
        allZonesChart.data.datasets[0].backgroundColor = bgColors;
        allZonesChart.data.datasets[0].borderColor = borderColors;
        allZonesChart.update('default');
        return;
    }

    allZonesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Predicted Demand',
                data: demands,
                backgroundColor: bgColors,
                borderColor: borderColors,
                borderWidth: 1.5,
                borderRadius: 6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(17,17,40,0.95)',
                    titleColor: '#f0f0ff',
                    bodyColor: '#a0a0c0',
                    borderColor: 'rgba(99,102,241,0.3)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                }
            },
            scales: {
                x: {
                    grid: { color: colors.gridColor },
                    ticks: { color: colors.textColor, font: { size: 10 } },
                    beginAtZero: true,
                    title: { display: true, text: 'Demand (rides/hr)', color: colors.textColor }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: colors.textColor, font: { size: 10 } }
                }
            }
        }
    });
}

// ── Weather ────────────────────────────────────────────────
async function fetchWeather() {
    const city = document.getElementById('city-input').value || 'Bhilai';
    const btn = document.getElementById('fetch-weather-btn');
    if (btn) btn.disabled = true;

    try {
        const data = await fetchJSON(`${API}/api/weather?city=${encodeURIComponent(city)}`, {
            _abortKey: 'weather'
        });
        if (!data) return;

        // Batch DOM updates
        requestAnimationFrame(() => {
            document.getElementById('weather-temp').textContent = `${data.temperature}°C`;
            document.getElementById('weather-condition').textContent = data.condition + (data.simulated ? ' (Simulated)' : '');
            document.getElementById('weather-humidity').textContent = `${data.humidity}%`;
            document.getElementById('weather-wind').textContent = `${data.wind_speed} m/s`;
            document.getElementById('weather-city').textContent = data.city;
            document.getElementById('stat-weather').textContent = `${data.temperature}°C ${data.condition}`;

            document.getElementById('temp-input').value = data.temperature;
            document.getElementById('humidity-input').value = data.humidity;

            const weatherSelect = document.getElementById('weather-select');
            for (let opt of weatherSelect.options) {
                if (opt.value === data.condition) {
                    weatherSelect.value = data.condition;
                    break;
                }
            }


        });
    } catch (err) {
        console.error('Weather fetch failed:', err);
    } finally {
        if (btn) btn.disabled = false;
    }
}



// ── Network Graph ──────────────────────────────────────────
async function loadGraph() {
    try {
        const data = await fetchJSON(`${API}/api/graph`, { _abortKey: 'graph' });
        if (!data) return;

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

        const nodes = new vis.DataSet(data.nodes.map(n => ({
            id: n.id,
            label: n.label,
            color: { background: '#6366f1', border: '#818cf8', highlight: { background: '#8b5cf6', border: '#a78bfa' } },
            font: { color: isDark ? '#f0f0ff' : '#1a1a2e', size: 11, face: 'Inter' },
            shape: 'dot',
            size: 18,
            borderWidth: 2,
            shadow: { enabled: true, size: 8, color: 'rgba(99,102,241,0.3)' }
        })));

        const edges = new vis.DataSet(data.edges.map(e => ({
            from: e.from,
            to: e.to,
            color: { color: isDark ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.2)' },
            width: 1.5,
            smooth: { type: 'continuous' }
        })));

        const container = document.getElementById('network-graph');
        networkInstance = new vis.Network(container, { nodes, edges }, {
            physics: {
                forceAtlas2Based: {
                    gravitationalConstant: -30,
                    centralGravity: 0.008,
                    springLength: 120,
                    springConstant: 0.05
                },
                solver: 'forceAtlas2Based',
                stabilization: { iterations: 80 } // Reduced from 100
            },
            interaction: { hover: true, tooltipDelay: 100 }
        });

        networkInstance._nodesDS = nodes;
    } catch (err) {
        console.error('Graph load failed:', err);
    }
}

function updateGraphColors(results) {
    if (!networkInstance || !networkInstance._nodesDS) return;

    const updates = results.map(r => {
        let bg, border;
        if (r.category === 'High') { bg = '#ef4444'; border = '#f87171'; }
        else if (r.category === 'Medium') { bg = '#f59e0b'; border = '#fbbf24'; }
        else { bg = '#10b981'; border = '#34d399'; }
        return {
            id: r.zone,
            color: { background: bg, border },
            size: Math.min(12 + (r.predicted_demand / 3), 38),
            title: `${r.zone}: ${r.predicted_demand} rides/hr (${r.category})`
        };
    });

    networkInstance._nodesDS.update(updates);
}

// ── Map ────────────────────────────────────────────────────
function initMap() {
    leafletMap = L.map('city-map', {
        preferCanvas: true  // Better performance for markers
    }).setView([21.2085, 81.3750], 14);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const tileUrl = isDark
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

    _mapTileLayer = L.tileLayer(tileUrl, {
        attribution: '&copy; OpenStreetMap & CartoDB',
        maxZoom: 18
    }).addTo(leafletMap);

    Object.entries(ZONE_COORDS).forEach(([zone, coords]) => {
        const marker = L.circleMarker(coords, {
            radius: 10, fillColor: '#6366f1', color: '#818cf8',
            weight: 2, opacity: 1, fillOpacity: 0.7
        }).addTo(leafletMap);

        marker.bindTooltip(zone, { permanent: false, direction: 'top', className: 'zone-tooltip' });
        marker._zoneName = zone;
        zoneMarkers.push(marker);
    });
}

function updateMapMarkers(results) {
    if (!leafletMap) return;

    const demandMap = {};
    results.forEach(r => demandMap[r.zone] = r);

    if (heatLayer) leafletMap.removeLayer(heatLayer);

    const heatPoints = [];

    zoneMarkers.forEach(marker => {
        const zone = marker._zoneName;
        const data = demandMap[zone];
        if (!data) return;

        let color;
        if (data.category === 'High') color = '#ef4444';
        else if (data.category === 'Medium') color = '#f59e0b';
        else color = '#10b981';

        marker.setStyle({ fillColor: color, color, radius: Math.min(8 + (data.predicted_demand / 4), 22) });
        marker.setTooltipContent(`<b>${zone}</b><br>Demand: ${data.predicted_demand} rides/hr<br>Category: ${data.category}`);

        const coords = ZONE_COORDS[zone];
        if (coords) heatPoints.push([coords[0], coords[1], data.predicted_demand / 80]);
    });

    if (heatPoints.length > 0) {
        heatLayer = L.heatLayer(heatPoints, {
            radius: 40, blur: 30, maxZoom: 16,
            gradient: { 0.2: '#10b981', 0.5: '#f59e0b', 0.8: '#ef4444', 1: '#dc2626' }
        }).addTo(leafletMap);
    }
}

// ── Heatmap ────────────────────────────────────────────────
async function loadHeatmap() {
    showSkeleton('heatmap-chart');

    try {
        const payload = getFormValues();
        const data = await fetchJSON(`${API}/api/heatmap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            _abortKey: 'heatmap'
        });

        if (!data) return;
        renderHeatmapChart(data);
    } catch (err) {
        console.error('Heatmap failed:', err);
    } finally {
        hideSkeleton('heatmap-chart');
    }
}

function renderHeatmapChart(data) {
    const ctx = document.getElementById('heatmap-chart').getContext('2d');
    const colors = getChartColors();

    const hourLabels = [];
    for (let h = 0; h < 24; h++) {
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        hourLabels.push(`${h12} ${ampm}`);
    }

    const bubbleData = [];
    data.zones.forEach((zone, yi) => {
        data.heatmap[zone].forEach((demand, xi) => {
            bubbleData.push({ x: xi, y: yi, r: 3 + (demand / 80) * 10, demand });
        });
    });

    const bubbleColors = bubbleData.map(p => {
        if (p.demand >= 45) return 'rgba(239, 68, 68, 0.75)';
        if (p.demand >= 20) return 'rgba(245, 158, 11, 0.75)';
        return 'rgba(16, 185, 129, 0.75)';
    });

    if (heatmapChart) {
        heatmapChart.data.datasets[0].data = bubbleData;
        heatmapChart.data.datasets[0].backgroundColor = bubbleColors;
        heatmapChart.update('default');
        return;
    }

    heatmapChart = new Chart(ctx, {
        type: 'bubble',
        data: {
            datasets: [{
                label: 'Demand',
                data: bubbleData,
                backgroundColor: bubbleColors,
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(17,17,40,0.95)',
                    titleColor: '#f0f0ff',
                    bodyColor: '#a0a0c0',
                    callbacks: {
                        label: (ctx) => {
                            const p = ctx.raw;
                            const zone = data.zones[p.y];
                            return `${zone} at ${hourLabels[p.x]}: ${p.demand} rides/hr`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear', min: -0.5, max: 23.5,
                    grid: { color: colors.gridColor },
                    ticks: { color: colors.textColor, font: { size: 9 }, callback: (v) => hourLabels[v] || '' },
                    title: { display: true, text: 'Hour', color: colors.textColor }
                },
                y: {
                    type: 'linear', min: -0.5, max: data.zones.length - 0.5,
                    grid: { color: colors.gridColor },
                    ticks: { color: colors.textColor, font: { size: 9 }, callback: (v) => data.zones[v] || '', stepSize: 1 }
                }
            }
        }
    });
}

// ── History ────────────────────────────────────────────────
async function loadHistory() {
    try {
        const data = await fetchJSON(`${API}/api/history?limit=50`, { _abortKey: 'history' });
        if (!data) return;

        const tbody = document.getElementById('history-tbody');

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No predictions yet. Run a prediction to see history.</td></tr>';
            return;
        }

        // Build HTML string in one go
        const html = data.map((r, i) => {
            const ts = new Date(r.timestamp);
            const timeStr = ts.toLocaleString('en-IN', {
                hour: 'numeric', minute: '2-digit',
                hour12: true, day: 'numeric', month: 'short'
            });
            const hourAmpm = formatHourAmPm(r.hour);
            return `<tr>
                <td>${data.length - i}</td>
                <td>${timeStr}</td>
                <td><strong>${r.zone}</strong></td>
                <td>${hourAmpm}</td>
                <td>${r.day_type}</td>
                <td>${r.weather}</td>
                <td>${r.temperature}°C</td>
                <td><strong>${r.predicted_demand}</strong></td>
                <td><span class="category-badge ${r.category.toLowerCase()}">${r.category}</span></td>
            </tr>`;
        }).join('');

        // Single DOM update
        tbody.innerHTML = html;
    } catch (err) {
        console.error('History load failed:', err);
    }
}

async function clearHistory() {
    if (!confirm('Clear all prediction history?')) return;
    try {
        await fetchJSON(`${API}/api/history/clear`, { method: 'POST', _abortKey: 'clear-history' });
        showToast('History cleared', 'success');
        loadHistory();
    } catch (err) {
        showToast('Failed to clear history');
    }
}

function formatHourAmPm(hour) {
    if (hour === 0) return '12:00 AM';
    if (hour < 12) return `${hour}:00 AM`;
    if (hour === 12) return '12:00 PM';
    return `${hour - 12}:00 PM`;
}
