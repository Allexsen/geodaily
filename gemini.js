/**
 * Gemini API Client
 */

export class GeminiClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        // Gemini 2.5 is the 2025 standard.
        this.modelParams = "gemini-2.5-flash";
        this.baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelParams}:generateContent`;

        // Load used cities from persistence
        const stored = localStorage.getItem('geodaily_used_cities');
        this.usedCities = stored ? new Set(JSON.parse(stored)) : new Set();
    }

    /**
     * Helper to robustly extract JSON from AI text
     */
    extractJSON(text) {
        try {
            // First try direct parse (if AI was perfect)
            return JSON.parse(text);
        } catch (e) {
            // Try to find the first '{' and last '}'
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start !== -1 && end !== -1) {
                const jsonStr = text.substring(start, end + 1);
                try {
                    return JSON.parse(jsonStr);
                } catch (e2) {
                    console.error("Sub-string JSON parse failed", e2, jsonStr);
                    throw e2;
                }
            }
            throw new Error("No JSON found in response");
        }
    }

    async enrichGameData(country, city) {
        if (!this.apiKey) throw new Error("API Key Missing");

        const prompt = `
            Context: The user is playing a geography game about ${city}, ${country}.
            
            We already have the stats. We need the cultural and historical "flavor" text.
            
            Return ONLY valid JSON with this structure:
            {
                "historical_fact": "A fascinating, single-sentence historical fact.",
                "person": {
                    "name": "Name",
                    "role": "Role",
                    "fact": "Did you know? [Fact]",
                    "bio": "Bio"
                },
                "history": "Brief summary"
            }
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

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                console.error("Gemini API Error:", errData);

                // Special hint if model not found
                if (response.status === 404) {
                    this.listAvailableModels();
                }
                throw new Error(`AI API Error (${response.status})`);
            }

            const data = await response.json();
            if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
                throw new Error('Invalid AI response structure');
            }

            return this.extractJSON(data.candidates[0].content.parts[0].text);
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
            prompt = `Name another DIFFERENT famous person from ${contextData.city.name}, ${contextData.country} (NOT ${contextData.person.name}). Return valid JSON: { "name": "Name", "role": "Role", "fact": "Did you know? [Fact]", "bio": "Short bio" }`;
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

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                console.error("Follow-up API Error:", errData);
                if (response.status === 404) {
                    this.listAvailableModels();
                }
                throw new Error(`AI API Error (${response.status})`);
            }

            const data = await response.json();
            if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
                throw new Error('Invalid AI response structure');
            }

            return this.extractJSON(data.candidates[0].content.parts[0].text);
        } catch (error) {
            console.error("Follow-up logic failure:", error);
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
