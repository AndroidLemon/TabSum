/**
 * TabSum - Settings & Permissions Controller
 */

import { getSettings, saveSettings, getArchivedTabs, saveArchivedTab, getStorageEstimate, clearAllHistory } from '../storage/db.js';
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
  
  if (settings.archiveMode === 'close') {
    document.getElementById('mode-close').checked = true;
  } else if (settings.archiveMode === 'discard') {
    document.getElementById('mode-discard').checked = true;
  } else {
    const hybridRadio = document.getElementById('mode-hybrid');
    if (hybridRadio) {
      hybridRadio.checked = true;
    } else {
      document.getElementById('mode-discard').checked = true;
    }
  }

  const ignorePinnedToggle = document.getElementById('ignore-pinned-toggle');
  if (ignorePinnedToggle) {
    ignorePinnedToggle.checked = settings.ignorePinnedTabs !== undefined ? Boolean(settings.ignorePinnedTabs) : true;
  }

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
  renderDomainChips(settings.excludedDomains || []);
}

function setupListeners() {
  // Open Wiki
  document.getElementById('open-wiki-link-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/app/index.html') });
  });

  // Grant Permissions
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

  // Timeout select
  document.getElementById('timeout-select').addEventListener('change', async (e) => {
    currentSettings.timeoutMinutes = parseInt(e.target.value, 10);
    await saveSettings(currentSettings);
    showToast('Inactivity timeout updated');
  });

  // Archive Mode
  document.querySelectorAll('input[name="archiveMode"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      currentSettings.archiveMode = e.target.value;
      await saveSettings(currentSettings);
      showToast('Archival mode updated');
    });
  });

  // Ignore Pinned Tabs
  const ignorePinnedToggle = document.getElementById('ignore-pinned-toggle');
  if (ignorePinnedToggle) {
    ignorePinnedToggle.addEventListener('change', async (e) => {
      currentSettings.ignorePinnedTabs = e.target.checked;
      await saveSettings(currentSettings);
      showToast('Pinned tab preference saved');
    });
  }

  // Close only with an AI summary
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

  // AI Provider
  document.getElementById('ai-provider-select').addEventListener('change', async (e) => {
    currentSettings.aiProvider = e.target.value;
    toggleApiKeyRow(e.target.value === 'gemini-api');
    toggleLocalLlmRows(e.target.value === 'openai-compatible');
    await saveSettings(currentSettings);
    showToast('AI Provider updated');
  });

  // Local / OpenAI-compatible server fields
  for (const [id, key] of [['openai-base-url', 'openaiBaseUrl'], ['openai-model', 'openaiModel'], ['openai-api-key', 'openaiApiKey']]) {
    document.getElementById(id).addEventListener('change', async (e) => {
      currentSettings[key] = e.target.value.trim();
      await saveSettings(currentSettings);
      showToast('Local model settings saved');
    });
  }

  document.getElementById('openai-test-btn').addEventListener('click', testLocalLlmConnection);

  // API Key input
  document.getElementById('gemini-api-key').addEventListener('change', async (e) => {
    currentSettings.geminiApiKey = e.target.value.trim();
    await saveSettings(currentSettings);
    showToast('API key saved locally');
  });

  // Add Domain
  document.getElementById('add-domain-btn').addEventListener('click', async () => {
    const input = document.getElementById('new-domain-input');
    const domain = input.value.trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '');
    if (!domain) return;

    if (!currentSettings.excludedDomains) currentSettings.excludedDomains = [];
    if (!currentSettings.excludedDomains.includes(domain)) {
      currentSettings.excludedDomains.push(domain);
      await saveSettings(currentSettings);
      renderDomainChips(currentSettings.excludedDomains);
      input.value = '';
      showToast(`Added ${domain} to whitelist`);
    }
  });

  // Export buttons
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

  // Import / Restore from a JSON backup
  const importBtn = document.getElementById('import-json-btn');
  const importInput = document.getElementById('import-json-input');
  if (importBtn && importInput) {
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
  }

  // Clear All History buttons
  const handleClearHistory = async () => {
    if (confirm('Are you sure you want to delete all stored tab summaries and wiki notes? This action cannot be undone.')) {
      await clearAllHistory();
      await updateStorageMeter();
      showToast('All history cleared');
    }
  };

  const clearHistoryBtn = document.getElementById('clear-history-btn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', handleClearHistory);
  }

  const clearDataBtn = document.getElementById('clear-data-btn');
  if (clearDataBtn) {
    clearDataBtn.addEventListener('click', handleClearHistory);
  }
}

async function updateStorageMeter() {
  try {
    const estimate = await getStorageEstimate();
    const meterEl = document.getElementById('storage-meter-text');
    if (meterEl) {
      const count = estimate.itemCount || 0;
      const bytes = estimate.byteEstimate || 0;
      const kb = Math.round(bytes / 1024);
      meterEl.textContent = `Current Storage: ${count} tabs (~${kb} KB)`;
    }
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
    if (hasPermission) {
      statusEl.textContent = '✓ Extraction permissions are active across all websites.';
      statusEl.style.color = '#10b981';
      grantBtn.textContent = 'Permission Active';
      grantBtn.disabled = true;
      grantBtn.style.opacity = '0.6';
      card.style.background = 'var(--bg-card)';
      card.style.borderColor = 'var(--border-color)';
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
  const row = document.getElementById('api-key-row');
  if (show) row.classList.remove('hidden');
  else row.classList.add('hidden');
}

function renderDomainChips(domains) {
  const container = document.getElementById('domain-chips');
  container.innerHTML = '';

  for (const domain of domains) {
    const chip = document.createElement('div');
    chip.className = 'domain-chip';
    chip.innerHTML = `
      <span>${escapeHtml(domain)}</span>
      <button class="chip-remove-btn" data-domain="${escapeHtml(domain)}">✕</button>
    `;

    chip.querySelector('.chip-remove-btn').addEventListener('click', async () => {
      currentSettings.excludedDomains = currentSettings.excludedDomains.filter(d => d !== domain);
      await saveSettings(currentSettings);
      renderDomainChips(currentSettings.excludedDomains);
      showToast(`Removed ${domain}`);
    });

    container.appendChild(chip);
  }
}

function showToast(message) {
  const toast = document.getElementById('save-toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2400);
}
