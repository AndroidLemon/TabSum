// Builds a throwaway copy of the extension (manifest.json + src/) in a temp
// directory with the test-only host permissions injected, so the real
// manifest.json shipped to users doesn't carry localhost/Wikipedia grants.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const TEST_HOST_PERMISSIONS = [
  'http://localhost/*',
  'http://127.0.0.1/*',
  '*://*.wikipedia.org/*'
];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Creates a temp copy of the extension with test host permissions injected
 * into its manifest.json, and returns the temp directory path.
 */
export function buildTestExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabsum-ext-'));

  copyDir(path.join(REPO_ROOT, 'src'), path.join(dir, 'src'));

  const manifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8')
  );
  manifest.host_permissions = [
    ...(manifest.host_permissions || []),
    ...TEST_HOST_PERMISSIONS
  ];
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  return dir;
}
