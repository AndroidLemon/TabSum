/**
 * TabSum - Settings & Permissions Controller
 */

import { getSettings, saveSettings, exportTabs } from '../storage/db.js';

let currentSettings = {};

document.addEventListener('DOMContentLoaded', async () => {
  currentSettings = await getSettings();
  populateForm(currentSettings);
  setupListeners();
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

  // Clear database
  document.getElementById('clear-data-btn').addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete all stored tab summaries and wiki notes? This action cannot be undone.')) {
      const req = indexedDB.deleteDatabase('TabSumDB');
      req.onsuccess = () => {
        showToast('Knowledge database cleared');
      };
    }
  });
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
