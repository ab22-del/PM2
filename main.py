"""
PropManage - AI-Powered Property Management Platform
Main FastAPI Application
"""

import datetime
import os
import uuid
import shutil
from typing import Optional, List
from fastapi import FastAPI, Depends, HTTPException, status, Request, Query, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import engine, get_db, Base
from models import (
    User, Subscription, Property, Unit, TenantProfile, Vehicle,
    MaintenanceRequest, ParkingComplaint, ChatMessage, Notification, ShowingRequest, Payout,
    Violation, Fine
)
from email_service import send_fine_email
from schemas import (
    UserRegister, UserLogin, TokenResponse, UserResponse,
    SubscriptionCreate, SubscriptionResponse,
    PropertyCreate, PropertyResponse,
    UnitCreate, UnitResponse,
    TenantCreate, TenantResponse,
    VehicleCreate, VehicleResponse,
    MaintenanceRequestCreate, MaintenanceRequestResponse,
    ChatMessageRequest, ChatMessageResponse, ChatHistoryItem,
    PayoutCreate,
)
from auth import (
    verify_password, get_password_hash, create_access_token,
    get_current_user, get_optional_user
)
from stacy import StacyAssistant, StacyLandlordAssistant

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="PropManage", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files
app.mount("/web", StaticFiles(directory="web", html=True), name="web")


# ─── Plan Configuration ─────────────────────────────────────────────────────

PLANS = {
    "base": {
        "name": "Base",
        "monthly_price": 199,
        "setup_fee": 59,
        "max_properties": 1,
        "max_tenants": 20,
        "features": [
            "Up to 1 Property",
            "Up to 20 Tenants",
            "AI Assistant (Stacy)",
            "Maintenance Request Management",
            "Parking Enforcement",
            "Tenant Portal",
            "Email & SMS Notifications",
        ]
    },
    "medium": {
        "name": "Medium",
        "monthly_price": 349,
        "setup_fee": 59,
        "max_properties": 2,
        "max_tenants": 50,
        "features": [
            "Up to 2 Properties",
            "Up to 50 Tenants",
            "Everything in Base",
            "Priority Support",
            "Advanced Reporting",
            "Vehicle Registry",
        ]
    },
    "managers": {
        "name": "Managers",
        "monthly_price": 549,
        "setup_fee": 59,
        "max_properties": 4,
        "max_tenants": 200,
        "features": [
            "Up to 4 Properties",
            "Up to 200 Tenants",
            "Everything in Medium",
            "Multi-Property Dashboard",
            "Vendor Coordination",
            "Automated Invoicing",
        ]
    },
    "landlord": {
        "name": "Landlord",
        "monthly_price": 649,
        "setup_fee": 59,
        "max_properties": 6,
        "max_tenants": 320,
        "features": [
            "Up to 6 Properties",
            "Up to 320 Tenants",
            "Everything in Managers",
            "Dedicated Account Manager",
            "Custom Workflows",
            "API Access",
        ]
    },
    "custom": {
        "name": "Custom",
        "monthly_price": 999,
        "setup_fee": 99,
        "max_properties": None,
        "max_tenants": None,
        "features": [
            "Unlimited Properties",
            "Unlimited Tenants",
            "Everything in Landlord",
            "White-Label Options",
            "Custom Integrations",
            "Enterprise Support",
        ]
    },
}


# ─── Root / Landing Page ─────────────────────────────────────────────────────

@app.get("/", response_class=RedirectResponse)
async def root():
    return RedirectResponse(url="/web/index.html")


# ─── Auth Routes ─────────────────────────────────────────────────────────────

OWNER_EMAIL = "arielbushari22@gmail.com"


@app.post("/api/auth/register", response_model=TokenResponse)
def register(data: UserRegister, db: Session = Depends(get_db)):
    # Check if email exists
    existing = db.query(User).filter(User.email == data.email.lower().strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    dob = None
    if data.date_of_birth:
        try:
            dob = datetime.date.fromisoformat(data.date_of_birth)
        except ValueError:
            pass

    # Auto-assign owner role for the platform owner email
    role = data.role
    if data.email.lower().strip() == OWNER_EMAIL:
        role = "owner"

    user = User(
        email=data.email.lower().strip(),
        hashed_password=get_password_hash(data.password),
        role=role,
        first_name=data.first_name.strip(),
        last_name=data.last_name.strip(),
        phone=data.phone.strip() if data.phone else None,
        date_of_birth=dob,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": str(user.id), "role": user.role})

    has_plan = False
    if user.role == "landlord":
        sub = db.query(Subscription).filter(Subscription.landlord_id == user.id).first()
        has_plan = sub is not None and sub.is_active
    elif user.role == "owner":
        has_plan = True

    return TokenResponse(
        access_token=token,
        user_id=user.id,
        role=user.role,
        first_name=user.first_name,
        last_name=user.last_name,
        has_plan=has_plan,
    )


@app.post("/api/auth/login", response_model=TokenResponse)
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email.lower().strip()).first()
    if not user:
        raise HTTPException(status_code=401, detail="No account found with this email. Please register first.")
    if not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect password")
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Account is deactivated")

    token = create_access_token({"sub": str(user.id), "role": user.role})

    has_plan = False
    if user.role == "landlord":
        sub = db.query(Subscription).filter(
            Subscription.landlord_id == user.id, Subscription.is_active == True
        ).first()
        has_plan = sub is not None
    elif user.role == "owner":
        has_plan = True  # Owner always has access

    return TokenResponse(
        access_token=token,
        user_id=user.id,
        role=user.role,
        first_name=user.first_name,
        last_name=user.last_name,
        has_plan=has_plan,
    )


@app.get("/api/auth/me", response_model=UserResponse)
def get_me(user: User = Depends(get_current_user)):
    return user


# ─── Plans ───────────────────────────────────────────────────────────────────

@app.get("/api/plans")
def get_plans():
    return PLANS


@app.post("/api/subscription", response_model=SubscriptionResponse)
def create_subscription(data: SubscriptionCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role != "landlord":
        raise HTTPException(status_code=403, detail="Only landlords can subscribe")

    plan_info = PLANS.get(data.plan)
    if not plan_info:
        raise HTTPException(status_code=400, detail="Invalid plan")

    # Deactivate existing subscription
    existing = db.query(Subscription).filter(Subscription.landlord_id == user.id).first()
    if existing:
        existing.is_active = False
        db.commit()

    sub = Subscription(
        landlord_id=user.id,
        plan=data.plan,
        max_properties=plan_info["max_properties"],
        max_tenants=plan_info["max_tenants"],
        monthly_price=plan_info["monthly_price"],
        setup_fee=plan_info["setup_fee"],
        is_active=True,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


@app.get("/api/subscription", response_model=Optional[SubscriptionResponse])
def get_subscription(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = db.query(Subscription).filter(
        Subscription.landlord_id == user.id, Subscription.is_active == True
    ).first()
    return sub


# ─── Properties ──────────────────────────────────────────────────────────────

@app.post("/api/properties", response_model=PropertyResponse)
def create_property(data: PropertyCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role != "landlord":
        raise HTTPException(status_code=403, detail="Only landlords can create properties")

    # Check plan limits
    sub = db.query(Subscription).filter(
        Subscription.landlord_id == user.id, Subscription.is_active == True
    ).first()
    if not sub:
        raise HTTPException(status_code=403, detail="You need an active plan to add properties")

    if sub.max_properties is not None:
        current_count = db.query(Property).filter(Property.landlord_id == user.id).count()
        if current_count >= sub.max_properties:
            raise HTTPException(status_code=403, detail=f"Your plan allows up to {sub.max_properties} properties")

    prop = Property(landlord_id=user.id, **data.model_dump())
    db.add(prop)
    db.commit()
    db.refresh(prop)
    return prop


@app.get("/api/properties", response_model=List[PropertyResponse])
def list_properties(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role == "owner":
        return db.query(Property).all()
    elif user.role == "landlord":
        return db.query(Property).filter(Property.landlord_id == user.id).all()
    elif user.role == "tenant":
        tp = db.query(TenantProfile).filter(TenantProfile.user_id == user.id).first()
        if tp:
            return [db.query(Property).filter(Property.id == tp.property_id).first()]
    return []


@app.get("/api/properties/{property_id}", response_model=PropertyResponse)
def get_property(property_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    return prop


@app.put("/api/properties/{property_id}", response_model=PropertyResponse)
def update_property(property_id: int, data: PropertyCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == property_id, Property.landlord_id == user.id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    for key, val in data.model_dump().items():
        setattr(prop, key, val)
    db.commit()
    db.refresh(prop)
    return prop


# ─── Units ───────────────────────────────────────────────────────────────────

@app.post("/api/properties/{property_id}/units", response_model=UnitResponse)
def create_unit(property_id: int, data: UnitCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == property_id, Property.landlord_id == user.id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    unit = Unit(property_id=property_id, **data.model_dump())
    db.add(unit)
    db.commit()
    db.refresh(unit)
    return unit


@app.get("/api/properties/{property_id}/units", response_model=List[UnitResponse])
def list_units(property_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Unit).filter(Unit.property_id == property_id).all()


@app.put("/api/units/{unit_id}", response_model=UnitResponse)
def update_unit(unit_id: int, data: UnitCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    unit = db.query(Unit).filter(Unit.id == unit_id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    prop = db.query(Property).filter(Property.id == unit.property_id, Property.landlord_id == user.id).first()
    if not prop:
        raise HTTPException(status_code=403, detail="Not authorized")
    for key, val in data.model_dump().items():
        setattr(unit, key, val)
    db.commit()
    db.refresh(unit)
    return unit


@app.delete("/api/units/{unit_id}")
def delete_unit(unit_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    unit = db.query(Unit).filter(Unit.id == unit_id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    prop = db.query(Property).filter(Property.id == unit.property_id, Property.landlord_id == user.id).first()
    if not prop:
        raise HTTPException(status_code=403, detail="Not authorized")
    if unit.is_occupied:
        raise HTTPException(status_code=400, detail="Cannot delete an occupied unit. Remove the tenant first.")
    db.delete(unit)
    db.commit()
    return {"message": "Unit deleted"}


# ─── Tenants ─────────────────────────────────────────────────────────────────

@app.post("/api/tenants", response_model=dict)
def create_tenant(data: TenantCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role != "landlord":
        raise HTTPException(status_code=403, detail="Only landlords can add tenants")

    # Verify property ownership
    prop = db.query(Property).filter(Property.id == data.property_id, Property.landlord_id == user.id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    # Check tenant limit
    sub = db.query(Subscription).filter(
        Subscription.landlord_id == user.id, Subscription.is_active == True
    ).first()
    if sub and sub.max_tenants is not None:
        current_count = db.query(TenantProfile).filter(TenantProfile.property_id == data.property_id, TenantProfile.is_active == True).count()
        total_all = db.query(TenantProfile).join(Property).filter(Property.landlord_id == user.id, TenantProfile.is_active == True).count()
        if total_all >= sub.max_tenants:
            raise HTTPException(status_code=403, detail=f"Your plan allows up to {sub.max_tenants} tenants total")

    # Create tenant user account
    existing = db.query(User).filter(User.email == data.email.lower().strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    dob = None
    if data.date_of_birth:
        try:
            dob = datetime.date.fromisoformat(data.date_of_birth)
        except ValueError:
            pass

    tenant_user = User(
        email=data.email.lower().strip(),
        hashed_password=get_password_hash(data.password),
        role="tenant",
        first_name=data.first_name.strip(),
        last_name=data.last_name.strip(),
        phone=data.phone.strip() if data.phone else None,
        date_of_birth=dob,
    )
    db.add(tenant_user)
    db.commit()
    db.refresh(tenant_user)

    lease_start = None
    lease_end = None
    if data.lease_start:
        try:
            lease_start = datetime.date.fromisoformat(data.lease_start)
        except ValueError:
            pass
    if data.lease_end:
        try:
            lease_end = datetime.date.fromisoformat(data.lease_end)
        except ValueError:
            pass

    profile = TenantProfile(
        user_id=tenant_user.id,
        unit_id=data.unit_id,
        property_id=data.property_id,
        lease_start=lease_start,
        lease_end=lease_end,
        emergency_contact_name=data.emergency_contact_name,
        emergency_contact_phone=data.emergency_contact_phone,
        is_active=True,
    )
    db.add(profile)

    # Mark unit as occupied
    unit = db.query(Unit).filter(Unit.id == data.unit_id).first()
    if unit:
        unit.is_occupied = True

    db.commit()
    db.refresh(profile)

    return {
        "id": profile.id,
        "tenant_profile_id": profile.id,
        "user_id": tenant_user.id,
        "email": tenant_user.email,
        "first_name": tenant_user.first_name,
        "last_name": tenant_user.last_name,
        "phone": tenant_user.phone,
        "unit_id": profile.unit_id,
        "property_id": profile.property_id,
        "is_active": profile.is_active,
    }


@app.get("/api/properties/{property_id}/tenants")
def list_tenants(property_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profiles = db.query(TenantProfile).filter(
        TenantProfile.property_id == property_id,
        TenantProfile.is_active == True
    ).all()

    result = []
    for p in profiles:
        u = db.query(User).filter(User.id == p.user_id).first()
        unit = db.query(Unit).filter(Unit.id == p.unit_id).first()
        vehicles = db.query(Vehicle).filter(Vehicle.tenant_profile_id == p.id).all()
        result.append({
            "id": p.id,
            "user_id": u.id,
            "email": u.email,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "phone": u.phone,
            "unit_number": unit.unit_number if unit else None,
            "unit_id": p.unit_id,
            "property_id": p.property_id,
            "lease_start": str(p.lease_start) if p.lease_start else None,
            "lease_end": str(p.lease_end) if p.lease_end else None,
            "is_active": p.is_active,
            "has_lease_file": bool(p.lease_file_path),
            "vehicles": [
                {
                    "id": v.id,
                    "owner_name": v.owner_name,
                    "plate_number": v.plate_number,
                    "make": v.make,
                    "model": v.model,
                    "color": v.color,
                    "year": v.year,
                }
                for v in vehicles
            ],
        })
    return result


# ─── Vehicles ────────────────────────────────────────────────────────────────

@app.post("/api/tenants/{tenant_profile_id}/vehicles", response_model=VehicleResponse)
def add_vehicle(tenant_profile_id: int, data: VehicleCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.query(TenantProfile).filter(TenantProfile.id == tenant_profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Tenant profile not found")

    # Check vehicle limit
    prop = db.query(Property).filter(Property.id == profile.property_id).first()
    current_count = db.query(Vehicle).filter(Vehicle.tenant_profile_id == tenant_profile_id).count()
    if prop and current_count >= prop.max_vehicles_per_unit:
        raise HTTPException(status_code=403, detail=f"Maximum {prop.max_vehicles_per_unit} vehicles allowed per unit")

    vehicle = Vehicle(tenant_profile_id=tenant_profile_id, **data.model_dump())
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return vehicle


@app.get("/api/tenants/{tenant_profile_id}/vehicles", response_model=List[VehicleResponse])
def list_vehicles(tenant_profile_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Vehicle).filter(Vehicle.tenant_profile_id == tenant_profile_id).all()


@app.get("/api/my/vehicles", response_model=List[VehicleResponse])
def my_vehicles(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.query(TenantProfile).filter(TenantProfile.user_id == user.id).first()
    if not profile:
        return []
    return db.query(Vehicle).filter(Vehicle.tenant_profile_id == profile.id).all()


# ─── Maintenance Requests ────────────────────────────────────────────────────

@app.get("/api/properties/{property_id}/maintenance")
def list_maintenance(property_id: int, status: Optional[str] = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(MaintenanceRequest).filter(MaintenanceRequest.property_id == property_id)
    if status:
        q = q.filter(MaintenanceRequest.status == status)
    requests = q.order_by(MaintenanceRequest.created_at.desc()).all()

    result = []
    for r in requests:
        tp = db.query(TenantProfile).filter(TenantProfile.id == r.tenant_profile_id).first()
        tenant_user = db.query(User).filter(User.id == tp.user_id).first() if tp else None
        unit = db.query(Unit).filter(Unit.id == r.unit_id).first()
        result.append({
            "id": r.id,
            "category": r.category,
            "description": r.description,
            "status": r.status,
            "priority": r.priority,
            "tenant_name": f"{tenant_user.first_name} {tenant_user.last_name}" if tenant_user else "Unknown",
            "unit_number": unit.unit_number if unit else "N/A",
            "scheduled_date": str(r.scheduled_date) if r.scheduled_date else None,
            "created_at": str(r.created_at) if r.created_at else None,
        })
    return result


@app.put("/api/maintenance/{request_id}/status")
def update_maintenance_status(request_id: int, status: str = Query(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    maint = db.query(MaintenanceRequest).filter(MaintenanceRequest.id == request_id).first()
    if not maint:
        raise HTTPException(status_code=404, detail="Request not found")
    maint.status = status
    if status == "completed":
        maint.completed_date = datetime.datetime.utcnow()
    db.commit()
    return {"message": "Updated", "status": status}


# ─── Parking Complaints ─────────────────────────────────────────────────────

@app.get("/api/properties/{property_id}/parking-complaints")
def list_parking_complaints(property_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    complaints = db.query(ParkingComplaint).filter(
        ParkingComplaint.property_id == property_id
    ).order_by(ParkingComplaint.created_at.desc()).all()

    result = []
    for c in complaints:
        reporter_profile = db.query(TenantProfile).filter(TenantProfile.id == c.reporter_tenant_id).first()
        reporter_user = db.query(User).filter(User.id == reporter_profile.user_id).first() if reporter_profile else None
        offender_user = None
        if c.offending_tenant_id:
            offender_profile = db.query(TenantProfile).filter(TenantProfile.id == c.offending_tenant_id).first()
            offender_user = db.query(User).filter(User.id == offender_profile.user_id).first() if offender_profile else None

        result.append({
            "id": c.id,
            "offending_plate": c.offending_plate,
            "reporter_name": f"{reporter_user.first_name} {reporter_user.last_name}" if reporter_user else "Unknown",
            "offender_name": f"{offender_user.first_name} {offender_user.last_name}" if offender_user else "Unknown/Unregistered",
            "status": c.status,
            "invoice_sent": c.invoice_sent,
            "invoice_amount": c.invoice_amount,
            "created_at": str(c.created_at) if c.created_at else None,
        })
    return result


# ─── Stacy Chat ──────────────────────────────────────────────────────────────

@app.post("/api/chat", response_model=ChatMessageResponse)
def chat_with_stacy(data: ChatMessageRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role == "tenant":
        assistant = StacyAssistant(db, user)
    else:
        assistant = StacyLandlordAssistant(db, user)

    result = assistant.process_message(data.message)
    return ChatMessageResponse(**result)


@app.get("/api/chat/history", response_model=List[ChatHistoryItem])
def get_chat_history(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    messages = db.query(ChatMessage).filter(
        ChatMessage.user_id == user.id
    ).order_by(ChatMessage.created_at.asc()).limit(100).all()
    return messages


# ─── Notifications ───────────────────────────────────────────────────────────

@app.get("/api/notifications")
def list_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notifs = db.query(Notification).filter(
        Notification.user_id == user.id
    ).order_by(Notification.created_at.desc()).limit(50).all()
    return [
        {
            "id": n.id,
            "type": n.type,
            "subject": n.subject,
            "message": n.message,
            "status": n.status,
            "created_at": str(n.created_at) if n.created_at else None,
        }
        for n in notifs
    ]


# ─── Dashboard Stats ────────────────────────────────────────────────────────

@app.get("/api/dashboard/stats")
def dashboard_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role == "landlord":
        properties = db.query(Property).filter(Property.landlord_id == user.id).all()
        prop_ids = [p.id for p in properties]

        total_tenants = db.query(TenantProfile).filter(
            TenantProfile.property_id.in_(prop_ids), TenantProfile.is_active == True
        ).count() if prop_ids else 0

        open_maintenance = db.query(MaintenanceRequest).filter(
            MaintenanceRequest.property_id.in_(prop_ids),
            MaintenanceRequest.status.in_(["open", "in_progress"])
        ).count() if prop_ids else 0

        open_parking = db.query(ParkingComplaint).filter(
            ParkingComplaint.property_id.in_(prop_ids),
            ParkingComplaint.status.in_(["open", "notified"])
        ).count() if prop_ids else 0

        total_units = db.query(Unit).filter(
            Unit.property_id.in_(prop_ids)
        ).count() if prop_ids else 0

        occupied_units = db.query(Unit).filter(
            Unit.property_id.in_(prop_ids), Unit.is_occupied == True
        ).count() if prop_ids else 0

        return {
            "total_properties": len(properties),
            "total_tenants": total_tenants,
            "total_units": total_units,
            "occupied_units": occupied_units,
            "open_maintenance": open_maintenance,
            "open_parking": open_parking,
        }
    else:
        # Tenant stats
        profile = db.query(TenantProfile).filter(TenantProfile.user_id == user.id).first()
        if profile:
            open_maint = db.query(MaintenanceRequest).filter(
                MaintenanceRequest.tenant_profile_id == profile.id,
                MaintenanceRequest.status.in_(["open", "in_progress", "scheduled"])
            ).count()
            return {
                "open_maintenance": open_maint,
                "unit": profile.unit_id,
            }
        return {}


# ─── Tenant Profile (self) ──────────────────────────────────────────────────

@app.get("/api/my/profile")
def get_my_profile(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.query(TenantProfile).filter(TenantProfile.user_id == user.id).first()
    if not profile:
        return {"error": "No tenant profile found"}

    unit = db.query(Unit).filter(Unit.id == profile.unit_id).first()
    prop = db.query(Property).filter(Property.id == profile.property_id).first()
    vehicles = db.query(Vehicle).filter(Vehicle.tenant_profile_id == profile.id).all()

    return {
        "id": profile.id,
        "user_id": user.id,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "phone": user.phone,
        "unit_number": unit.unit_number if unit else None,
        "property_name": prop.name if prop else None,
        "property_address": prop.address if prop else None,
        "lease_start": str(profile.lease_start) if profile.lease_start else None,
        "lease_end": str(profile.lease_end) if profile.lease_end else None,
        "rent_amount": unit.rent_amount if unit else None,
        "parking_spot": unit.parking_spot if unit else None,
        "vehicles": [
            {
                "id": v.id,
                "owner_name": v.owner_name,
                "plate_number": v.plate_number,
                "make": v.make,
                "model": v.model,
                "color": v.color,
            }
            for v in vehicles
        ],
        "has_lease_file": bool(profile.lease_file_path),
    }


# ─── Lease File Upload/Download ──────────────────────────────────

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}


@app.post("/api/tenants/{tenant_profile_id}/lease-file")
async def upload_lease_file(
    tenant_profile_id: int,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = db.query(TenantProfile).filter(TenantProfile.id == tenant_profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Tenant profile not found")

    # Authorization: landlord who owns the property or the tenant themselves
    prop = db.query(Property).filter(Property.id == profile.property_id).first()
    if user.role == "landlord" and prop.landlord_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if user.role == "tenant" and profile.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Validate file extension
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF, PNG, JPG, and JPEG files are allowed")

    # Delete old file if exists
    if profile.lease_file_path and os.path.exists(profile.lease_file_path):
        os.remove(profile.lease_file_path)

    # Save file
    filename = f"lease_{tenant_profile_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)

    profile.lease_file_path = filepath
    db.commit()

    return {"message": "Lease file uploaded successfully", "filename": filename}


@app.get("/api/tenants/{tenant_profile_id}/lease-file")
def download_lease_file(
    tenant_profile_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = db.query(TenantProfile).filter(TenantProfile.id == tenant_profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Tenant profile not found")

    # Authorization: landlord who owns the property or the tenant themselves
    prop = db.query(Property).filter(Property.id == profile.property_id).first()
    if user.role == "landlord" and prop.landlord_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if user.role == "tenant" and profile.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if not profile.lease_file_path or not os.path.exists(profile.lease_file_path):
        raise HTTPException(status_code=404, detail="No lease file found")

    return FileResponse(
        profile.lease_file_path,
        filename=os.path.basename(profile.lease_file_path),
        media_type="application/octet-stream",
    )


# ─── Violations ──────────────────────────────────────────────────────────

@app.get("/api/properties/{property_id}/violations")
def list_violations(property_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """List violations for a property (landlord only)."""
    prop = db.query(Property).filter(Property.id == property_id, Property.landlord_id == user.id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    violations = db.query(Violation).filter(
        Violation.property_id == property_id
    ).order_by(Violation.created_at.desc()).all()

    result = []
    for v in violations:
        tenant_user = None
        unit_number = None
        if v.tenant_profile_id:
            tp = db.query(TenantProfile).filter(TenantProfile.id == v.tenant_profile_id).first()
            if tp:
                tenant_user = db.query(User).filter(User.id == tp.user_id).first()
                unit_obj = db.query(Unit).filter(Unit.id == tp.unit_id).first()
                unit_number = unit_obj.unit_number if unit_obj else None

        # Check if a fine has been issued for this violation
        fine = db.query(Fine).filter(Fine.violation_id == v.id).first()

        result.append({
            "id": v.id,
            "type": v.type,
            "description": v.description,
            "status": v.status,
            "tenant_name": f"{tenant_user.first_name} {tenant_user.last_name}" if tenant_user else "Unknown/Unregistered",
            "tenant_email": tenant_user.email if tenant_user else None,
            "unit_number": unit_number,
            "email_sent": v.email_sent,
            "reviewed_at": str(v.reviewed_at) if v.reviewed_at else None,
            "review_notes": v.review_notes,
            "created_at": str(v.created_at) if v.created_at else None,
            "fine": {
                "id": fine.id,
                "amount": fine.amount,
                "reason": fine.reason,
                "status": fine.status,
                "email_sent": fine.email_sent,
                "created_at": str(fine.created_at) if fine.created_at else None,
            } if fine else None,
        })
    return result


@app.put("/api/violations/{violation_id}/review")
def review_violation(
    violation_id: int,
    action: str = Query(..., description="dismiss or fine"),
    fine_amount: Optional[float] = Query(None),
    reason: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Landlord reviews a violation — dismiss or issue a fine."""
    if user.role != "landlord":
        raise HTTPException(status_code=403, detail="Only landlords can review violations")

    violation = db.query(Violation).filter(Violation.id == violation_id).first()
    if not violation:
        raise HTTPException(status_code=404, detail="Violation not found")

    prop = db.query(Property).filter(Property.id == violation.property_id, Property.landlord_id == user.id).first()
    if not prop:
        raise HTTPException(status_code=403, detail="Not authorized")

    if action == "dismiss":
        violation.status = "dismissed"
        violation.reviewed_by = user.id
        violation.reviewed_at = datetime.datetime.utcnow()
        violation.review_notes = reason or "Dismissed by landlord"
        db.commit()
        return {"message": "Violation dismissed", "status": "dismissed"}

    elif action == "fine":
        if not fine_amount or fine_amount <= 0:
            fine_amount = prop.parking_violation_fee

        # Auto-fill reason if blank
        if not reason:
            reason = (
                f"Fine issued for {violation.type} violation. {violation.description}"
            )

        violation.status = "fined"
        violation.reviewed_by = user.id
        violation.reviewed_at = datetime.datetime.utcnow()
        violation.review_notes = reason

        fine = Fine(
            violation_id=violation.id,
            tenant_profile_id=violation.tenant_profile_id,
            property_id=violation.property_id,
            amount=fine_amount,
            reason=reason,
            status="pending",
        )
        db.add(fine)
        db.commit()
        db.refresh(fine)

        # Send fine email to tenant
        if violation.tenant_profile_id:
            tp = db.query(TenantProfile).filter(TenantProfile.id == violation.tenant_profile_id).first()
            if tp:
                tenant_user = db.query(User).filter(User.id == tp.user_id).first()
                if tenant_user:
                    send_fine_email(
                        db=db,
                        user_id=tenant_user.id,
                        property_id=violation.property_id,
                        to_email=tenant_user.email,
                        tenant_name=f"{tenant_user.first_name} {tenant_user.last_name}",
                        property_name=prop.name,
                        fine_amount=fine_amount,
                        reason=reason,
                        violation_description=violation.description,
                    )
                    fine.email_sent = True
                    db.commit()

        return {
            "message": "Fine issued",
            "status": "fined",
            "fine_id": fine.id,
            "amount": fine_amount,
        }
    else:
        raise HTTPException(status_code=400, detail="Action must be 'dismiss' or 'fine'")


@app.get("/api/properties/{property_id}/fines")
def list_fines(property_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """List fines for a property (landlord only)."""
    prop = db.query(Property).filter(Property.id == property_id, Property.landlord_id == user.id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    fines = db.query(Fine).filter(Fine.property_id == property_id).order_by(Fine.created_at.desc()).all()
    result = []
    for f in fines:
        tp = db.query(TenantProfile).filter(TenantProfile.id == f.tenant_profile_id).first()
        tenant_user = db.query(User).filter(User.id == tp.user_id).first() if tp else None
        result.append({
            "id": f.id,
            "amount": f.amount,
            "reason": f.reason,
            "status": f.status,
            "email_sent": f.email_sent,
            "tenant_name": f"{tenant_user.first_name} {tenant_user.last_name}" if tenant_user else "Unknown",
            "created_at": str(f.created_at) if f.created_at else None,
        })
    return result


@app.get("/api/my/violations")
def my_violations(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get the current tenant's violations."""
    profile = db.query(TenantProfile).filter(TenantProfile.user_id == user.id).first()
    if not profile:
        return []
    violations = db.query(Violation).filter(
        Violation.tenant_profile_id == profile.id
    ).order_by(Violation.created_at.desc()).all()
    return [
        {
            "id": v.id,
            "type": v.type,
            "description": v.description,
            "status": v.status,
            "created_at": str(v.created_at) if v.created_at else None,
        }
        for v in violations
    ]


@app.get("/api/my/fines")
def my_fines(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get the current tenant's fines."""
    profile = db.query(TenantProfile).filter(TenantProfile.user_id == user.id).first()
    if not profile:
        return []
    fines = db.query(Fine).filter(
        Fine.tenant_profile_id == profile.id
    ).order_by(Fine.created_at.desc()).all()
    return [
        {
            "id": f.id,
            "amount": f.amount,
            "reason": f.reason,
            "status": f.status,
            "created_at": str(f.created_at) if f.created_at else None,
        }
        for f in fines
    ]


# ─── Owner Endpoints ──────────────────────────────────────────────────────

def require_owner(user: User = Depends(get_current_user)):
    if user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    return user


@app.get("/api/owner/stats")
def owner_stats(user: User = Depends(require_owner), db: Session = Depends(get_db)):
    total_landlords = db.query(User).filter(User.role == "landlord").count()
    total_tenants = db.query(User).filter(User.role == "tenant").count()
    total_properties = db.query(Property).count()
    total_units = db.query(Unit).count()
    occupied_units = db.query(Unit).filter(Unit.is_occupied == True).count()
    active_subscriptions = db.query(Subscription).filter(Subscription.is_active == True).count()
    monthly_revenue = db.query(func.sum(Subscription.monthly_price)).filter(
        Subscription.is_active == True
    ).scalar() or 0
    open_maintenance = db.query(MaintenanceRequest).filter(
        MaintenanceRequest.status.in_(["open", "in_progress"])
    ).count()
    total_payouts = db.query(func.sum(Payout.amount)).filter(
        Payout.status == "completed"
    ).scalar() or 0
    pending_payouts = db.query(func.sum(Payout.amount)).filter(
        Payout.status == "pending"
    ).scalar() or 0

    return {
        "total_landlords": total_landlords,
        "total_tenants": total_tenants,
        "total_properties": total_properties,
        "total_units": total_units,
        "occupied_units": occupied_units,
        "active_subscriptions": active_subscriptions,
        "monthly_revenue": monthly_revenue,
        "open_maintenance": open_maintenance,
        "total_payouts": total_payouts,
        "pending_payouts": pending_payouts,
    }


@app.get("/api/owner/landlords")
def owner_list_landlords(user: User = Depends(require_owner), db: Session = Depends(get_db)):
    landlords = db.query(User).filter(User.role == "landlord").order_by(User.created_at.desc()).all()
    result = []
    for ll in landlords:
        sub = db.query(Subscription).filter(
            Subscription.landlord_id == ll.id, Subscription.is_active == True
        ).first()
        prop_count = db.query(Property).filter(Property.landlord_id == ll.id).count()
        tenant_count = db.query(TenantProfile).join(Property).filter(
            Property.landlord_id == ll.id, TenantProfile.is_active == True
        ).count()
        total_paid = db.query(func.sum(Payout.amount)).filter(
            Payout.landlord_id == ll.id, Payout.status == "completed"
        ).scalar() or 0
        result.append({
            "id": ll.id,
            "email": ll.email,
            "first_name": ll.first_name,
            "last_name": ll.last_name,
            "phone": ll.phone,
            "is_active": ll.is_active,
            "created_at": str(ll.created_at) if ll.created_at else None,
            "plan": sub.plan if sub else None,
            "monthly_price": sub.monthly_price if sub else 0,
            "properties": prop_count,
            "tenants": tenant_count,
            "total_paid_out": total_paid,
        })
    return result


@app.put("/api/owner/landlords/{landlord_id}/status")
def owner_toggle_landlord(landlord_id: int, user: User = Depends(require_owner), db: Session = Depends(get_db)):
    landlord = db.query(User).filter(User.id == landlord_id, User.role == "landlord").first()
    if not landlord:
        raise HTTPException(status_code=404, detail="Landlord not found")
    landlord.is_active = not landlord.is_active
    db.commit()
    return {"id": landlord.id, "is_active": landlord.is_active}


@app.get("/api/owner/payouts")
def owner_list_payouts(user: User = Depends(require_owner), db: Session = Depends(get_db)):
    payouts = db.query(Payout).order_by(Payout.created_at.desc()).all()
    result = []
    for p in payouts:
        ll = db.query(User).filter(User.id == p.landlord_id).first()
        result.append({
            "id": p.id,
            "landlord_id": p.landlord_id,
            "landlord_name": f"{ll.first_name} {ll.last_name}" if ll else "Unknown",
            "landlord_email": ll.email if ll else "Unknown",
            "amount": p.amount,
            "status": p.status,
            "description": p.description,
            "created_at": str(p.created_at) if p.created_at else None,
            "completed_at": str(p.completed_at) if p.completed_at else None,
        })
    return result


@app.post("/api/owner/payouts")
def owner_create_payout(data: PayoutCreate, user: User = Depends(require_owner), db: Session = Depends(get_db)):
    landlord = db.query(User).filter(User.id == data.landlord_id, User.role == "landlord").first()
    if not landlord:
        raise HTTPException(status_code=404, detail="Landlord not found")
    payout = Payout(
        landlord_id=data.landlord_id,
        amount=data.amount,
        description=data.description,
        status="pending",
    )
    db.add(payout)
    db.commit()
    db.refresh(payout)
    return {"id": payout.id, "status": payout.status}


@app.put("/api/owner/payouts/{payout_id}/complete")
def owner_complete_payout(payout_id: int, user: User = Depends(require_owner), db: Session = Depends(get_db)):
    payout = db.query(Payout).filter(Payout.id == payout_id).first()
    if not payout:
        raise HTTPException(status_code=404, detail="Payout not found")
    payout.status = "completed"
    payout.completed_at = datetime.datetime.utcnow()
    db.commit()
    return {"id": payout.id, "status": payout.status}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
