/* =====================================================
   EmployeeAI Tenant Portal JS – v3
   Fixes: SMS delivery, Stacy context memory, smarter AI
   ===================================================== */
const STORAGE_DATA = "employeeai_data_v1";
const STORAGE_TENANT_SESSION = "employeeai_tenant_session_v1";
const STORAGE_STACY_STATE = "employeeai_stacy_state_v1";
const byId = (id) => document.getElementById(id);

const emptyPropertyConfig = () => ({
  operationsEmail: "", operationsPassword: "",
  landlordPhone: "", maintenanceEmail: "",
  smsMode: "textbelt", textbeltKey: ""
});

const loadData = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_DATA)) || { properties: [], issues: [], reminders: [], alerts: [], smsLog: [] }; }
  catch { return { properties: [], issues: [], reminders: [], alerts: [], smsLog: [] }; }
};
const saveData = (d) => localStorage.setItem(STORAGE_DATA, JSON.stringify(d));
const setTenantSession = (s) => localStorage.setItem(STORAGE_TENANT_SESSION, JSON.stringify(s));
const getTenantSession = () => { try { return JSON.parse(localStorage.getItem(STORAGE_TENANT_SESSION)); } catch { return null; } };
const clearTenantSession = () => localStorage.removeItem(STORAGE_TENANT_SESSION);

const loadStacyState = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_STACY_STATE)) || {}; }
  catch { return {}; }
};
const saveStacyState = (s) => localStorage.setItem(STORAGE_STACY_STATE, JSON.stringify(s));

const getTenantStacyState = (tenantId) => {
  const all = loadStacyState();
  if (!all[tenantId]) all[tenantId] = {
    pending: null, lastIssue: null, lastTopic: null,
    lastSeenAt: null, conversationHistory: []
  };
  if (!all[tenantId].conversationHistory) all[tenantId].conversationHistory = [];
  return { all, state: all[tenantId] };
};

const pushAlert = (data, propertyId, type, message, status = "info") => {
  if (!Array.isArray(data.alerts)) data.alerts = [];
  data.alerts.push({ id: crypto.randomUUID(), propertyId, type, message, status, createdAt: new Date().toISOString() });
};

const normalizePhone = (s) => {
  const stripped = String(s || "").replace(/[\s\-\(\)\.]/g, "");
  // Keep + for international format, digits otherwise
  const cleaned = stripped.replace(/[^\d+]/g, "");
  return cleaned;
};

const pushSmsLog = (data, propertyId, phone, text, delivery = "queued") => {
  if (!Array.isArray(data.smsLog)) data.smsLog = [];
  const entry = { id: crypto.randomUUID(), propertyId, phone: phone || "(missing phone)", text, delivery, createdAt: new Date().toISOString() };
  data.smsLog.push(entry);
  return entry;
};

// FIX: SMS delivery — use "textbelt" as free test key if none configured, consistent logic
const sendSms = async (data, propertyId, cfg, phone, text) => {
  const target = normalizePhone(phone);
  const entry = pushSmsLog(data, propertyId, target || phone || "(missing phone)", text, "queued");

  if (!target) {
    entry.delivery = "failed: missing phone";
    saveData(data);
    return entry;
  }

  const mode = cfg?.smsMode || "textbelt";
  if (mode === "textbelt") {
    // Use configured key or fall back to free "textbelt" test key (1 free SMS/day)
    const key = (cfg?.textbeltKey && cfg.textbeltKey.trim()) ? cfg.textbeltKey.trim() : "textbelt";
    try {
      const params = new URLSearchParams({ phone: target, message: text, key });
      const res = await fetch("https://textbelt.com/text", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      const json = await res.json();
      entry.delivery = json.success
        ? `sent${json.textId ? ` (id:${json.textId})` : ""}`
        : `failed: ${json.error || "unknown"}`;
    } catch (e) {
      entry.delivery = "failed: network";
    }
  } else {
    entry.delivery = "demo-mode (not sent)";
  }

  saveData(data);
  return entry;
};

const readPdf = (file) => new Promise((resolve) => {
  if (!file) return resolve(null);
  const reader = new FileReader();
  reader.onload = () => resolve({ fileName: file.name, dataUrl: reader.result });
  reader.onerror = () => resolve(null);
  reader.readAsDataURL(file);
});

const findByInvite = (data, invite, email) => {
  for (const property of data.properties || []) for (const unit of property.units || []) for (const tenant of unit.tenants || []) {
    if (tenant.inviteToken === invite && tenant.email === email.toLowerCase()) return { property, unit, tenant };
  }
  return null;
};

const findByCredentials = (data, email, password) => {
  for (const property of data.properties || []) for (const unit of property.units || []) for (const tenant of unit.tenants || []) {
    if (tenant.email === email.toLowerCase() && tenant.password === password) return { property, unit, tenant };
  }
  return null;
};

const findBySession = (data, session) => {
  for (const property of data.properties || []) for (const unit of property.units || []) for (const tenant of unit.tenants || []) {
    if (tenant.id === session.tenantId) return { property, unit, tenant };
  }
  return null;
};

const unitVehicleLimit = (property, unit) => unit.vehicleMaxOverride || property.maxVehiclesPerUnit || 2;
const unitVehicleCount = (unit) => (unit.tenants || []).reduce((n, t) => n + ((t.vehicles || []).length), 0);

const allVehicles = (property) => (property.units || []).flatMap((u) =>
  (u.tenants || []).flatMap((t) => (t.vehicles || []).map((v) => ({ ...v, owner: t, unit: u }))));

const findVehicleByPlate = (property, plate) => {
  const p = String(plate || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!p) return null;
  return allVehicles(property).find((v) => String(v.plate || "").trim().toUpperCase().replace(/\s+/g, "") === p) || null;
};

/* =================== STACY INTELLIGENCE ENGINE ===================
   Smart conversation logic with full context awareness, memory,
   and natural responses. Falls back to keyword matching gracefully.
   ================================================================= */

const stacyPersonality = {
  greet: (name, lastIssue) => {
    const base = `Hi ${name}! I'm Stacy, your property assistant. I'm available 24/7 for parking issues, maintenance requests, lease questions, or anything else you need.`;
    if (lastIssue && lastIssue.type && lastIssue.createdAt) {
      const when = new Date(lastIssue.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      return `${base}\n\n📋 By the way — I still have your ${lastIssue.type.toLowerCase()} request from ${when} on file. If you're following up on that, just say "yes" or ask me about it.`;
    }
    return base;
  },

  contextHelp: (lastIssue) => {
    if (lastIssue?.type) {
      return `I can help! Are you following up on your **${lastIssue.type.toLowerCase()}** issue, or is this something new?\n\nYou can say:\n• "Still about the ${lastIssue.type.toLowerCase()}" — I'll pull up the details\n• "New issue" — I'll start fresh\n• Or just describe what's happening`;
    }
    return `I'm here to help! What do you need?\n\n🚗 **Parking** — someone in your spot, wrong plate, etc.\n🔧 **Maintenance** — repairs, leaks, AC, appliances\n📄 **Lease / policy** — questions about your agreement\n💬 **General** — anything else on your mind\n\nJust describe what's going on in plain language.`;
  },

  parkingAsk: () => `Got it — I'll handle this right away. What's the **license plate** of the vehicle blocking your spot? (Example: ABC 1234)`,

  parkingFound: (plate, ownerName) =>
    `Found it — **${plate}** is registered to another resident (${ownerName}). I've sent them an immediate warning text to move their vehicle, and I've notified your property manager with full details.\n\nIf the car isn't moved within 30 minutes, let me know and I can escalate — I'll flag for towing or draft a violation invoice pending manager approval.`,

  parkingNotFound: (plate) =>
    `I logged plate **${plate}** and alerted your property manager — the plate isn't in our registry, so they'll need to verify the vehicle directly. They've been notified with your unit and the plate number.\n\nWant me to also draft a violation notice to hold for their approval?`,

  maintenanceAsk: () =>
    `I'll get this reported right away. To route it correctly — what exactly is happening, and when did it start? Please mention if there's any safety risk (flooding, no power, gas smell) so I can prioritize properly.`,

  maintenanceLogged: (details) =>
    `Reported! I've created a maintenance ticket for: "${details.slice(0, 80)}${details.length > 80 ? "..." : ""}"\n\nYour property manager has been notified and needs to approve dispatch. You'll typically hear back within 24 hours. If it's an emergency (flooding, no power, fire risk), reply "EMERGENCY" and I'll escalate immediately.`,

  emergency: () =>
    `⚠️ EMERGENCY FLAGGED — I'm notifying your property manager immediately with an urgent priority alert. If there is any risk to life or safety, please also call 911 or your local emergency services right now.\n\nI'm escalating your maintenance ticket to emergency priority.`,

  followUpYes: (issueType) =>
    `Okay — pulling up your ${issueType.toLowerCase()} issue. What would you like to know or update? You can say "status", "cancel", or just describe what changed.`,

  status: (lastIssue) => {
    if (!lastIssue) return `You don't have any open issues on file right now. What do you need help with?`;
    const when = new Date(lastIssue.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `Your most recent request:\n📌 **${lastIssue.type}** — submitted ${when}\n📊 Status: Awaiting manager review\n\nWant to add more details or follow up on this?`;
  },

  leaseInfo: (property) => {
    const rent = property?.policy?.startingRent;
    const terms = property?.policy?.leaseTerms;
    let resp = `Here's what I have on file for your property:\n\n`;
    if (rent) resp += `💰 **Rent:** ${rent}\n`;
    if (terms) resp += `📋 **Terms:** ${terms}\n`;
    if (!rent && !terms) resp += `Your property manager hasn't entered specific lease details yet. I'd recommend contacting them directly for lease-specific questions.`;
    resp += `\nIs there something specific you need — renewal, move-out checklist, or a policy question?`;
    return resp;
  },

  unknown: () =>
    `I want to make sure I help you correctly. Could you give me a bit more detail? For example:\n• "My fridge stopped working yesterday"\n• "Someone parked in spot 12 — plate ABC123"\n• "How much notice do I need to give before moving out?"\n\nThe more context you give me, the faster I can route this.`
};

// Intent detection — returns { intent, confidence, data }
const detectIntent = (text) => {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);

  // Emergency keywords — highest priority
  if (["emergency", "fire", "flood", "flooding", "gas", "gas leak", "no power", "electrical fire", "burst pipe"].some(k => lower.includes(k)))
    return { intent: "emergency", confidence: 1 };

  // Follow-up confirmations
  if (["yes", "yeah", "yep", "yup", "correct", "that one", "same issue", "still about"].some(k => lower.includes(k)) && lower.split(/\s+/).length <= 4)
    return { intent: "followup_yes", confidence: 0.9 };

  // Status check
  if (["status", "update", "any news", "what happened", "heard back", "any update"].some(k => lower.includes(k)))
    return { intent: "status_check", confidence: 0.9 };

  // Help menu
  if (["help", "menu", "options", "what can you do", "commands"].some(k => lower.includes(k)) && lower.split(/\s+/).length <= 4)
    return { intent: "help", confidence: 0.9 };

  // Parking — strong signals
  const parkingStrong = (lower.includes("park") && (lower.includes("spot") || lower.includes("space") || lower.includes("my spot") || lower.includes("wrong spot")))
    || lower.includes("someone parked") || lower.includes("blocking my") || lower.includes("in my parking");
  if (parkingStrong) return { intent: "parking", confidence: 0.95 };

  // Looks like a license plate (standalone)
  const plateMatch = text.trim().match(/^[A-Z0-9]{3,8}$/i);
  if (plateMatch) return { intent: "plate_input", confidence: 0.9, data: { plate: text.trim() } };

  // Maintenance — strong signals
  const maintenanceWords = ["ac", "air conditioning", "fridge", "refrigerator", "leak", "leaking", "broken", "not working", "repair", "maintenance", "mold", "mould", "pest", "bug", "cockroach", "roach", "heater", "heat", "hot water", "no hot water", "toilet", "sink", "drain", "clogged", "dishwasher", "washer", "dryer", "oven", "stove", "window", "door won't", "lock broken"];
  if (maintenanceWords.some(k => lower.includes(k))) return { intent: "maintenance", confidence: 0.9 };

  // Lease / policy
  const leaseWords = ["rent", "lease", "move out", "moving out", "notice", "renewal", "renew", "deposit", "policy", "rules", "when is rent", "how much", "fee", "fees"];
  if (leaseWords.some(k => lower.includes(k))) return { intent: "lease", confidence: 0.85 };

  // Guest parking
  if (lower.includes("guest") && lower.includes("park")) return { intent: "guest_parking", confidence: 0.85 };

  return { intent: "unknown", confidence: 0 };
};

/* =================== TENANT AUTH =================== */
const initTenantAuth = () => {
  const inviteForm = byId("tenantInviteForm");
  const loginForm = byId("tenantLoginForm");
  if (!inviteForm || !loginForm) return;

  const activateTab = byId("activateTab");
  const loginTab = byId("loginTab");
  const alertEl = byId("tenantAlert");
  const show = (m) => { alertEl.classList.remove("hidden"); alertEl.textContent = m; };
  const clear = () => { alertEl.classList.add("hidden"); alertEl.textContent = ""; };

  const switchMode = (mode) => {
    clear();
    const activate = mode === "activate";
    activateTab.classList.toggle("active", activate);
    loginTab.classList.toggle("active", !activate);
    inviteForm.classList.toggle("hidden", !activate);
    loginForm.classList.toggle("hidden", activate);
  };

  activateTab.addEventListener("click", () => switchMode("activate"));
  loginTab.addEventListener("click", () => switchMode("login"));

  const inviteFromUrl = new URLSearchParams(window.location.search).get("invite");
  if (inviteFromUrl) byId("inviteTokenInput").value = inviteFromUrl;

  inviteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    clear();
    const f = new FormData(inviteForm);
    const invite = String(f.get("invite") || "").trim();
    const email = String(f.get("email") || "").trim().toLowerCase();
    const password = String(f.get("password") || "");
    const data = loadData();
    const found = findByInvite(data, invite, email);
    if (!found) return show("Invite token or email not found. Check with your property manager.");
    found.tenant.password = password;
    found.tenant.email = email;
    if (!found.tenant.inviteActivatedAt) found.tenant.inviteActivatedAt = new Date().toISOString();
    saveData(data);
    setTenantSession({ tenantId: found.tenant.id, propertyId: found.property.id, email: found.tenant.email });
    window.location.href = "./tenant-portal.html";
  });

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    clear();
    const f = new FormData(loginForm);
    const email = String(f.get("email") || "").trim().toLowerCase();
    const password = String(f.get("password") || "");
    const data = loadData();
    const found = findByCredentials(data, email, password);
    if (!found) return show("Invalid email or password.");
    setTenantSession({ tenantId: found.tenant.id, propertyId: found.property.id, email: found.tenant.email });
    window.location.href = "./tenant-portal.html";
  });
};

/* =================== TENANT PORTAL =================== */
const initTenantPortal = () => {
  if (!byId("tenantBadge")) return;
  const session = getTenantSession();
  if (!session) return (window.location.href = "./tenant-auth.html");
  const data = loadData();
  const found = findBySession(data, session);
  if (!found) { clearTenantSession(); return (window.location.href = "./tenant-auth.html"); }

  const { property, unit, tenant } = found;
  // FIX: Use emptyPropertyConfig() fallback so smsMode defaults to "textbelt" not undefined
  const cfg = property.stacyConfig || emptyPropertyConfig();

  const renderPortal = () => {
    byId("tenantBadge").textContent = `${tenant.fullName} · ${property.name}`;
    byId("tenantProfile").innerHTML = `
      <div style="display:grid;gap:6px;font-size:14px;">
        <div><strong>Unit:</strong> ${unit.label}</div>
        <div><strong>Property:</strong> ${property.name}</div>
        <div><strong>Email:</strong> ${tenant.email}</div>
        <div><strong>Phone:</strong> ${tenant.phone || "—"}</div>
      </div>`;
    byId("tenantProfileForm").email.value = tenant.email || "";
    byId("tenantProfileForm").phone.value = tenant.phone || "";
    byId("tenantLeaseInfo").innerHTML = tenant.lease?.dataUrl
      ? `<a class="btn sm" href="${tenant.lease.dataUrl}" download="${tenant.lease.fileName}">📄 Download ${tenant.lease.fileName}</a>`
      : `<span class="muted" style="font-size:13px;">No lease uploaded yet.</span>`;

    byId("householdTenantsBody").innerHTML = (unit.tenants || []).map((t) =>
      `<tr><td>${t.fullName}</td><td>${t.email || "—"}</td><td>${t.phone || "—"}</td><td><button class="btn sm" data-edit-household="${t.id}">Edit</button> <button class="btn sm" data-remove-household="${t.id}">Remove</button></td></tr>`
    ).join("");

    byId("vehicleOwnerSelect").innerHTML = (unit.tenants || []).map((t) => `<option value="${t.id}">${t.fullName}</option>`).join("");

    const vehicles = (unit.tenants || []).flatMap((t) => (t.vehicles || []).map((v) => ({ ...v, ownerName: t.fullName })));
    byId("tenantVehiclesBody").innerHTML = vehicles.length
      ? vehicles.map((v) => `<tr><td><strong>${v.plate}</strong></td><td>${v.make} ${v.model}</td><td style="color:var(--muted)">${v.color}</td><td>${v.ownerName}</td><td>${v.assignedSpot || "—"}</td><td><button class="btn sm" data-remove-vehicle="${v.id}">Remove</button></td></tr>`).join("")
      : `<tr><td colspan="6" class="muted" style="text-align:center;padding:16px;">No vehicles registered yet.</td></tr>`;
  };

  renderPortal();

  byId("tenantLogoutBtn").addEventListener("click", () => { clearTenantSession(); window.location.href = "./tenant-auth.html"; });

  byId("tenantProfileForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    tenant.email = String(f.get("email") || "").trim().toLowerCase();
    tenant.phone = String(f.get("phone") || "").trim();
    saveData(data); renderPortal();
    // Update session email
    setTenantSession({ ...session, email: tenant.email });
  });

  byId("tenantLeaseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = new FormData(e.target).get("leaseFile");
    if (!file || !file.size) return;
    tenant.lease = await readPdf(file);
    saveData(data); e.target.reset(); renderPortal();
  });

  byId("householdTenantForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    unit.tenants.push({
      id: crypto.randomUUID(),
      fullName: String(f.get("fullName") || "").trim(),
      email: String(f.get("email") || "").trim().toLowerCase(),
      phone: String(f.get("phone") || "").trim(),
      password: null, vehicles: [], lease: null, inviteToken: null
    });
    saveData(data); e.target.reset(); renderPortal();
  });

  byId("tenantVehicleForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const max = unitVehicleLimit(property, unit);
    if (unitVehicleCount(unit) >= max) {
      byId("tenantVehicleError").textContent = `Unit limit reached: max ${max} vehicles.`;
      return;
    }
    byId("tenantVehicleError").textContent = "";
    const owner = (unit.tenants || []).find((t) => t.id === f.get("ownerTenantId"));
    if (!owner) return;
    owner.vehicles = owner.vehicles || [];
    owner.vehicles.push({
      id: crypto.randomUUID(),
      plate: String(f.get("plate") || "").trim().toUpperCase(),
      make: String(f.get("make") || "").trim(),
      model: String(f.get("model") || "").trim(),
      color: String(f.get("color") || "").trim(),
      assignedSpot: String(f.get("assignedSpot") || "").trim(),
      status: "active"
    });
    saveData(data); e.target.reset(); renderPortal();
  });

  document.addEventListener("click", (e) => {
    const editHousehold = e.target.getAttribute("data-edit-household");
    const removeHousehold = e.target.getAttribute("data-remove-household");
    const removeVehicle = e.target.getAttribute("data-remove-vehicle");

    if (editHousehold || removeHousehold) {
      const idx = (unit.tenants || []).findIndex((t) => t.id === (editHousehold || removeHousehold));
      if (idx < 0) return;
      if (removeHousehold) {
        if (unit.tenants[idx].id === tenant.id) return alert("You cannot remove your own account from this portal.");
        unit.tenants.splice(idx, 1); saveData(data); return renderPortal();
      }
      const t = unit.tenants[idx];
      t.fullName = prompt("Resident name", t.fullName) || t.fullName;
      t.email = (prompt("Resident email", t.email || "") ?? t.email).toLowerCase();
      t.phone = prompt("Resident phone", t.phone || "") ?? t.phone;
      saveData(data); return renderPortal();
    }

    if (removeVehicle) {
      for (const t of (unit.tenants || [])) {
        const vidx = (t.vehicles || []).findIndex((v) => v.id === removeVehicle);
        if (vidx >= 0) { t.vehicles.splice(vidx, 1); saveData(data); return renderPortal(); }
      }
    }
  });

  /* =================== STACY CHAT =================== */
  const bubble = byId("tenantStacyBubbleBtn");
  const panel = byId("tenantStacyPanel");
  const messages = byId("tenantStacyMessages");
  const form = byId("tenantStacyForm");
  const input = byId("tenantStacyInput");
  const st = getTenantStacyState(tenant.id);
  const stacyAll = st.all;
  const stacy = st.state;
  let isOpen = false;

  const remember = (patch = {}) => {
    Object.assign(stacy, patch);
    stacy.lastSeenAt = new Date().toISOString();
    saveStacyState(stacyAll);
  };

  const addToHistory = (role, content) => {
    if (!stacy.conversationHistory) stacy.conversationHistory = [];
    stacy.conversationHistory.push({ role, content, ts: Date.now() });
    // Keep last 20 messages
    if (stacy.conversationHistory.length > 20) stacy.conversationHistory = stacy.conversationHistory.slice(-20);
    saveStacyState(stacyAll);
  };

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
    div.id = "stacy-typing";
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  };

  const removeTyping = () => {
    const el = document.getElementById("stacy-typing");
    if (el) el.remove();
  };

  const reply = async (text) => {
    const typing = pushTyping();
    await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
    typing.remove();
    push("bot", text);
    addToHistory("assistant", text);
  };

  bubble.addEventListener("click", () => {
    isOpen = !isOpen;
    panel.classList.toggle("hidden", !isOpen);
    if (isOpen && !messages.children.length) {
      const greeting = stacyPersonality.greet(tenant.fullName.split(" ")[0], stacy.lastIssue);
      push("bot", greeting);
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    push("user", text);
    addToHistory("user", text);

    const lower = text.toLowerCase();
    const { intent, data: intentData } = detectIntent(text);

    // ---- PENDING STATE HANDLERS ----

    if (stacy.pending === "parking_plate") {
      // Accept what user types as the plate
      const rawPlate = text.trim().toUpperCase().replace(/\s+/g, "");
      const match = findVehicleByPlate(property, rawPlate);

      const issue = {
        id: crypto.randomUUID(), propertyId: property.id,
        type: "Parking Complaint", from: tenant.fullName,
        message: `Parking complaint — plate: ${rawPlate} | Unit: ${unit.label} | Reporter: ${tenant.fullName}`,
        approvalRequired: true, status: "Awaiting manager approval",
        createdAt: new Date().toISOString(),
        meta: { plate: rawPlate, reporterUnit: unit.label, reporterPhone: tenant.phone || "" }
      };
      data.issues.push(issue);
      pushAlert(data, property.id, "Parking", `${unit.label} ${tenant.fullName} reported plate ${rawPlate}`, "warning");

      // Notify landlord
      await sendSms(data, property.id, cfg, cfg.landlordPhone,
        `PARKING COMPLAINT | ${property.name} | Unit ${unit.label} | Reporter: ${tenant.fullName} (${tenant.phone || "no phone"}) | Plate: ${rawPlate}${match ? ` | Registered to: ${match.owner.fullName} (${match.owner.phone || "no phone"})` : " | PLATE NOT IN REGISTRY"}. Review in dashboard.`
      );

      // FIX: Notify the registered vehicle owner if we find them and they have a phone
      if (match?.owner?.phone) {
        await sendSms(data, property.id, cfg, match.owner.phone,
          `Hi ${match.owner.fullName} — this is an automated notice from ${property.name}: your vehicle (${rawPlate}) is reported to be parked in another resident's spot. Please move it as soon as possible to avoid a fine or tow.`
        );
      }

      saveData(data);
      remember({
        pending: null, lastTopic: "parking",
        lastIssue: { id: issue.id, type: issue.type, createdAt: issue.createdAt, meta: { plate: rawPlate } }
      });

      const response = match?.owner?.phone
        ? stacyPersonality.parkingFound(rawPlate, match.owner.fullName)
        : stacyPersonality.parkingNotFound(rawPlate);
      await reply(response);
      return;
    }

    if (stacy.pending === "maintenance_details") {
      const issue = {
        id: crypto.randomUUID(), propertyId: property.id,
        type: "Maintenance", from: tenant.fullName,
        message: text, approvalRequired: true,
        status: "Awaiting manager approval",
        createdAt: new Date().toISOString(),
        meta: { unit: unit.label, tenantPhone: tenant.phone || "" }
      };
      data.issues.push(issue);
      pushAlert(data, property.id, "Maintenance", `${unit.label} ${tenant.fullName}: ${text.slice(0, 80)}`, "warning");
      await sendSms(data, property.id, cfg, cfg.landlordPhone,
        `MAINTENANCE REQUEST | ${property.name} | Unit ${unit.label} | ${tenant.fullName} (${tenant.phone || "no phone"}): "${text}". Approve dispatch in dashboard.`
      );
      saveData(data);
      remember({
        pending: null, lastTopic: "maintenance",
        lastIssue: { id: issue.id, type: issue.type, createdAt: issue.createdAt }
      });

      // Check for emergency keywords in their response
      if (["flood", "flooding", "fire", "gas", "no power", "burst", "emergency"].some(k => lower.includes(k))) {
        await reply(stacyPersonality.emergency());
      } else {
        await reply(stacyPersonality.maintenanceLogged(text));
      }
      return;
    }

    // ---- INTENT ROUTING ----

    if (intent === "emergency") {
      const issue = {
        id: crypto.randomUUID(), propertyId: property.id,
        type: "EMERGENCY Maintenance", from: tenant.fullName,
        message: `⚠️ EMERGENCY: ${text}`, approvalRequired: false,
        status: "EMERGENCY - Immediate action required",
        createdAt: new Date().toISOString()
      };
      data.issues.push(issue);
      pushAlert(data, property.id, "EMERGENCY", `EMERGENCY reported by ${unit.label} ${tenant.fullName}: ${text.slice(0, 80)}`, "bad");
      await sendSms(data, property.id, cfg, cfg.landlordPhone,
        `🚨 EMERGENCY | ${property.name} | Unit ${unit.label} | ${tenant.fullName} (${tenant.phone || "no phone"}): "${text}". Immediate action required.`
      );
      saveData(data);
      remember({ pending: null, lastTopic: "maintenance", lastIssue: { id: issue.id, type: "EMERGENCY Maintenance", createdAt: issue.createdAt } });
      await reply(stacyPersonality.emergency());
      return;
    }

    if (intent === "followup_yes" && stacy.lastIssue?.type) {
      remember({ lastTopic: (stacy.lastIssue.type || "").toLowerCase() });
      await reply(stacyPersonality.followUpYes(stacy.lastIssue.type));
      return;
    }

    if (intent === "status_check") {
      await reply(stacyPersonality.status(stacy.lastIssue));
      return;
    }

    if (intent === "help") {
      await reply(stacyPersonality.contextHelp(stacy.lastIssue));
      return;
    }

    if (intent === "parking") {
      pushAlert(data, property.id, "Parking", `${unit.label} ${tenant.fullName} started a parking report.`, "warning");
      await sendSms(data, property.id, cfg, cfg.landlordPhone,
        `PARKING REPORT STARTED | ${property.name} | Unit ${unit.label} | Reporter: ${tenant.fullName}. Stacy is collecting details.`
      );
      saveData(data);
      remember({ pending: "parking_plate", lastTopic: "parking" });
      await reply(stacyPersonality.parkingAsk());
      return;
    }

    if (intent === "plate_input" && stacy.lastTopic === "parking") {
      // User pasted a plate after parking was mentioned
      remember({ pending: "parking_plate" });
      // Re-process as plate input
      input.value = text;
      form.dispatchEvent(new Event("submit"));
      return;
    }

    if (intent === "maintenance") {
      remember({ pending: "maintenance_details", lastTopic: "maintenance" });
      await reply(stacyPersonality.maintenanceAsk());
      return;
    }

    if (intent === "lease") {
      const issue = { id: crypto.randomUUID(), propertyId: property.id, type: "Lease / Policy Question", from: tenant.fullName, message: text, approvalRequired: false, status: "Logged", createdAt: new Date().toISOString() };
      data.issues.push(issue);
      saveData(data);
      remember({ lastTopic: "lease", lastIssue: { id: issue.id, type: issue.type, createdAt: issue.createdAt } });
      await reply(stacyPersonality.leaseInfo(property));
      return;
    }

    if (intent === "guest_parking") {
      await reply(`Guest parking questions depend on your property's specific policy. From what I have on file:\n\n${property.policy?.leaseTerms || "Your property manager hasn't entered specific parking policy details yet."}\n\nWould you like me to flag this question for your property manager to respond to?`);
      return;
    }

    // Default: log and give helpful response
    const issue = { id: crypto.randomUUID(), propertyId: property.id, type: "Tenant Message", from: tenant.fullName, message: text, approvalRequired: false, status: "Logged", createdAt: new Date().toISOString() };
    data.issues.push(issue);
    pushAlert(data, property.id, "Tenant Message", `${unit.label} ${tenant.fullName}: ${text.slice(0, 80)}`, "info");
    saveData(data);
    remember({ lastTopic: "general", lastIssue: { id: issue.id, type: "General Message", createdAt: issue.createdAt } });
    await reply(stacyPersonality.unknown());
  });
};

window.addEventListener("DOMContentLoaded", () => {
  initTenantAuth();
  initTenantPortal();
});
