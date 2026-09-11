/**
 * TabSum - Settings & Permissions Controller
 */

import { getSettings, saveSettings, exportTabs, getStorageEstimate, enforceStorageQuota, clearAllHistory } from '../storage/db.js';

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
  } else {
    document.getElementById('mode-discard').checked = true;
  }

  document.getElementById('notif-toggle').checked = Boolean(settings.notificationsEnabled);
  document.getElementById('ai-provider-select').value = settings.aiProvider || 'auto';
  document.getElementById('gemini-api-key').value = settings.geminiApiKey || '';

  const maxStoredSelect = document.getElementById('max-stored-select');
  if (maxStoredSelect) {
    maxStoredSelect.value = String(settings.maxStoredItems !== undefined ? settings.maxStoredItems : 1000);
  }

  const autoPruneToggle = document.getElementById('auto-prune-toggle');
  if (autoPruneToggle) {
    autoPruneToggle.checked = settings.autoPruneEnabled !== undefined ? Boolean(settings.autoPruneEnabled) : true;
  }

  toggleApiKeyRow(settings.aiProvider === 'gemini-api');
  renderDomainChips(settings.excludedDomains || []);
}

function setupListeners() {
  // Open Wiki
  document.getElementById('open-wiki-link-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/wiki/index.html') });
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

  // Notifications
  document.getElementById('notif-toggle').addEventListener('change', async (e) => {
    currentSettings.notificationsEnabled = e.target.checked;
    await saveSettings(currentSettings);
    showToast('Notification preference saved');
  });

  // AI Provider
  document.getElementById('ai-provider-select').addEventListener('change', async (e) => {
    currentSettings.aiProvider = e.target.value;
    toggleApiKeyRow(e.target.value === 'gemini-api');
    await saveSettings(currentSettings);
    showToast('AI Provider updated');
  });

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
    const json = await exportTabs('json');
    downloadFile(json, 'TabSum_Backup.json', 'application/json');
  });

  document.getElementById('export-md-btn').addEventListener('click', async () => {
    const md = await exportTabs('markdown');
    downloadFile(md, 'TabSum_Wiki_Export.md', 'text/markdown');
  });

  // Storage Quota: Maximum Stored Tabs
  const maxStoredSelect = document.getElementById('max-stored-select');
  if (maxStoredSelect) {
    maxStoredSelect.addEventListener('change', async (e) => {
      currentSettings.maxStoredItems = parseInt(e.target.value, 10);
      await saveSettings(currentSettings);
      if (currentSettings.autoPruneEnabled) {
        await enforceStorageQuota(currentSettings);
      }
      await updateStorageMeter();
      showToast('Maximum stored tabs updated');
    });
  }

  // Storage Quota: Auto-prune toggle
  const autoPruneToggle = document.getElementById('auto-prune-toggle');
  if (autoPruneToggle) {
    autoPruneToggle.addEventListener('change', async (e) => {
      currentSettings.autoPruneEnabled = e.target.checked;
      await saveSettings(currentSettings);
      if (currentSettings.autoPruneEnabled) {
        await enforceStorageQuota(currentSettings);
      }
      await updateStorageMeter();
      showToast('Auto-prune preference saved');
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

    const subtextEl = document.getElementById('storage-quota-subtext');
    if (subtextEl) {
      if (estimate.quota > 0) {
        subtextEl.textContent = `Capacity: ${estimate.quota.toLocaleString()} tabs`;
      } else {
        subtextEl.textContent = 'Capacity: Unlimited';
      }
    }

    const progressBar = document.getElementById('storage-progress-bar');
    if (progressBar) {
      if (estimate.quota > 0) {
        const pct = Math.min(100, Math.round(((estimate.itemCount || 0) / estimate.quota) * 100));
        progressBar.style.width = `${pct}%`;
        progressBar.style.backgroundColor = pct > 90 ? 'var(--danger)' : 'var(--accent)';
      } else {
        progressBar.style.width = '0%';
      }
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

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message) {
  const toast = document.getElementById('save-toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2400);
}
