/* global document, fetch, window, history */

const PAGE_CONFIG = {
  incidents: {
    path: "/app",
    sectionId: "page-incidents",
    title: "Incidents",
  },
  "audit-logs": {
    path: "/app/audit-logs",
    sectionId: "page-audit-logs",
    title: "Audit Logs",
  },
  usage: {
    path: "/app/usage",
    sectionId: "page-usage",
    title: "Usage",
  },
  "api-keys": {
    path: "/app/api-keys",
    sectionId: "page-api-keys",
    title: "API Keys",
  },
};

const state = {
  csrfToken: "",
  authenticated: false,
  user: null,
  activeTenantId: null,
  tenants: [],
  incidents: [],
  auditLogs: [],
  usage: null,
  serviceAccounts: [],
  apiKeys: [],
  lastIssuedSecret: null,
  currentPage: "incidents",
};

const elements = {
  sessionPill: document.getElementById("session-pill"),
  activityLog: document.getElementById("activity-log"),
  navLinks: Array.from(document.querySelectorAll("[data-page-link]")),
  loginForm: document.getElementById("login-form"),
  logoutButton: document.getElementById("logout-button"),
  loginEmail: document.getElementById("login-email"),
  loginPassword: document.getElementById("login-password"),
  tenantForm: document.getElementById("tenant-form"),
  tenantName: document.getElementById("tenant-name"),
  refreshTenants: document.getElementById("refresh-tenants"),
  tenantList: document.getElementById("tenant-list"),
  incidentForm: document.getElementById("incident-form"),
  incidentTitle: document.getElementById("incident-title"),
  incidentSeverity: document.getElementById("incident-severity"),
  incidentDescription: document.getElementById("incident-description"),
  refreshIncidents: document.getElementById("refresh-incidents"),
  incidentList: document.getElementById("incident-list"),
  auditLimit: document.getElementById("audit-limit"),
  refreshAuditLogs: document.getElementById("refresh-audit-logs"),
  auditLogList: document.getElementById("audit-log-list"),
  refreshUsage: document.getElementById("refresh-usage"),
  usageMetric: document.getElementById("usage-metric"),
  usageUsed: document.getElementById("usage-used"),
  usageLimit: document.getElementById("usage-limit"),
  usageRemaining: document.getElementById("usage-remaining"),
  usageWindow: document.getElementById("usage-window"),
  serviceAccountForm: document.getElementById("service-account-form"),
  serviceAccountName: document.getElementById("service-account-name"),
  serviceAccountList: document.getElementById("service-account-list"),
  apiKeyForm: document.getElementById("api-key-form"),
  apiKeyServiceAccount: document.getElementById("api-key-service-account"),
  apiKeyName: document.getElementById("api-key-name"),
  scopeRead: document.getElementById("scope-read"),
  scopeWrite: document.getElementById("scope-write"),
  refreshApiKeys: document.getElementById("refresh-api-keys"),
  apiKeyList: document.getElementById("api-key-list"),
  apiKeySecret: document.getElementById("api-key-secret"),
};

const pageSections = Object.fromEntries(
  Object.entries(PAGE_CONFIG).map(([page, config]) => [
    page,
    document.getElementById(config.sectionId),
  ]),
);

function nowStamp() {
  return new Date().toISOString().slice(11, 19);
}

function pushActivity(message) {
  const line = `[${nowStamp()}] ${message}`;
  elements.activityLog.textContent = `${line}\n${elements.activityLog.textContent}`.trimEnd();
}

function toDisplayDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return date.toLocaleString();
}

function pageFromPath(pathname) {
  const normalized = pathname === "/app/" ? "/app" : pathname.replace(/\/+$/, "");
  for (const [page, config] of Object.entries(PAGE_CONFIG)) {
    if (config.path === normalized) {
      return page;
    }
  }

  return "incidents";
}

function updateSessionPill() {
  if (!state.authenticated || state.user === null) {
    elements.sessionPill.textContent = "Anonymous session";
    return;
  }

  const tenantPart = state.activeTenantId
    ? ` | tenant ${state.activeTenantId.slice(0, 8)}`
    : " | no active tenant";
  elements.sessionPill.textContent = `${state.user.email}${tenantPart}`;
}

function renderTenantList() {
  if (!state.authenticated) {
    elements.tenantList.innerHTML = "<li>Login to load tenants.</li>";
    return;
  }

  const items = state.tenants.map((entry) => {
    const isActive = state.activeTenantId === entry.tenant.id;
    return `
      <li>
        <strong>${entry.tenant.name}</strong>
        <span class="meta">${entry.membership.role} | ${entry.tenant.id}</span>
        <div class="row">
          <button data-switch-tenant="${entry.tenant.id}" type="button" class="muted">
            ${isActive ? "Active" : "Switch"}
          </button>
        </div>
      </li>
    `;
  });

  elements.tenantList.innerHTML = items.length > 0 ? items.join("") : "<li>No tenants yet.</li>";

  document.querySelectorAll("[data-switch-tenant]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tenantId = button.getAttribute("data-switch-tenant");
      if (!tenantId) {
        return;
      }

      await switchTenant(tenantId);
    });
  });
}

function renderIncidentList() {
  const items = state.incidents.map((incident) => `
    <li>
      <strong>${incident.title}</strong>
      <span class="meta">${incident.severity} | ${incident.status}</span>
      <span class="meta">start ${toDisplayDate(incident.startTime)}</span>
    </li>
  `);

  elements.incidentList.innerHTML = items.length > 0
    ? items.join("")
    : "<li>No incidents in active tenant.</li>";
}

function renderAuditLogList() {
  const items = state.auditLogs.map((event) => `
    <li>
      <strong>${event.action}</strong>
      <span class="meta">${toDisplayDate(event.createdAt)} | actor ${event.actorUserId ?? "system"}</span>
      <span class="meta">target ${event.targetType ?? "none"}:${event.targetId ?? "none"}</span>
    </li>
  `);

  elements.auditLogList.innerHTML = items.length > 0
    ? items.join("")
    : "<li>No audit events in active tenant.</li>";
}

function renderUsageSummary() {
  const usage = state.usage;
  if (usage === null) {
    elements.usageMetric.textContent = "n/a";
    elements.usageUsed.textContent = "n/a";
    elements.usageLimit.textContent = "n/a";
    elements.usageRemaining.textContent = "n/a";
    elements.usageWindow.textContent = "n/a";
    return;
  }

  elements.usageMetric.textContent = usage.metric;
  elements.usageUsed.textContent = String(usage.used);
  elements.usageLimit.textContent = String(usage.limit);
  elements.usageRemaining.textContent = String(usage.remaining);
  elements.usageWindow.textContent = `${usage.windowHours}h`;
}

function renderServiceAccountOptions() {
  const options = state.serviceAccounts.map((account) => `
    <option value="${account.id}">${account.name}</option>
  `);

  elements.apiKeyServiceAccount.innerHTML = options.length > 0
    ? options.join("")
    : "<option value=\"\" disabled selected>No service account</option>";
}

function renderServiceAccountList() {
  const items = state.serviceAccounts.map((account) => `
    <li>
      <strong>${account.name}</strong>
      <span class="meta">${account.id}</span>
      <span class="meta">owner ${account.ownerUserId}</span>
    </li>
  `);

  elements.serviceAccountList.innerHTML = items.length > 0
    ? items.join("")
    : "<li>No service accounts for active tenant.</li>";
}

function renderApiKeyList() {
  const items = state.apiKeys.map((key) => `
    <li>
      <strong>${key.name}</strong>
      <span class="meta">${key.id}</span>
      <span class="meta">scopes ${key.scopes.join(", ")} | last used ${key.lastUsedAt ? toDisplayDate(key.lastUsedAt) : "never"}</span>
      <span class="meta">revoked ${key.revokedAt ? toDisplayDate(key.revokedAt) : "no"}</span>
      <div class="row">
        <button data-revoke-api-key="${key.id}" type="button" class="muted" ${key.revokedAt ? "disabled" : ""}>
          Revoke
        </button>
      </div>
    </li>
  `);

  elements.apiKeyList.innerHTML = items.length > 0
    ? items.join("")
    : "<li>No API keys for active tenant.</li>";

  document.querySelectorAll("[data-revoke-api-key]").forEach((button) => {
    button.addEventListener("click", async () => {
      const apiKeyId = button.getAttribute("data-revoke-api-key");
      if (!apiKeyId) {
        return;
      }

      await revokeApiKey(apiKeyId);
    });
  });
}

function renderLastSecret() {
  elements.apiKeySecret.textContent = state.lastIssuedSecret ?? "No key issued yet.";
}

function setPage(page, options = {}) {
  const targetPage = PAGE_CONFIG[page] ? page : "incidents";
  const fromPopState = options.fromPopState === true;
  const replace = options.replace === true;
  state.currentPage = targetPage;

  for (const [pageId, section] of Object.entries(pageSections)) {
    section.hidden = pageId !== targetPage;
  }

  elements.navLinks.forEach((link) => {
    const pageLink = link.getAttribute("data-page-link");
    link.classList.toggle("active", pageLink === targetPage);
  });

  if (!fromPopState) {
    const method = replace ? "replaceState" : "pushState";
    history[method]({}, "", PAGE_CONFIG[targetPage].path);
  }
}

function requireActiveTenant(actionLabel) {
  if (!state.authenticated) {
    throw new Error(`Login required before ${actionLabel}.`);
  }

  if (!state.activeTenantId) {
    throw new Error(`Switch to an active tenant before ${actionLabel}.`);
  }

  return state.activeTenantId;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      "content-type": "application/json",
      ...(state.csrfToken ? { "x-csrf-token": state.csrfToken } : {}),
      ...(options.headers ?? {}),
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  const hasJson = contentType.includes("application/json");
  const body = hasJson ? await response.json() : null;

  if (!response.ok) {
    const code = typeof body?.code === "string" ? body.code : "REQUEST_FAILED";
    const message = typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
    throw new Error(`${code}: ${message}`);
  }

  if (body && typeof body.csrfToken === "string") {
    state.csrfToken = body.csrfToken;
  }

  return body;
}

async function loadAuthState() {
  const body = await request("/v1/auth/me", { method: "GET", headers: {} });
  state.authenticated = body.authenticated === true;
  state.user = body.authenticated === true ? body.user : null;
  pushActivity(state.authenticated ? `Authenticated as ${state.user.email}` : "Session is anonymous");
  updateSessionPill();
}

async function refreshTenants() {
  if (!state.authenticated) {
    state.tenants = [];
    state.activeTenantId = null;
    renderTenantList();
    updateSessionPill();
    return;
  }

  const body = await request("/v1/tenants", { method: "GET", headers: {} });
  state.tenants = Array.isArray(body.tenants) ? body.tenants : [];
  state.activeTenantId = typeof body.activeTenantId === "string" ? body.activeTenantId : null;
  renderTenantList();
  updateSessionPill();
  pushActivity(`Loaded ${state.tenants.length} tenant(s)`);
}

async function switchTenant(tenantId) {
  await request(`/v1/tenants/${tenantId}/switch`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  state.activeTenantId = tenantId;
  renderTenantList();
  updateSessionPill();
  pushActivity(`Switched tenant to ${tenantId}`);
  await refreshCurrentPageData();
}

async function refreshIncidents() {
  if (!state.authenticated || !state.activeTenantId) {
    state.incidents = [];
    renderIncidentList();
    return;
  }

  const body = await request("/v1/incidents", { method: "GET", headers: {} });
  state.incidents = Array.isArray(body.incidents) ? body.incidents : [];
  renderIncidentList();
  pushActivity(`Loaded ${state.incidents.length} incident(s)`);
}

async function refreshAuditLogs() {
  if (!state.authenticated || !state.activeTenantId) {
    state.auditLogs = [];
    renderAuditLogList();
    return;
  }

  const limitValue = Number.parseInt(elements.auditLimit.value, 10);
  const limit = Number.isNaN(limitValue) ? 25 : Math.max(1, Math.min(100, limitValue));
  const body = await request(`/v1/audit-logs?limit=${limit}`, { method: "GET", headers: {} });
  state.auditLogs = Array.isArray(body.events) ? body.events : [];
  renderAuditLogList();
  pushActivity(`Loaded ${state.auditLogs.length} audit event(s)`);
}

async function refreshUsage() {
  if (!state.authenticated || !state.activeTenantId) {
    state.usage = null;
    renderUsageSummary();
    return;
  }

  const body = await request("/v1/usage", { method: "GET", headers: {} });
  state.usage = body.usage ?? null;
  renderUsageSummary();
  if (state.usage) {
    pushActivity(`Usage ${state.usage.used}/${state.usage.limit} for ${state.usage.metric}`);
  }
}

async function refreshServiceAccounts() {
  if (!state.authenticated || !state.activeTenantId) {
    state.serviceAccounts = [];
    renderServiceAccountOptions();
    renderServiceAccountList();
    return;
  }

  const body = await request(`/v1/tenants/${state.activeTenantId}/service-accounts`, { method: "GET", headers: {} });
  state.serviceAccounts = Array.isArray(body.serviceAccounts) ? body.serviceAccounts : [];
  renderServiceAccountOptions();
  renderServiceAccountList();
  pushActivity(`Loaded ${state.serviceAccounts.length} service account(s)`);
}

async function refreshApiKeys() {
  if (!state.authenticated || !state.activeTenantId) {
    state.apiKeys = [];
    renderApiKeyList();
    return;
  }

  const body = await request(`/v1/tenants/${state.activeTenantId}/api-keys`, { method: "GET", headers: {} });
  state.apiKeys = Array.isArray(body.apiKeys) ? body.apiKeys : [];
  renderApiKeyList();
  pushActivity(`Loaded ${state.apiKeys.length} API key(s)`);
}

async function refreshApiKeysPage() {
  await refreshServiceAccounts();
  await refreshApiKeys();
}

async function refreshCurrentPageData() {
  if (state.currentPage === "incidents") {
    await refreshIncidents();
    return;
  }

  if (state.currentPage === "audit-logs") {
    await refreshAuditLogs();
    return;
  }

  if (state.currentPage === "usage") {
    await refreshUsage();
    return;
  }

  if (state.currentPage === "api-keys") {
    await refreshApiKeysPage();
  }
}

async function revokeApiKey(apiKeyId) {
  const tenantId = requireActiveTenant("revoking an API key");
  const body = await request(`/v1/tenants/${tenantId}/api-keys/${apiKeyId}/revoke`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  pushActivity(`Revoked API key ${body.apiKey?.name ?? apiKeyId}`);
  await refreshApiKeys();
}

async function bootstrap() {
  try {
    setPage(pageFromPath(window.location.pathname), { replace: true });
    await loadAuthState();
    await refreshTenants();
    renderServiceAccountOptions();
    renderServiceAccountList();
    renderApiKeyList();
    renderUsageSummary();
    renderAuditLogList();
    renderIncidentList();
    renderLastSecret();
    await refreshCurrentPageData();
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "Bootstrap failed");
  }
}

elements.navLinks.forEach((link) => {
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    const page = link.getAttribute("data-page-link");
    if (!page) {
      return;
    }

    try {
      setPage(page);
      await refreshCurrentPageData();
      pushActivity(`Opened ${PAGE_CONFIG[page].title} view`);
    } catch (error) {
      pushActivity(error instanceof Error ? error.message : "Navigation failed");
    }
  });
});

window.addEventListener("popstate", async () => {
  setPage(pageFromPath(window.location.pathname), { fromPopState: true });
  try {
    await refreshCurrentPageData();
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "Navigation refresh failed");
  }
});

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await request("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: elements.loginEmail.value,
        password: elements.loginPassword.value,
      }),
    });

    elements.loginPassword.value = "";
    pushActivity("Login successful");
    await loadAuthState();
    await refreshTenants();
    await refreshCurrentPageData();
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "Login failed");
  }
});

elements.logoutButton.addEventListener("click", async () => {
  try {
    await request("/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    });

    state.authenticated = false;
    state.user = null;
    state.activeTenantId = null;
    state.tenants = [];
    state.incidents = [];
    state.auditLogs = [];
    state.usage = null;
    state.serviceAccounts = [];
    state.apiKeys = [];
    state.lastIssuedSecret = null;
    renderTenantList();
    renderIncidentList();
    renderAuditLogList();
    renderUsageSummary();
    renderServiceAccountOptions();
    renderServiceAccountList();
    renderApiKeyList();
    renderLastSecret();
    updateSessionPill();
    pushActivity("Logged out");
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "Logout failed");
  }
});

elements.tenantForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const body = await request("/v1/tenants", {
      method: "POST",
      body: JSON.stringify({ name: elements.tenantName.value }),
    });

    elements.tenantName.value = "";
    state.activeTenantId = body.activeTenantId ?? null;
    pushActivity(`Created tenant ${body.tenant?.name ?? ""}`.trim());
    await refreshTenants();
    await refreshCurrentPageData();
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "Tenant create failed");
  }
});

elements.refreshTenants.addEventListener("click", async () => {
  try {
    await refreshTenants();
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "Tenant refresh failed");
  }
});

elements.incidentForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    requireActiveTenant("creating an incident");
    const body = await request("/v1/incidents", {
      method: "POST",
      body: JSON.stringify({
        title: elements.incidentTitle.value,
        description: elements.incidentDescription.value,
        severity: elements.incidentSeverity.value,
        startTime: new Date().toISOString(),
        impactedServices: [],
      }),
    });

    elements.incidentTitle.value = "";
    elements.incidentDescription.value = "";
    pushActivity(`Created incident ${body.incident?.title ?? ""}`.trim());
    await refreshIncidents();
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "Incident create failed");
  }
});

elements.refreshIncidents.addEventListener("click", async () => {
  try {
    await refreshIncidents();
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "Incident refresh failed");
  }
});

elements.refreshAuditLogs.addEventListener("click", async () => {
  try {
    await refreshAuditLogs();
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "Audit log refresh failed");
  }
});

elements.refreshUsage.addEventListener("click", async () => {
  try {
    await refreshUsage();
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "Usage refresh failed");
  }
});

elements.serviceAccountForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const tenantId = requireActiveTenant("creating a service account");
    const body = await request(`/v1/tenants/${tenantId}/service-accounts`, {
      method: "POST",
      body: JSON.stringify({
        name: elements.serviceAccountName.value,
      }),
    });

    elements.serviceAccountName.value = "";
    pushActivity(`Created service account ${body.serviceAccount?.name ?? ""}`.trim());
    await refreshServiceAccounts();
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "Service account create failed");
  }
});

elements.apiKeyForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const tenantId = requireActiveTenant("creating an API key");
    const serviceAccountId = elements.apiKeyServiceAccount.value;
    if (!serviceAccountId) {
      throw new Error("Select a service account before creating an API key.");
    }

    const scopes = [];
    if (elements.scopeRead.checked) {
      scopes.push("read");
    }
    if (elements.scopeWrite.checked) {
      scopes.push("write");
    }
    if (scopes.length === 0) {
      throw new Error("Select at least one scope.");
    }

    const body = await request(`/v1/tenants/${tenantId}/api-keys`, {
      method: "POST",
      body: JSON.stringify({
        serviceAccountId,
        name: elements.apiKeyName.value,
        scopes,
      }),
    });

    elements.apiKeyName.value = "";
    state.lastIssuedSecret = body.secret ?? body.redactedSecret ?? "Secret unavailable";
    renderLastSecret();
    pushActivity(`Created API key ${body.apiKey?.name ?? ""}`.trim());
    await refreshApiKeys();
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "API key create failed");
  }
});

elements.refreshApiKeys.addEventListener("click", async () => {
  try {
    await refreshApiKeysPage();
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "API key refresh failed");
  }
});

bootstrap();
