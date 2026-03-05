from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import date, datetime


# ─── Auth ────────────────────────────────────────────────────────────────────

class UserRegister(BaseModel):
    email: str
    password: str
    first_name: str
    last_name: str
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    role: str = "landlord"


class UserLogin(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    role: str
    first_name: str
    last_name: str
    has_plan: bool = False


class UserResponse(BaseModel):
    id: int
    email: str
    first_name: str
    last_name: str
    phone: Optional[str] = None
    role: str
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ─── Subscription ────────────────────────────────────────────────────────────

class SubscriptionCreate(BaseModel):
    plan: str  # base, medium, managers, landlord, custom


class SubscriptionResponse(BaseModel):
    id: int
    plan: str
    max_properties: Optional[int]
    max_tenants: Optional[int]
    monthly_price: float
    setup_fee: float
    is_active: bool

    class Config:
        from_attributes = True


# ─── Property ────────────────────────────────────────────────────────────────

class PropertyCreate(BaseModel):
    name: str
    address: str
    city: str
    state: str
    zip_code: str
    total_units: int = 1
    max_vehicles_per_unit: int = 2
    parking_violation_fee: float = 50.0
    maintenance_email: Optional[str] = None
    maintenance_phone: Optional[str] = None
    broker_email: Optional[str] = None
    rent_info: Optional[str] = None


class PropertyResponse(BaseModel):
    id: int
    name: str
    address: str
    city: str
    state: str
    zip_code: str
    total_units: int
    max_vehicles_per_unit: int
    parking_violation_fee: float
    maintenance_email: Optional[str]
    maintenance_phone: Optional[str]
    broker_email: Optional[str]
    rent_info: Optional[str]

    class Config:
        from_attributes = True


# ─── Unit ────────────────────────────────────────────────────────────────────

class UnitCreate(BaseModel):
    unit_number: str
    bedrooms: int = 1
    bathrooms: float = 1.0
    rent_amount: Optional[float] = None
    parking_spot: Optional[str] = None


class UnitResponse(BaseModel):
    id: int
    property_id: int
    unit_number: str
    bedrooms: int
    bathrooms: float
    rent_amount: Optional[float]
    is_occupied: bool
    parking_spot: Optional[str]

    class Config:
        from_attributes = True


# ─── Tenant ──────────────────────────────────────────────────────────────────

class TenantCreate(BaseModel):
    email: str
    password: str
    first_name: str
    last_name: str
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    unit_id: int
    property_id: int
    lease_start: Optional[str] = None
    lease_end: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None


class TenantResponse(BaseModel):
    id: int
    user: UserResponse
    unit_id: int
    property_id: int
    lease_start: Optional[date] = None
    lease_end: Optional[date] = None
    is_active: bool
    vehicles: List = []

    class Config:
        from_attributes = True


# ─── Vehicle ─────────────────────────────────────────────────────────────────

class VehicleCreate(BaseModel):
    owner_name: str
    plate_number: str
    make: Optional[str] = None
    model: Optional[str] = None
    color: Optional[str] = None
    year: Optional[int] = None


class VehicleResponse(BaseModel):
    id: int
    tenant_profile_id: int
    owner_name: str
    plate_number: str
    make: Optional[str]
    model: Optional[str]
    color: Optional[str]
    year: Optional[int]

    class Config:
        from_attributes = True


# ─── Maintenance ─────────────────────────────────────────────────────────────

class MaintenanceRequestCreate(BaseModel):
    description: str
    category: Optional[str] = None
    priority: str = "normal"


class MaintenanceRequestResponse(BaseModel):
    id: int
    tenant_profile_id: int
    property_id: int
    unit_id: Optional[int]
    category: Optional[str]
    description: str
    status: str
    priority: str
    scheduled_date: Optional[datetime]
    completed_date: Optional[datetime]
    notes: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


# ─── Chat ────────────────────────────────────────────────────────────────────

class PayoutCreate(BaseModel):
    landlord_id: int
    amount: float
    description: Optional[str] = None


class ChatMessageRequest(BaseModel):
    message: str


class ChatMessageResponse(BaseModel):
    response: str
    actions: list = []
    intent: str = ""


class ChatHistoryItem(BaseModel):
    role: str
    content: str
    created_at: Optional[datetime] = None
    intent: Optional[str] = None

    class Config:
        from_attributes = True
