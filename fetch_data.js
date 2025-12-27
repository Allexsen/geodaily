const fs = require('fs');
const https = require('https');

/**
 * Fetch Data script for GeoDaily
 * This script aggregates country and city data into a single optimized JSON file.
 */

const COUNTRIES_URL = 'https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/refs/heads/master/json/countries.json';
const COMBINED_URL = 'https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/refs/heads/master/json/countries%2Bstates%2Bcities.json';

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to fetch: ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

async function main() {
    console.log("Fetching datasets (this might take a moment)...");
    try {
        const [statsData, countries] = await Promise.all([
            fetchJSON(COUNTRIES_URL),
            fetchJSON(COMBINED_URL)
        ]);

        console.log(`Loaded ${countries.length} countries and ${statsData.length} stat entries.`);

        const merged = countries.map(c => {
            const stats = statsData.find(s => s.iso2 === c.iso2) || {};

            // Area formatting
            let areaStr = stats.area_sq_km ? stats.area_sq_km.toLocaleString() + " km²" : "Unknown";

            // GDP formatting
            let gdpStr = "Data Pending";
            const gdpM = stats.gdp ? parseFloat(stats.gdp) : 0;
            if (gdpM > 0) {
                const billions = gdpM / 1000;
                if (billions >= 1000) {
                    gdpStr = `$${(billions / 1000).toFixed(1)} Trillion`;
                } else {
                    gdpStr = `$${billions.toFixed(1)} Billion`;
                }
            }

            // Difficulty Logic (Country level recognizability)
            const countryPop = c.population ? parseInt(c.population) : 0;
            let countryDifficulty = "extreme";
            if (gdpM > 500000 || countryPop > 60000000) countryDifficulty = "easy";
            else if (gdpM > 50000 || countryPop > 15000000) countryDifficulty = "medium";
            else if (gdpM > 5000 || countryPop > 2000000) countryDifficulty = "hard";

            // Flatten cities from states
            let allCities = [];
            if (c.states) {
                c.states.forEach(state => {
                    if (state.cities) {
                        state.cities.forEach(city => {
                            if (city.latitude && city.longitude) {
                                allCities.push({
                                    name: city.name,
                                    coordinates: [parseFloat(city.latitude), parseFloat(city.longitude)],
                                    pop: "Unknown",
                                    is_capital: (city.name === c.capital)
                                });
                            }
                        });
                    }
                });
            }

            return {
                name: c.name,
                code: c.iso2.toLowerCase(),
                continent: c.region,
                coordinates: [parseFloat(c.latitude), parseFloat(c.longitude)],
                stats: {
                    population: c.population ? parseInt(c.population).toLocaleString() : "Unknown",
                    area: areaStr,
                    gdp: gdpStr
                },
                cities: allCities,
                difficulty: countryDifficulty
            };
        }).filter(country => country.cities.length > 0);

        fs.writeFileSync('data.json', JSON.stringify(merged));
        console.log(`Success! data.json created with ${merged.length} countries.`);
    } catch (err) {
        console.error("Aggregation failed:", err);
    }
}

main();
