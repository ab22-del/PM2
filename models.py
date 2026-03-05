import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, Date, Enum as SAEnum
)
from sqlalchemy.orm import relationship
from database import Base
import enum


class UserRole(str, enum.Enum):
    OWNER = "owner"
    LANDLORD = "landlord"
    TENANT = "tenant"


class MaintenanceStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class ParkingComplaintStatus(str, enum.Enum):
    OPEN = "open"
    NOTIFIED = "notified"
    RESOLVED = "resolved"
    INVOICED = "invoiced"


class PlanTier(str, enum.Enum):
    BASE = "base"
    MEDIUM = "medium"
    MANAGERS = "managers"
    LANDLORD = "landlord"
    CUSTOM = "custom"


# ─── Users ───────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, nullable=False)  # owner, landlord, or tenant
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    date_of_birth = Column(Date, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Landlord relationships
    owned_properties = relationship("Property", back_populates="landlord", foreign_keys="Property.landlord_id")
    subscription = relationship("Subscription", back_populates="landlord", uselist=False)

    # Tenant relationships
    tenant_profile = relationship("TenantProfile", back_populates="user", uselist=False)


# ─── Subscriptions / Plans ───────────────────────────────────────────────────

class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    landlord_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    plan = Column(String, nullable=False)  # base, medium, managers, landlord, custom
    max_properties = Column(Integer, nullable=True)  # null = unlimited
    max_tenants = Column(Integer, nullable=True)
    monthly_price = Column(Float, nullable=False)
    setup_fee = Column(Float, nullable=False)
    is_active = Column(Boolean, default=True)
    started_at = Column(DateTime, default=datetime.datetime.utcnow)

    landlord = relationship("User", back_populates="subscription")


# ─── Properties ──────────────────────────────────────────────────────────────

class Property(Base):
    __tablename__ = "properties"

    id = Column(Integer, primary_key=True, index=True)
    landlord_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    address = Column(String, nullable=False)
    city = Column(String, nullable=False)
    state = Column(String, nullable=False)
    zip_code = Column(String, nullable=False)
    total_units = Column(Integer, default=1)
    max_vehicles_per_unit = Column(Integer, default=2)
    max_guest_passes_per_unit = Column(Integer, default=2)
    max_guest_pass_duration_hours = Column(Integer, default=72)
    allow_guest_passes = Column(Boolean, default=True)
    parking_violation_fee = Column(Float, default=50.0)
    maintenance_email = Column(String, nullable=True)  # maintenance company email
    maintenance_phone = Column(String, nullable=True)
    broker_email = Column(String, nullable=True)
    rent_info = Column(Text, nullable=True)  # configurable rent info for inquiries
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    landlord = relationship("User", back_populates="owned_properties", foreign_keys=[landlord_id])
    units = relationship("Unit", back_populates="property", cascade="all, delete-orphan")


class Unit(Base):
    __tablename__ = "units"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)
    unit_number = Column(String, nullable=False)
    bedrooms = Column(Integer, default=1)
    bathrooms = Column(Float, default=1.0)
    rent_amount = Column(Float, nullable=True)
    is_occupied = Column(Boolean, default=False)
    parking_spot = Column(String, nullable=True)

    property = relationship("Property", back_populates="units")
    tenant_profiles = relationship("TenantProfile", back_populates="unit")


# ─── Tenant Profiles ────────────────────────────────────────────────────────

class TenantProfile(Base):
    __tablename__ = "tenant_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    unit_id = Column(Integer, ForeignKey("units.id"), nullable=False)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)
    lease_start = Column(Date, nullable=True)
    lease_end = Column(Date, nullable=True)
    lease_file_path = Column(String, nullable=True)
    emergency_contact_name = Column(String, nullable=True)
    emergency_contact_phone = Column(String, nullable=True)
    move_in_date = Column(Date, nullable=True)
    is_active = Column(Boolean, default=True)

    user = relationship("User", back_populates="tenant_profile")
    unit = relationship("Unit", back_populates="tenant_profiles")
    vehicles = relationship("Vehicle", back_populates="tenant_profile", cascade="all, delete-orphan")


# ─── Vehicles ────────────────────────────────────────────────────────────────

class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(Integer, primary_key=True, index=True)
    tenant_profile_id = Column(Integer, ForeignKey("tenant_profiles.id"), nullable=False)
    owner_name = Column(String, nullable=False)
    plate_number = Column(String, nullable=False, index=True)
    make = Column(String, nullable=True)
    model = Column(String, nullable=True)
    color = Column(String, nullable=True)
    year = Column(Integer, nullable=True)

    tenant_profile = relationship("TenantProfile", back_populates="vehicles")


class GuestPass(Base):
    __tablename__ = "guest_passes"

    id = Column(Integer, primary_key=True, index=True)
    tenant_profile_id = Column(Integer, ForeignKey("tenant_profiles.id"), nullable=False)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)
    make = Column(String, nullable=False)
    model = Column(String, nullable=False)
    color = Column(String, nullable=False)
    plate_number = Column(String, nullable=False, index=True)
    duration_hours = Column(Integer, nullable=False)
    status = Column(String, default="active")  # active, expired, cancelled
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)

    tenant_profile = relationship("TenantProfile")
    property = relationship("Property")


# ─── Maintenance Requests ────────────────────────────────────────────────────

class MaintenanceRequest(Base):
    __tablename__ = "maintenance_requests"

    id = Column(Integer, primary_key=True, index=True)
    tenant_profile_id = Column(Integer, ForeignKey("tenant_profiles.id"), nullable=False)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)
    unit_id = Column(Integer, ForeignKey("units.id"), nullable=False)
    category = Column(String, nullable=True)  # plumbing, electrical, appliance, etc.
    description = Column(Text, nullable=False)
    status = Column(String, default="open")
    priority = Column(String, default="normal")  # low, normal, high, emergency
    scheduled_date = Column(DateTime, nullable=True)
    completed_date = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    tenant_profile = relationship("TenantProfile")


# ─── Parking Complaints ─────────────────────────────────────────────────────

class ParkingComplaint(Base):
    __tablename__ = "parking_complaints"

    id = Column(Integer, primary_key=True, index=True)
    reporter_tenant_id = Column(Integer, ForeignKey("tenant_profiles.id"), nullable=False)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)
    offending_plate = Column(String, nullable=False)
    offending_tenant_id = Column(Integer, ForeignKey("tenant_profiles.id"), nullable=True)
    status = Column(String, default="open")
    invoice_sent = Column(Boolean, default=False)
    invoice_amount = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    reporter = relationship("TenantProfile", foreign_keys=[reporter_tenant_id])
    offender = relationship("TenantProfile", foreign_keys=[offending_tenant_id])


# ─── Stacy Chat Messages ────────────────────────────────────────────────────

class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=True)
    role = Column(String, nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)
    intent = Column(String, nullable=True)  # parking, maintenance, lease, general, etc.
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


# ─── Notifications / SMS Log ────────────────────────────────────────────────

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=True)
    type = Column(String, nullable=False)  # sms, email, in_app
    recipient_phone = Column(String, nullable=True)
    recipient_email = Column(String, nullable=True)
    subject = Column(String, nullable=True)
    message = Column(Text, nullable=False)
    status = Column(String, default="pending")  # pending, sent, failed
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    sent_at = Column(DateTime, nullable=True)


# ─── Showing Requests ───────────────────────────────────────────────────────

class ShowingRequest(Base):
    __tablename__ = "showing_requests"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    message = Column(Text, nullable=True)
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


# ─── Payouts ───────────────────────────────────────────────────────────────

class Payout(Base):
    __tablename__ = "payouts"

    id = Column(Integer, primary_key=True, index=True)
    landlord_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    amount = Column(Float, nullable=False)
    status = Column(String, default="pending")  # pending, completed, failed
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    landlord = relationship("User")


# ─── Violations ──────────────────────────────────────────────────────────────

class Violation(Base):
    __tablename__ = "violations"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)
    tenant_profile_id = Column(Integer, ForeignKey("tenant_profiles.id"), nullable=True)
    parking_complaint_id = Column(Integer, ForeignKey("parking_complaints.id"), nullable=True)
    type = Column(String, nullable=False)  # parking, noise, lease, other
    description = Column(Text, nullable=False)
    status = Column(String, default="pending")  # pending, dismissed, fined
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)  # landlord who reviewed
    reviewed_at = Column(DateTime, nullable=True)
    review_notes = Column(Text, nullable=True)
    email_sent = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    property = relationship("Property")
    tenant_profile = relationship("TenantProfile")
    parking_complaint = relationship("ParkingComplaint")


# ─── Fines ───────────────────────────────────────────────────────────────────

class Fine(Base):
    __tablename__ = "fines"

    id = Column(Integer, primary_key=True, index=True)
    violation_id = Column(Integer, ForeignKey("violations.id"), nullable=False)
    tenant_profile_id = Column(Integer, ForeignKey("tenant_profiles.id"), nullable=False)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)
    amount = Column(Float, nullable=False)
    reason = Column(Text, nullable=True)
    status = Column(String, default="pending")  # pending, paid, waived
    email_sent = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    paid_at = Column(DateTime, nullable=True)

    violation = relationship("Violation")
    tenant_profile = relationship("TenantProfile")
    property = relationship("Property")
