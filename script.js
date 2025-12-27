/**
 * GeoDaily - Main Application Logic
 */

import { GeminiClient } from './gemini.js';

class GeoDaily {
    constructor() {
        this.apiKey = localStorage.getItem('geodaily_gemini_key') || null;
        this.client = null;
        this.map = null;
        this.currentData = null;
        this.phase = 'INTRO';
        this.marker = null;
        this.countriesData = []; // Store the massive dataset here

        // Load used cities
        const stored = localStorage.getItem('geodaily_used_cities');
        this.usedCities = stored ? new Set(JSON.parse(stored)) : new Set();

        this.dom = {
            settingsModal: document.getElementById('settings-modal'),
            apiKeyInput: document.getElementById('api-key'),
            saveKeyBtn: document.getElementById('save-key-btn'),
            gameUi: document.getElementById('game-ui'),
            contentOverlay: document.getElementById('content-overlay'),
            phaseContent: document.getElementById('phase-content'),
            skipBtn: document.getElementById('skip-btn'),
            settingsBtn: document.getElementById('settings-btn'),
            topBar: document.getElementById('top-bar')
        };

        this.init();
    }

    init() {
        this.initMap();
        this.loadGeoJSON(); // Load country boundaries

        const savedDifficulty = localStorage.getItem('geodaily_difficulty');
        const diffSelect = document.getElementById('difficulty-select');
        if (savedDifficulty) diffSelect.value = savedDifficulty;

        diffSelect.addEventListener('change', () => {
            localStorage.setItem('geodaily_difficulty', diffSelect.value);
            this.startGame();
        });

        this.dom.saveKeyBtn.addEventListener('click', () => this.saveApiKey());
        this.dom.settingsBtn.addEventListener('click', () => this.openSettings());

        // Load the massive dataset
        this.loadDataset();

        // Theme Toggle
        this.theme = localStorage.getItem('geodaily_theme') || 'light';
        const themeBtn = document.getElementById('theme-toggle');
        this.updateTheme(this.theme); // Apply initial theme
        themeBtn.onclick = () => {
            this.theme = this.theme === 'light' ? 'dark' : 'light';
            localStorage.setItem('geodaily_theme', this.theme);
            this.updateTheme(this.theme);
        };

        // New Controls
        document.getElementById('next-btn').onclick = () => this.startGame(); // Skip entire journey

        // Close button logic
        if (!document.getElementById('close-settings-btn')) {
            const closeBtn = document.createElement('button');
            closeBtn.id = 'close-settings-btn';
            closeBtn.className = 'icon-btn';
            closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            closeBtn.style.cssText = "position:absolute; top:1rem; right:1rem;";
            closeBtn.onclick = () => {
                this.dom.settingsModal.classList.remove('active');
            };
            this.dom.settingsModal.querySelector('.modal-content').appendChild(closeBtn);
        }

        // Demo Button
        const demoBtn = document.getElementById('demo-btn');
        if (demoBtn) {
            demoBtn.onclick = () => {
                this.dom.settingsModal.classList.remove('active');
                this.dom.gameUi.classList.remove('hidden');
                if (!this.currentData) this.startGame();
            };
        }

        // Initialize Client if key exists
        if (this.apiKey) {
            this.client = new GeminiClient(this.apiKey);
            this.dom.settingsModal.classList.remove('active');
            this.dom.gameUi.classList.remove('hidden');
        } else {
            this.dom.settingsModal.classList.add('active');
        }
    }

    async loadDataset() {
        try {
            const res = await fetch('data.json');
            this.countriesData = await res.json();
            console.log(`Dataset loaded: ${this.countriesData.length} countries available.`);

            // Start game immediately if it was waiting
            if (this.phase === 'INTRO' || !this.currentData) {
                this.startGame();
            }
        } catch (e) {
            console.error("Failed to load dataset", e);
            this.showToast("Critical Error: Failed to load game data. Check your connection.", "error");
        }
    }

    checkForApiKey() {
        if (this.apiKey) {
            this.client = new GeminiClient(this.apiKey);
            this.dom.settingsModal.classList.remove('active');
            this.dom.gameUi.classList.remove('hidden');
        }
    }

    initMap() {
        this.map = L.map('map', {
            zoomControl: false,
            attributionControl: false,
            minZoom: 2,
            worldCopyJump: true  // Seamless map panning like Google Maps
        }).setView([20, 0], 2);

        this.tileLayers = {
            light: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; CartoDB', subdomains: 'abcd', maxZoom: 19
            }),
            // Use dark blue-tinted map for better visibility (no labels)
            dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; CartoDB', subdomains: 'abcd', maxZoom: 19
            })
        };

        this.updateTheme(this.theme || 'light', true); // Add initial layer

        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        // Click handler for City Find phase (GeoJSON handles COUNTRY_GUESS)
        this.map.on('click', (e) => this.handleMapClick(e));
    }

    updateTheme(mode, firstRun = false) {
        if (!this.map) return;

        if (mode === 'light') {
            if (this.map.hasLayer(this.tileLayers.dark)) this.map.removeLayer(this.tileLayers.dark);
            if (!this.map.hasLayer(this.tileLayers.light)) this.tileLayers.light.addTo(this.map);
            document.documentElement.setAttribute('data-theme', 'light');
            document.getElementById('theme-toggle').innerHTML = '<i class="fa-solid fa-moon"></i>';
        } else {
            if (this.map.hasLayer(this.tileLayers.light)) this.map.removeLayer(this.tileLayers.light);
            if (!this.map.hasLayer(this.tileLayers.dark)) this.tileLayers.dark.addTo(this.map);
            document.documentElement.setAttribute('data-theme', 'dark');
            document.getElementById('theme-toggle').innerHTML = '<i class="fa-solid fa-sun" style="color:#fbbf24"></i>';
        }

        // Refresh GeoJSON styles for new theme if loaded
        if (this.geoLayer) {
            this.geoLayer.eachLayer(layer => {
                const featureId = layer._featureId;
                // Always reset style unless it's a persistent highlight (Correct or Wrong/Hinted)
                if (layer !== this.correctLayer && !this.wrongGuesses?.has(featureId) && !this.hintedLayers?.has(featureId)) {
                    this.resetLayerStyle(layer);
                }
            });
        }
    }

    async loadGeoJSON() {
        try {
            const res = await fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json');
            const data = await res.json();

            this.geoLayer = L.geoJSON(data, {
                style: {
                    color: (this.theme === 'dark' && this.phase === 'COUNTRY_GUESS') ? 'rgba(255,255,255,0.2)' : 'transparent',
                    fillColor: this.theme === 'dark' ? '#1e293b' : '#000000',
                    weight: 1,
                    fillOpacity: (this.theme === 'dark' && this.phase === 'COUNTRY_GUESS') ? 0.3 : 0
                },
                onEachFeature: (feature, layer) => {
                    layer._featureId = feature.id || feature.properties.name;
                    layer.on('mouseover', () => {
                        // Only allow hover highlights during active guessing phase
                        if (this.phase === 'COUNTRY_GUESS' && !this.guessedCorrectly) {
                            // Don't change style if already marked wrong/correct/hinted
                            if (!this.wrongGuesses?.has(layer._featureId) && !this.hintedLayers?.has(layer._featureId)) {
                                layer.setStyle({
                                    color: '#a855f7',
                                    weight: 2,
                                    fillOpacity: 0.1
                                });
                            }
                        }
                    });
                    layer.on('mouseout', () => {
                        // Reset hover highlight if we are in COUNTRY_GUESS and not guessed correctly
                        if (this.phase === 'COUNTRY_GUESS' && !this.guessedCorrectly) {
                            if (!this.wrongGuesses?.has(layer._featureId) && !this.hintedLayers?.has(layer._featureId)) {
                                this.resetLayerStyle(layer);
                            }
                        } else if (this.phase !== 'COUNTRY_GUESS' || this.guessedCorrectly) {
                            // If phase changed or guessed correctly, ensure we don't leave hover styles stuck
                            if (layer !== this.correctLayer && !this.wrongGuesses?.has(layer._featureId) && !this.hintedLayers?.has(layer._featureId)) {
                                this.resetLayerStyle(layer);
                            }
                        }
                    });
                    layer.on('click', (e) => this.handleGeoClick(e, feature, layer));
                }
            }).addTo(this.map);
        } catch (e) {
            console.error("Failed to load GeoJSON", e);
        }
    }

    resetLayerStyle(layer) {
        // Only show landmass fills/borders during the active guessing phase for Dark Mode
        const showLandmass = this.theme === 'dark' && this.phase === 'COUNTRY_GUESS' && !this.guessedCorrectly;

        if (this.theme === 'dark') {
            layer.setStyle({
                color: showLandmass ? 'rgba(255,255,255,0.2)' : 'transparent',
                fillColor: '#1e293b',
                fillOpacity: showLandmass ? 0.3 : 0,
                weight: 1,
                dashArray: null
            });
        } else {
            layer.setStyle({
                color: 'transparent',
                fillColor: '#000000',
                fillOpacity: 0,
                weight: 1,
                dashArray: null
            });
        }
    }

    resetAllGeoStyles() {
        // Clear all visual styles from GeoJSON layers
        if (this.geoLayer) {
            this.geoLayer.eachLayer(layer => this.resetLayerStyle(layer));
        }

        // Clean up map markers and circles
        if (this.marker) { this.map.removeLayer(this.marker); this.marker = null; }
        if (this.hintCircle) { this.map.removeLayer(this.hintCircle); this.hintCircle = null; }

        // Clear tracking sets
        this.wrongGuesses = new Set();
        this.hintedLayers = new Set();
        // NOTE: We do NOT null correctLayer here because we need it for the next phase
    }

    saveApiKey() {
        const key = this.dom.apiKeyInput.value.trim();
        if (key) {
            this.apiKey = key;
            localStorage.setItem('geodaily_gemini_key', key);
            this.checkForApiKey();
            // Trigger enrichment if we were waiting for key
            if (this.currentData && !this.currentData.person.name) {
                this.enrichGameData();
            }
        } else {
            alert('Please enter a valid API key.');
        }
    }

    openSettings() {
        this.dom.settingsModal.classList.add('active');
        this.dom.apiKeyInput.value = this.apiKey || '';
    }

    async startGame() {
        this.phase = 'LOADING';
        this.renderPhase(); // Show loading screen immediately

        this.correctLayer = null; // Reset correctly for new game
        this.resetAllGeoStyles(); // Ensure clean map for new game

        // Use a short timeout to allow the UI to update before heavy calculation
        setTimeout(() => {
            // 1. Generate Local Base Data
            const diffElem = document.getElementById('difficulty-select');
            const difficulty = diffElem ? diffElem.value : 'medium';
            this.currentData = this.generateLocalGameData(difficulty);

            if (!this.currentData) {
                console.warn("Could not generate game data. Still waiting for dataset?");
                return; // Stay in loading state or handle error
            }

            console.log("Local Data Loaded:", this.currentData);

            this.phase = 'COUNTRY_GUESS';
            // 2. Render immediately
            this.renderPhase();

            // 3. Trigger AI Enrichment in background (for later phases)
            this.enrichGameData();
        }, 100);
    }

    generateLocalGameData(difficulty) {
        if (!this.countriesData || this.countriesData.length === 0) return null;

        // Build a pool of all individual city options from the data
        let cityPool = [];
        this.countriesData.forEach(country => {
            country.cities.forEach(city => {
                // Determine difficulty based on country difficulty and capital status
                let cityDifficulty = country.difficulty;

                // If not capital, it's significantly harder to find
                if (!city.is_capital) {
                    if (cityDifficulty === 'easy') cityDifficulty = 'medium';
                    else if (cityDifficulty === 'medium') cityDifficulty = 'hard';
                    else if (cityDifficulty === 'hard') cityDifficulty = 'extreme';
                }

                // Dynamic radii based on city "importance"
                let hintRadius = 40000; // Default 40km
                let snapRadius = 3000;  // Default 3km

                if (city.is_capital) {
                    if (country.difficulty === 'easy') { hintRadius = 100000; snapRadius = 12000; }
                    else if (country.difficulty === 'medium') { hintRadius = 80000; snapRadius = 10000; }
                    else { hintRadius = 60000; snapRadius = 8000; }
                } else {
                    if (country.difficulty === 'easy') { hintRadius = 50000; snapRadius = 6000; }
                    else if (country.difficulty === 'medium') { hintRadius = 40000; snapRadius = 4000; }
                    else { hintRadius = 30000; snapRadius = 2500; } // Very strict for small towns
                }

                cityPool.push({
                    countryRef: country,
                    city: city,
                    calculatedDifficulty: cityDifficulty,
                    hintRadius: hintRadius,
                    snapRadius: snapRadius
                });
            });
        });

        // Filter based on selected difficulty (Mutually exclusive for better consistency)
        let candidates = cityPool.filter(c => c.calculatedDifficulty === difficulty);

        // Fallback ifpool is empty (shouldn't happen with large dataset but just in case)
        if (candidates.length === 0) {
            candidates = cityPool.filter(c => c.calculatedDifficulty === 'medium');
        }

        // Filter out used cities (granular tracking)
        const available = candidates.filter(c => !this.usedCities.has(`${c.countryRef.name}:${c.city.name}`));
        let selection = available.length > 0 ? available : candidates;

        // Final safety fallback: If still empty, use everything in the pool
        if (selection.length === 0) {
            console.warn("Difficulty filter returned zero results. Falling back to full city pool.");
            selection = cityPool;
        }

        if (selection.length === 0) {
            console.error("Critical error: No cities found in dataset.");
            return null;
        }

        const result = selection[Math.floor(Math.random() * selection.length)];
        const country = result.countryRef;
        const city = result.city;

        // Save usage
        this.usedCities.add(`${country.name}:${city.name}`);
        localStorage.setItem('geodaily_used_cities', JSON.stringify(Array.from(this.usedCities)));

        // Helper to generate distractor numbers
        const makeOptions = (valStr, isMoney = false) => {
            if (!valStr || valStr === "Unknown" || valStr === "Data Pending" || valStr === "N/A") {
                return null; // Signal that this stat is invalid
            }
            let clean = valStr.replace(/,/g, '').replace(' km²', '').replace('$', '').replace(' Trillion', '').replace(' Billion', '');
            let val = parseFloat(clean);
            if (isNaN(val) || val === 0) return null;

            if (isMoney) {
                if (valStr.includes('Trillion')) val *= 1000000000000;
                else if (valStr.includes('Billion')) val *= 1000000000;
            }

            const options = [valStr];
            let attempts = 0;
            while (options.length < 4 && attempts < 100) {
                attempts++;
                const vary = 1 + (Math.random() * 0.8 - 0.4); // Wider range
                let fakeVal = val * vary;
                let fakeStr = "";
                if (isMoney) {
                    let billions = fakeVal / 1000000000;
                    if (billions > 1000) fakeStr = `$${(billions / 1000).toFixed(1)} Trillion`;
                    else fakeStr = `$${billions.toFixed(1)} Billion`;
                } else {
                    fakeStr = Math.floor(fakeVal).toLocaleString();
                    if (valStr.includes('km²')) fakeStr += ' km²';
                }
                if (!options.includes(fakeStr) && fakeStr !== "0") options.push(fakeStr);
            }
            return options.sort(() => Math.random() - 0.5);
        };

        // Flag options
        const flagOptions = [{ url: `https://flagcdn.com/w320/${country.code}.png`, is_correct: true }];
        while (flagOptions.length < 4) {
            const r = this.countriesData[Math.floor(Math.random() * this.countriesData.length)];
            if (r.code !== country.code && !flagOptions.find(f => f.url.includes(r.code))) {
                flagOptions.push({ url: `https://flagcdn.com/w320/${r.code}.png`, is_correct: false });
            }
        }

        // Build Stats Quiz objects, only including valid data
        const countryQuiz = {};
        const popOpts = makeOptions(country.stats.population);
        if (popOpts) countryQuiz.population = { question: "What is the population size?", correct: country.stats.population, options: popOpts };

        const areaOpts = makeOptions(country.stats.area);
        if (areaOpts) countryQuiz.area = { question: "What is the total area?", correct: country.stats.area, options: areaOpts };

        const gdpOpts = makeOptions(country.stats.gdp, true);
        if (gdpOpts) countryQuiz.gdp = { question: "What is the approximate GDP?", correct: country.stats.gdp, options: gdpOpts };

        const cityQuiz = {};
        const cityPopOpts = makeOptions(city.pop);
        if (cityPopOpts) cityQuiz.population = { question: `What is the population of ${city.name}?`, correct: city.pop, options: cityPopOpts };

        return {
            country: country.name,
            country_code: country.code,
            continent: country.continent,
            coordinates: country.coordinates,
            flag_options: flagOptions.sort(() => Math.random() - 0.5),
            stats_quiz: countryQuiz,
            city: {
                name: city.name,
                coordinates: city.coordinates,
                stats_quiz: cityQuiz,
                hint_radius: result.hintRadius,
                snap_radius: result.snapRadius
            },
            historical_fact: "Loading interesting history...",
            person: { name: "Loading...", role: "Famous Figure", bio: "We are finding a local legend...", fact: "Did you know? loading..." },
            history: "Loading context..."
        };
    }

    async enrichGameData() {
        if (!this.client || !this.currentData) return;

        console.log("Fetching AI enrichment...");
        try {
            const enrichment = await this.client.enrichGameData(this.currentData.country, this.currentData.city.name);
            console.log("Enrichment received:", enrichment);

            // Merge into current data
            this.currentData.person = enrichment.person;
            this.currentData.history = enrichment.history;
            this.currentData.historical_fact = enrichment.historical_fact;

            // If we are currently ON one of these phases, re-render to show data
            if (['HISTORICAL_FACT', 'PERSON_GUESS', 'HISTORY'].includes(this.phase)) {
                this.renderPhase();
            }
        } catch (e) {
            console.error("Enrichment failed", e);
            this.currentData.historical_fact = "Could not load history.";
            this.currentData.history = "Could not load history.";
            // Only overwrite if it wasn't already set to something valid
            if (this.currentData.person.name === "Loading...") {
                this.currentData.person.name = "Unknown";
                this.currentData.person.bio = "Could not fetch data.";
            }
        }
    }

    async handleGeoClick(e, feature, layer) {
        if (this.phase !== 'COUNTRY_GUESS' || this.guessedCorrectly) return;

        // Initialize tracking sets if not present
        if (!this.wrongGuesses) this.wrongGuesses = new Set();

        const clickedName = feature.properties.name || feature.properties.admin || feature.id;
        const featureId = layer._featureId;
        // Normalize: try to match name or ID with code/name
        const targetCode = this.currentData.country_code.toUpperCase();
        const targetName = this.currentData.country.toUpperCase();

        let isCorrect = false;

        // Check ID (ISO 3 usually) vs Code (2 letter) - tricky.
        // Check Name
        if (clickedName && (
            clickedName.toUpperCase() === targetName ||
            feature.id === targetCode
        )) {
            isCorrect = true;
        } else {
            if (feature.properties.ISO_A2 && feature.properties.ISO_A2 === targetCode) isCorrect = true;
            if (clickedName.toUpperCase().includes(targetName) || targetName.includes(clickedName.toUpperCase())) isCorrect = true;
        }

        if (isCorrect) {
            this.guessedCorrectly = true;
            this.correctLayer = layer;
            // Clear all highlights (wrong/hinted) immediately on success
            this.resetAllGeoStyles();

            // Re-apply green to just the correct one
            layer.setStyle({ fillColor: '#22c55e', fillOpacity: 0.6, color: '#166534', weight: 3 });

            this.showToast('Correct! Well done.', 'success');
            setTimeout(() => this.nextPhase(), 1500);
        } else {
            // Track this as a wrong guess (so mouseout doesn't reset it)
            this.wrongGuesses.add(featureId);
            layer.setStyle({ fillColor: '#ef4444', fillOpacity: 0.4, color: '#991b1b' }); // Red, persistent
            this.showToast(`Not quite. That's ${clickedName}.`, 'error');
        }
    }

    // Deprecated the old Nominatim click handler, replaced with this stub or removal
    handleMapClick(e) {
        if (this.phase === 'COUNTRY_GUESS') {
            // Do nothing here, we rely on GeoJSON click
        } else if (this.phase === 'CITY_FIND') {
            // Keep City Find logic
            const d = this.map.distance(e.latlng, this.currentData.city.coordinates);
            const tolerance = this.currentData.city.snap_radius;

            if (d < tolerance) {
                this.showToast(`Found ${this.currentData.city.name}!`, 'success');
                if (this.marker) this.map.removeLayer(this.marker);
                if (this.hintCircle) this.map.removeLayer(this.hintCircle);
                this.marker = L.marker(this.currentData.city.coordinates).addTo(this.map);
                setTimeout(() => this.nextPhase(), 1500);
            } else {
                this.showToast(`Missed by ${Math.round(d / 1000)}km.`, 'error');
            }
        }
    }

    showAnswer() {
        if (this.phase === 'COUNTRY_GUESS') {
            this.guessedCorrectly = true; // Stop play
            this.resetAllGeoStyles();
            // Find layer
            this.geoLayer.eachLayer(layer => {
                const p = layer.feature.properties;
                if (p.ISO_A2 === this.currentData.country_code.toUpperCase() || p.name === this.currentData.country) {
                    layer.setStyle({ fillColor: '#fbbf24', fillOpacity: 0.6, color: '#d97706', weight: 3 }); // Gold
                }
            });
            // Use currentData.coordinates instead of layer bounds to avoid dateline/zoom issues
            this.map.flyTo(this.currentData.coordinates, 4);
            setTimeout(() => this.nextPhase(), 2000);
        } else if (this.phase === 'CITY_FIND') {
            const coords = this.currentData.city.coordinates;
            if (this.marker) this.map.removeLayer(this.marker);
            this.marker = L.marker(coords).addTo(this.map);
            this.map.flyTo(coords, 10);
            this.showToast(`It's right here!`, 'info');
            setTimeout(() => this.nextPhase(), 2000);
        } else {
            // For other phases just skip
            this.nextPhase();
        }
    }

    // Helper for cardinal direction
    getBearing(start, end) {
        // Simple approximation
        const latDiff = end[0] - start.lat;
        const lngDiff = end[1] - start.lng;
        if (Math.abs(latDiff) > Math.abs(lngDiff)) {
            return latDiff > 0 ? 'North' : 'South';
        } else {
            return lngDiff > 0 ? 'East' : 'West';
        }
    }

    showToast(msg, type = 'info') {
        const t = document.createElement('div');
        t.className = `toast toast-${type}`;
        t.style.cssText = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            background: ${type === 'success' ? 'var(--success)' : 'var(--error)'};
            color: white; pxdding: 10px 20px; border-radius: 20px;
            padding: 0.5rem 1rem; font-weight: 600; box-shadow: 0 5px 15px rgba(0,0,0,0.3);
            z-index: 1000; animation: fadeUp 0.3s ease;
        `;
        t.innerText = msg;
        document.body.appendChild(t);
        setTimeout(() => { t.remove(); }, 3000);
    }

    nextPhase() {
        const phases = ['COUNTRY_GUESS', 'FLAG_GUESS', 'STATS_COUNTRY', 'CITY_FIND', 'STATS_CITY', 'HISTORICAL_FACT', 'PERSON_GUESS', 'HISTORY'];
        const currentIdx = phases.indexOf(this.phase);
        if (currentIdx < phases.length - 1) {
            this.phase = phases[currentIdx + 1];
            this.renderPhase();
        } else {
            // New round
            this.startGame();
        }
    }

    // Helper to sanitize HTML to prevent XSS
    escapeHTML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    renderPhase() {
        const p = this.dom.phaseContent;
        if (!p) return;
        p.innerHTML = '';
        this.dom.contentOverlay.classList.remove('hidden');

        if (this.phase !== 'LOADING' && !this.currentData) {
            p.innerHTML = `<div class="loader">Waiting for game data...</div>`;
            return;
        }

        const setView = (coords, zoom) => this.map.setView(coords, zoom, { animate: true, duration: 1.5 });

        switch (this.phase) {
            case 'LOADING':
                p.innerHTML = `<div class="loader"><i class="fa-solid fa-circle-notch fa-spin"></i> Generating your journey...</div>`;
                break;

            case 'COUNTRY_GUESS':
                this.missedClicks = 0;
                this.guessedCorrectly = false;
                this.wrongGuesses = new Set();
                this.hintedLayers = new Set();
                this.hintLevel = 0;
                // Reset all layer styles from previous round
                this.resetAllGeoStyles();

                p.innerHTML = `
                    <h3>Where is <strong>${this.currentData.country}</strong>?</h3>
                    <p>Find and click it on the map.</p>
                    <div id="hint-container" style="margin-top:10px;">
                        <div style="display:flex; gap:10px; justify-content:center; margin-bottom:10px;">
                            <button id="show-hint-btn" class="btn-secondary" style="font-size:0.8rem">Show Hint</button>
                            <button id="show-answer-btn" class="btn-secondary" style="font-size:0.8rem">Show Answer</button>
                        </div>
                    </div>
                `;
                p.querySelector('#show-answer-btn').onclick = () => this.showAnswer();
                p.querySelector('#show-hint-btn').onclick = (e) => {
                    this.hintLevel++;

                    if (this.hintLevel === 1) {
                        // First hint: Show continent
                        e.target.innerText = 'More Hints';
                        if (this.currentData.continent) {
                            const hintP = document.createElement('p');
                            hintP.className = 'hint fade-in';
                            hintP.style.marginTop = '10px';
                            hintP.innerHTML = `<i class="fa-solid fa-compass"></i> It's in <strong>${this.escapeHTML(this.currentData.continent)}</strong>.`;
                            p.querySelector('#hint-container').appendChild(hintP);
                        }
                    } else if (this.hintLevel === 2) {
                        // Second hint: Highlight nearby countries
                        e.target.style.display = 'none';

                        const trueLat = this.currentData.coordinates[0];
                        const trueLng = this.currentData.coordinates[1];
                        const offsetLat = (Math.random() - 0.5) * 15;
                        const offsetLng = (Math.random() - 0.5) * 15;
                        const centerLatLng = L.latLng(trueLat + offsetLat, trueLng + offsetLng);
                        const radius = 1500000 + (Math.random() * 500000);

                        this.geoLayer.eachLayer(layer => {
                            const bounds = layer.getBounds();
                            const center = bounds.getCenter();
                            if (center.distanceTo(centerLatLng) < radius) {
                                this.hintedLayers.add(layer._featureId);
                                layer.setStyle({
                                    color: '#fbbf24',
                                    weight: 2,
                                    dashArray: '5, 5',
                                    fillOpacity: 0.15,
                                    fillColor: '#fbbf24'
                                });
                            }
                        });

                        // Ensure target is highlighted
                        this.geoLayer.eachLayer(layer => {
                            const props = layer.feature.properties;
                            const targetCode = this.currentData.country_code.toUpperCase();
                            if (props.ISO_A2 === targetCode || props.name === this.currentData.country) {
                                this.hintedLayers.add(layer._featureId);
                                layer.setStyle({
                                    color: '#fbbf24',
                                    weight: 2,
                                    dashArray: '5, 5',
                                    fillOpacity: 0.15,
                                    fillColor: '#fbbf24'
                                });
                            }
                        });

                        this.map.flyTo(centerLatLng, 4);
                        const hintP = document.createElement('p');
                        hintP.className = 'hint fade-in';
                        hintP.innerHTML = `<i class="fa-solid fa-map-location-dot"></i> One of the highlighted countries is the target!`;
                        p.querySelector('#hint-container').appendChild(hintP);
                    }
                };
                setView([20, 0], 2);
                break;

            case 'FLAG_GUESS':
                // Reduce the correct country to outline-only (remove fill)
                if (this.correctLayer) {
                    this.correctLayer.setStyle({ fillOpacity: 0, color: '#166534', weight: 2 });
                }
                this.dom.contentOverlay.classList.remove('hidden');
                p.innerHTML = `<h3>Which flag is for <strong>${this.escapeHTML(this.currentData.country)}</strong>?</h3>
                               <div id="flag-grid" class="flag-grid"></div>`;

                const grid = p.querySelector('#flag-grid');
                this.currentData.flag_options.sort(() => 0.5 - Math.random()).forEach(flag => {
                    const img = document.createElement('img');
                    img.src = flag.url;
                    img.className = 'flag-btn';
                    img.onclick = () => {
                        if (flag.is_correct) {
                            this.showToast('Correct Flag!', 'success');
                            setTimeout(() => this.nextPhase(), 1000);
                        } else {
                            this.showToast('Wrong flag!', 'error');
                            img.style.opacity = '0.3';
                            img.style.pointerEvents = 'none';
                        }
                    };
                    grid.appendChild(img);
                });
                break;

            case 'STATS_COUNTRY':
                if (Object.keys(this.currentData.stats_quiz).length === 0) {
                    this.nextPhase();
                    return;
                }
                p.innerHTML = `<h3>${this.escapeHTML(this.currentData.country)} Stats</h3><div id="quiz-container"></div>`;
                this.renderStatsQuiz(p.querySelector('#quiz-container'), this.currentData.stats_quiz, () => {
                    // When quiz done
                    const btn = document.createElement('button');
                    btn.className = 'btn-primary fade-in';
                    btn.style.marginTop = '1rem';
                    btn.innerText = 'Next: The City';
                    btn.onclick = () => this.nextPhase();
                    p.appendChild(btn);
                });
                setView(this.currentData.coordinates, 5);
                break;

            case 'CITY_FIND':
                p.innerHTML = `
                    <h3>Find <strong>${this.currentData.city.name}</strong></h3>
                    <p>Click on the map where you think this city is located.</p>
                    <div id="city-hint-container" style="margin-top:10px; display:flex; gap:10px; justify-content:center;">
                        <button id="show-city-hint-btn" class="btn-secondary" style="font-size:0.8rem">Show Hint</button>
                        <button id="show-city-answer-btn" class="btn-secondary" style="font-size:0.8rem">Show Answer</button>
                    </div>
                `;
                p.querySelector('#show-city-answer-btn').onclick = () => this.showAnswer();
                p.querySelector('#show-city-hint-btn').onclick = (e) => {
                    e.target.style.display = 'none';
                    const center = this.map.getCenter();
                    const dir = this.getBearing(center, this.currentData.city.coordinates);
                    const hintParam = document.createElement('p');
                    hintParam.className = 'hint fade-in';
                    hintParam.innerHTML = `<i class="fa-solid fa-compass"></i> It is generally towards the <strong>${dir}</strong> from the screen center.`;
                    p.querySelector('#city-hint-container').appendChild(hintParam);

                    // Add visual hint circle
                    if (this.hintCircle) this.map.removeLayer(this.hintCircle);
                    this.hintCircle = L.circle(this.currentData.city.coordinates, {
                        radius: this.currentData.city.hint_radius,
                        color: '#fbbf24',
                        fillColor: '#fbbf24',
                        fillOpacity: 0.15,
                        dashArray: '5, 5',
                        weight: 1
                    }).addTo(this.map);
                    this.map.flyTo(this.currentData.city.coordinates, 8);
                };
                break;

            case 'STATS_CITY':
                if (Object.keys(this.currentData.city.stats_quiz).length === 0) {
                    this.nextPhase();
                    return;
                }
                if (!this.marker) {
                    this.marker = L.marker(this.currentData.city.coordinates).addTo(this.map);
                }
                setView(this.currentData.city.coordinates, 10);

                p.innerHTML = `<h3>${this.escapeHTML(this.currentData.city.name)} Stats</h3><div id="city-quiz-container"></div>`;
                this.renderStatsQuiz(p.querySelector('#city-quiz-container'), this.currentData.city.stats_quiz, () => {
                    const btn = document.createElement('button');
                    btn.className = 'btn-primary fade-in';
                    btn.style.marginTop = '1rem';
                    btn.innerText = 'Next: A bit of History';
                    btn.onclick = () => this.nextPhase();
                    p.appendChild(btn);
                });
                break;

            case 'HISTORICAL_FACT':
                p.innerHTML = `
                    <h3>History Check</h3>
                    <div class="fact-box fade-in" style="background:rgba(255,255,255,0.1); padding:2rem; border-radius:12px; margin:2rem 0; border-left: 5px solid #a855f7; text-align:left;">
                        <i class="fa-solid fa-landmark" style="color:#a855f7; font-size:1.5rem; margin-bottom:1rem; display:block;"></i>
                        <p style="font-size:1.1rem; line-height:1.6; color:white;">
                            ${this.escapeHTML(this.currentData.historical_fact || "History is full of mysteries...")}
                        </p>
                    </div>
                    <button class="btn-primary" onclick="window.game.nextPhase()">Who lives here? <i class="fa-solid fa-user"></i></button>
                `;
                break;

            case 'PERSON_GUESS':
                p.innerHTML = `
                    <h3>Famous Figure</h3>
                    <p><strong>${this.escapeHTML(this.currentData.person.name)}</strong></p>
                    <p><em>${this.escapeHTML(this.currentData.person.role)}</em></p>
                    <p class="fade-in" style="margin-top:10px">${this.escapeHTML(this.currentData.person.bio)}</p>
                    <div id="person-dynamic-area">
                        <div class="fact-box" style="background:rgba(255,255,255,0.1); padding:15px; border-radius:8px; margin-top:15px; border-left: 4px solid #fbbf24; text-align:left;">
                            <strong style="color:#fbbf24; margin-bottom:5px; display:block;">Did you know?</strong>
                            ${this.escapeHTML(this.currentData.person.fact).replace('Did you know?', '')}
                        </div>
                    </div>
                    
                    <div class="controls-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:1rem;">
                        <button id="more-info-btn" class="btn-secondary"><i class="fa-solid fa-circle-info"></i> more info</button>
                        <button id="next-person-btn" class="btn-secondary"><i class="fa-solid fa-user-plus"></i> someone else</button>
                    </div>
                    <button class="btn-primary" style="margin-top:10px;" onclick="window.game.nextPhase()">Wrap up</button>
                `;

                // Handle Follow-ups
                p.querySelector('#more-info-btn').onclick = async (e) => {
                    const btn = e.target.closest('button');
                    const originalText = btn.innerHTML;
                    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                    btn.disabled = true;

                    try {
                        const data = await this.client.generateFollowUp(this.currentData, 'MORE_INFO');
                        const area = p.querySelector('#person-dynamic-area');

                        // Append new facts
                        data.facts.forEach(fact => {
                            const div = document.createElement('div');
                            div.className = 'fact-box fade-in';
                            div.style.cssText = `background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; margin-top:10px; text-align:left; font-size:0.9rem;`;
                            div.innerHTML = `<i class="fa-solid fa-plus" style="color:#38bdf8; margin-right:5px;"></i> ${this.escapeHTML(fact)}`;
                            area.appendChild(div);
                        });
                        btn.remove(); // Remove button after use
                    } catch (err) {
                        this.showToast('Failed.', 'error');
                        btn.innerHTML = originalText;
                        btn.disabled = false;
                    }
                };

                p.querySelector('#next-person-btn').onclick = async (e) => {
                    const btn = e.target.closest('button');
                    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                    try {
                        const newPerson = await this.client.generateFollowUp(this.currentData, 'OTHER_PERSON');
                        // Update current data so "more info" works for new person too
                        this.currentData.person = newPerson;
                        this.renderPhase(); // Re-render this phase with new person
                    } catch (err) {
                        this.showToast('Failed.', 'error');
                        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> someone else';
                    }
                };
                break;

            case 'HISTORY':
                p.innerHTML = `
                    <h3>Historical Context</h3>
                    <p>${this.escapeHTML(this.currentData.history)}</p>
                    <div id="history-dynamic-area"></div>
                    <button id="history-more-btn" class="btn-secondary" style="margin-top:1rem; width:100%"><i class="fa-solid fa-book-open"></i> Tell me more</button>
                    <button class="btn-primary" style="margin-top:2rem;" onclick="window.game.nextPhase()">Start New Journey <i class="fa-solid fa-plane"></i></button>
                `;

                p.querySelector('#history-more-btn').onclick = async (e) => {
                    const btn = e.target;
                    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                    try {
                        const data = await this.client.generateFollowUp(this.currentData, 'HISTORY_DEEP_DIVE');
                        const area = p.querySelector('#history-dynamic-area');
                        const ul = document.createElement('ul');
                        ul.style.cssText = "text-align:left; margin-top:15px; padding-left:20px; color:#cbd5e1; font-size:0.9rem;";
                        data.points.forEach(pt => {
                            const li = document.createElement('li');
                            li.innerText = pt;
                            li.style.marginBottom = "8px";
                            ul.appendChild(li);
                        });
                        area.appendChild(ul);
                        btn.remove();
                    } catch (err) {
                        this.showToast('Failed.', 'error');
                        btn.innerHTML = 'retry';
                    }
                };
                break;
        }
    }

    renderStatsQuiz(container, quizData, onComplete) {
        let keys = Object.keys(quizData);
        let current = 0;

        const showQuestion = () => {
            if (current >= keys.length) {
                onComplete();
                return;
            }
            const key = keys[current];
            const q = quizData[key];

            container.innerHTML = `
                <div class="fade-in">
                    <p style="margin-bottom:10px; font-weight:600; color:#cbd5e1;">${this.escapeHTML(q.question)}</p>
                    <div class="choices-list"></div>
                </div>
            `;

            const list = container.querySelector('.choices-list');
            // Shuffle options
            q.options.sort(() => 0.5 - Math.random()).forEach(opt => {
                const btn = document.createElement('button');
                btn.innerText = opt;
                btn.onclick = () => {
                    const btns = Array.from(list.children);
                    btns.forEach(b => b.disabled = true);

                    let isCorrect = (opt === q.correct);

                    if (isCorrect) {
                        this.showToast('Correct!', 'success');
                        btn.style.border = '1px solid var(--success)';
                        btn.style.background = 'rgba(34, 197, 94, 0.2)';
                    } else {
                        btn.style.border = '1px solid var(--error)';
                        // Highlight correct one
                        const correctBtn = btns.find(b => b.innerText === q.correct);
                        if (correctBtn) {
                            correctBtn.style.border = '1px solid var(--success)';
                            correctBtn.style.backgroundColor = 'rgba(34, 197, 94, 0.2)';
                        }
                    }

                    setTimeout(() => {
                        current++;
                        showQuestion();
                    }, 2000); // Longer wait to read answer
                };
                list.appendChild(btn);
            });
        };
        showQuestion();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.game = new GeoDaily();
});
