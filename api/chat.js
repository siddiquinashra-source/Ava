import { neon } from '@neondatabase/serverless';
import { createNeonAuth } from '@neondatabase/auth/next/server';

// Database connection
const sql = neon(process.env.NEON_DATABASE_URL);

// Neon Auth setup
const auth = createNeonAuth({
    baseUrl: process.env.VERCEL_URL || 'http://localhost:3000',
    cookies: {
        secret: process.env.NEON_AUTH_COOKIE_SECRET
    }
});

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || 'fd6bfc3a5e534979a562387474fff219.XWr5VBH7jhPIdBeYkljTINc1';

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Verify auth
    const session = await auth.getSession(req);
    
    // GET: Load history
    if (req.method === 'GET') {
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        
        try {
            const conversations = await sql`
                SELECT id, title, created_at, updated_at
                FROM conversations
                WHERE user_id = ${session.user.id}
                ORDER BY updated_at DESC
            `;
            return res.status(200).json({ conversations });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // POST: Chat + Save
    if (req.method === 'POST') {
        const { model, messages, conversationId } = req.body;
        
        try {
            const response = await fetch('https://api.ollama.com/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OLLAMA_API_KEY}`
                },
                body: JSON.stringify({ model, messages, stream: false })
            });

            const data = await response.json();
            const botReply = data.message?.content || data.response;

            // Save if authenticated
            if (session && botReply) {
                let convId = conversationId;
                if (!convId) {
                    const newConv = await sql`
                        INSERT INTO conversations (user_id, title)
                        VALUES (${session.user.id}, ${messages[messages.length-1].content.substring(0, 100)})
                        RETURNING id
                    `;
                    convId = newConv[0].id;
                }
                
                await sql`
                    INSERT INTO messages (conversation_id, role, content, model)
                    VALUES (${convId}, 'user', ${messages[messages.length-1].content}, ${model}),
                           (${convId}, 'assistant', ${botReply}, ${model})
                `;
                
                return res.status(200).json({ 
                    message: { content: botReply }, 
                    conversationId: convId 
                });
            }

            return res.status(200).json({ message: { content: botReply } });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
}
