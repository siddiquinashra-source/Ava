import { neon } from '@neondatabase/serverless';

// Neon database connection
const sql = neon('postgresql://neondb_owner:npg_RKe0bD6jwSrh@ep-quiet-cherry-a45jj9ee.us-east-1.aws.neon.tech/neondb?sslmode=require');

// Ollama API key
const OLLAMA_API_KEY = 'fd6bfc3a5e534979a562387474fff219.XWr5VBH7jhPIdBeYkljTINc1';

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id, x-conversation-id');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // ---------- GET: Load chat history ----------
    if (req.method === 'GET') {
        const userId = req.headers['x-user-id'];
        const conversationId = req.headers['x-conversation-id'];

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        try {
            if (conversationId) {
                // Load messages for a specific conversation
                const messages = await sql`
                    SELECT role, content, model, created_at
                    FROM messages
                    WHERE conversation_id = ${conversationId}
                    ORDER BY created_at ASC
                `;
                return res.status(200).json({ messages });
            } else {
                // List all conversations for the user
                const conversations = await sql`
                    SELECT id, title, created_at, updated_at
                    FROM conversations
                    WHERE user_id = ${userId}
                    ORDER BY updated_at DESC
                `;
                return res.status(200).json({ conversations });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Database error: ' + error.message });
        }
    }

    // ---------- POST: Chat + Save to DB ----------
    if (req.method === 'POST') {
        const { model, messages, userId, conversationId } = req.body;

        if (!model || !messages) {
            return res.status(400).json({ error: 'Missing model or messages' });
        }

        try {
            // 1. Call Ollama API
            const ollamaResponse = await fetch('https://api.ollama.com/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OLLAMA_API_KEY}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    stream: false
                })
            });

            const data = await ollamaResponse.json();

            if (!ollamaResponse.ok) {
                return res.status(ollamaResponse.status).json({ error: data.error || 'API error' });
            }

            const botReply = data.message?.content || data.response;
            let convId = conversationId;

            // 2. Save to database if user is logged in
            if (userId && botReply) {
                // Create new conversation if needed
                if (!convId) {
                    const lastUserMsg = messages[messages.length - 1];
                    const title = lastUserMsg?.content?.substring(0, 100) || 'New Chat';
                    const newConv = await sql`
                        INSERT INTO conversations (user_id, title)
                        VALUES (${userId}, ${title})
                        RETURNING id
                    `;
                    convId = newConv[0].id;
                }

                // Save user message
                const lastUserMsg = messages[messages.length - 1];
                await sql`
                    INSERT INTO messages (conversation_id, role, content, model)
                    VALUES (${convId}, 'user', ${lastUserMsg.content}, ${model})
                `;

                // Save assistant message
                await sql`
                    INSERT INTO messages (conversation_id, role, content, model)
                    VALUES (${convId}, 'assistant', ${botReply}, ${model})
                `;

                // Update conversation timestamp
                await sql`
                    UPDATE conversations SET updated_at = NOW()
                    WHERE id = ${convId}
                `;

                // Return with conversation ID
                return res.status(200).json({
                    message: { content: botReply },
                    conversationId: convId
                });
            }

            // Return without saving (user not logged in)
            return res.status(200).json({
                message: { content: botReply }
            });

        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
