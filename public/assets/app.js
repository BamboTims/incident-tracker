/* global document, fetch */

const state = {
  csrfToken: "",
  authenticated: false,
  user: null,
  activeTenantId: null,
  tenants: [],
  incidents: [],
};

const elements = {
  sessionPill: document.getElementById("session-pill"),
  activityLog: document.getElementById("activity-log"),
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
};

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

function updateSessionPill() {
  if (!state.authenticated || state.user === null) {
    elements.sessionPill.textContent = "Anonymous session";
    return;
  }

  const tenantPart = state.activeTenantId ? ` | tenant ${state.activeTenantId.slice(0, 8)}` : " | no active tenant";
  elements.sessionPill.textContent = `${state.user.email}${tenantPart}`;
}

function renderTenantList() {
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

  elements.incidentList.innerHTML = items.length > 0 ? items.join("") : "<li>No incidents in active tenant.</li>";
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
  await refreshIncidents();
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

async function bootstrap() {
  try {
    await loadAuthState();
    await refreshTenants();
    await refreshIncidents();
  } catch (error) {
    pushActivity(error instanceof Error ? error.message : "Bootstrap failed");
  }
}

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
    pushActivity("Login successful");
    elements.loginPassword.value = "";
    await loadAuthState();
    await refreshTenants();
    await refreshIncidents();
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
    pushActivity("Logged out");
    state.authenticated = false;
    state.user = null;
    state.activeTenantId = null;
    state.tenants = [];
    state.incidents = [];
    renderTenantList();
    renderIncidentList();
    updateSessionPill();
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
    await refreshIncidents();
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

bootstrap();
