import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';

// Database connection from environment variable
const sql = neon(process.env.NEON_DATABASE_URL);

// Google OAuth2 client
const googleClient = new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET
});

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + (process.env.PASSWORD_SALT || 'ava-secret-salt')).digest('hex');
}

function generateToken(userId) {
    const payload = JSON.stringify({ userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return Buffer.from(payload).toString('base64');
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action') || '';

    // ----- GOOGLE SIGN-IN (ID Token) -----
    if (req.method === 'POST' && action === 'google') {
        const { credential } = req.body || {};
        if (!credential) {
            return res.status(400).json({ error: 'Missing credential' });
        }

        try {
            const ticket = await googleClient.verifyIdToken({
                idToken: credential,
                audience: process.env.GOOGLE_CLIENT_ID
            });
            const payload = ticket.getPayload();
            
            const googleId = payload['sub'];
            const email = payload['email'];
            const name = payload['name'] || email.split('@')[0];

            let users = await sql`SELECT id FROM users WHERE id = ${googleId}`;
            if (users.length === 0) {
                const emailUsers = await sql`SELECT id FROM users WHERE email = ${email}`;
                if (emailUsers.length > 0) {
                    await sql`UPDATE users SET id = ${googleId} WHERE email = ${email}`;
                } else {
                    await sql`
                        INSERT INTO users (id, email, password, name, created_at)
                        VALUES (${googleId}, ${email}, '', ${name}, NOW())
                    `;
                }
            }

            const token = generateToken(googleId);
            return res.status(200).json({
                user: { id: googleId, email, name },
                session: { access_token: token }
            });
        } catch (error) {
            console.error('Google ID token verification failed:', error);
            return res.status(401).json({ error: 'Invalid Google credential' });
        }
    }

    // ----- GOOGLE AUTH CODE (Popup fallback) -----
    if (req.method === 'POST' && action === 'google-code') {
        const { code } = req.body || {};
        if (!code) {
            return res.status(400).json({ error: 'Missing auth code' });
        }

        try {
            const redirectUri = process.env.VERCEL_URL
                ? `https://${process.env.VERCEL_URL}/api/auth`
                : 'http://localhost:3000/api/auth';

            const { tokens } = await googleClient.getToken({
                code,
                redirect_uri: redirectUri
            });

            if (!tokens.id_token) {
                return res.status(400).json({ error: 'No ID token received' });
            }

            const ticket = await googleClient.verifyIdToken({
                idToken: tokens.id_token,
                audience: process.env.GOOGLE_CLIENT_ID
            });
            const payload = ticket.getPayload();
            
            const googleId = payload['sub'];
            const email = payload['email'];
            const name = payload['name'] || email.split('@')[0];

            let users = await sql`SELECT id FROM users WHERE id = ${googleId}`;
            if (users.length === 0) {
                const emailUsers = await sql`SELECT id FROM users WHERE email = ${email}`;
                if (emailUsers.length > 0) {
                    await sql`UPDATE users SET id = ${googleId} WHERE email = ${email}`;
                } else {
                    await sql`
                        INSERT INTO users (id, email, password, name, created_at)
                        VALUES (${googleId}, ${email}, '', ${name}, NOW())
                    `;
                }
            }

            const token = generateToken(googleId);
            return res.status(200).json({
                user: { id: googleId, email, name },
                session: { access_token: token }
            });
        } catch (error) {
            console.error('Google auth code exchange failed:', error);
            return res.status(401).json({ error: 'Google authentication failed' });
        }
    }

    // ----- SIGNUP -----
    if (req.method === 'POST' && action === 'signup') {
        const { email, password, name } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        try {
            const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
            if (existing.length > 0) {
                return res.status(400).json({ error: 'Email already registered' });
            }
            const hashedPassword = hashPassword(password);
            const userId = 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            await sql`
                INSERT INTO users (id, email, password, name, created_at)
                VALUES (${userId}, ${email}, ${hashedPassword}, ${name || email.split('@')[0]}, NOW())
            `;
            const token = generateToken(userId);
            return res.status(200).json({
                user: { id: userId, email, name: name || email.split('@')[0] },
                session: { access_token: token }
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
            const hashedPassword = hashPassword(password);
            const users = await sql`
                SELECT id, email, name FROM users 
                WHERE email = ${email} AND password = ${hashedPassword}
            `;
            if (users.length === 0) {
                const googleUsers = await sql`
                    SELECT id, email, name FROM users 
                    WHERE email = ${email} AND password = ''
                `;
                if (googleUsers.length > 0) {
                    return res.status(401).json({ 
                        error: 'This account uses Google Sign-In. Please click "Continue with Google" to sign in.' 
                    });
                }
                return res.status(401).json({ error: 'Invalid email or password' });
            }
            const user = users[0];
            const token = generateToken(user.id);
            return res.status(200).json({
                user: { id: user.id, email: user.email, name: user.name },
                session: { access_token: token }
            });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // ----- VERIFY -----
    if (req.method === 'POST' && action === 'verify') {
        const { access_token } = req.body || {};
        if (!access_token) {
            return res.status(400).json({ error: 'Token required' });
        }
        try {
            const payload = JSON.parse(Buffer.from(access_token, 'base64').toString());
            if (payload.exp < Date.now()) {
                return res.status(401).json({ error: 'Token expired' });
            }
            const users = await sql`SELECT id, email, name FROM users WHERE id = ${payload.userId}`;
            if (users.length === 0) {
                return res.status(401).json({ error: 'User not found' });
            }
            return res.status(200).json({ user: users[0] });
        } catch (error) {
            return res.status(401).json({ error: 'Invalid token' });
        }
    }

    // ----- LOGOUT -----
    if (req.method === 'POST' && action === 'logout') {
        return res.status(200).json({ success: true });
    }

    return res.status(404).json({ error: 'Not found', action });
}
