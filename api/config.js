// /api/config.js
// Shared JSON config blob so every device sees the same photo uploads.
// Uses the same Vercel Blob store as /api/upload.js.
import { put, list, del } from '@vercel/blob';

export const config = { api: { bodyParser: false } };

const CONFIG_PATH = 'site-config.json';

// Read + JSON-parse the request body manually. Don't rely on a framework
// auto-parsing req.body for us — plain Vercel Node functions don't always.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      resolve(req.body);
      return;
    }
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) { resolve({}); return; }
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function findExistingConfigBlob(token) {
  const { blobs } = await list({ prefix: CONFIG_PATH, token });
  return blobs.find((b) => b.pathname === CONFIG_PATH) || null;
}

async function readConfigBlob(match) {
  if (!match) return {};
  try {
    const remote = await fetch(match.url, { cache: 'no-store' });
    if (!remote.ok) return {};
    return await remote.json();
  } catch (e) {
    return {};
  }
}

export default async function handler(req, res) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;

    if (req.method === 'GET') {
      const match = await findExistingConfigBlob(token);
      const data = await readConfigBlob(match);
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const incoming = await readJsonBody(req);

      // Merge with existing config so two devices updating different
      // slots at nearly the same time don't clobber each other.
      const match = await findExistingConfigBlob(token);
      const existing = await readConfigBlob(match);
      const merged = { ...existing, ...incoming };

      // Don't depend on `allowOverwrite` support — delete any existing
      // blob at this path first (works on every @vercel/blob version),
      // then write fresh with a stable, predictable filename.
      if (match) {
        try { await del(match.url, { token }); } catch (e) { /* ignore, put() below will still attempt to write */ }
      }

      const blob = await put(CONFIG_PATH, JSON.stringify(merged), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json',
        token,
      });

      return res.status(200).json({ ok: true, url: blob.url, config: merged });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('config route error', err);
    return res.status(500).json({ error: err.message || 'Config error' });
  }
}
