// api/auth/google.js
import { neon } from '@neondatabase/serverless';
import { OAuth2Client } from 'google-auth-library';

const sql = neon(process.env.NEON_DATABASE_URL);
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { credential } = req.body;
  if (!credential) {
    res.status(400).json({ error: 'Missing credential' });
    return;
  }

  try {
    // Verify the Google ID token
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    
    // Extract user info from Google's response
    const googleId = payload['sub'];
    const email = payload['email'];
    const name = payload['name'];
    const picture = payload['picture'];

    // Check if user exists in your database, otherwise create them
    let user = await sql`SELECT id FROM users WHERE id = ${googleId}`;
    if (user.length === 0) {
      // Create new user (no password for Google account)
      await sql`
        INSERT INTO users (id, email, password, name, created_at)
        VALUES (${googleId}, ${email}, '', ${name}, NOW())
      `;
    }
    
    // Create a session token for the user (reuse your existing logic)
    const token = generateToken(googleId);
    
    res.status(200).json({
      user: { id: googleId, email, name },
      session: { access_token: token }
    });
  } catch (error) {
    console.error('Google token verification failed', error);
    res.status(401).json({ error: 'Invalid Google credential' });
  }
}
