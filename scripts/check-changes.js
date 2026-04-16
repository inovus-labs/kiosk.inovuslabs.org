import crypto from 'crypto';
import fs     from 'fs';
import path   from 'path';

const GHOST_API_URL         = process.env.GHOST_API_URL || 'https://blog.inovuslabs.org';
const GHOST_CONTENT_API_KEY = process.env.GHOST_CONTENT_API_KEY;
const POST_LIMIT            = 8;
const HASH_FILE             = process.env.HASH_FILE || '.cache/posts-hash.txt';

if (!GHOST_CONTENT_API_KEY) {
  console.error('Error: GHOST_CONTENT_API_KEY is required');
  process.exit(1);
}

const url =
  `${GHOST_API_URL}/ghost/api/content/posts/` +
  `?key=${GHOST_CONTENT_API_KEY}` +
  `&limit=${POST_LIMIT}` +
  `&fields=title,custom_excerpt,excerpt,feature_image,published_at,url,reading_time` +
  `&include=tags,authors`;

const res = await fetch(url);
if (!res.ok) {
  console.error(`Ghost API returned ${res.status}`);
  process.exit(1);
}

const data    = await res.json();
const newHash = crypto.createHash('sha256')
  .update(JSON.stringify(data.posts || []))
  .digest('hex');

const prevHash = fs.existsSync(HASH_FILE)
  ? fs.readFileSync(HASH_FILE, 'utf8').trim()
  : '';

const changed = newHash !== prevHash;

if (changed) {
  console.log(`Data changed — new hash: ${newHash.slice(0, 12)}…`);
  fs.mkdirSync(path.dirname(HASH_FILE), { recursive: true });
  fs.writeFileSync(HASH_FILE, newHash, 'utf8');
} else {
  console.log(`No changes detected (hash: ${newHash.slice(0, 12)}…) — skipping build.`);
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}
