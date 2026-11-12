// Vercel serverless function: receives a short audio clip from the app,
// forwards it to AudD with the secret key, and returns a cleaned-up result.
// The AudD key lives only in the AUDD_TOKEN environment variable, never in the app.

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB is plenty for a 10-20 s clip

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw Object.assign(new Error("too_large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const token = process.env.AUDD_TOKEN;
  if (!token) {
    res.status(500).json({ error: "missing_key" });
    return;
  }

  let audio;
  try {
    audio = await readBody(req);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || "bad_request" });
    return;
  }
  if (audio.length < 2000) {
    res.status(400).json({ error: "too_short" });
    return;
  }

  const type = req.headers["content-type"] || "audio/webm";
  const form = new FormData();
  form.append("api_token", token);
  form.append("return", "apple_music,spotify");
  form.append("file", new Blob([audio], { type }), "clip");

  let data;
  try {
    const r = await fetch("https://api.audd.io/", { method: "POST", body: form });
    data = await r.json();
  } catch (e) {
    res.status(502).json({ error: "service_unreachable" });
    return;
  }

  if (data.status !== "success") {
    res.status(502).json({ error: "service_error", detail: data.error?.error_message || "" });
    return;
  }
  if (!data.result) {
    res.status(200).json({ found: false });
    return;
  }

  const r = data.result;
  const spotify = r.spotify || {};
  const apple = r.apple_music || {};
  const cover =
    (apple.artwork && apple.artwork.url && apple.artwork.url.replace("{w}", "600").replace("{h}", "600")) ||
    (spotify.album && spotify.album.images && spotify.album.images[0] && spotify.album.images[0].url) ||
    null;

  res.status(200).json({
    found: true,
    title: r.title || "",
    artist: r.artist || "",
    album: r.album || "",
    release: r.release_date || "",
    label: r.label || "",
    cover,
    spotify: (spotify.external_urls && spotify.external_urls.spotify) || null,
    apple: apple.url || null,
    songLink: r.song_link || null
  });
}
