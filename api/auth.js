// api/auth.js - Handles all auth operations via Neon Auth
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const AUTH_URL = 'https://ep-quiet-cherry-a45jj9ee.neonauth.us-east-1.aws.neon.tech/neondb/auth';

    // ----- SIGNUP -----
    if (req.method === 'POST' && req.url.endsWith('/signup')) {
        const { email, password, name } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        try {
            const response = await fetch(`${AUTH_URL}/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email,
                    password,
                    data: { name: name || email.split('@')[0] }
                })
            });

            const data = await response.json();

            if (!response.ok) {
                return res.status(response.status).json({ error: data.message || 'Signup failed' });
            }

            // Save user to our users table
            if (data.user) {
                const { neon } = await import('@neondatabase/serverless');
                const sql = neon(process.env.NEON_DATABASE_URL);
                
                await sql`
                    INSERT INTO users (id, email, name, created_at)
                    VALUES (${data.user.id}, ${email}, ${name || email.split('@')[0]}, NOW())
                    ON CONFLICT (id) DO UPDATE SET name = ${name || email.split('@')[0]}
                `;
            }

            return res.status(200).json(data);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // ----- LOGIN -----
    if (req.method === 'POST' && req.url.endsWith('/login')) {
        const { email, password } = req.body;

        try {
            const response = await fetch(`${AUTH_URL}/token?grant_type=password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (!response.ok) {
                return res.status(response.status).json({ error: data.message || 'Login failed' });
            }

            // Get user info
            const userResponse = await fetch(`${AUTH_URL}/user`, {
                headers: { 'Authorization': `Bearer ${data.access_token}` }
            });
            const userData = await userResponse.json();

            return res.status(200).json({
                session: data,
                user: userData
            });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // ----- VERIFY TOKEN -----
    if (req.method === 'POST' && req.url.endsWith('/verify')) {
        const { access_token } = req.body;

        if (!access_token) {
            return res.status(400).json({ error: 'Token required' });
        }

        try {
            const response = await fetch(`${AUTH_URL}/user`, {
                headers: { 'Authorization': `Bearer ${access_token}` }
            });

            if (!response.ok) {
                return res.status(401).json({ error: 'Invalid token' });
            }

            const userData = await response.json();
            return res.status(200).json({ user: userData });
        } catch (error) {
            return res.status(401).json({ error: 'Token verification failed' });
        }
    }

    // ----- LOGOUT -----
    if (req.method === 'POST' && req.url.endsWith('/logout')) {
        const authHeader = req.headers['authorization'];
        const token = authHeader?.replace('Bearer ', '');

        if (token) {
            try {
                await fetch(`${AUTH_URL}/logout`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } catch (e) { /* ignore */ }
        }

        return res.status(200).json({ success: true });
    }

    return res.status(404).json({ error: 'Not found' });
}
