# EmployeeAI — Stacy Property Operations Platform

## Quick Start

1. Open `index.html` in a browser (or serve with any HTTP server)
2. Click "Get Started" to create a landlord account
3. Select a plan → Add a property → Add units → Add tenants
4. Generate invite links for tenants
5. Tenants activate via `tenant-auth.html` and can chat with Stacy

To run locally:
```bash
cd site
python3 -m http.server 8000
# Open http://localhost:8000/index.html
```

## SMS Setup (IMPORTANT)

SMS is powered by **Textbelt** (textbelt.com). Here's how to get it working:

### Free Testing (1 SMS/day)
1. In the Landlord Dashboard → Operations → Stacy Configuration
2. Set SMS Mode to **"Live — Textbelt API"**
3. Leave the API key **blank** (uses free "textbelt" test key)
4. Enter your phone number in **Landlord alert phone** (format: `+15551234567`)
5. Add tenant phone numbers when registering tenants

**Note:** The free key only sends 1 SMS per day total. Good for testing, not production.

### Production SMS (Unlimited)
1. Go to https://textbelt.com and purchase an API key ($10 = 100 SMS, or $49 = 500 SMS)
2. Paste the key in Stacy Configuration → Textbelt API Key
3. Now Stacy can send unlimited texts to landlords and tenants

### Phone Number Format
- Use full international format: `+15551234567`
- Must include country code (US = +1)
- No spaces, dashes, or parentheses needed (but they're okay — we strip them)

### Troubleshooting SMS
- Check the **SMS Delivery Log** in Alerts & SMS tab
- "failed: quota exceeded" = free key used up for today
- "failed: network" = check your internet connection
- "failed: invalid phone" = verify phone number format
- "demo-mode" = SMS mode set to Demo, switch to Live

## Files

```
├── index.html          # Marketing landing page
├── auth.html           # Landlord signup/login
├── dashboard.html      # Landlord dashboard
├── tenant-auth.html    # Tenant signup/login
├── tenant-portal.html  # Tenant portal + Stacy chat
├── owner.html          # Owner admin panel
├── assets/
│   └── styles.css      # Design system
├── js/
│   ├── auth.js         # Authentication
│   ├── plans.js        # Plan definitions
│   ├── dashboard.js    # Landlord dashboard logic
│   ├── tenant.js       # Tenant portal + Stacy AI
│   └── owner.js        # Owner admin logic
```

## Stacy AI Features (v4)

### For Tenants
- Parking complaints with automatic plate lookup + SMS to violator
- Maintenance requests with smart follow-up questions
- Emergency escalation (flood, fire, gas leak → immediate manager alert)
- Noise complaints, security concerns, lease questions
- Conversation memory — Stacy remembers past issues and asks about them
- Status checks on open requests
- Natural conversation flow with contextual responses

### For Landlords
- Plate lookup by number
- Tenant search by name
- Property summary
- Parking complaint workflow with SMS
- Maintenance ticket creation
- Email triage and auto-categorization

## Plans

| Plan | Monthly | Setup | Properties | Tenants |
|------|---------|-------|------------|---------|
| Base | $199 | $59 | 1 | 20 |
| Medium | $349 | $59 | 2 | 50 |
| Managers | $549 | $59 | 4 | 200 |
| Landlord | $649 | $59 | 6 | 320 |
| Custom | $999+ | Inquire | Unlimited | Unlimited |

## What's Demo vs Live

### Fully Functional
- Tenant/Landlord account creation and login
- Property, unit, tenant, vehicle management
- Stacy AI chat (tenant + landlord)
- Parking complaint workflows with SMS
- Maintenance request workflows with SMS
- Email triage
- Violation invoicing workflow
- All data stored in browser localStorage

### Coming Soon (Demo Placeholder)
- Payment processing (rent collection, autopay)
- Bank account / routing number setup
- Actual email sending (currently logs only)
