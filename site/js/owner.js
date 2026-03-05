const STORAGE_DATA = "employeeai_data_v1";
const STORAGE_OWNER = "employeeai_owner_v1";
const byId = (id) => document.getElementById(id);

const loadData = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_DATA)) || { properties: [] }; }
  catch { return { properties: [] }; }
};

const loadOwner = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_OWNER)) || { plans: {}, payouts: [] }; }
  catch { return { plans: {}, payouts: [] }; }
};

const saveOwner = (owner) => localStorage.setItem(STORAGE_OWNER, JSON.stringify(owner));

const landlordUsers = () => window.EmployeeAIAuth.listUsers().filter((u) => u.role === "landlord");

const renderOwner = () => {
  const users = landlordUsers();
  const data = loadData();
  const ownerState = loadOwner();
  const plans = ownerState.plans || {};
  const payouts = ownerState.payouts || [];

  const mrr = users.reduce((sum, u) => sum + Number((plans[u.email] || u.plan || {}).monthly || 0), 0);
  const payoutTotal = payouts.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  byId("kpiUsers").textContent = String(users.length);
  byId("kpiProperties").textContent = String((data.properties || []).length);
  byId("kpiMrr").textContent = `$${mrr.toLocaleString()}`;
  byId("kpiBalance").textContent = `$${Math.max(0, mrr - payoutTotal).toLocaleString()}`;

  const filter = String(byId("landlordSearch").value || "").toLowerCase();
  const filtered = users.filter((u) => `${u.fullName} ${u.email}`.toLowerCase().includes(filter));

  byId("planUserEmail").innerHTML = filtered.map((u) => `<option value="${u.email}">${u.fullName} (${u.email})</option>`).join("");
  byId("usersBody").innerHTML = filtered.length
    ? filtered.map((u) => {
      const plan = plans[u.email] || u.plan || { name: "Starter", monthly: 149, setup: 59 };
      return `<tr><td>${u.fullName}</td><td>${u.email}</td><td>${plan.name}</td><td>$${Number(plan.monthly)}</td><td>$${Number(plan.setup || 0)}</td></tr>`;
    }).join("")
    : `<tr><td colspan="5" class="muted">No matching landlords.</td></tr>`;

  byId("payoutsBody").innerHTML = payouts.length
    ? [...payouts].reverse().map((p) => `<tr><td>${new Date(p.createdAt).toLocaleString()}</td><td>${p.description}</td><td>$${Number(p.amount).toLocaleString()}</td></tr>`).join("")
    : `<tr><td colspan="3" class="muted">No payouts yet.</td></tr>`;

  const select = byId("planSelect");
  select.innerHTML = window.EmployeeAIPlanUtils.listNames().map((n) => `<option value="${n}">${n}</option>`).join("");
};

const updateLandlordPlanInUsers = (email, plan) => {
  const users = window.EmployeeAIAuth.listUsers();
  const idx = users.findIndex((u) => u.email === email);
  if (idx < 0) return;
  const rawUsers = JSON.parse(localStorage.getItem("employeeai_users_v1") || "[]");
  const ridx = rawUsers.findIndex((u) => u.email === email);
  if (ridx < 0) return;
  rawUsers[ridx].plan = plan;
  localStorage.setItem("employeeai_users_v1", JSON.stringify(rawUsers));
};

const initOwner = () => {
  const user = window.EmployeeAIAuth.currentUser();
  if (!user) return (window.location.href = "./auth.html");
  if (!window.EmployeeAIAuth.isOwner(user)) return (window.location.href = "./dashboard.html");

  byId("ownerBadge").textContent = `${user.fullName} • Owner`;
  byId("logoutBtn").addEventListener("click", () => { window.EmployeeAIAuth.logout(); window.location.href = "./auth.html"; });

  byId("landlordSearch").addEventListener("input", renderOwner);

  byId("planSelect").addEventListener("change", () => {
    const planName = byId("planSelect").value;
    const plan = window.EmployeeAIPlanUtils.getPlan(planName);
    byId("assignPlanForm").price.value = String(plan.monthly);
    byId("assignPlanForm").setupFee.value = String(plan.setup);
  });

  byId("assignPlanForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const ownerState = loadOwner();
    const payload = {
      name: String(f.get("plan") || "Starter"),
      monthly: Number(f.get("price") || 0),
      setup: Number(f.get("setupFee") || 0)
    };
    ownerState.plans[String(f.get("userEmail") || "")] = payload;
    saveOwner(ownerState);
    updateLandlordPlanInUsers(String(f.get("userEmail") || ""), payload);
    renderOwner();
  });

  byId("payoutForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const ownerState = loadOwner();
    ownerState.payouts.push({ id: crypto.randomUUID(), description: String(f.get("description") || "").trim(), amount: Number(f.get("amount") || 0), createdAt: new Date().toISOString() });
    saveOwner(ownerState);
    e.target.reset();
    renderOwner();
  });

  const starter = window.EmployeeAIPlanUtils.getPlan("Starter");
  byId("assignPlanForm").price.value = String(starter.monthly);
  byId("assignPlanForm").setupFee.value = String(starter.setup);

  renderOwner();
};

window.addEventListener("DOMContentLoaded", initOwner);
