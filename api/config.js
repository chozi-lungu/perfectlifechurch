// /api/config.js
// Shared JSON config blob so every device sees the same photo uploads.
// Uses the same Vercel Blob store as /api/upload.js.
// Deliberately avoids del() and allowOverwrite — not all @vercel/blob
// versions ship those. Only put() + list() are used, matching the same
// static-import style as /api/upload.js (a dynamic import() here caused
// Vercel's per-function bundler to skip including the package entirely).
import { put, list } from '@vercel/blob';

export const config = { api: { bodyParser: false } };

const CONFIG_PREFIX = 'site-config/';

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
      catch (e) { reject(new Error('Invalid JSON body: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

async function getLatestConfigBlob(token) {
  const { blobs } = await list({ prefix: CONFIG_PREFIX, token });
  if (!blobs || !blobs.length) return null;
  blobs.sort((a, b) => {
    const ta = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
    const tb = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
    return tb - ta;
  });
  return blobs[0];
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
    if (!token) {
      return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN is not set in this environment' });
    }

    if (req.method === 'GET') {
      const match = await getLatestConfigBlob(token);
      const data = await readConfigBlob(match);
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const incoming = await readJsonBody(req);

      const match = await getLatestConfigBlob(token);
      const existing = await readConfigBlob(match);
      const merged = { ...existing, ...incoming };

      const blob = await put(CONFIG_PREFIX + Date.now() + '.json', JSON.stringify(merged), {
        access: 'public',
        contentType: 'application/json',
        token,
      });

      return res.status(200).json({ ok: true, url: blob.url, config: merged });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('config route error', err);
    return res.status(500).json({ error: (err && err.message) || 'Config error' });
  }
}
