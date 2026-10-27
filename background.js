const CONTENT_SCRIPT_ID = "web-timer";
const STORAGE_KEY = "domains";

function getPatterns(domain) {
  if (domain === "localhost") {
    return ["*://localhost/*"];
  }
  return [`*://*.${domain}/*`];
}

function getPermissionOrigins(domain) {
  if (domain === "localhost") {
    return ["http://localhost/*", "https://localhost/*"];
  }
  return [`http://*.${domain}/*`, `https://*.${domain}/*`];
}

async function registerForDomains(domains) {
  await chrome.scripting.unregisterContentScripts({
    ids: [CONTENT_SCRIPT_ID]
  });

  if (domains.length === 0) {
    return;
  }

  const matches = domains.flatMap(getPatterns);
  await chrome.scripting.registerContentScripts([{
    id: CONTENT_SCRIPT_ID,
    matches,
    js: ["content.js"],
    runAt: "document_idle"
  }]);
}

async function injectIntoOpenTabs(domains) {
  if (domains.length === 0) {
    return;
  }

  const tabs = await chrome.tabs.query({});
  const configuredDomains = new Set(domains);

  for (const tab of tabs) {
    if (!tab.id || !tab.url) {
      continue;
    }

    let hostname;
    try {
      hostname = new URL(tab.url).hostname.toLowerCase();
    } catch {
      continue;
    }

    const shouldInject = [...configuredDomains].some(domain =>
      hostname === domain || hostname.endsWith(`.${domain}`)
    );
    if (!shouldInject) {
      continue;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
    } catch (error) {
      console.warn(`Web Timer could not run in tab ${tab.id}:`, error);
    }
  }
}

async function configureDomains(domains) {
  const oldSettings = await chrome.storage.sync.get(STORAGE_KEY);
  const oldDomains = oldSettings[STORAGE_KEY] || [];
  const origins = domains.flatMap(getPermissionOrigins);
  const hasPermissions = await chrome.permissions.contains({ origins });

  if (!hasPermissions) {
    throw new Error("設定したドメインへのアクセス許可がありません。");
  }

  await registerForDomains(domains);
  await chrome.storage.sync.set({ [STORAGE_KEY]: domains });
  await injectIntoOpenTabs(domains);

  const retainedOrigins = new Set(origins);
  const removedOrigins = oldDomains
    .flatMap(getPermissionOrigins)
    .filter(origin => !retainedOrigins.has(origin));
  if (removedOrigins.length > 0) {
    await chrome.permissions.remove({ origins: removedOrigins });
  }
}

async function restoreConfiguration() {
  const settings = await chrome.storage.sync.get(STORAGE_KEY);
  const domains = settings[STORAGE_KEY] || [];
  try {
    await registerForDomains(domains);
  } catch (error) {
    console.error("Web Timer could not restore its configured domains:", error);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "configure-domains" || !Array.isArray(message.domains)) {
    return false;
  }

  configureDomains(message.domains)
    .then(() => sendResponse({ ok: true }))
    .catch(error => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  return true;
});

restoreConfiguration();
