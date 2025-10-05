import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.OAUTH_CLIENT_ID || process.env.GITHUB_CLIENT_ID || process.env.OAUTH_GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET || process.env.OAUTH_GITHUB_CLIENT_SECRET;
const REDIRECT_URL = process.env.REDIRECT_URL; // e.g. https://your-oauth-domain/callback
const ORIGINS = (process.env.ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const SCOPES = process.env.SCOPES || 'public_repo'; // use 'repo' if the repo is private

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URL || ORIGINS.length === 0) {
  console.error('Missing env. Required: OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, REDIRECT_URL, ORIGINS');
}

function isAllowedOrigin(originParam) {
  try {
    const u = new URL(originParam);
    const host = u.host;
    return ORIGINS.some(o => {
      if (!o) return false;
      // allow exact host or wildcard pattern like *.example.com
      if (o.startsWith('*.')) {
        const suffix = o.slice(1); // '.example.com'
        return host.endsWith(suffix);
      }
      return host === o || host === o.replace(/^https?:\/\//, '');
    });
  } catch (e) {
    return false;
  }
}

app.use(cors({
  origin(origin, cb) {
    // allow only configured origins, or no Origin (server-to-server)
    if (!origin) return cb(null, true);
    try {
      const host = new URL(origin).host;
      if (ORIGINS.includes(host)) return cb(null, true);
    } catch { }
    return cb(null, false);
  },
  credentials: true,
}));

// GET /auth?provider=github&origin=https://site.example or &site_id=site.example
app.get('/auth', (req, res) => {
  const { provider = 'github' } = req.query;
  if (provider !== 'github') return res.status(400).send('Unsupported provider');

  // accept both origin and site_id parameters
  const raw = req.query.origin || req.query.site_id;
  if (!raw) return res.status(400).send('Origin not allowed');

  // normalize to full origin
  const origin = raw.includes('://') ? raw : `https://${raw}`;

  // allow scope override from query (else use env default)
  const scope = req.query.scope || SCOPES;

  if (!isAllowedOrigin(origin)) return res.status(400).send('Origin not allowed');

  const csrf = crypto.randomBytes(16).toString('hex');
  const statePayload = Buffer.from(JSON.stringify({ csrf, origin }), 'utf8').toString('base64url');

  // store state in httpOnly cookie for CSRF validation
  res.cookie('oauth_state', statePayload, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000, // 10 minutes
  });

  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URL);
  authorizeUrl.searchParams.set('scope', scope);
  authorizeUrl.searchParams.set('state', statePayload);

  return res.redirect(authorizeUrl.toString());
});

// GitHub redirects here with ?code&state
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send('Missing code/state');

  const cookieState = req.cookies.oauth_state;
  if (!cookieState || cookieState !== state) {
    return res.status(400).send('Invalid state');
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
  } catch {
    return res.status(400).send('Bad state');
  }

  const { origin } = parsed || {};
  if (!origin || !isAllowedOrigin(origin)) return res.status(400).send('Origin not allowed');

  try {
    const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URL,
      }),
    });
    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return res.status(400).send('Failed to obtain access token');
    }

    // Return a small page that posts the token back to the CMS window
    // Decap expects message format: 'authorization:github:success:${JSON.stringify({token, provider})}'
    const content = JSON.stringify({ token: accessToken, provider: "github" });
    const message = JSON.stringify(`authorization:github:success:${content}`);

    const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Auth Complete</title></head>
<body>
<script>
  (function(){
    function receiveMessage(e) {
      console.log("receiveMessage %o", e);
      // send message to main window with the app
      window.opener.postMessage(${message}, e.origin);
    }

    window.addEventListener("message", receiveMessage, false);

    // Start handshake with parent
    console.log("Sending message: %o", "github");
    window.opener.postMessage("authorizing:github", "*");
  })();
</script>
<p>Authentication complete. You can close this window.</p>
</body></html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (e) {
    console.error(e);

    // Return error page with proper postMessage format
    const errorContent = JSON.stringify({ error: e.message || 'OAuth error' });
    const errorMessage = JSON.stringify(`authorization:github:error:${errorContent}`);

    const errorHtml = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Auth Error</title></head>
<body>
<script>
  (function(){
    function receiveMessage(e) {
      console.log("receiveMessage %o", e);
      // send error message to main window
      window.opener.postMessage(${errorMessage}, e.origin);
    }

    window.addEventListener("message", receiveMessage, false);

    // Start handshake with parent
    console.log("Sending error message: %o", "github");
    window.opener.postMessage("authorizing:github", "*");
  })();
</script>
<p>Authentication failed. You can close this window.</p>
</body></html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(errorHtml);
  }
});

app.get('/healthz', (_req, res) => res.send('ok'));

app.listen(PORT, () => {
  console.log(`OAuth provider listening on :${PORT}`);
});

