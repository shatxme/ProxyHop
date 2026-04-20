const state = {
  profiles: [],
  activeProfileId: null,
  isConnected: false,
  proxy: null,
  lastError: "",
  inputError: "",
};

const elements = {
  controlLine: document.querySelector("#control-line"),
  messageBar: document.querySelector("#message-bar"),
  connectionsList: document.querySelector("#connections-list"),
  form: document.querySelector("#profile-form"),
  saveBtn: document.querySelector("#save-btn"),
  endpointInput: document.querySelector("#endpoint-input"),
};

function showMessage(message = "") {
  elements.messageBar.textContent = message;
  elements.messageBar.classList.toggle("hidden", !message);
}

function formatControlLine(proxy) {
  if (!proxy) {
    return "";
  }

  if (proxy.levelOfControl === "controlled_by_other_extensions") {
    return "Another extension currently controls Chrome proxy settings.";
  }

  if (proxy.levelOfControl === "not_controllable") {
    return "Chrome proxy settings are not controllable in the current environment.";
  }

  return "";
}

function updateStatus() {
  const controlText = formatControlLine(state.proxy);
  elements.controlLine.textContent = controlText;
  elements.controlLine.classList.toggle("hidden", !controlText);
  showMessage(state.inputError || state.lastError);
}

function getProfileLabel(profile) {
  return `${profile.host}:${profile.port}`;
}

function renderConnections() {
  elements.connectionsList.replaceChildren();

  if (state.profiles.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = "No saved connections yet.";
    elements.connectionsList.append(emptyState);
    return;
  }

  const profiles = [...state.profiles].sort((left, right) => {
    if (left.id === state.activeProfileId) {
      return -1;
    }
    if (right.id === state.activeProfileId) {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });

  for (const profile of profiles) {
    const isActive = state.isConnected && state.activeProfileId === profile.id;
    const card = document.createElement("article");
    card.className = `connection-card${isActive ? " active" : ""}`;

    const head = document.createElement("div");
    head.className = "connection-head";

    const statusDot = document.createElement("span");
    statusDot.className = "status-dot";
    statusDot.setAttribute("aria-hidden", "true");

    const endpoint = document.createElement("div");
    endpoint.className = "connection-endpoint";
    endpoint.textContent = getProfileLabel(profile);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "ghost icon-button delete-button";
    deleteButton.setAttribute("aria-label", `Delete connection ${getProfileLabel(profile)}`);
    deleteButton.title = "Delete connection";
    deleteButton.dataset.action = "delete";
    deleteButton.dataset.profileId = profile.id;

    head.append(statusDot, endpoint, deleteButton);

    const actions = document.createElement("div");
    actions.className = "connection-actions";

    const connectButton = document.createElement("button");
    connectButton.type = "button";
    connectButton.className = `primary${isActive ? " disconnect" : ""}`;
    connectButton.textContent = isActive ? "Disconnect" : "Connect";
    connectButton.dataset.action = isActive ? "disconnect" : "connect";
    connectButton.dataset.profileId = profile.id;

    actions.append(connectButton);
    card.append(head, actions);
    elements.connectionsList.append(card);
  }
}

function parseEndpoint(value) {
  const match = String(value || "").trim().match(/^(.+):(\d{1,5})$/);
  if (!match) {
    throw new Error("Use IPv4:Port format, for example 203.0.113.10:24861.");
  }

  const host = match[1].trim().toLowerCase();
  const port = Number.parseInt(match[2], 10);
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    throw new Error("Enter a valid IPv4 address, for example 203.0.113.10.");
  }

  const octets = host.split(".");
  if (octets.some((octet) => Number.parseInt(octet, 10) > 255)) {
    throw new Error("Each IPv4 number must be between 0 and 255.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be between 1 and 65535.");
  }

  return { host, port };
}

function setBusy(isBusy) {
  elements.saveBtn.disabled = isBusy;
  elements.endpointInput.disabled = isBusy;
  for (const button of document.querySelectorAll("button[data-action]")) {
    button.disabled = isBusy;
  }
}

async function sendMessage(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) {
    throw new Error(response?.error || "Unexpected extension error.");
  }
  return response.data;
}

async function refresh() {
  const data = await sendMessage("getState");
  state.profiles = data.profiles;
  state.activeProfileId = data.activeProfileId;
  state.isConnected = data.isConnected;
  state.proxy = data.proxy;
  state.lastError = data.lastError;

  renderConnections();
  updateStatus();
}

async function runAction(action) {
  try {
    setBusy(true);
    await action();
    state.inputError = "";
  } catch (error) {
    state.inputError = error.message || String(error);
  } finally {
    await refresh();
    setBusy(false);
  }
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.inputError = "";
  updateStatus();

  await runAction(async () => {
    const endpoint = parseEndpoint(elements.endpointInput.value);
    const existingProfile = state.profiles.find((profile) => profile.host === endpoint.host && profile.port === endpoint.port);
    const profileId = existingProfile?.id || (await sendMessage("saveProfile", { profile: endpoint })).profile.id;

    await sendMessage("connectProfile", { profileId });
    elements.form.reset();
  });
});

elements.connectionsList.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("button[data-action]");
  if (!actionButton) {
    return;
  }

  const { action, profileId } = actionButton.dataset;
  if (!profileId) {
    return;
  }

  if (action === "delete") {
    const profile = state.profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }
    if (!window.confirm(`Delete connection ${getProfileLabel(profile)}?`)) {
      return;
    }

    await runAction(async () => {
      await sendMessage("deleteProfile", { profileId });
    });
    return;
  }

  await runAction(async () => {
    if (action === "disconnect") {
      await sendMessage("disconnect");
      return;
    }

    await sendMessage("connectProfile", { profileId });
  });
});

elements.endpointInput.addEventListener("input", () => {
  if (!state.inputError) {
    return;
  }

  state.inputError = "";
  updateStatus();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (!changes.lastError && !changes.activeProfileId && !changes.profiles) {
    return;
  }

  void refresh();
});

void refresh();
