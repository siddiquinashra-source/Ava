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

    console.log('Auth action:', action); // Debug

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

            const data = await response.json();

            if (!response.ok) {
                return res.status(response.status).json({ error: data.message || data.error || 'Signup failed' });
            }

            return res.status(200).json({
                user: data.user || { id: data.id, email, name: name || email.split('@')[0] },
                session: data.session || data
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

            const data = await response.json();

            if (!response.ok) {
                return res.status(response.status).json({ error: data.message || data.error || 'Login failed' });
            }

            // Get user info
            let userData = { id: data.user?.id, email };
            try {
                const userResponse = await fetch(`${AUTH_URL}/user`, {
                    headers: { 'Authorization': `Bearer ${data.access_token}` }
                });
                if (userResponse.ok) {
                    userData = await userResponse.json();
                }
            } catch (e) {
                console.log('Could not fetch user details');
            }

            return res.status(200).json({
                session: data,
                user: userData
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
    if (req.method === 'POST' && action === 'logout') {
        return res.status(200).json({ success: true });
    }

    // If no action matched
    return res.status(404).json({ 
        error: 'Not found',
        action: action,
        method: req.method 
    });
}
