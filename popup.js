const domainsField = document.getElementById("domains");
const saveButton = document.getElementById("save");
const statusMessage = document.getElementById("status");
const elapsedDisplay = document.getElementById("elapsed");
const timerStatus = document.getElementById("timer-status");
const DEFAULT_DOMAINS = [
  "youtube.com",
  "x.com",
  "instagram.com",
  "facebook.com",
  "tiktok.com",
  "threads.net",
  "reddit.com",
  "snapchat.com",
  "pinterest.com",
  "linkedin.com",
  "twitch.tv"
];

function normalizeDomain(value) {
  const input = value.trim();
  if (!input) {
    return null;
  }

  const url = new URL(input.includes("://") ? input : `https://${input}`);
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash
  ) {
    throw new Error(`ドメインのみ入力してください: ${input}`);
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || !/^[a-z0-9.-]+$/.test(hostname) || hostname.includes("..")) {
    throw new Error(`有効なドメインではありません: ${input}`);
  }
  return hostname;
}

function domainPermissionOrigins(domain) {
  if (domain === "localhost") {
    return ["http://localhost/*", "https://localhost/*"];
  }
  return [`http://*.${domain}/*`, `https://*.${domain}/*`];
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function formatElapsedTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

async function updateElapsedTime() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    elapsedDisplay.textContent = "--:--:--";
    timerStatus.textContent = "アクティブなタブがありません。";
    return;
  }

  let hostname;
  try {
    hostname = new URL(tab.url).hostname.toLowerCase();
  } catch {
    elapsedDisplay.textContent = "--:--:--";
    timerStatus.textContent = "このページでは計測できません。";
    return;
  }

  const settings = await chrome.storage.sync.get("domains");
  const domains = settings.domains || [];
  const configuredDomain = domains.find(domain =>
    hostname === domain || hostname.endsWith(`.${domain}`)
  );
  if (!configuredDomain) {
    elapsedDisplay.textContent = "--:--:--";
    timerStatus.textContent = "このドメインは計測対象に設定されていません。";
    return;
  }

  const hasPermission = await chrome.permissions.contains({
    origins: domainPermissionOrigins(configuredDomain)
  });
  if (!hasPermission) {
    elapsedDisplay.textContent = "--:--:--";
    timerStatus.textContent = "「保存」を押して、このサイトへのアクセスを許可してください。";
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "get-elapsed-time"
    });
    if (typeof response?.elapsedMs !== "number") {
      throw new Error("計測時間を取得できませんでした。");
    }
    elapsedDisplay.textContent = formatElapsedTime(response.elapsedMs);
    timerStatus.textContent = "このタブを開いてから";
  } catch {
    elapsedDisplay.textContent = "--:--:--";
    timerStatus.textContent = "拡張機能とこのページを再読み込みしてください。";
  }
}

async function loadDomains() {
  const settings = await chrome.storage.sync.get("domains");
  const domains = Object.prototype.hasOwnProperty.call(settings, "domains")
    ? settings.domains
    : DEFAULT_DOMAINS;
  domainsField.value = domains.join("\n");
}

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  setStatus("");

  let domains;
  try {
    domains = [...new Set(
      domainsField.value
        .split(/\r?\n/)
        .map(normalizeDomain)
        .filter(Boolean)
    )];
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    saveButton.disabled = false;
    return;
  }

  const origins = domains.flatMap(domainPermissionOrigins);
  try {
    const permissionRequest = origins.length > 0
      ? chrome.permissions.request({ origins })
      : Promise.resolve(true);
    const granted = await permissionRequest;
    if (!granted) {
      throw new Error("ドメインへのアクセスが許可されませんでした。");
    }

    const response = await chrome.runtime.sendMessage({
      type: "configure-domains",
      domains
    });
    if (!response?.ok) {
      throw new Error(response?.error || "設定を保存できませんでした。");
    }
    setStatus("設定を保存しました。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    saveButton.disabled = false;
  }
});

loadDomains().catch(error => {
  setStatus(`設定を読み込めませんでした: ${error}`, true);
});

updateElapsedTime();
window.setInterval(() => {
  updateElapsedTime().catch(error => {
    timerStatus.textContent = `経過時間を取得できませんでした: ${error}`;
  });
}, 1000);
