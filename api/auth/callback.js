// api/auth/callback.js
import { neon } from '@neondatabase/serverless';
import { OAuth2Client } from 'google-auth-library';

const sql = neon(process.env.NEON_DATABASE_URL);

export default async function handler(req, res) {
    const { code } = req.query;

    if (!code) {
        res.writeHead(302, { Location: '/?error=no_code' });
        return res.end();
    }

    try {
        // Exchange code for tokens
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_CLIENT_ID || '357614574670-2b6bs52fpfibnjc7501hph59b3tnmkl9.apps.googleusercontent.com',
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: `https://${req.headers.host}/api/auth/callback`,
                grant_type: 'authorization_code'
            })
        });

        const tokens = await response.json();

        if (!tokens.id_token) {
            throw new Error('No ID token received');
        }

        // Verify the ID token
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();

        const googleId = payload['sub'];
        const email = payload['email'];
        const name = payload['name'] || email.split('@')[0];

        // Save user to database
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

        // Generate session token
        const sessionToken = Buffer.from(JSON.stringify({
            userId: googleId,
            exp: Date.now() + 7 * 24 * 60 * 60 * 1000
        })).toString('base64');

        // Redirect to main page with auth data in URL hash
        const authData = encodeURIComponent(JSON.stringify({
            token: sessionToken,
            name: name,
            email: email,
            id: googleId
        }));

        res.writeHead(302, { 
            Location: `/?auth=${authData}`
        });
        return res.end();

    } catch (error) {
        console.error('Callback error:', error);
        res.writeHead(302, { Location: '/?error=auth_failed' });
        return res.end();
    }
}
