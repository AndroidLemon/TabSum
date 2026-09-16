/**
 * TabSum - Settings & Permissions Controller
 */

import { getSettings, saveSettings, setDomainList, getArchivedTabs, saveArchivedTab, getStorageEstimate, clearAllHistory } from '../storage/db.js';
import { escapeHtml } from '../shared/html.js';
import { exportToMarkdown, exportToJSON, triggerDownload } from '../shared/export.js';

let currentSettings = {};

document.addEventListener('DOMContentLoaded', async () => {
  currentSettings = await getSettings();
  populateForm(currentSettings);
  setupListeners();
  await updateStorageMeter();
  await checkPermissions();
});

function populateForm(settings) {
  document.getElementById('timeout-select').value = String(settings.timeoutMinutes || 60);
  
  const mode = ['close', 'discard'].includes(settings.archiveMode) ? settings.archiveMode : 'hybrid';
  document.getElementById(`mode-${mode}`).checked = true;

  document.getElementById('ignore-pinned-toggle').checked = settings.ignorePinnedTabs !== undefined ? Boolean(settings.ignorePinnedTabs) : true;

  document.getElementById('ai-close-toggle').checked = settings.closeRequiresAiSummary !== false;
  document.getElementById('fade-unopened-input').value = settings.fadeUnopenedDays;
  document.getElementById('fade-reopened-input').value = settings.fadeReopenedDays;
  document.getElementById('ai-provider-select').value = settings.aiProvider || 'auto';
  document.getElementById('gemini-api-key').value = settings.geminiApiKey || '';
  document.getElementById('openai-base-url').value = settings.openaiBaseUrl || '';
  document.getElementById('openai-model').value = settings.openaiModel || '';
  document.getElementById('openai-api-key').value = settings.openaiApiKey || '';

  toggleApiKeyRow(settings.aiProvider === 'gemini-api');
  toggleLocalLlmRows(settings.aiProvider === 'openai-compatible');
  renderAllChips();
}

function setupListeners() {
  document.getElementById('open-wiki-link-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/app/index.html') });
  });

  document.getElementById('grant-perm-btn').addEventListener('click', async () => {
    try {
      const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
      if (granted) {
        showToast('Extraction permissions granted!');
      }
      await checkPermissions();
    } catch (err) {
      console.error('Permission request failed:', err);
    }
  });

  document.getElementById('timeout-select').addEventListener('change', async (e) => {
    currentSettings.timeoutMinutes = parseInt(e.target.value, 10);
    await saveSettings(currentSettings);
    showToast('Inactivity timeout updated');
  });

  document.querySelectorAll('input[name="archiveMode"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      currentSettings.archiveMode = e.target.value;
      await saveSettings(currentSettings);
      showToast('Archival mode updated');
    });
  });

  document.getElementById('ignore-pinned-toggle').addEventListener('change', async (e) => {
    currentSettings.ignorePinnedTabs = e.target.checked;
    await saveSettings(currentSettings);
    showToast('Pinned tab preference saved');
  });

  document.getElementById('ai-close-toggle').addEventListener('change', async (e) => {
    currentSettings.closeRequiresAiSummary = e.target.checked;
    await saveSettings(currentSettings);
    showToast('Closing preference saved');
  });

  // Fade windows (days; 0 = never)
  for (const [id, key] of [['fade-unopened-input', 'fadeUnopenedDays'], ['fade-reopened-input', 'fadeReopenedDays']]) {
    document.getElementById(id).addEventListener('change', async (e) => {
      const days = Math.max(0, parseInt(e.target.value, 10) || 0);
      e.target.value = days;
      currentSettings[key] = days;
      await saveSettings(currentSettings);
      showToast(days ? `Notes fade after ${days} days` : 'Notes never fade');
    });
  }

  document.getElementById('ai-provider-select').addEventListener('change', async (e) => {
    currentSettings.aiProvider = e.target.value;
    toggleApiKeyRow(e.target.value === 'gemini-api');
    toggleLocalLlmRows(e.target.value === 'openai-compatible');
    await saveSettings(currentSettings);
    showToast('AI Provider updated');
  });

  for (const [id, key] of [['openai-base-url', 'openaiBaseUrl'], ['openai-model', 'openaiModel'], ['openai-api-key', 'openaiApiKey']]) {
    document.getElementById(id).addEventListener('change', async (e) => {
      currentSettings[key] = e.target.value.trim();
      await saveSettings(currentSettings);
      showToast('Local model settings saved');
    });
  }

  document.getElementById('openai-test-btn').addEventListener('click', testLocalLlmConnection);

  document.getElementById('gemini-api-key').addEventListener('change', async (e) => {
    currentSettings.geminiApiKey = e.target.value.trim();
    await saveSettings(currentSettings);
    showToast('API key saved locally');
  });

  bindDomainList({ key: 'excludedDomains', inputId: 'new-domain-input', btnId: 'add-domain-btn' });
  bindDomainList({ key: 'alwaysCloseDomains', inputId: 'new-trusted-input', btnId: 'add-trusted-btn' });

  document.getElementById('export-json-btn').addEventListener('click', async () => {
    const tabs = await getArchivedTabs({ limit: Infinity, includeText: true });
    const json = exportToJSON(tabs);
    triggerDownload(json, 'TabSum_Backup.json', 'application/json;charset=utf-8');
    showToast('Exported JSON backup');
  });

  document.getElementById('export-md-btn').addEventListener('click', async () => {
    const tabs = await getArchivedTabs({ limit: 10000 });
    const md = exportToMarkdown(tabs);
    triggerDownload(md, 'TabSum_Wiki_Export.md', 'text/markdown;charset=utf-8');
    showToast('Exported Markdown');
  });

  const importBtn = document.getElementById('import-json-btn');
  const importInput = document.getElementById('import-json-input');
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    importInput.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) {
        throw new Error('Backup file must contain a JSON array of notes');
      }

      let imported = 0;
      for (const record of data) {
        if (record && typeof record === 'object') {
          await saveArchivedTab(record);
          imported++;
        }
      }

      await updateStorageMeter();
      showToast(`Imported ${imported} notes`);
    } catch (err) {
      console.error('Import failed:', err);
      showToast('Import failed: invalid JSON backup file');
    }
  });

  document.getElementById('clear-history-btn').addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete all stored tab summaries and wiki notes? This action cannot be undone.')) {
      await clearAllHistory();
      await updateStorageMeter();
      showToast('All history cleared');
    }
  });
}

async function updateStorageMeter() {
  try {
    const estimate = await getStorageEstimate();
    const count = estimate.itemCount || 0;
    const bytes = estimate.byteEstimate || 0;
    const kb = Math.round(bytes / 1024);
    document.getElementById('storage-meter-text').textContent = `Current Storage: ${count} tabs (~${kb} KB)`;
  } catch (err) {
    console.error('Failed to update storage meter:', err);
  }
}

async function checkPermissions() {
  const statusEl = document.getElementById('permission-status');
  const grantBtn = document.getElementById('grant-perm-btn');
  const card = document.getElementById('permission-card');

  try {
    const hasPermission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
    card.classList.toggle('granted', hasPermission);
    if (hasPermission) {
      statusEl.textContent = '✓ Extraction permissions are active across all websites.';
      grantBtn.textContent = 'Permission Active';
      grantBtn.disabled = true;
    } else {
      statusEl.textContent = '⚠ TabSum requires permission to read background tab content.';
      grantBtn.textContent = 'Enable on All Sites';
      grantBtn.disabled = false;
    }
  } catch (err) {
    statusEl.textContent = 'Permission check unavailable';
  }
}

function toggleLocalLlmRows(show) {
  document.querySelectorAll('.local-llm-row').forEach(row => row.classList.toggle('hidden', !show));
}

/**
 * Ask Chrome for access to the server's origin (the service worker's summarize request needs
 * it), then list its models via GET /models to confirm the URL and key work.
 */
async function testLocalLlmConnection() {
  const status = document.getElementById('openai-test-status');
  const baseUrl = document.getElementById('openai-base-url').value.trim().replace(/\/+$/, '');
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    status.textContent = '✗ Enter a valid URL, e.g. http://localhost:11434/v1';
    return;
  }

  // Must run first, while the click still counts as a user gesture
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
  if (!granted) {
    status.textContent = `✗ TabSum needs permission to reach ${origin}`;
    return;
  }

  status.textContent = 'Connecting…';
  const apiKey = document.getElementById('openai-api-key').value.trim();
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      status.textContent = res.status === 401 || res.status === 403
        ? `✗ HTTP ${res.status}: check the API key${res.status === 403 ? ' (Ollama: set OLLAMA_ORIGINS=chrome-extension://*)' : ''}`
        : `✗ HTTP ${res.status} from ${baseUrl}/models`;
      return;
    }
    const models = ((await res.json()).data || []).map(m => m.id).filter(Boolean);
    const list = document.getElementById('openai-model-list');
    list.innerHTML = models.map(id => `<option value="${escapeHtml(id)}"></option>`).join('');
    const chosen = document.getElementById('openai-model').value.trim();
    status.textContent = `✓ Connected: ${models.length} model(s)` +
      (chosen && !models.includes(chosen) ? ` — "${chosen}" isn't one of them` : '');
  } catch (err) {
    status.textContent = `✗ Could not reach ${baseUrl} (${err.name === 'TimeoutError' ? 'timed out' : 'is the server running?'})`;
  }
}

function toggleApiKeyRow(show) {
  document.getElementById('api-key-row').classList.toggle('hidden', !show);
}

function renderAllChips() {
  renderDomainChips(document.getElementById('domain-chips'), 'excludedDomains');
  renderDomainChips(document.getElementById('trusted-chips'), 'alwaysCloseDomains');
}

function renderDomainChips(container, key) {
  container.innerHTML = '';

  for (const domain of currentSettings[key] || []) {
    const chip = document.createElement('div');
    chip.className = 'domain-chip';
    chip.innerHTML = `
      <span>${escapeHtml(domain)}</span>
      <button class="chip-remove-btn" data-domain="${escapeHtml(domain)}">✕</button>
    `;

    chip.querySelector('.chip-remove-btn').addEventListener('click', async () => {
      // Fresh read, not currentSettings: a context-menu add while Options is open must not
      // be clobbered by the page's cached copy.
      const fresh = await getSettings();
      currentSettings = await saveSettings({ [key]: (fresh[key] || []).filter((d) => d !== domain) });
      renderAllChips();
      showToast(`Removed ${domain}`);
    });

    container.appendChild(chip);
  }
}

// Add handler shared by the whitelist and the trusted-sites sections; the two lists are
// mutually exclusive (setDomainList enforces it), so a write to one always refreshes both.
function bindDomainList({ key, inputId, btnId }) {
  document.getElementById(btnId).addEventListener('click', async () => {
    const input = document.getElementById(inputId);
    const domain = input.value.trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '');
    if (!domain) return;

    currentSettings = await setDomainList(domain, key);
    renderAllChips();
    input.value = '';
    showToast(key === 'excludedDomains' ? `Added ${domain} to whitelist` : `Added ${domain} to trusted sites`);
  });
}

function showToast(message) {
  const toast = document.getElementById('save-toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2400);
}
