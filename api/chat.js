import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

const sql = neon('postgresql://neondb_owner:npg_RKe0bD6jwSrh@ep-quiet-cherry-a45jj9ee.us-east-1.aws.neon.tech/neondb?sslmode=require');
const OLLAMA_API_KEY = 'fd6bfc3a5e534979a562387474fff219.XWr5VBH7jhPIdBeYkljTINc1';

function verifyToken(token) {
    if (!token) return null;
    try {
        const payload = JSON.parse(Buffer.from(token, 'base64').toString());
        if (payload.exp < Date.now()) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id, x-conversation-id');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

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

    // ----- POST: Chat + Save -----
    if (req.method === 'POST') {
        const { model, messages, userId, conversationId } = req.body;

        if (!model || !messages) {
            return res.status(400).json({ error: 'Missing model or messages' });
        }

        try {
            console.log('Calling Ollama with model:', model);
            
            const response = await fetch('https://api.ollama.com/api/chat', {
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

            if (!response.ok) {
                const errText = await response.text();
                console.error('Ollama error:', errText);
                return res.status(response.status).json({ error: errText });
            }

            const data = await response.json();
            const botReply = data.message?.content || data.response;
            
            console.log('Got reply, length:', botReply?.length);

            let convId = conversationId;

            // Save to database if user is logged in
            if (userId && botReply) {
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
                    VALUES (${convId}, 'assistant', ${botReply}, ${model})
                `;
                await sql`
                    UPDATE conversations SET updated_at = NOW()
                    WHERE id = ${convId}
                `;

                return res.status(200).json({
                    message: { content: botReply },
                    conversationId: convId
                });
            }

            // Not logged in — just return the reply
            return res.status(200).json({
                message: { content: botReply }
            });

        } catch (error) {
            console.error('Fatal error:', error);
            return res.status(500).json({ error: error.message });
        }
    }
    // ----- DELETE CONVERSATION -----
    if (req.method === 'POST' && action === 'delete') {
        const { conversationId } = req.body || {};
        const userId = req.headers['x-user-id'];

        if (!conversationId || !userId) {
            return res.status(400).json({ error: 'Missing conversationId or userId' });
        }

        try {
            // Delete messages first (CASCADE should handle this, but being safe)
            await sql`DELETE FROM messages WHERE conversation_id = ${conversationId}`;
            await sql`DELETE FROM conversations WHERE id = ${conversationId} AND user_id = ${userId}`;
            
            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
    return res.status(405).json({ error: 'Method not allowed' });
}
