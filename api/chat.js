export default async function handler(req, res) {
    // Allow requests from any origin (CORS)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const apiKey = process.env.OLLAMA_API_KEY;
        if (!apiKey) {
            throw new Error('API key not configured on the server');
        }

        const ollamaResponse = await fetch('https://api.ollama.com/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(req.body)
        });

        const data = await ollamaResponse.json();
        res.status(ollamaResponse.status).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
