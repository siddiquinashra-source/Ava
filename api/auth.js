// api/auth.js - Handles all auth operations via Neon Auth
export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const AUTH_URL = 'https://ep-quiet-cherry-a45jj9ee.neonauth.us-east-1.aws.neon.tech/neondb/auth';
    
    // Parse the action from the URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const action = url.pathname.split('/').pop();

    // ----- SIGNUP -----
    if (req.method === 'POST' && action === 'signup') {
        const { email, password, name } = req.body || {};

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

            const text = await response.text();
            console.log('Signup response:', text);

            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                return res.status(500).json({ 
                    error: 'Invalid response from auth server',
                    details: text.substring(0, 200)
                });
            }

            if (!response.ok) {
                return res.status(response.status).json({ 
                    error: data.message || data.error || 'Signup failed' 
                });
            }

            // Return user data
            return res.status(200).json({
                user: data.user || { 
                    id: data.id || 'user_' + Date.now(), 
                    email, 
                    name: name || email.split('@')[0] 
                },
                session: data.session || { access_token: data.access_token }
            });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // ----- LOGIN -----
    if (req.method === 'POST' && action === 'login') {
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        try {
            const response = await fetch(`${AUTH_URL}/token?grant_type=password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const text = await response.text();
            console.log('Login response:', text);

            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                return res.status(500).json({ 
                    error: 'Invalid response from auth server',
                    details: text.substring(0, 200)
                });
            }

            if (!response.ok) {
                return res.status(response.status).json({ 
                    error: data.message || data.error || 'Login failed' 
                });
            }

            return res.status(200).json({
                session: data,
                user: data.user || { id: data.user_id, email }
            });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // ----- VERIFY TOKEN -----
    if (req.method === 'POST' && action === 'verify') {
        const { access_token } = req.body || {};

        if (!access_token) {
            return res.status(400).json({ error: 'Token required' });
        }

        try {
            const response = await fetch(`${AUTH_URL}/user`, {
                headers: { 'Authorization': `Bearer ${access_token}` }
            });

            const text = await response.text();
            console.log('Verify response:', text);

            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                return res.status(401).json({ error: 'Invalid token' });
            }

            if (!response.ok) {
                return res.status(401).json({ error: 'Invalid token' });
            }

            return res.status(200).json({ user: data });
        } catch (error) {
            return res.status(401).json({ error: 'Token verification failed' });
        }
    }

    // ----- LOGOUT -----
    if (req.method === 'POST' && action === 'logout') {
        return res.status(200).json({ success: true });
    }

    return res.status(404).json({ error: 'Not found', action });
}
