const DEFAULT_STORAGE = {
  profiles: [],
  activeProfileId: null,
  lastError: "",
};

function isExtensionControlledProxy(proxyDetails) {
  return proxyDetails.levelOfControl === "controlled_by_this_extension" && proxyDetails.value?.mode === "fixed_servers";
}

function normalizeProfile(input = {}) {
  const id = input.id ? String(input.id) : crypto.randomUUID();
  const host = String(input.host || "").trim().toLowerCase();
  const port = Number.parseInt(String(input.port || "1080"), 10);
  const name = String(input.name || "").trim() || `${host}:${port}`;

  if (!host) {
    throw new Error("IP is required.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be between 1 and 65535.");
  }

  return {
    id,
    name,
    host,
    port,
  };
}

async function getStoredState() {
  return chrome.storage.local.get(DEFAULT_STORAGE);
}

async function setProxyConfig(config) {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.set({ value: config, scope: "regular" }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function clearProxyConfig() {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.clear({ scope: "regular" }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function getProxyConfig() {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.get({ incognito: false }, (details) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(details);
    });
  });
}

function setBadge(active) {
  chrome.action.setBadgeBackgroundColor({ color: active ? "#2fa36b" : "#51606f" });
  chrome.action.setBadgeText({ text: active ? "ON" : "" });
}

async function refreshActionState() {
  const { profiles, activeProfileId } = await getStoredState();
  const proxy = await getProxyConfig();
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) || null;
  setBadge(Boolean(activeProfile) && isExtensionControlledProxy(proxy));
  chrome.action.setTitle({
    title: activeProfile ? `ProxyHop: ${activeProfile.name}` : "ProxyHop",
  });
}

async function buildViewModel() {
  const state = await getStoredState();
  const proxy = await getProxyConfig();
  const activeProfile = state.profiles.find((profile) => profile.id === state.activeProfileId) || null;

  return {
    profiles: state.profiles,
    activeProfileId: state.activeProfileId,
    activeProfile,
    isConnected: Boolean(activeProfile) && isExtensionControlledProxy(proxy),
    lastError: state.lastError,
    proxy: {
      levelOfControl: proxy.levelOfControl,
      mode: proxy.value?.mode || "system",
    },
  };
}

async function saveProfile(profileInput) {
  const profile = normalizeProfile(profileInput);
  const state = await getStoredState();
  const profiles = [...state.profiles];
  const existingIndex = profiles.findIndex((item) => item.id === profile.id);

  if (existingIndex >= 0) {
    profiles[existingIndex] = profile;
  } else {
    profiles.push(profile);
  }

  profiles.sort((left, right) => left.name.localeCompare(right.name));

  await chrome.storage.local.set({
    profiles,
    lastError: "",
  });

  if (state.activeProfileId === profile.id) {
    await applyProfile(profile.id);
  } else {
    await refreshActionState();
  }

  return profile;
}

async function applyProfile(profileId) {
  const state = await getStoredState();
  const profile = state.profiles.find((item) => item.id === profileId);

  if (!profile) {
    throw new Error("Profile not found.");
  }

  await setProxyConfig({
    mode: "fixed_servers",
    rules: {
      singleProxy: {
        scheme: "socks5",
        host: profile.host,
        port: profile.port,
      },
    },
  });

  await chrome.storage.local.set({
    activeProfileId: profile.id,
    lastError: "",
  });
  await refreshActionState();

  return profile;
}

async function disconnectProfile() {
  await clearProxyConfig();
  await chrome.storage.local.set({
    activeProfileId: null,
    lastError: "",
  });
  await refreshActionState();
}

async function removeProfile(profileId) {
  const state = await getStoredState();
  const nextProfiles = state.profiles.filter((profile) => profile.id !== profileId);

  if (nextProfiles.length === state.profiles.length) {
    return;
  }

  if (state.activeProfileId === profileId) {
    await clearProxyConfig();
  }

  await chrome.storage.local.set({
    profiles: nextProfiles,
    activeProfileId: state.activeProfileId === profileId ? null : state.activeProfileId,
    lastError: "",
  });
  await refreshActionState();
}

function formatProxyError(details) {
  const friendlyMessages = {
    "net::ERR_PROXY_CONNECTION_FAILED": "Could not connect to the proxy. Check the server IP, port, and firewall.",
    "net::ERR_SOCKS_CONNECTION_FAILED": "The SOCKS5 proxy rejected or failed the connection.",
    "net::ERR_CONNECTION_TIMED_OUT": "Connection timed out. Check that the proxy server is reachable.",
    "net::ERR_TIMED_OUT": "Connection timed out. Check that the proxy server is reachable.",
  };
  const friendlyMessage = friendlyMessages[details.error];
  const detailText = details.details ? ` ${details.details}` : "";

  if (friendlyMessage) {
    return `${friendlyMessage}${detailText}`.trim();
  }

  const severity = details.fatal ? "Fatal proxy error:" : "Proxy error:";
  return `${severity} ${details.error}.${detailText}`.trim();
}

async function handleProxyError(details) {
  const [state, proxy] = await Promise.all([getStoredState(), getProxyConfig()]);

  if (!state.activeProfileId || !isExtensionControlledProxy(proxy)) {
    if (state.lastError) {
      await chrome.storage.local.set({ lastError: "" });
    }
    return;
  }

  await chrome.storage.local.set({ lastError: formatProxyError(details) });
}

async function handleMessage(message) {
  switch (message?.type) {
    case "getState":
      return await buildViewModel();
    case "saveProfile":
      return { profile: await saveProfile(message.profile) };
    case "connectProfile":
      return { profile: await applyProfile(message.profileId) };
    case "disconnect":
      await disconnectProfile();
      return { ok: true };
    case "deleteProfile":
      await removeProfile(message.profileId);
      return { ok: true };
    default:
      throw new Error("Unsupported message.");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.get(DEFAULT_STORAGE).then((state) => chrome.storage.local.set(state));
  void refreshActionState();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshActionState();
});

chrome.proxy.onProxyError.addListener((details) => {
  void handleProxyError(details);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

void refreshActionState();
