// Check the complete Git index, including binary assets, without printing secrets.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const secrets = [];
for (const name of ['backend/.env.local', 'backend/.env.migration.local']) {
  const path = new URL(`../${name}`, import.meta.url);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.+)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (/^(AI_API_KEY|USDA_API_KEY|CLOUDINARY_API_SECRET|CLOUDINARY_API_KEY|.*PASSWORD|FIREBASE_SERVICE_ACCOUNT_JSON)$/.test(match[1]) && value.length > 8) secrets.push(value);
    if (match[1] === 'MONGODB_URI') {
      secrets.push(value);
      try { const password = decodeURIComponent(new URL(value).password); if (password.length > 8) secrets.push(password); } catch { /* Config validation handles malformed URIs. */ }
    }
  }
}
const files = git('ls-files', '-z').toString().split('\0').filter(Boolean);
const problems = new Set();
for (const file of files) {
  if (/(^|\/)(node_modules|build|\.local|\.dart_tool|\.firebase|secrets)(\/|$)|\.local\.json$|(^|\/)\.env(?:$|\.(?!example$))|\.(jks|keystore|p12|log)$|key\.properties$|firebase-adminsdk.*\.json$/.test(file)) problems.add(file);
  const contents = git('show', `:${file}`);
  if (secrets.some(secret => contents.includes(Buffer.from(secret)))) problems.add(file);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}\b/.test(contents.toString('utf8'))) problems.add(file);
}
if (problems.size) {
  console.error(`Credential/excluded-file check failed: ${[...problems].join(', ')}`);
  process.exitCode = 1;
} else console.log(`Git index checked: ${files.length} files; no configured server secrets, private keys or excluded artifacts found.`);
