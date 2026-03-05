/* =====================================================
   EmployeeAI Landlord Dashboard JS – v3
   Fixes: SMS delivery, smarter Stacy, improved UX
   ===================================================== */
const STORAGE_DATA = "employeeai_data_v1";
const byId = (id) => document.getElementById(id);
const planNames = () => window.EmployeeAIPlanUtils.listNames();
const getPlan = (n) => window.EmployeeAIPlanUtils.getPlan(n);

const emptyPropertyConfig = () => ({
  operationsEmail: "", operationsPassword: "",
  landlordPhone: "", maintenanceEmail: "",
  smsMode: "textbelt", textbeltKey: ""
});
const emptyData = () => ({ properties: [], issues: [], reminders: [], alerts: [], smsLog: [] });
const loadData = () => { try { return JSON.parse(localStorage.getItem(STORAGE_DATA)) || emptyData(); } catch { return emptyData(); } };
const saveData = (data) => localStorage.setItem(STORAGE_DATA, JSON.stringify(data));

const ensureData = () => {
  const d = loadData();
  for (const k of ["properties", "issues", "reminders", "alerts", "smsLog"]) if (!Array.isArray(d[k])) d[k] = [];
  for (const p of d.properties) {
    if (!Array.isArray(p.units)) p.units = [];
    if (!p.policy) p.policy = { startingRent: "", leaseTerms: "" };
    if (!p.stacyConfig) p.stacyConfig = emptyPropertyConfig();
    for (const u of p.units) {
      if (!Array.isArray(u.tenants)) u.tenants = [];
      for (const t of u.tenants) if (!Array.isArray(t.vehicles)) t.vehicles = [];
    }
  }
  return d;
};

const readPdf = (file) => new Promise((resolve) => {
  if (!file) return resolve(null);
  const r = new FileReader();
  r.onload = () => resolve({ fileName: file.name, dataUrl: r.result });
  r.onerror = () => resolve(null);
  r.readAsDataURL(file);
});

const currentPlan = () => getPlan(window.EmployeeAIAuth.currentUser()?.plan?.name || "Base");
const hasActivePlan = () => !!window.EmployeeAIAuth.currentUser()?.plan?.name;

const activePropertyId = () => byId("activePropertySelect")?.value;
const activeProperty = (data) => data.properties.find((p) => p.id === activePropertyId());
const allUnits = (p) => (p ? p.units : []);
const allTenants = (p) => allUnits(p).flatMap((u) => (u.tenants || []).map((t) => ({ ...t, unit: u })));
const allVehicles = (p) => allTenants(p).flatMap((t) => (t.vehicles || []).map((v) => ({ ...v, tenant: t, unit: t.unit })));
const createInviteLink = (token) => `${window.location.origin}/web/tenant-auth.html?invite=${token}`;
const totalTenantCount = (data) => data.properties.reduce((n, p) => n + (p.units || []).reduce((u, x) => u + ((x.tenants || []).length), 0), 0);
const unitVehicleCount = (unit) => (unit.tenants || []).reduce((n, t) => n + ((t.vehicles || []).length), 0);

const statusPill = (s) => {
  const str = String(s || "");
  if (str.includes("Approved") || str.includes("Resolved") || str.includes("success") || str.includes("sent")) return `<span class="pill success">${str}</span>`;
  if (str.includes("EMERGENCY") || str.includes("Escalated") || str.includes("Rejected") || str.includes("failed")) return `<span class="pill danger">${str}</span>`;
  if (str.includes("Awaiting") || str.includes("queued") || str.includes("demo")) return `<span class="pill warning">${str}</span>`;
  return `<span class="pill info">${str}</span>`;
};

const normalizePlate = (p) => String(p || "").trim().toUpperCase().replace(/\s+/g, "");

const findVehicleByPlate = (property, plate) => {
  const target = normalizePlate(plate);
  for (const u of (property.units || [])) {
    for (const t of (u.tenants || [])) {
      for (const v of (t.vehicles || [])) {
        if (normalizePlate(v.plate) === target) return { unit: u, tenant: t, vehicle: v };
      }
    }
  }
  return null;
};

const pushAlert = (data, propertyId, type, message, status = "info") => {
  data.alerts.push({ id: crypto.randomUUID(), propertyId, type, message, status, createdAt: new Date().toISOString() });
};

// FIX: SMS delivery — use free "textbelt" key as fallback, consistent behavior
const pushSms = async (data, propertyId, config, text, phoneOverride = null) => {
  const phone = phoneOverride || config?.landlordPhone || "";
  const normalizedPhone = String(phone).replace(/[\s\-\(\)\.]/g, "").replace(/[^\d+]/g, "");
  const entry = {
    id: crypto.randomUUID(), propertyId,
    phone: normalizedPhone || phone || "(missing phone)",
    text, delivery: "queued",
    createdAt: new Date().toISOString()
  };
  data.smsLog.push(entry);

  if (!normalizedPhone) {
    entry.delivery = "failed: missing phone";
    saveData(data);
    return { ok: false, reason: "missing phone" };
  }

  const mode = config?.smsMode || "textbelt";
  if (mode === "textbelt") {
    // FIX: Fall back to free "textbelt" key if none configured (1 free SMS/day)
    const key = (config?.textbeltKey && config.textbeltKey.trim()) ? config.textbeltKey.trim() : "textbelt";
    try {
      const params = new URLSearchParams({ phone: normalizedPhone, message: text, key });
      const res = await fetch("https://textbelt.com/text", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      const json = await res.json();
      entry.delivery = json.success ? `sent${json.textId ? ` (id:${json.textId})` : ""}` : `failed: ${json.error || "unknown"}`;
      saveData(data);
      return { ok: !!json.success, json };
    } catch (err) {
      entry.delivery = "failed: network";
      saveData(data);
      return { ok: false, reason: "network" };
    }
  }

  entry.delivery = "demo-mode (not sent — set SMS mode to Textbelt)";
  saveData(data);
  return { ok: true, demo: true };
};

const addIssue = (data, property, type, from, message, approvalRequired = true, meta = {}) => {
  const issue = {
    id: crypto.randomUUID(), propertyId: property.id,
    type, from, message, approvalRequired,
    status: approvalRequired ? "Awaiting manager approval" : "Resolved by Stacy",
    meta, createdAt: new Date().toISOString()
  };
  data.issues.push(issue);
  return issue;
};

const matchTenant = (property, fromEmail, text, unitHint) => {
  const q = text.toLowerCase();
  for (const unit of property.units) for (const tenant of unit.tenants || []) {
    if ((tenant.email || "").toLowerCase() === fromEmail.toLowerCase()) return { unit, tenant };
    if (tenant.fullName && q.includes(tenant.fullName.toLowerCase())) return { unit, tenant };
    if (unitHint && unit.label.toLowerCase() === unitHint.toLowerCase()) return { unit, tenant };
  }
  return null;
};

// Smart email analysis with better routing
const analyzeEmail = async (data, property, payload) => {
  const cfg = property.stacyConfig || emptyPropertyConfig();
  const raw = `${payload.subject} ${payload.body}`;
  const text = raw.toLowerCase();
  const mapped = matchTenant(property, payload.fromEmail, raw, payload.unitHint);
  const unitName = mapped ? mapped.unit.label : (payload.unitHint || "Unknown Unit");
  const tenantName = mapped ? mapped.tenant.fullName : "Unknown Sender";
  const identity = `${unitName} – ${tenantName}`;

  if (!mapped) pushAlert(data, property.id, "Unidentified Sender",
    `Could not identify ${payload.fromEmail}. Stacy logged the message and flagged for manual review.`, "warning");

  // Emergency keywords
  if (["flood", "flooding", "fire", "gas leak", "emergency", "no power"].some(k => text.includes(k))) {
    addIssue(data, property, "EMERGENCY Maintenance", payload.fromEmail, payload.body, false, { unitName, tenantName, priority: "EMERGENCY" });
    await pushSms(data, property.id, cfg, `🚨 EMERGENCY from ${identity}: "${payload.subject}". Immediate attention required.`);
    pushAlert(data, property.id, "EMERGENCY", `Emergency escalation from ${identity}`, "danger");
    return `🚨 Emergency flagged for ${identity}. Management has been alerted with urgent priority. If life-safety, also call 911.`;
  }

  // Maintenance
  if (["ac", "fridge", "refrigerator", "not working", "repair", "maintenance", "leak", "broken", "mold"].some(k => text.includes(k))) {
    addIssue(data, property, "Maintenance", payload.fromEmail, payload.body, true, { unitName, tenantName });
    await pushSms(data, property.id, cfg, `MAINTENANCE | ${identity}: "${payload.subject}". Approve dispatch in dashboard.`);
    pushAlert(data, property.id, "Maintenance", `Maintenance ticket created for ${identity}.`, "warning");
    return `Maintenance request logged for ${identity}. Management approval SMS sent. Vendor will be dispatched once approved.`;
  }

  // Parking
  if (text.includes("park") && (text.includes("spot") || text.includes("space") || text.includes("blocking"))) {
    addIssue(data, property, "Parking Complaint", payload.fromEmail, payload.body, true, { unitName, tenantName });
    await pushSms(data, property.id, cfg, `PARKING COMPLAINT | ${identity}: "${payload.subject}". Review in dashboard.`);
    pushAlert(data, property.id, "Parking", `Parking complaint from ${identity}.`, "warning");
    return `Parking complaint logged for ${identity}. What's the license plate? Share it in the Stacy chat and I'll look up the registered tenant and send a warning.`;
  }

  // Prospect inquiry
  if (["availability", "2 bedroom", "2br", "3br", "rent", "showing", "deposit", "move in"].some(k => text.includes(k))) {
    addIssue(data, property, "Prospect Inquiry", payload.fromEmail, payload.body, false, { unitName, tenantName });
    const rent = property.policy?.startingRent || "Pricing is available upon request.";
    const terms = property.policy?.leaseTerms || "Standard screening and move-in requirements apply.";
    pushAlert(data, property.id, "Prospect", `Prospect auto-responded: ${payload.fromEmail}`, "success");
    return `Auto-responded to prospect ${payload.fromEmail}: "${rent} ${terms}" — Logged and tracked.`;
  }

  addIssue(data, property, "General Tenant Message", payload.fromEmail, payload.body, false, { unitName, tenantName });
  pushAlert(data, property.id, "Message", `General message from ${identity}.`, "info");
  return `Message from ${identity} logged. No auto-action required — you can review it in the workflow queue.`;
};

const renderPlansGrid = (targetId, currentPlanName) => {
  const html = planNames().map((n) => {
    const p = getPlan(n);
    const monthly = n === "Custom" ? "$999+" : `$${p.monthly}`;
    const setup = (p.setup === null || typeof p.setup === "undefined") ? "Custom pricing" : `$${p.setup} setup`;
    const bullets = Array.isArray(p.bullets)
      ? `<ul>${p.bullets.map(b => `<li>${b}</li>`).join("")}</ul>` : "";
    const cap = `<ul><li>${p.properties === Infinity ? "Unlimited" : `Up to ${p.properties}`} properties</li><li>${p.tenants === Infinity ? "Unlimited" : `Up to ${p.tenants}`} tenants</li></ul>`;
    const isCurrent = currentPlanName === n;
    const isPopular = n === "Managers";
    const cta = isCurrent
      ? `<button class="btn" disabled style="opacity:0.5;cursor:default;">✓ Current plan</button>`
      : (n === "Custom" ? `<button class="btn" data-select-plan="${n}">Contact sales</button>` : `<button class="btn primary" data-select-plan="${n}">Select ${n}</button>`);
    return `<div class="plan-card${isCurrent ? " current" : ""}">
      ${isPopular ? `<span class="popular-tag">Most Popular</span>` : ""}
      <div class="plan-name">${n}</div>
      <div class="plan-price">${monthly}<span>/mo</span></div>
      <div class="plan-setup">${setup}</div>
      ${cap}${bullets}${cta}
    </div>`;
  }).join("");
  byId(targetId).innerHTML = `<div class="plans-grid">${html}</div>`;
};

const render = () => {
  const data = ensureData();
  const user = window.EmployeeAIAuth.currentUser();
  const noPlan = !user?.plan?.name;
  byId("noPlanGate").classList.toggle("hidden", !noPlan);
  byId("appShell").classList.toggle("hidden", noPlan);

  if (noPlan) { renderPlansGrid("planOnlyGrid", null); return; }

  const select = byId("activePropertySelect");
  const prev = select.value;
  select.innerHTML = data.properties.map((p) => `<option value="${p.id}">${p.name} (${p.cityState})</option>`).join("");
  if (prev && data.properties.some((p) => p.id === prev)) select.value = prev;
  const property = activeProperty(data) || data.properties[0];
  if (property) select.value = property.id;

  const propHint = byId("activePropertyHint");
  if (propHint) propHint.textContent = property ? `Active: ${property.name}` : "Create a property to begin.";

  const tenants = allTenants(property);
  const vehicles = allVehicles(property);
  const issues = data.issues.filter((i) => !property || i.propertyId === property.id);
  const alerts = data.alerts.filter((a) => !property || a.propertyId === property.id);
  const sms = data.smsLog.filter((s) => !property || s.propertyId === property.id);

  byId("kpiProperties").textContent = String(data.properties.length);
  byId("kpiTenants").textContent = String(tenants.length);
  byId("kpiIssues").textContent = String(issues.length);
  byId("kpiPending").textContent = String(issues.filter((i) => i.approvalRequired && i.status.includes("Awaiting")).length);

  const uplan = getPlan(user.plan.name);
  const setupTxt = (uplan.setup === null || typeof uplan.setup === "undefined") ? "Custom" : `$${uplan.setup} setup`;
  const monthlyTxt = (user.plan.name === "Custom") ? "$999+/mo" : `$${uplan.monthly}/mo`;
  byId("planSummary").textContent = `${user.plan.name} • ${monthlyTxt} + ${setupTxt} • ${uplan.label}`;
  byId("planSelect").innerHTML = planNames().map((n) => {
    const p = getPlan(n);
    const monthly = n === "Custom" ? "$999+/mo" : `$${p.monthly}/mo`;
    return `<option value="${n}" ${n === user.plan.name ? "selected" : ""}>${n} — ${monthly}</option>`;
  }).join("");
  renderPlansGrid("billingPlanGrid", user.plan.name);

  byId("unitPropertyId").innerHTML = data.properties.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  byId("tenantUnitId").innerHTML = allUnits(property).map((u) => `<option value="${u.id}">${u.label}</option>`).join("");
  byId("vehicleTenantId").innerHTML = tenants.map((t) => `<option value="${t.id}">${t.fullName} — ${t.unit.label}</option>`).join("");

  byId("tenantsBody").innerHTML = tenants.length ? tenants.map((t) => {
    const lease = t.lease?.dataUrl ? `<a class="btn sm" href="${t.lease.dataUrl}" download="${t.lease.fileName}">PDF</a>` : `<span class="muted text-xs">None</span>`;
    const invite = t.inviteToken
      ? `<a href="${createInviteLink(t.inviteToken)}" target="_blank" class="btn sm">Open</a> <button class="btn sm" data-copy-invite="${t.inviteToken}">Copy</button>`
      : `<button class="btn sm" data-generate-invite="${t.id}">Generate</button>`;
    return `<tr>
      <td><strong>${t.fullName}</strong></td>
      <td>${t.unit.label}</td>
      <td><div>${t.phone || "—"}</div><div class="muted text-xs">${t.email || "—"}</div></td>
      <td>${lease}</td>
      <td>${invite}</td>
      <td style="white-space:nowrap;"><button class="btn sm" data-edit-tenant="${t.id}">Edit</button> <button class="btn sm" data-remove-tenant="${t.id}">Remove</button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px;">No tenants yet for this property.</td></tr>`;

  byId("vehiclesBody").innerHTML = vehicles.length ? vehicles.map((v) => `<tr>
    <td><strong>${v.plate}</strong></td>
    <td>${v.make} ${v.model}</td>
    <td>${v.color}</td>
    <td>${v.tenant.fullName}</td>
    <td>${v.assignedSpot || "—"}</td>
    <td>${v.status}</td>
    <td><button class="btn sm" data-edit-vehicle="${v.id}">Edit</button> <button class="btn sm" data-remove-vehicle="${v.id}">Remove</button></td>
  </tr>`).join("") : `<tr><td colspan="7" class="muted" style="text-align:center;padding:20px;">No vehicles registered.</td></tr>`;

  byId("unitsBody").innerHTML = allUnits(property).length ? allUnits(property).map((u) => `<tr>
    <td>${property.name}</td>
    <td><strong>${u.label}</strong></td>
    <td>${(u.tenants || []).length}</td>
    <td>${u.parkingSpots}</td>
    <td>${u.vehicleMaxOverride || property.maxVehiclesPerUnit}</td>
    <td><button class="btn sm" data-edit-unit="${u.id}">Edit</button> <button class="btn sm" data-remove-unit="${u.id}">Remove</button></td>
  </tr>`).join("") : `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px;">No units yet.</td></tr>`;

  byId("issuesBody").innerHTML = issues.length ? [...issues].reverse().map((i) => `<tr>
    <td>${statusPill(i.type.includes("EMERGENCY") ? "EMERGENCY" : "info")} <strong>${i.type}</strong></td>
    <td style="max-width:200px;"><div>${i.from}</div><div class="muted text-xs" style="margin-top:3px;">${i.message.slice(0, 80)}${i.message.length > 80 ? "…" : ""}</div></td>
    <td>${statusPill(i.status)}</td>
    <td>${i.approvalRequired ? "Yes" : "—"}</td>
    <td>${i.approvalRequired && i.status.includes("Awaiting")
      ? `<button class="btn sm success" data-approve="${i.id}">Approve</button> <button class="btn sm" data-escalate="${i.id}">Escalate</button>`
      : "—"}</td>
  </tr>`).join("") : `<tr><td colspan="5" class="muted" style="text-align:center;padding:20px;">No workflows yet.</td></tr>`;

  byId("alertsBody").innerHTML = alerts.length ? [...alerts].reverse().map((a) => `<tr>
    <td class="muted text-xs">${new Date(a.createdAt).toLocaleString()}</td>
    <td><strong>${a.type}</strong></td>
    <td>${a.message}</td>
    <td>${statusPill(a.status || "info")}</td>
  </tr>`).join("") : `<tr><td colspan="4" class="muted" style="text-align:center;padding:20px;">No alerts yet.</td></tr>`;

  byId("smsBody").innerHTML = sms.length ? [...sms].reverse().map((s) => `<tr>
    <td class="muted text-xs">${new Date(s.createdAt).toLocaleString()}</td>
    <td>${s.phone}</td>
    <td style="max-width:220px;">${s.text.slice(0, 100)}${s.text.length > 100 ? "…" : ""}</td>
    <td>${statusPill(s.delivery || "queued")}</td>
  </tr>`).join("") : `<tr><td colspan="4" class="muted" style="text-align:center;padding:20px;">No SMS sent yet.</td></tr>`;

  if (byId("reportingSnapshot")) byId("reportingSnapshot").textContent =
    `Properties: ${data.properties.length} · Tenants: ${totalTenantCount(data)} · Open Issues: ${data.issues.length} · Alerts: ${data.alerts.length} · SMS: ${data.smsLog.length}`;

  const cfg = property?.stacyConfig || emptyPropertyConfig();
  const f = byId("stacyConfigForm");
  if (f) {
    f.operationsEmail.value = cfg.operationsEmail || "";
    f.operationsPassword.value = cfg.operationsPassword || "";
    f.landlordPhone.value = cfg.landlordPhone || "";
    f.maintenanceEmail.value = cfg.maintenanceEmail || "";
    f.smsMode.value = cfg.smsMode || "textbelt";
    f.textbeltKey.value = cfg.textbeltKey || "";
  }
};

const bindTabs = () => {
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    const panel = byId(`tab-${btn.dataset.tab}`);
    if (panel) panel.classList.add("active");
  }));
};

/* ======================== STACY BUBBLE (LANDLORD) ========================
   Smart landlord-facing Stacy with full parking + maintenance workflows.
   Remembers context per session, provides intelligent responses.
   ========================================================================= */
const bindStacyBubble = () => {
  const bubble = byId("stacyBubbleBtn");
  const panel = byId("stacyPanel");
  const messages = byId("stacyMessages");
  const form = byId("stacyChatForm");
  const input = byId("stacyInput");
  let state = { mode: null, data: {}, history: [] };
  let isOpen = false;

  const push = (who, text) => {
    const div = document.createElement("div");
    div.className = `stacy-msg ${who}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  };

  const pushTyping = () => {
    const div = document.createElement("div");
    div.className = "stacy-msg bot typing";
    div.id = "stacy-typing-landlord";
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  };

  const reply = async (text) => {
    const t = pushTyping();
    await new Promise(r => setTimeout(r, 350 + Math.random() * 300));
    t.remove();
    push("bot", text);
  };

  bubble.addEventListener("click", () => {
    isOpen = !isOpen;
    panel.classList.toggle("hidden", !isOpen);
    if (isOpen && !messages.children.length) {
      push("bot", "Hi — I'm Stacy. I help you manage parking complaints, maintenance approvals, tenant communications, and more.\n\nYou can tell me:\n• A plate number to look up a registered vehicle\n• A tenant name or unit to find contact info\n• 'Summary' for a quick property overview\n• Or ask me anything about your operations");
    }
  });

  const getContext = () => {
    const data = ensureData();
    const property = activeProperty(data) || data.properties[0];
    if (!property) return { data, property: null, cfg: emptyPropertyConfig() };
    const cfg = property.stacyConfig || emptyPropertyConfig();
    return { data, property, cfg };
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const txt = input.value.trim();
    if (!txt) return;
    input.value = "";
    push("user", txt);
    state.history.push({ role: "user", content: txt });

    const { data, property, cfg } = getContext();
    if (!property) return reply("Please create a property first so I can provide accurate context.");

    const lower = txt.toLowerCase();

    // Pending: plate lookup for parking complaint
    if (state.mode === "parking_plate") {
      state.mode = null;
      const plate = normalizePlate(txt);
      const found = findVehicleByPlate(property, plate);
      const violatorName = found?.tenant?.fullName || "Unknown resident";
      const violatorPhone = found?.tenant?.phone || "";
      const complainant = state.data.complainant || "Unknown";
      const complainantPhone = state.data.complainantPhone || "";

      const issue = addIssue(data, property, "Parking Complaint", "Stacy / Landlord", `Plate ${plate} reported by ${complainant}`, true,
        { plate, violatorName, violatorPhone, complainant, complainantPhone, amount: property?.policy?.parkingFine || 50 }
      );

      await pushSms(data, property.id, cfg,
        `PARKING COMPLAINT | ${property.name} | Plate: ${plate} | Reported by: ${complainant} | Registered to: ${violatorName} ${violatorPhone ? `(${violatorPhone})` : "(no phone)"}. Awaiting approval.`
      );

      // FIX: Send text to the registered tenant who owns the vehicle
      if (violatorPhone) {
        await pushSms(data, property.id, cfg,
          `Parking notice: Your vehicle (${plate}) has been reported in another resident's spot at ${property.name}. Please move it immediately to avoid a fine or tow.`,
          violatorPhone
        );
      }

      pushAlert(data, property.id, "Parking", `Parking complaint for plate ${plate}. Registered to: ${violatorName}.`, "warning");
      saveData(data); render();

      await reply(found
        ? `Found it — plate ${plate} belongs to ${violatorName}. I've sent them a warning text${violatorPhone ? "" : " (no phone on file)"} and notified you for approval.\n\nNext step: Approve the complaint in the workflow queue to trigger a violation invoice.`
        : `Plate ${plate} is not in the vehicle registry. I've logged the complaint and alerted you — management will need to verify the vehicle manually.\n\nConsider adding it to the violation form in the Automation Hub.`);
      return;
    }

    // Summary
    if (["summary", "overview", "how many", "stats"].some(k => lower.includes(k))) {
      const tenants = allTenants(property);
      const vehicles = allVehicles(property);
      const openIssues = data.issues.filter(i => i.propertyId === property.id && i.approvalRequired && i.status.includes("Awaiting"));
      await reply(`Here's your quick summary for ${property.name}:\n\n👥 ${tenants.length} tenants across ${allUnits(property).length} units\n🚗 ${vehicles.length} registered vehicles\n⚠️ ${openIssues.length} pending approval${openIssues.length !== 1 ? "s" : ""}\n\nNeed details on any of these?`);
      return;
    }

    // Plate lookup
    const plateMatch = txt.trim().match(/\b([A-Z0-9]{3,8})\b/i);
    if (plateMatch && (lower.includes("plate") || lower.includes("look up") || lower.includes("who owns") || lower.includes("find") || txt.trim().match(/^[A-Z0-9\s]{3,10}$/i))) {
      const plate = normalizePlate(plateMatch[1]);
      const found = findVehicleByPlate(property, plate);
      if (found) {
        await reply(`Plate ${plate} is registered to:\n👤 ${found.tenant.fullName}\n🏠 Unit ${found.unit.label}\n📱 ${found.tenant.phone || "No phone on file"}\n📧 ${found.tenant.email || "No email"}\n🚗 ${found.vehicle.make} ${found.vehicle.model} (${found.vehicle.color}) — Spot: ${found.vehicle.assignedSpot || "unassigned"}`);
      } else {
        await reply(`Plate ${plate} is not registered in the vehicle registry for ${property.name}. Would you like me to create a parking complaint for this plate?`);
        state.mode = "parking_unregistered";
        state.data = { plate };
      }
      return;
    }

    // Tenant lookup by name
    const tenants = allTenants(property);
    const nameMatch = tenants.find(t => lower.includes(t.fullName.toLowerCase()) || (t.unit?.label && lower.includes(t.unit.label.toLowerCase())));
    if (nameMatch && (lower.includes("contact") || lower.includes("phone") || lower.includes("email") || lower.includes("find") || lower.includes("info"))) {
      await reply(`Contact info for ${nameMatch.fullName}:\n🏠 Unit ${nameMatch.unit.label}\n📱 ${nameMatch.phone || "No phone on file"}\n📧 ${nameMatch.email || "No email"}\n🚗 ${nameMatch.vehicles?.length || 0} vehicle(s) registered`);
      return;
    }

    // Parking complaint
    if ((lower.includes("park") && (lower.includes("spot") || lower.includes("complaint") || lower.includes("blocking"))) || lower.includes("parking issue")) {
      state = { mode: "parking_plate", data: { complainant: "manager" }, history: state.history };
      await reply("Got it — I'll handle the parking complaint. What's the license plate number of the vehicle? (Example: ABC 1234)");
      return;
    }

    // Maintenance
    if (["maintenance", "repair", "broken", "ac", "fridge", "leak"].some(k => lower.includes(k))) {
      const issue = addIssue(data, property, "Maintenance", "Landlord / Stacy", txt, true);
      await pushSms(data, property.id, cfg, `MAINTENANCE NOTED | ${property.name}: "${txt.slice(0, 80)}". Approve dispatch from dashboard.`);
      pushAlert(data, property.id, "Maintenance", `Maintenance flagged: ${txt.slice(0, 60)}`, "warning");
      saveData(data); render();
      await reply(`Maintenance issue logged and a reminder was queued. Approve dispatch from the workflow queue when ready.`);
      return;
    }

    // Default: helpful context
    await reply(`I can help with a few things from here:\n\n• **Look up a plate:** Just type or paste the license plate\n• **Find a tenant:** Say "find [name]" or "contact unit 2A"\n• **Parking complaint:** Say "parking complaint" and I'll guide you\n• **Property summary:** Say "summary"\n\nWhat do you need?`);
  });
};

const initDashboard = () => {
  const user = window.EmployeeAIAuth.currentUser();
  if (!user) return (window.location.href = "./auth.html");
  if (window.EmployeeAIAuth.isOwner(user)) return (window.location.href = "./owner.html");

  byId("userBadge").textContent = `${user.fullName} · Landlord`;
  byId("logoutBtn").addEventListener("click", () => { window.EmployeeAIAuth.logout(); window.location.href = "./auth.html"; });

  bindTabs();
  bindStacyBubble();
  byId("activePropertySelect").addEventListener("change", render);

  byId("planForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const planName = byId("planSelect").value;
    const p = getPlan(planName);
    window.EmployeeAIAuth.updateCurrentUserPlan({ name: planName, monthly: p.monthly, setup: p.setup });
    render();
  });

  document.addEventListener("click", (e) => {
    const selectPlan = e.target.getAttribute("data-select-plan");
    if (!selectPlan) return;
    const p = getPlan(selectPlan);
    window.EmployeeAIAuth.updateCurrentUserPlan({ name: selectPlan, monthly: p.monthly, setup: p.setup });
    render();
  });

  byId("propertyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = ensureData();
    const limits = currentPlan();
    if (data.properties.length >= limits.properties) return alert(`Plan limit: max ${limits.properties} properties.`);
    const f = new FormData(e.target);
    data.properties.push({
      id: crypto.randomUUID(),
      name: String(f.get("name") || "").trim(),
      cityState: String(f.get("cityState") || "").trim(),
      maxVehiclesPerUnit: Number(f.get("maxVehiclesPerUnit") || 2),
      policy: { startingRent: "", leaseTerms: "" },
      stacyConfig: emptyPropertyConfig(), units: []
    });
    saveData(data); e.target.reset(); render();
  });

  byId("stacyConfigForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = ensureData();
    const property = activeProperty(data) || data.properties[0];
    if (!property) return;
    const f = new FormData(e.target);
    property.stacyConfig = {
      operationsEmail: String(f.get("operationsEmail") || "").trim(),
      operationsPassword: String(f.get("operationsPassword") || "").trim(),
      landlordPhone: String(f.get("landlordPhone") || "").trim(),
      maintenanceEmail: String(f.get("maintenanceEmail") || "").trim(),
      smsMode: String(f.get("smsMode") || "textbelt"),
      textbeltKey: String(f.get("textbeltKey") || "").trim()
    };
    pushAlert(data, property.id, "Config", `Stacy settings updated for ${property.name}.`, "success");
    saveData(data); render();
    alert("✓ Stacy settings saved!");
  });

  byId("emailIngestForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = ensureData();
    const property = activeProperty(data) || data.properties[0];
    if (!property) return;
    const f = new FormData(e.target);
    const response = await analyzeEmail(data, property, {
      fromEmail: String(f.get("fromEmail") || "").trim().toLowerCase(),
      subject: String(f.get("subject") || "").trim(),
      body: String(f.get("body") || "").trim(),
      unitHint: String(f.get("unitHint") || "").trim()
    });
    pushAlert(data, property.id, "Email Processed", `Stacy: ${response}`, "success");
    saveData(data); e.target.reset(); render();
    alert(`Stacy analyzed this email:\n\n${response}`);
  });

  byId("unitForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = ensureData();
    const f = new FormData(e.target);
    const property = data.properties.find((p) => p.id === f.get("propertyId"));
    if (!property) return;
    property.units.push({
      id: crypto.randomUUID(),
      label: String(f.get("label") || "").trim(),
      parkingSpots: Number(f.get("parkingSpots") || 0),
      vehicleMaxOverride: f.get("vehicleMaxOverride") ? Number(f.get("vehicleMaxOverride")) : null,
      tenants: []
    });
    saveData(data); e.target.reset(); render();
  });

  byId("tenantForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = ensureData();
    const limits = currentPlan();
    if (totalTenantCount(data) >= limits.tenants) return alert(`Plan limit: max ${limits.tenants} tenants.`);
    const property = activeProperty(data) || data.properties[0];
    if (!property) return;
    const f = new FormData(e.target);
    const unit = property.units.find((u) => u.id === f.get("unitId"));
    if (!unit) return;
    const file = f.get("leaseFile");
    const lease = file && file.size ? await readPdf(file) : null;
    unit.tenants.push({
      id: crypto.randomUUID(),
      fullName: String(f.get("fullName") || "").trim(),
      dob: String(f.get("dob") || ""),
      phone: String(f.get("phone") || "").trim(),
      email: String(f.get("email") || "").trim().toLowerCase(),
      lease, vehicles: [], inviteToken: null, password: null
    });
    saveData(data); e.target.reset(); render();
  });

  byId("vehicleForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = ensureData();
    const property = activeProperty(data) || data.properties[0];
    if (!property) return;
    const f = new FormData(e.target);
    let owner; let unit;
    for (const u of property.units) {
      const t = (u.tenants || []).find((x) => x.id === f.get("tenantId"));
      if (t) { owner = t; unit = u; break; }
    }
    if (!owner || !unit) return;
    const max = unit.vehicleMaxOverride || property.maxVehiclesPerUnit;
    if (unitVehicleCount(unit) >= max) { byId("vehicleError").textContent = `Unit vehicle limit reached (${max}).`; return; }
    byId("vehicleError").textContent = "";
    owner.vehicles.push({
      id: crypto.randomUUID(),
      plate: String(f.get("plate") || "").trim().toUpperCase(),
      make: String(f.get("make") || "").trim(), model: String(f.get("model") || "").trim(),
      color: String(f.get("color") || "").trim(), assignedSpot: String(f.get("assignedSpot") || "").trim(),
      status: "active"
    });
    saveData(data); e.target.reset(); render();
  });

  byId("violationForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = ensureData();
    const property = activeProperty(data) || data.properties[0];
    if (!property) return;
    const f = new FormData(e.target);
    addIssue(data, property, "Parking Violation Invoice", "Automation Hub", `${f.get("unit")}: ${f.get("notes")} ($${f.get("amount")})`, true);
    pushAlert(data, property.id, "Violation", `Violation workflow queued for unit ${f.get("unit")}.`, "warning");
    saveData(data); e.target.reset(); render();
  });

  byId("leaseWorkflowForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = ensureData();
    const property = activeProperty(data) || data.properties[0];
    if (!property) return;
    const f = new FormData(e.target);
    addIssue(data, property, "Lease Workflow", "Automation Hub", `${f.get("action")} for ${f.get("email")}`, false);
    pushAlert(data, property.id, "Lease Workflow", `Queued: ${f.get("action")} for ${f.get("email")}.`, "success");
    saveData(data); e.target.reset(); render();
  });

  document.addEventListener("click", async (e) => {
    const data = ensureData();
    const approve = e.target.getAttribute("data-approve");
    const escalate = e.target.getAttribute("data-escalate");
    const genInvite = e.target.getAttribute("data-generate-invite");
    const copyInvite = e.target.getAttribute("data-copy-invite");
    const editTenant = e.target.getAttribute("data-edit-tenant");
    const removeTenant = e.target.getAttribute("data-remove-tenant");
    const editVehicle = e.target.getAttribute("data-edit-vehicle");
    const removeVehicle = e.target.getAttribute("data-remove-vehicle");
    const editUnit = e.target.getAttribute("data-edit-unit");
    const removeUnit = e.target.getAttribute("data-remove-unit");

    if (approve || escalate) {
      const issue = data.issues.find((i) => i.id === (approve || escalate));
      if (!issue) return;
      issue.status = approve ? "Approved for dispatch" : "Escalated to manager";
      const property = data.properties.find((p) => p.id === issue.propertyId);
      const cfg = property?.stacyConfig || emptyPropertyConfig();
      if (property && approve && issue.type.includes("Maintenance")) {
        const vendor = cfg.maintenanceEmail || "(maintenance email not configured)";
        pushAlert(data, property.id, "Dispatch", `Stacy emailed maintenance vendor ${vendor} for: ${issue.message.slice(0, 60)}`, "success");
        await pushSms(data, property.id, cfg, `Dispatch approved for: ${issue.message.slice(0, 60)}. Vendor: ${vendor}`);
      }
      if (property && approve && (issue.type.includes("Parking"))) {
        const fine = issue.meta?.amount || 50;
        const plate = issue.meta?.plate || "(plate)";
        const violatorName = issue.meta?.violatorName || "Resident";
        const violatorPhone = issue.meta?.violatorPhone || "";
        pushAlert(data, property.id, "Violation Invoice", `Parking invoice: $${fine} for ${violatorName} (${plate}).`, "warning");
        if (violatorPhone) {
          await pushSms(data, property.id, cfg,
            `Parking violation notice: A $${fine} fine has been issued for your vehicle (${plate}) at ${property.name}. Please contact management to resolve.`,
            violatorPhone
          );
        }
      }
      saveData(data); render(); return;
    }

    if (genInvite) {
      for (const p of data.properties) for (const u of p.units) {
        const t = (u.tenants || []).find((x) => x.id === genInvite);
        if (t) { t.inviteToken = crypto.randomUUID(); saveData(data); render(); return; }
      }
    }

    if (copyInvite) {
      const url = createInviteLink(copyInvite);
      try { await navigator.clipboard.writeText(url); } catch {}
      alert(`Invite link copied:\n${url}`);
      return;
    }

    if (editTenant || removeTenant) {
      for (const p of data.properties) for (const u of p.units) {
        const idx = (u.tenants || []).findIndex((x) => x.id === (editTenant || removeTenant));
        if (idx >= 0) {
          if (removeTenant) { u.tenants.splice(idx, 1); saveData(data); render(); return; }
          const t = u.tenants[idx];
          t.fullName = prompt("Tenant full name", t.fullName) || t.fullName;
          t.phone = prompt("Phone", t.phone || "") ?? t.phone;
          t.email = (prompt("Email", t.email || "") ?? t.email).toLowerCase();
          saveData(data); render(); return;
        }
      }
    }

    if (editVehicle || removeVehicle) {
      for (const p of data.properties) for (const u of p.units) for (const t of (u.tenants || [])) {
        const idx = (t.vehicles || []).findIndex((x) => x.id === (editVehicle || removeVehicle));
        if (idx >= 0) {
          if (removeVehicle) { t.vehicles.splice(idx, 1); saveData(data); render(); return; }
          const v = t.vehicles[idx];
          v.plate = (prompt("Plate", v.plate) || v.plate).toUpperCase();
          v.make = prompt("Make", v.make) || v.make;
          v.model = prompt("Model", v.model) || v.model;
          v.color = prompt("Color", v.color) || v.color;
          v.assignedSpot = prompt("Assigned spot", v.assignedSpot || "") ?? v.assignedSpot;
          saveData(data); render(); return;
        }
      }
    }

    if (editUnit || removeUnit) {
      for (const p of data.properties) {
        const idx = (p.units || []).findIndex((x) => x.id === (editUnit || removeUnit));
        if (idx >= 0) {
          if (removeUnit) { p.units.splice(idx, 1); saveData(data); render(); return; }
          const u = p.units[idx];
          u.label = prompt("Unit label", u.label) || u.label;
          u.parkingSpots = Number(prompt("Parking spots", String(u.parkingSpots)) || u.parkingSpots);
          const o = prompt("Vehicle max override (blank to clear)", u.vehicleMaxOverride ? String(u.vehicleMaxOverride) : "");
          u.vehicleMaxOverride = o ? Number(o) : null;
          saveData(data); render(); return;
        }
      }
    }
  });

  render();
};

window.addEventListener("DOMContentLoaded", initDashboard);
