const STORAGE_USERS = "employeeai_users_v1";
const STORAGE_SESSION = "employeeai_session_v1";
const OWNER_EMAIL = "arielbushari22@gmail.com";

const safeUsers = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_USERS) || "[]"); }
  catch { return []; }
};

const saveUsers = (users) => localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
const setSession = (user) => localStorage.setItem(STORAGE_SESSION, JSON.stringify(user));
const isOwnerEmail = (email) => String(email || "").trim().toLowerCase() === OWNER_EMAIL;
const defaultPlan = () => ({ name: null, monthly: 0, setup: 0 });

const normalizeUser = (user) => {
  const owner = isOwnerEmail(user.email);
  const plan = user.plan || defaultPlan();
  return {
    ...user,
    role: owner ? "owner" : "landlord",
    permissions: owner ? ["*"] : (user.permissions || []),
    plan
  };
};

const getSession = () => {
  try {
    const session = JSON.parse(localStorage.getItem(STORAGE_SESSION));
    return session ? normalizeUser(session) : null;
  } catch {
    return null;
  }
};

const sessionPayload = (user) => ({
  id: user.id,
  fullName: user.fullName,
  role: user.role,
  email: user.email,
  permissions: user.permissions || [],
  plan: user.plan || defaultPlan()
});

window.EmployeeAIAuth = {
  signup(payload) {
    const users = safeUsers();
    const exists = users.some((u) => u.email.toLowerCase() === payload.email.toLowerCase());
    if (exists) return { ok: false, message: "An account with this email already exists." };

    const user = normalizeUser({
      id: crypto.randomUUID(),
      fullName: payload.fullName,
      role: "landlord",
      company: payload.company,
      email: payload.email,
      password: payload.password,
      permissions: [],
      plan: defaultPlan(),
      createdAt: new Date().toISOString()
    });

    users.push(user);
    saveUsers(users);
    setSession(sessionPayload(user));
    return { ok: true, user };
  },

  login(payload) {
    const users = safeUsers();
    const userIndex = users.findIndex(
      (u) => u.email.toLowerCase() === payload.email.toLowerCase() && u.password === payload.password
    );

    if (userIndex < 0) return { ok: false, message: "Invalid email or password." };

    const user = normalizeUser(users[userIndex]);
    users[userIndex] = user;
    saveUsers(users);
    setSession(sessionPayload(user));
    return { ok: true, user };
  },

  updateCurrentUserPlan(plan) {
    const current = this.currentUser();
    if (!current) return null;
    const users = safeUsers();
    const idx = users.findIndex((u) => u.id === current.id);
    if (idx < 0) return null;
    users[idx] = normalizeUser({ ...users[idx], plan });
    saveUsers(users);
    setSession(sessionPayload(users[idx]));
    return users[idx];
  },

  logout() { localStorage.removeItem(STORAGE_SESSION); },
  currentUser() { return getSession(); },

  isOwner(user) {
    const current = user || getSession();
    return !!current && (current.role === "owner" || (current.permissions || []).includes("*"));
  },

  destinationFor(user) { return this.isOwner(user) ? "./owner.html" : "./dashboard.html"; },
  listUsers() { return safeUsers().map(normalizeUser); }
};
