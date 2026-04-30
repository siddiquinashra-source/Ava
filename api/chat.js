import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL || 'postgresql://neondb_owner:npg_RKe0bD6jwSrh@ep-quiet-cherry-a45jj9ee.us-east-1.aws.neon.tech/neondb?sslmode=require');
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || 'fd6bfc3a5e534979a562387474fff219.XWr5VBH7jhPIdBeYkljTINc1';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id, x-conversation-id');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action') || '';

    // ----- GET: Load history -----
    if (req.method === 'GET') {
        const userId = req.headers['x-user-id'];
        const conversationId = req.headers['x-conversation-id'];

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        try {
            if (conversationId) {
                const messages = await sql`
                    SELECT role, content, model, created_at
                    FROM messages
                    WHERE conversation_id = ${conversationId}
                    ORDER BY created_at ASC
                `;
                return res.status(200).json({ messages });
            } else {
                const conversations = await sql`
                    SELECT id, title, created_at, updated_at
                    FROM conversations
                    WHERE user_id = ${userId}
                    ORDER BY updated_at DESC
                `;
                return res.status(200).json({ conversations });
            }
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // ----- DELETE: Remove conversation -----
    if (req.method === 'POST' && action === 'delete') {
        const { conversationId } = req.body || {};
        const userId = req.headers['x-user-id'];

        if (!conversationId || !userId) {
            return res.status(400).json({ error: 'Missing conversationId or userId' });
        }

        try {
            await sql`DELETE FROM messages WHERE conversation_id = ${conversationId}`;
            await sql`DELETE FROM conversations WHERE id = ${conversationId} AND user_id = ${userId}`;
            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // ----- POST: Chat + Save (with streaming!) -----
    if (req.method === 'POST' && action !== 'delete') {
        const { model, messages, userId, conversationId } = req.body;

        if (!model || !messages) {
            return res.status(400).json({ error: 'Missing model or messages' });
        }

        try {
            // Call Ollama API with stream: true
            const response = await fetch('https://api.ollama.com/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OLLAMA_API_KEY}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    stream: true  // <-- Enable streaming!
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                return res.status(response.status).json({ error: errText });
            }

            // Set up streaming response to the client
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';

            // Stream tokens to the client
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        if (data.message?.content) {
                            const token = data.message.content;
                            fullResponse += token;
                            // Send token to client
                            res.write(`data: ${JSON.stringify({ token, done: false })}\n\n`);
                        }
                        if (data.done) {
                            res.write(`data: ${JSON.stringify({ token: '', done: true, conversationId: null })}\n\n`);
                        }
                    } catch (e) {
                        // Skip non-JSON lines
                    }
                }
            }

            // Save to database if user is logged in
            let convId = conversationId;
            if (userId && fullResponse) {
                if (!convId) {
                    const lastMsg = messages[messages.length - 1];
                    const title = lastMsg?.content?.substring(0, 100) || 'New Chat';
                    const newConv = await sql`
                        INSERT INTO conversations (user_id, title)
                        VALUES (${userId}, ${title})
                        RETURNING id
                    `;
                    convId = newConv[0].id;
                }

                const lastMsg = messages[messages.length - 1];
                await sql`
                    INSERT INTO messages (conversation_id, role, content, model)
                    VALUES (${convId}, 'user', ${lastMsg.content}, ${model})
                `;
                await sql`
                    INSERT INTO messages (conversation_id, role, content, model)
                    VALUES (${convId}, 'assistant', ${fullResponse}, ${model})
                `;
                await sql`
                    UPDATE conversations SET updated_at = NOW()
                    WHERE id = ${convId}
                `;

                // Send final message with conversationId
                res.write(`data: ${JSON.stringify({ token: '', done: true, conversationId: convId })}\n\n`);
            } else {
                res.write(`data: ${JSON.stringify({ token: '', done: true })}\n\n`);
            }

            res.end();

        } catch (error) {
            console.error('Fatal error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
