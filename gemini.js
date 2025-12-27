/**
 * Gemini API Client
 */

export class GeminiClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        // User requested 2.5 (It's late 2025!)
        this.modelParams = "gemini-2.5-flash";
        this.baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelParams}:generateContent`;

        // Load used cities from persistence
        const stored = localStorage.getItem('geodaily_used_cities');
        this.usedCities = stored ? new Set(JSON.parse(stored)) : new Set();
    }

    // AI now only handles the "Creative" parts: History, Trivia, and People.
    // Deterministic data (Flags, Coords, Stats) is handled locally in script.js to save tokens.
    async enrichGameData(country, city) {
        const prompt = `
            Context: The user is playing a geography game about ${city}, ${country}.
            
            We already have the stats. We need the cultural and historical "flavor" text.
            
            Return ONLY valid JSON with this structure:
            {
                "historical_fact": "A fascinating, single-sentence historical fact about ${city} (or ${country} if city is obscure).",
                "person": {
                    "name": "Name of a famous person from or associated with ${city} or ${country}",
                    "role": "e.g. Physicist / Musician",
                    "fact": "Did you know? [Insert a very specific, surprising, less known fact about them].",
                    "bio": "A short 2 sentence bio."
                },
                "history": "A very brief (2-3 sentences) historical summary of the city/country context."
            }
            
            IMPORTANT:
            - 'fact' must start with "Did you know?".
            - Make the content educational and interesting.
        `;

        try {
            const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            if (!response.ok) throw new Error('Enrichment API Request Failed');

            const data = await response.json();
            return JSON.parse(data.candidates[0].content.parts[0].text);
        } catch (error) {
            console.error("Gemini Enrichment Error:", error);
            throw error;
        }
    }

    async generateFollowUp(contextData, type) {
        let prompt = "";

        if (type === 'MORE_INFO') {
            prompt = `Tell me 3 more specific, fascinating, and lesser-known facts about ${contextData.person.name} (${contextData.person.role}) from ${contextData.city.name}. Return as valid JSON: { "facts": ["fact1", "fact2", "fact3"] }`;
        } else if (type === 'OTHER_PERSON') {
            prompt = `Name another DIFFERENT famous person from ${contextData.city.name}, ${country} (NOT ${contextData.person.name}). Return valid JSON: { "name": "Name", "role": "Role", "fact": "Did you know? [Fact]", "bio": "Short bio" }`;
        } else if (type === 'HISTORY_DEEP_DIVE') {
            prompt = `Provide a detailed, interesting, 5-point historical summary of ${contextData.country}, strictly focusing on lesser known events or specific interesting eras. Return as valid JSON: { "points": ["point1", "point2", "point3", "point4", "point5"] }`;
        }

        try {
            const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            if (!response.ok) throw new Error('API Request Failed');

            const data = await response.json();
            return JSON.parse(data.candidates[0].content.parts[0].text);
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    async listAvailableModels() {
        console.log("Attempting to list available models...");
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
            const data = await res.json();
            if (data.models) {
                const modelNames = data.models.map(m => m.name.replace('models/', '')).filter(n => n.includes('gemini'));
                const msg = `Mode '${this.modelParams}' not found.\nAvailable models:\n${modelNames.join('\n')}`;
                alert(msg);
                console.log(msg);
            }
        } catch (e) {
            console.error("Could not list models:", e);
        }
    }
}
