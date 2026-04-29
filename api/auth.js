import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

const sql = neon('postgresql://neondb_owner:npg_RKe0bD6jwSrh@ep-quiet-cherry-a45jj9ee.us-east-1.aws.neon.tech/neondb?sslmode=require');

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'ava-secret-salt').digest('hex');
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

    const url = new URL(req.url, `http://${req.headers.host}`);
    const action = url.pathname.split('/').pop();

    // SIGNUP
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

    // LOGIN
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

    // VERIFY
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

    // LOGOUT
    if (req.method === 'POST' && action === 'logout') {
        return res.status(200).json({ success: true });
    }

    return res.status(404).json({ error: 'Not found' });
}
