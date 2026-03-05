window.EmployeeAIPlans = {
  Base: { monthly: 199, setup: 59, properties: 1, tenants: 20, label: "Up to 1 property • Up to 20 tenants", bullets: [
    "24/7 Stacy AI tenant assistant",
    "Tenant chat + email triage",
    "Maintenance approvals & dispatch",
    "Vehicle registry & parking enforcement",
    "SMS alerts & notifications",
    "Basic reminders & activity logs"
  ]},
  Medium: { monthly: 349, setup: 59, properties: 2, tenants: 50, label: "Up to 2 properties • Up to 50 tenants", bullets: [
    "Everything in Base",
    "Multi-property management",
    "Vendor follow-ups & scheduling",
    "Prospect inquiry auto-responses",
    "Parking violation workflows",
    "Advanced email routing"
  ]},
  Managers: { monthly: 549, setup: 59, properties: 4, tenants: 200, label: "Up to 4 properties • Up to 200 tenants", bullets: [
    "Everything in Medium",
    "Role-based access (admin/agent)",
    "Automated violation invoicing",
    "Lease workflow automation",
    "Advanced operational alerts",
    "Priority support"
  ]},
  Landlord: { monthly: 649, setup: 59, properties: 6, tenants: 320, label: "Up to 6 properties • Up to 320 tenants", bullets: [
    "Everything in Managers",
    "Portfolio reporting & analytics",
    "Bulk tenant import",
    "Custom templates per property",
    "Priority onboarding",
    "Dedicated account manager"
  ]},
  Custom: { monthly: 999, setup: null, properties: Infinity, tenants: Infinity, label: "Custom portfolio • Unlimited scale", bullets: [
    "Unlimited properties & tenants",
    "Dedicated onboarding specialist",
    "Custom workflows & integrations",
    "SLA & priority support",
    "Security & compliance expansion",
    "Custom API access"
  ]}
};

window.EmployeeAIPlanUtils = {
  getPlan(name) {
    return (window.EmployeeAIPlans || {}).hasOwnProperty(name) ? window.EmployeeAIPlans[name] : window.EmployeeAIPlans.Base;
  },
  listNames() {
    return Object.keys(window.EmployeeAIPlans || {});
  }
};
