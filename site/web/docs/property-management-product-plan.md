# EmployeeAI Property Management Platform Plan

## 1) Product summary

Build **EmployeeAI Property Ops** with an AI assistant named **Stacy** that automates communications and workflows between:
- Tenants
- Landlords / property managers
- Vendors (maintenance)
- Prospects

Core value proposition: reduce repetitive operational work (emails, scheduling, follow-ups, parking disputes), not replace existing accounting/property systems.

---

## 2) Recommended pricing model (v1)

Price by operational capacity (properties + tenants), while positioning each plan as an AI operations employee.

| Plan | Monthly | Setup Fee | Properties | Tenants |
|---|---:|---:|---:|---:|
| Starter | $149 | $59 | Up to 1 | Up to 20 |
| Growth | $349 | $59 | Up to 2 | Up to 50 |
| Professional | $549 | $59 | Up to 4 | Up to 200 |
| Portfolio | $799 | $59 | Up to 6 | Up to 320 |
| Unlimited | $999+ | $99 | Unlimited | Unlimited |

Custom quote intake should request:
- Number of properties
- Number of tenants
- City/State
- Integrations needed
- Required SLA/support level

---

## 3) Data model and tenancy boundaries

Each property must be data-isolated to prevent cross-property confusion and enforce privacy boundaries.

Suggested hierarchy:

- Account (landlord/property manager)
  - Property
    - Unit
      - Resident profile(s)
      - Lease documents
      - Vehicle registrations
      - Work orders / incidents

### Resident profile fields
- Full name
- DOB
- Phone / email
- Unit assignment
- Lease agreement file

### Vehicle registry fields
- Plate
- Make
- Model
- Color
- Registered owner (resident)
- Assigned parking space (optional)
- Status (active/inactive)

### Rules
- Per-unit max vehicle count configurable by landlord.
- Property-specific response and policy templates.

---

## 4) Channels and AI interaction model

Stacy should support:
- In-app tenant chat
- Email
- SMS (for urgent or approval workflows)

Behavioral rule:
- Stacy can resolve low-risk requests automatically.
- Stacy requests landlord approval for actions with legal/financial impact.

---

## 5) MVP scope (sell fast)

### Include in Phase 1 (MVP)
1. Account/property/unit/resident setup
2. Lease uploads and resident CRM records
3. AI handling for tenant messages (chat/email)
4. Maintenance triage and vendor outreach
5. Landlord SMS approvals for sensitive actions
6. Prospect email routing + configured FAQ answers
7. Rent reminder notifications (non-payment-processing)

### Defer to later phases
- Full payment processing/autopay
- Gate integrations
- Advanced violation billing/reconciliation

---

## 6) Key workflows

## 6.1 Parking complaint workflow
1. Tenant message: “Someone parked in my spot.”
2. Stacy asks for license plate.
3. Stacy checks property vehicle registry.
4. Stacy notifies violator via SMS.
5. Stacy notifies manager with summary + suggested next action.
6. If manager approves, Stacy sends violation notice/invoice email.

## 6.2 Maintenance workflow
1. Tenant reports issue (chat/email): “Fridge not working.”
2. Stacy classifies issue and captures required details.
3. Stacy asks manager for approval to dispatch.
4. On approval, Stacy emails/SMS assigned maintenance vendor.
5. Vendor replies are handled by Stacy until blocked.
6. If blocked, Stacy escalates with explicit questions to manager.

## 6.3 Prospect inquiry workflow
1. Prospect asks rent/availability by email.
2. Stacy responds from landlord-configured property data.
3. If showing requested, Stacy routes to broker/manager.

---

## 7) Stacy permissions framework (trust model)

### Auto-approve actions (safe)
- Acknowledge tenant receipt
- Ask clarifying questions
- Send policy/info responses from approved templates
- Send non-binding reminders

### Approval-required actions
- Issuing any fines/invoices
- Sending legal/compliance-sensitive notices
- Confirming vendor dispatch with cost implications
- Changing resident or lease records
- Sharing personal contact information beyond configured policy

### Always-escalate actions
- Threats, harassment, safety incidents
- Potential fair housing/legal risk
- Payment disputes and chargeback disputes
- Any confidence score below threshold

---

## 8) Launch sequencing

## Phase 1 (0–8 weeks)
- Tenant CRM + lease docs
- Stacy chat/email triage
- Maintenance workflow + manager approvals
- Prospect inquiry automation

## Phase 2 (8–16 weeks)
- Parking workflow + violation suggestions
- Policy templates per property
- Enhanced audit logs

## Phase 3 (16+ weeks)
- Payments/autopay integration
- Advanced reporting
- Optional external integrations

---

## 9) Operational requirements

- Full audit log of Stacy actions and approvals
- Role-based access (landlord, manager, staff, tenant)
- Property-level data partitioning
- Configurable communication templates
- Human override on any workflow step

---

## 10) Positioning

Recommended market positioning:

> **EmployeeAI is the AI operations layer for property managers.**
> Keep your existing systems; Stacy handles the communication and coordination workload.

This reduces adoption friction because managers can keep incumbent software while adding automation.
