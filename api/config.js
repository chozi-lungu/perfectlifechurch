// /api/config.js
// Shared JSON config blob so every device sees the same photo uploads.
// Uses the same Vercel Blob store as /api/upload.js.
import { put, list } from '@vercel/blob';

export const config = { api: { bodyParser: true } };

const CONFIG_PATH = 'site-config.json';

export default async function handler(req, res) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;

    if (req.method === 'GET') {
      const { blobs } = await list({ prefix: CONFIG_PATH, token });
      const match = blobs.find((b) => b.pathname === CONFIG_PATH);
      if (!match) {
        return res.status(200).json({});
      }
      const remote = await fetch(match.url, { cache: 'no-store' });
      if (!remote.ok) return res.status(200).json({});
      const data = await remote.json();
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const incoming = req.body && typeof req.body === 'object' ? req.body : {};

      // Merge with existing config so two devices updating different
      // slots at nearly the same time don't clobber each other.
      let existing = {};
      try {
        const { blobs } = await list({ prefix: CONFIG_PATH, token });
        const match = blobs.find((b) => b.pathname === CONFIG_PATH);
        if (match) {
          const remote = await fetch(match.url, { cache: 'no-store' });
          if (remote.ok) existing = await remote.json();
        }
      } catch (e) {
        // no existing config yet — fine, start fresh
      }

      const merged = { ...existing, ...incoming };

      const blob = await put(CONFIG_PATH, JSON.stringify(merged), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
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
