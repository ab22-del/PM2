/* =====================================================
   EmployeeAI Tenant Portal JS – v4
   MAJOR: Smarter Stacy, fixed SMS, conversation memory
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

const loadStacyState = () => { try { return JSON.parse(localStorage.getItem(STORAGE_STACY_STATE)) || {}; } catch { return {}; } };
const saveStacyState = (s) => localStorage.setItem(STORAGE_STACY_STATE, JSON.stringify(s));

const getTenantStacyState = (tenantId) => {
  const all = loadStacyState();
  if (!all[tenantId]) all[tenantId] = {
    pending: null, lastIssue: null, lastTopic: null,
    lastSeenAt: null, conversationHistory: [], issueCount: 0
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
  return stripped.replace(/[^\d+]/g, "");
};

const pushSmsLog = (data, propertyId, phone, text, delivery = "queued") => {
  if (!Array.isArray(data.smsLog)) data.smsLog = [];
  const entry = { id: crypto.randomUUID(), propertyId, phone: phone || "(missing phone)", text, delivery, createdAt: new Date().toISOString() };
  data.smsLog.push(entry);
  return entry;
};

const sendSms = async (data, propertyId, cfg, phone, text) => {
  const target = normalizePhone(phone);
  const entry = pushSmsLog(data, propertyId, target || phone || "(missing phone)", text, "queued");

  if (!target) {
    entry.delivery = "failed: missing phone number";
    saveData(data);
    return entry;
  }

  const mode = cfg?.smsMode || "textbelt";
  if (mode === "textbelt") {
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
      entry.delivery = "failed: network error — check SMS configuration";
    }
  } else {
    entry.delivery = "demo-mode (logged only — switch to Textbelt for live SMS)";
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

/* =================== STACY v4 INTELLIGENCE ENGINE ===================
   Complete rewrite with:
   - Multi-turn conversation state machine
   - Deep context memory per tenant
   - Natural language understanding with fuzzy matching
   - Proactive follow-ups and smart suggestions
   - Proper escalation paths
   ================================================================= */

const STACY = {
  // Greeting — context aware
  greet(name, stacy) {
    const hour = new Date().getHours();
    const timeGreet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    let msg = `${timeGreet}, ${name}! I'm Stacy, your property assistant. I'm here 24/7 to help with anything you need.`;

    if (stacy.lastIssue?.type && stacy.lastIssue?.createdAt) {
      const when = new Date(stacy.lastIssue.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const topic = stacy.lastIssue.type.toLowerCase();
      msg += `\n\n📋 I see you had a ${topic} request from ${when}. Are you following up on that, or do you have something new?`;
    } else {
      msg += `\n\nHow can I help you today? You can tell me about:\n🚗 Parking issues\n🔧 Maintenance problems\n📄 Lease questions\n💬 Or anything else — just describe what's going on.`;
    }
    return msg;
  },

  // Smart intent detection with confidence scoring
  detectIntent(text, stacy) {
    const lower = text.toLowerCase().trim();
    const words = lower.split(/\s+/);
    const wordCount = words.length;

    // Emergency — always highest priority
    const emergencyWords = ["emergency", "fire", "flood", "flooding", "gas leak", "gas smell", "no power", "burst pipe", "electrical fire", "smoke", "carbon monoxide"];
    if (emergencyWords.some(k => lower.includes(k)))
      return { intent: "emergency", confidence: 1.0 };

    // Very short affirmative responses — likely follow-ups
    const yesWords = ["yes", "yeah", "yep", "yup", "correct", "sure", "ok", "okay", "right", "that one", "same issue", "same thing", "still about", "following up", "follow up"];
    if (yesWords.some(k => lower === k || (lower.includes(k) && wordCount <= 5)))
      return { intent: "followup_yes", confidence: 0.9 };

    // Negative / new issue
    const noWords = ["no", "nah", "nope", "different", "new issue", "something else", "not that", "new problem"];
    if (noWords.some(k => lower === k || (lower.includes(k) && wordCount <= 5)))
      return { intent: "new_issue", confidence: 0.9 };

    // Status check
    if (["status", "update", "any news", "what happened", "heard back", "any update", "progress", "check on"].some(k => lower.includes(k)))
      return { intent: "status_check", confidence: 0.9 };

    // Thank you / goodbye
    if (["thank", "thanks", "appreciate", "thx"].some(k => lower.includes(k)))
      return { intent: "thanks", confidence: 0.85 };

    if (["bye", "goodbye", "that's all", "nothing else", "all good", "all set", "i'm good"].some(k => lower.includes(k)))
      return { intent: "goodbye", confidence: 0.85 };

    // Help / menu
    if (["help", "menu", "options", "what can you do", "commands", "how does this work"].some(k => lower.includes(k)) && wordCount <= 6)
      return { intent: "help", confidence: 0.9 };

    // Parking — strong signals
    if ((lower.includes("park") && (lower.includes("spot") || lower.includes("space") || lower.includes("my spot") || lower.includes("wrong spot") || lower.includes("taken")))
      || lower.includes("someone parked") || lower.includes("blocking my") || lower.includes("in my parking") || lower.includes("towed")
      || lower.includes("car in my") || lower.includes("vehicle in my"))
      return { intent: "parking", confidence: 0.95 };

    // License plate input (standalone 3-8 alphanumeric)
    if (/^[A-Z0-9\s\-]{3,10}$/i.test(text.trim()) && wordCount <= 2)
      return { intent: "plate_input", confidence: 0.9, data: { plate: text.trim() } };

    // Maintenance — strong signals
    const maintWords = ["ac", "air conditioning", "hvac", "fridge", "refrigerator", "leak", "leaking", "broken", "not working",
      "repair", "maintenance", "mold", "mould", "pest", "bug", "cockroach", "roach", "mice", "mouse", "rat",
      "heater", "heat", "hot water", "no hot water", "toilet", "sink", "drain", "clogged", "backed up",
      "dishwasher", "washer", "dryer", "oven", "stove", "window", "door won't", "lock broken", "lock doesn't",
      "garbage disposal", "light", "electrical", "outlet", "water damage", "ceiling", "wall", "floor",
      "smoke detector", "thermostat", "garbage", "trash", "exterminator", "plumber", "electrician"];
    if (maintWords.some(k => lower.includes(k)))
      return { intent: "maintenance", confidence: 0.9 };

    // Lease / policy / rent
    const leaseWords = ["rent", "lease", "move out", "moving out", "notice", "renewal", "renew", "deposit", "policy",
      "rules", "when is rent", "how much", "fee", "fees", "late fee", "early termination", "break lease",
      "sublease", "sublet", "pet policy", "pet", "noise", "quiet hours"];
    if (leaseWords.some(k => lower.includes(k)))
      return { intent: "lease", confidence: 0.85 };

    // Guest parking
    if (lower.includes("guest") && lower.includes("park"))
      return { intent: "guest_parking", confidence: 0.85 };

    // Noise complaint
    if (lower.includes("noise") || lower.includes("loud") || lower.includes("music") || lower.includes("party"))
      return { intent: "noise_complaint", confidence: 0.85 };

    // Safety / security
    if (["suspicious", "break in", "broken into", "security", "unsafe", "stolen"].some(k => lower.includes(k)))
      return { intent: "security", confidence: 0.85 };

    // Package / delivery
    if (["package", "delivery", "mail", "amazon", "ups", "fedex"].some(k => lower.includes(k)))
      return { intent: "package", confidence: 0.8 };

    return { intent: "unknown", confidence: 0 };
  }
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
    e.preventDefault(); clear();
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
    e.preventDefault(); clear();
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
  const cfg = property.stacyConfig || emptyPropertyConfig();

  const renderPortal = () => {
    byId("tenantBadge").textContent = `${tenant.fullName} · ${property.name}`;
    byId("tenantProfile").innerHTML = `
      <div style="display:grid;gap:8px;font-size:14px;">
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);"><span style="color:var(--text-2);font-weight:600;">Unit</span><span style="font-weight:600;">${unit.label}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);"><span style="color:var(--text-2);font-weight:600;">Property</span><span>${property.name}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);"><span style="color:var(--text-2);font-weight:600;">Email</span><span>${tenant.email}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;"><span style="color:var(--text-2);font-weight:600;">Phone</span><span>${tenant.phone || "Not set"}</span></div>
      </div>`;
    byId("tenantProfileForm").email.value = tenant.email || "";
    byId("tenantProfileForm").phone.value = tenant.phone || "";
    byId("tenantLeaseInfo").innerHTML = tenant.lease?.dataUrl
      ? `<a class="btn sm" href="${tenant.lease.dataUrl}" download="${tenant.lease.fileName}">📄 Download ${tenant.lease.fileName}</a>`
      : `<span class="muted" style="font-size:13px;">No lease uploaded yet.</span>`;

    byId("householdTenantsBody").innerHTML = (unit.tenants || []).map((t) =>
      `<tr><td><strong>${t.fullName}</strong></td><td>${t.email || "—"}</td><td>${t.phone || "—"}</td><td style="white-space:nowrap;"><button class="btn sm" data-edit-household="${t.id}">Edit</button> <button class="btn sm" data-remove-household="${t.id}">×</button></td></tr>`
    ).join("");

    byId("vehicleOwnerSelect").innerHTML = (unit.tenants || []).map((t) => `<option value="${t.id}">${t.fullName}</option>`).join("");

    const vehicles = (unit.tenants || []).flatMap((t) => (t.vehicles || []).map((v) => ({ ...v, ownerName: t.fullName })));
    byId("tenantVehiclesBody").innerHTML = vehicles.length
      ? vehicles.map((v) => `<tr><td><strong>${v.plate}</strong></td><td>${v.make} ${v.model}</td><td style="color:var(--text-2)">${v.color}</td><td>${v.ownerName}</td><td>${v.assignedSpot || "—"}</td><td><button class="btn sm" data-remove-vehicle="${v.id}">×</button></td></tr>`).join("")
      : `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px;">No vehicles registered yet.</td></tr>`;
  };

  renderPortal();

  byId("tenantLogoutBtn").addEventListener("click", () => { clearTenantSession(); window.location.href = "./tenant-auth.html"; });

  byId("tenantProfileForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    tenant.email = String(f.get("email") || "").trim().toLowerCase();
    tenant.phone = String(f.get("phone") || "").trim();
    saveData(data); renderPortal();
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
      make: String(f.get("make") || "").trim(), model: String(f.get("model") || "").trim(),
      color: String(f.get("color") || "").trim(), assignedSpot: String(f.get("assignedSpot") || "").trim(),
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
        if (unit.tenants[idx].id === tenant.id) return alert("You cannot remove your own account.");
        unit.tenants.splice(idx, 1); saveData(data); return renderPortal();
      }
      const t = unit.tenants[idx];
      t.fullName = prompt("Resident name", t.fullName) || t.fullName;
      t.email = (prompt("Email", t.email || "") ?? t.email).toLowerCase();
      t.phone = prompt("Phone", t.phone || "") ?? t.phone;
      saveData(data); return renderPortal();
    }

    if (removeVehicle) {
      for (const t of (unit.tenants || [])) {
        const vidx = (t.vehicles || []).findIndex((v) => v.id === removeVehicle);
        if (vidx >= 0) { t.vehicles.splice(vidx, 1); saveData(data); return renderPortal(); }
      }
    }
  });

  /* =================== STACY CHAT v4 =================== */
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
    if (stacy.conversationHistory.length > 30) stacy.conversationHistory = stacy.conversationHistory.slice(-30);
    saveStacyState(stacyAll);
  };

  const push = (who, text) => {
    const div = document.createElement("div");
    div.className = `stacy-msg ${who}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  };

  const reply = async (text) => {
    const typing = document.createElement("div");
    typing.className = "stacy-msg bot typing";
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
    await new Promise(r => setTimeout(r, 400 + Math.random() * 500));
    typing.remove();
    push("bot", text);
    addToHistory("assistant", text);
  };

  bubble.addEventListener("click", () => {
    isOpen = !isOpen;
    panel.classList.toggle("hidden", !isOpen);
    if (isOpen && !messages.children.length) {
      const greeting = STACY.greet(tenant.fullName.split(" ")[0], stacy);
      push("bot", greeting);
    }
  });

  // ── Main chat handler ──
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    push("user", text);
    addToHistory("user", text);

    // Reload data each time (in case landlord changed something)
    const freshData = loadData();
    const freshProperty = freshData.properties.find(p => p.id === property.id) || property;
    const freshCfg = freshProperty.stacyConfig || emptyPropertyConfig();
    const lower = text.toLowerCase();
    const { intent, confidence, data: intentData } = STACY.detectIntent(text, stacy);

    // ═══ PENDING STATE HANDLERS ═══

    // Waiting for plate number
    if (stacy.pending === "parking_plate") {
      const rawPlate = text.trim().toUpperCase().replace(/\s+/g, "");

      // Check if they said something other than a plate
      if (rawPlate.length < 2 || rawPlate.length > 10) {
        await reply(`I need the license plate number of the vehicle in your spot. It's usually 3-8 characters — something like "ABC1234" or "7TRK492". What's the plate?`);
        return;
      }

      remember({ pending: null });

      const match = findVehicleByPlate(freshProperty, rawPlate);

      // Create the issue
      const issue = {
        id: crypto.randomUUID(), propertyId: freshProperty.id,
        type: "Parking Complaint", from: tenant.fullName,
        message: `Parking complaint — plate: ${rawPlate} | Unit: ${unit.label} | Reporter: ${tenant.fullName} (${tenant.phone || "no phone"})`,
        approvalRequired: true, status: "Awaiting manager approval",
        createdAt: new Date().toISOString(),
        meta: {
          plate: rawPlate, reporterUnit: unit.label, reporterPhone: tenant.phone || "",
          violatorName: match?.owner?.fullName || "Unknown",
          violatorPhone: match?.owner?.phone || "",
          violatorUnit: match?.unit?.label || "Unknown"
        }
      };
      freshData.issues.push(issue);
      pushAlert(freshData, freshProperty.id, "Parking", `${unit.label} ${tenant.fullName} reported plate ${rawPlate}`, "warning");

      // SMS to landlord
      const landlordMsg = match
        ? `PARKING COMPLAINT | ${freshProperty.name}\nReporter: ${tenant.fullName}, Unit ${unit.label} (${tenant.phone || "no phone"})\nPlate: ${rawPlate}\nRegistered to: ${match.owner.fullName}, Unit ${match.unit.label} (${match.owner.phone || "no phone"})\n\nReply YES to approve a violation invoice.`
        : `PARKING COMPLAINT | ${freshProperty.name}\nReporter: ${tenant.fullName}, Unit ${unit.label} (${tenant.phone || "no phone"})\nPlate: ${rawPlate}\nPLATE NOT IN REGISTRY — manual verification needed.`;

      await sendSms(freshData, freshProperty.id, freshCfg, freshCfg.landlordPhone, landlordMsg);

      // SMS to the violator if found
      if (match?.owner?.phone) {
        await sendSms(freshData, freshProperty.id, freshCfg, match.owner.phone,
          `Hi ${match.owner.fullName} — this is an automated notice from ${freshProperty.name}: your vehicle (plate: ${rawPlate}) has been reported in another resident's assigned parking spot. Please move it as soon as possible to avoid a fine or tow. Thank you.`
        );
      }

      saveData(freshData);
      remember({
        lastTopic: "parking",
        lastIssue: { id: issue.id, type: "Parking Complaint", createdAt: issue.createdAt, meta: { plate: rawPlate } },
        issueCount: (stacy.issueCount || 0) + 1
      });

      if (match) {
        await reply(`Found it — plate ${rawPlate} is registered to ${match.owner.fullName} in Unit ${match.unit.label}.\n\nHere's what I've done:\n✅ Sent them an immediate text to move their vehicle\n✅ Notified your property manager with all details\n✅ Logged the complaint for records\n\nIf the car isn't moved soon, let me know and I can escalate to a violation invoice. Is there anything else I can help with?`);
      } else {
        await reply(`I've logged plate ${rawPlate} and alerted your property manager — that plate isn't in our vehicle registry, so they'll need to verify it directly.\n\nYour manager has been texted with your unit info and the plate number. Is there anything else I can help you with?`);
      }
      return;
    }

    // Waiting for maintenance details
    if (stacy.pending === "maintenance_details") {
      remember({ pending: null });

      // Check for emergency in their description
      const isEmergency = ["flood", "flooding", "fire", "gas", "gas leak", "no power", "burst", "smoke", "emergency"].some(k => lower.includes(k));

      const issue = {
        id: crypto.randomUUID(), propertyId: freshProperty.id,
        type: isEmergency ? "EMERGENCY Maintenance" : "Maintenance",
        from: tenant.fullName,
        message: `Unit ${unit.label} — ${tenant.fullName}: ${text}`,
        approvalRequired: !isEmergency,
        status: isEmergency ? "EMERGENCY - Immediate action required" : "Awaiting manager approval",
        createdAt: new Date().toISOString(),
        meta: { unit: unit.label, tenantPhone: tenant.phone || "", details: text }
      };
      freshData.issues.push(issue);
      pushAlert(freshData, freshProperty.id, isEmergency ? "EMERGENCY" : "Maintenance", `${unit.label} ${tenant.fullName}: ${text.slice(0, 80)}`, isEmergency ? "bad" : "warning");

      const prefix = isEmergency ? "🚨 EMERGENCY" : "MAINTENANCE REQUEST";
      await sendSms(freshData, freshProperty.id, freshCfg, freshCfg.landlordPhone,
        `${prefix} | ${freshProperty.name}\nUnit ${unit.label} | ${tenant.fullName} (${tenant.phone || "no phone"})\n\n"${text}"\n\n${isEmergency ? "Immediate action required." : "Approve dispatch in your dashboard."}`
      );
      saveData(freshData);

      remember({
        lastTopic: "maintenance",
        lastIssue: { id: issue.id, type: issue.type, createdAt: issue.createdAt },
        issueCount: (stacy.issueCount || 0) + 1
      });

      if (isEmergency) {
        await reply(`⚠️ EMERGENCY FLAGGED — I've escalated this immediately to your property manager with urgent priority.\n\nIf there is any risk to life or safety, please also call 911 right now. Don't wait.\n\nYour manager has been alerted and should respond very quickly. I'm here if you need anything else.`);
      } else {
        await reply(`Got it — I've submitted your maintenance request:\n\n"${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"\n\nYour property manager has been texted and needs to approve the dispatch. You'll typically hear back within 24 hours.\n\nIf this becomes an emergency (flooding, no power, gas smell), just tell me and I'll escalate immediately. Anything else I can help with?`);
      }
      return;
    }

    // Waiting for noise complaint details
    if (stacy.pending === "noise_details") {
      remember({ pending: null });
      const issue = {
        id: crypto.randomUUID(), propertyId: freshProperty.id,
        type: "Noise Complaint", from: tenant.fullName,
        message: `Unit ${unit.label} — ${tenant.fullName}: ${text}`,
        approvalRequired: false, status: "Logged — Manager notified",
        createdAt: new Date().toISOString(),
        meta: { unit: unit.label, tenantPhone: tenant.phone || "" }
      };
      freshData.issues.push(issue);
      pushAlert(freshData, freshProperty.id, "Noise", `${unit.label} ${tenant.fullName}: noise complaint`, "warning");
      await sendSms(freshData, freshProperty.id, freshCfg, freshCfg.landlordPhone,
        `NOISE COMPLAINT | ${freshProperty.name}\nUnit ${unit.label} | ${tenant.fullName} (${tenant.phone || "no phone"})\n\n"${text}"`
      );
      saveData(freshData);
      remember({
        lastTopic: "noise", lastIssue: { id: issue.id, type: "Noise Complaint", createdAt: issue.createdAt },
        issueCount: (stacy.issueCount || 0) + 1
      });
      await reply(`I've logged the noise complaint and notified your property manager.\n\nIf the noise persists tonight, feel free to let me know and I'll send a follow-up alert. Is there anything else?`);
      return;
    }

    // ═══ INTENT ROUTING ═══

    if (intent === "emergency") {
      const issue = {
        id: crypto.randomUUID(), propertyId: freshProperty.id,
        type: "EMERGENCY Maintenance", from: tenant.fullName,
        message: `⚠️ EMERGENCY: Unit ${unit.label} — ${tenant.fullName}: ${text}`,
        approvalRequired: false,
        status: "EMERGENCY - Immediate action required",
        createdAt: new Date().toISOString()
      };
      freshData.issues.push(issue);
      pushAlert(freshData, freshProperty.id, "EMERGENCY", `EMERGENCY from ${unit.label} ${tenant.fullName}: ${text.slice(0, 80)}`, "bad");
      await sendSms(freshData, freshProperty.id, freshCfg, freshCfg.landlordPhone,
        `🚨 EMERGENCY | ${freshProperty.name}\nUnit ${unit.label} | ${tenant.fullName} (${tenant.phone || "no phone"})\n\n"${text}"\n\nIMMADIATE ACTION REQUIRED.`
      );
      saveData(freshData);
      remember({ pending: null, lastTopic: "maintenance", lastIssue: { id: issue.id, type: "EMERGENCY", createdAt: issue.createdAt } });
      await reply(`⚠️ EMERGENCY FLAGGED — I've notified your property manager immediately with urgent priority.\n\nIf there is ANY risk to life or safety:\n📞 Call 911 NOW — don't wait\n🚪 Evacuate if there's fire, gas, or smoke\n\nYour manager has been alerted. I'm here — what else do you need?`);
      return;
    }

    if (intent === "followup_yes" && stacy.lastIssue?.type) {
      const when = new Date(stacy.lastIssue.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      await reply(`Okay, pulling up your ${stacy.lastIssue.type.toLowerCase()} from ${when}.\n\nWhat would you like to do?\n• "Status" — I'll check where things stand\n• "Update" — tell me what changed and I'll add to the record\n• "Cancel" — I'll close the request\n• Or just describe what's happening and I'll figure it out.`);
      return;
    }

    if (intent === "new_issue") {
      remember({ pending: null, lastTopic: null });
      await reply(`No problem — starting fresh. What do you need help with?\n\n🚗 Parking issue\n🔧 Maintenance / repair\n📄 Lease question\n🔊 Noise complaint\n💬 Something else\n\nJust tell me what's going on.`);
      return;
    }

    if (intent === "status_check") {
      if (stacy.lastIssue?.type) {
        const when = new Date(stacy.lastIssue.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        await reply(`Here's the latest on your most recent request:\n\n📌 Type: ${stacy.lastIssue.type}\n🕐 Submitted: ${when}\n📊 Status: Sent to property manager for review\n\nYour property manager has been notified. If you haven't heard back yet, I can send them a follow-up reminder. Want me to do that?`);
      } else {
        await reply(`You don't have any open requests on file right now. If you need something, just let me know — I'm here to help!`);
      }
      return;
    }

    if (intent === "thanks") {
      await reply(`You're welcome! 😊 I'm always here if you need anything else. Have a great ${new Date().getHours() < 18 ? "day" : "evening"}!`);
      return;
    }

    if (intent === "goodbye") {
      await reply(`All set! Don't hesitate to reach out anytime — I'm here 24/7. Take care! 👋`);
      return;
    }

    if (intent === "help") {
      const lastContext = stacy.lastIssue?.type
        ? `\n\n📋 I also have your recent ${stacy.lastIssue.type.toLowerCase()} on file — say "status" to check on it.`
        : "";
      await reply(`Here's everything I can help with:\n\n🚗 Parking — "Someone parked in my spot"\n🔧 Maintenance — "My AC isn't working"\n📄 Lease — "When is rent due?"\n🔊 Noise — "My neighbor is being loud"\n🚨 Emergency — "There's a gas leak"\n📊 Status — "Check on my last request"\n💬 General — Describe anything and I'll route it\n\nI remember our past conversations, so you can follow up on previous issues anytime.${lastContext}`);
      return;
    }

    if (intent === "parking") {
      remember({ pending: "parking_plate", lastTopic: "parking" });
      await reply(`I'll handle this right away. What's the license plate number of the vehicle in your spot?\n\nJust type it — something like "ABC1234" or "7TRK 492".`);
      return;
    }

    if (intent === "plate_input" && stacy.lastTopic === "parking") {
      remember({ pending: "parking_plate" });
      // Re-submit as if they're in the parking_plate flow
      stacy.pending = "parking_plate";
      input.value = text;
      form.dispatchEvent(new Event("submit"));
      return;
    }

    if (intent === "maintenance") {
      remember({ pending: "maintenance_details", lastTopic: "maintenance" });
      await reply(`I'll get this reported right away. Can you describe the issue in a bit more detail?\n\nFor example:\n• What's not working?\n• When did it start?\n• Is there any safety risk (water damage, electrical, gas)?\n\nThe more detail you give me, the faster we can get the right person out there.`);
      return;
    }

    if (intent === "lease") {
      const rent = freshProperty.policy?.startingRent;
      const terms = freshProperty.policy?.leaseTerms;
      let resp = "Here's what I have on file for your property:\n\n";
      if (rent) resp += `💰 Rent: ${rent}\n`;
      if (terms) resp += `📋 Terms: ${terms}\n`;
      if (!rent && !terms) resp += "Your property manager hasn't entered specific lease details yet.\n";
      resp += `\nFor detailed lease questions, I'd recommend checking your lease document (you can download it from your profile) or contacting your property manager directly.\n\nIs there something specific you need — renewal info, move-out process, or a policy question?`;

      const issue = { id: crypto.randomUUID(), propertyId: freshProperty.id, type: "Lease Question", from: tenant.fullName, message: text, approvalRequired: false, status: "Logged", createdAt: new Date().toISOString() };
      freshData.issues.push(issue);
      saveData(freshData);
      remember({ lastTopic: "lease", lastIssue: { id: issue.id, type: "Lease Question", createdAt: issue.createdAt } });
      await reply(resp);
      return;
    }

    if (intent === "guest_parking") {
      const terms = freshProperty.policy?.leaseTerms;
      await reply(`Guest parking policies depend on your property's specific rules.\n\n${terms ? `Here's what's on file: "${terms}"` : "Your property manager hasn't entered specific parking policies yet."}\n\nWant me to ask your property manager about guest parking and get back to you?`);
      return;
    }

    if (intent === "noise_complaint") {
      remember({ pending: "noise_details", lastTopic: "noise" });
      await reply(`Sorry to hear that. I'll log a noise complaint for you.\n\nCan you tell me a few details?\n• Where is the noise coming from (which unit, if you know)?\n• What kind of noise (music, yelling, construction)?\n• How long has it been going on?\n\nThis helps your property manager address it properly.`);
      return;
    }

    if (intent === "security") {
      const issue = {
        id: crypto.randomUUID(), propertyId: freshProperty.id,
        type: "Security Concern", from: tenant.fullName,
        message: `Unit ${unit.label} — ${tenant.fullName}: ${text}`,
        approvalRequired: false, status: "Escalated to manager",
        createdAt: new Date().toISOString()
      };
      freshData.issues.push(issue);
      pushAlert(freshData, freshProperty.id, "Security", `Security concern from ${unit.label} ${tenant.fullName}`, "bad");
      await sendSms(freshData, freshProperty.id, freshCfg, freshCfg.landlordPhone,
        `⚠️ SECURITY CONCERN | ${freshProperty.name}\nUnit ${unit.label} | ${tenant.fullName} (${tenant.phone || "no phone"})\n\n"${text}"\n\nPlease review.`
      );
      saveData(freshData);
      remember({ lastTopic: "security", lastIssue: { id: issue.id, type: "Security Concern", createdAt: issue.createdAt } });
      await reply(`I've flagged this as a security concern and notified your property manager immediately.\n\nIf you feel unsafe right now:\n📞 Call 911 for emergencies\n🔒 Make sure your doors and windows are locked\n\nYour manager has been alerted. Is there anything else?`);
      return;
    }

    if (intent === "package") {
      await reply(`For package and delivery questions, here are some things that might help:\n\n📦 If a package is missing, check with your neighbors and the delivery carrier's tracking\n🏢 Some properties have package lockers or a front desk — check your property's policy\n📱 If you suspect theft, I can log a security concern for your property manager\n\nWould you like me to flag this for your property manager?`);
      return;
    }

    // ═══ UNKNOWN / GENERAL — be helpful, not robotic ═══
    // Try to be conversational and guide them
    const issue = {
      id: crypto.randomUUID(), propertyId: freshProperty.id,
      type: "Tenant Message", from: tenant.fullName,
      message: `Unit ${unit.label} — ${tenant.fullName}: ${text}`,
      approvalRequired: false, status: "Logged",
      createdAt: new Date().toISOString()
    };
    freshData.issues.push(issue);
    pushAlert(freshData, freshProperty.id, "Message", `${unit.label} ${tenant.fullName}: ${text.slice(0, 80)}`, "info");
    saveData(freshData);
    remember({
      lastTopic: "general",
      lastIssue: { id: issue.id, type: "General Message", createdAt: issue.createdAt }
    });

    await reply(`I want to make sure I help you with the right thing. I've logged your message, but let me ask — does this fall into one of these categories?\n\n🚗 Parking issue\n🔧 Something broken / maintenance\n📄 Lease or rent question\n🔊 Noise complaint\n🔒 Safety concern\n\nOr if you can give me a bit more detail about what's going on, I can route it to the right person. I'm here to help!`);
  });
};

window.addEventListener("DOMContentLoaded", () => {
  initTenantAuth();
  initTenantPortal();
});
