"""
Stacy - AI Tenant Operations Assistant

Smart conversational assistant that handles:
- Parking complaints (plate lookup, notifications, invoicing, violations)
- Maintenance requests (categorization, scheduling, vendor coordination)
- Lease questions (with subtopic detection for renewals, move-out, payments, terms)
- General help and tenant support
- Rent inquiries from prospective tenants

Stacy remembers conversation context and acts like a knowledgeable human assistant.
"""

import datetime
import re
from typing import Optional, List, Dict, Tuple
from sqlalchemy.orm import Session
from models import (
    User, TenantProfile, Vehicle, Property, Unit, ChatMessage,
    MaintenanceRequest, ParkingComplaint, Notification, Violation
)
from email_service import send_violation_email


class StacyAssistant:
    """Intelligent AI assistant for property management."""

    # Maintenance categories and their keywords
    MAINTENANCE_CATEGORIES = {
        "plumbing": ["leak", "pipe", "faucet", "toilet", "drain", "water", "shower", "sink", "clog", "plumb"],
        "electrical": ["light", "outlet", "switch", "power", "electric", "breaker", "wiring", "bulb", "socket"],
        "appliance": ["fridge", "refrigerator", "stove", "oven", "dishwasher", "washer", "dryer", "microwave", "garbage disposal", "appliance"],
        "hvac": ["heat", "ac", "air condition", "furnace", "thermostat", "vent", "hvac", "cold", "hot", "temperature"],
        "structural": ["door", "window", "wall", "ceiling", "floor", "roof", "crack", "hole", "broken"],
        "pest": ["bug", "roach", "cockroach", "mouse", "mice", "rat", "ant", "pest", "insect", "rodent", "bed bug"],
        "general": ["paint", "carpet", "clean", "smell", "noise", "mold", "mildew"],
    }

    # Lease subtopics and their keywords
    LEASE_SUBTOPICS = {
        "lease_renewal": ["renew", "renewal", "extend", "extension", "new lease", "re-sign", "resign"],
        "lease_moveout": ["move out", "moveout", "move-out", "moving out", "vacate", "leaving", "notice to vacate", "end lease", "break lease"],
        "lease_payment": ["payment method", "pay rent", "how to pay", "payment option", "zelle", "check", "cash", "venmo", "online payment", "autopay", "auto-pay"],
        "lease_terms": ["lease term", "policy", "policies", "rule", "rules", "pet", "guest", "sublease", "sub-lease", "terms and conditions", "what does my lease"],
    }

    GREETINGS = ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "sup", "what's up", "yo"]

    def __init__(self, db: Session, user: User):
        self.db = db
        self.user = user
        self.tenant_profile = None
        self.property = None
        self.unit = None

        if user.role == "tenant":
            self.tenant_profile = db.query(TenantProfile).filter(
                TenantProfile.user_id == user.id,
                TenantProfile.is_active == True
            ).first()
            if self.tenant_profile:
                self.property = db.query(Property).filter(Property.id == self.tenant_profile.property_id).first()
                self.unit = db.query(Unit).filter(Unit.id == self.tenant_profile.unit_id).first()

    def get_conversation_history(self, limit: int = 20) -> List[ChatMessage]:
        """Get recent conversation history for context."""
        return self.db.query(ChatMessage).filter(
            ChatMessage.user_id == self.user.id
        ).order_by(ChatMessage.created_at.desc()).limit(limit).all()[::-1]

    def get_last_intent(self) -> Optional[str]:
        """Get the intent of the last assistant message."""
        last_msg = self.db.query(ChatMessage).filter(
            ChatMessage.user_id == self.user.id,
            ChatMessage.role == "assistant"
        ).order_by(ChatMessage.created_at.desc()).first()
        return last_msg.intent if last_msg else None

    def get_last_user_message(self) -> Optional[ChatMessage]:
        """Get the last user message."""
        return self.db.query(ChatMessage).filter(
            ChatMessage.user_id == self.user.id,
            ChatMessage.role == "user"
        ).order_by(ChatMessage.created_at.desc()).first()

    def detect_lease_subtopic(self, message: str) -> Optional[str]:
        """Detect a specific lease subtopic from the message."""
        msg = message.lower().strip()
        for subtopic, keywords in self.LEASE_SUBTOPICS.items():
            if any(kw in msg for kw in keywords):
                return subtopic
        return None

    def detect_intent(self, message: str) -> str:
        """Detect the user's intent from their message."""
        msg = message.lower().strip()

        # Check for greetings
        if any(msg.startswith(g) or msg == g for g in self.GREETINGS):
            return "greeting"

        # Check for help request
        if msg in ["help", "help me", "i need help", "what can you do", "what do you do"]:
            last_intent = self.get_last_intent()
            if last_intent and last_intent not in ["greeting", "help", "welcome"]:
                return "help_followup"
            return "help"

        # Parking related
        parking_words = ["park", "spot", "parking", "tow", "car", "vehicle", "someone parked", "my spot"]
        if any(w in msg for w in parking_words):
            return "parking"

        # Plate number (just digits/letters, likely a follow-up to parking)
        if re.match(r'^[A-Za-z0-9]{3,10}$', msg.strip()):
            last_intent = self.get_last_intent()
            if last_intent == "parking_awaiting_plate":
                return "parking_plate_response"
            return "short_response"

        # Yes/No responses
        if msg.strip().lower() in ["yes", "yeah", "yep", "sure", "ok", "okay", "y", "no", "nah", "nope", "n"]:
            return "confirmation"

        # Maintenance related
        for category, keywords in self.MAINTENANCE_CATEGORIES.items():
            if any(kw in msg for kw in keywords):
                return "maintenance"

        # Check for lease subtopics FIRST (before generic lease)
        lease_subtopic = self.detect_lease_subtopic(msg)
        if lease_subtopic:
            return lease_subtopic

        # Generic lease keywords
        lease_words = ["lease", "rent", "deposit", "contract", "agreement"]
        if any(w in msg for w in lease_words):
            return "lease"

        # If last intent was lease, check if this is a follow-up subtopic
        last_intent = self.get_last_intent()
        if last_intent in ("lease", "lease_renewal", "lease_moveout", "lease_payment", "lease_terms"):
            followup = self._try_resolve_lease_followup(msg)
            if followup:
                return followup

        # Showing/inquiry
        showing_words = ["show", "tour", "visit", "available", "vacancy", "looking for", "apartment", "interested"]
        if any(w in msg for w in showing_words):
            return "inquiry"

        # Thank you
        if any(w in msg for w in ["thank", "thanks", "appreciate"]):
            return "thanks"

        # Complaint
        complaint_words = ["complaint", "complain", "noisy", "loud", "neighbor", "smell", "dirty", "trash"]
        if any(w in msg for w in complaint_words):
            return "complaint"

        return "general"

    def _try_resolve_lease_followup(self, msg: str) -> Optional[str]:
        """Try to match a short follow-up message to a lease subtopic."""
        # These are the options Stacy presents after the initial lease response
        followup_map = {
            "lease_renewal": ["renewal", "renew", "renewal options", "extend"],
            "lease_moveout": ["move out", "move-out", "moveout", "moving out", "vacate"],
            "lease_payment": ["payment", "payment methods", "pay", "how to pay", "methods"],
            "lease_terms": ["terms", "policies", "policy", "lease terms", "terms and policies", "rules"],
        }
        for subtopic, keywords in followup_map.items():
            if any(kw == msg or kw in msg for kw in keywords):
                return subtopic
        return None

    def detect_maintenance_category(self, message: str) -> str:
        """Detect the specific maintenance category."""
        msg = message.lower()
        for category, keywords in self.MAINTENANCE_CATEGORIES.items():
            if any(kw in msg for kw in keywords):
                return category
        return "general"

    def find_vehicle_by_plate(self, plate: str) -> Optional[Tuple[Vehicle, TenantProfile, User]]:
        """Look up a vehicle by plate number within the same property."""
        if not self.property:
            return None

        plate_clean = plate.strip().upper()

        result = self.db.query(Vehicle, TenantProfile, User).join(
            TenantProfile, Vehicle.tenant_profile_id == TenantProfile.id
        ).join(
            User, TenantProfile.user_id == User.id
        ).filter(
            TenantProfile.property_id == self.property.id,
            Vehicle.plate_number.ilike(f"%{plate_clean}%")
        ).first()

        return result

    def save_message(self, role: str, content: str, intent: str = None):
        """Save a chat message to the database."""
        msg = ChatMessage(
            user_id=self.user.id,
            property_id=self.property.id if self.property else None,
            role=role,
            content=content,
            intent=intent
        )
        self.db.add(msg)
        self.db.commit()
        return msg

    def create_notification(self, user_id: int, notif_type: str, message: str,
                            phone: str = None, email: str = None, subject: str = None) -> Notification:
        """Create a notification record."""
        notif = Notification(
            user_id=user_id,
            property_id=self.property.id if self.property else None,
            type=notif_type,
            recipient_phone=phone,
            recipient_email=email,
            subject=subject,
            message=message,
            status="sent",
            sent_at=datetime.datetime.utcnow()
        )
        self.db.add(notif)
        self.db.commit()
        return notif

    def _build_lease_subtopic_response(self, subtopic: str) -> str:
        """Build a detailed response for a specific lease subtopic."""
        name = self.user.first_name

        if subtopic == "lease_renewal":
            response = f"Great question about renewals, {name}! Here's what you need to know:\n\n"
            if self.tenant_profile and self.tenant_profile.lease_end:
                days_left = (self.tenant_profile.lease_end - datetime.date.today()).days
                if days_left > 0:
                    response += f"Your current lease ends on **{self.tenant_profile.lease_end.strftime('%B %d, %Y')}** — that's **{days_left} days** from now.\n\n"
                else:
                    response += f"Your lease ended on **{self.tenant_profile.lease_end.strftime('%B %d, %Y')}**. It may be month-to-month now.\n\n"
            response += (
                "**Renewal process:**\n"
                "- Typically, your property manager will reach out 60-90 days before your lease ends with renewal options\n"
                "- You can also proactively request a renewal by contacting your property manager\n"
                "- Renewal terms (rent adjustments, lease length) will be outlined in the renewal offer\n\n"
                "Would you like me to notify your property manager that you're interested in renewal?"
            )
            return response

        elif subtopic == "lease_moveout":
            response = f"Here's what you need to know about moving out, {name}:\n\n"
            if self.tenant_profile and self.tenant_profile.lease_end:
                response += f"Your lease ends on **{self.tenant_profile.lease_end.strftime('%B %d, %Y')}**.\n\n"
            response += (
                "**Move-out checklist:**\n"
                "- Provide written notice to your property manager (typically 30-60 days before move-out)\n"
                "- Schedule a move-out inspection with management\n"
                "- Clean the unit thoroughly (avoid deductions from your deposit)\n"
                "- Remove all personal belongings and trash\n"
                "- Return all keys, fobs, and parking permits\n"
                "- Ensure all utilities are transferred or canceled\n"
                "- Provide a forwarding address for your security deposit return\n\n"
                "**Security deposit:** Typically returned within 30 days of move-out, minus any deductions for damages beyond normal wear and tear.\n\n"
                "Would you like me to notify your property manager about your move-out plans?"
            )
            return response

        elif subtopic == "lease_payment":
            response = f"Here's your rent payment information, {name}:\n\n"
            if self.unit and self.unit.rent_amount:
                response += f"**Monthly Rent:** ${self.unit.rent_amount:,.2f}\n\n"
            response += (
                "**Common payment methods:**\n"
                "- Online portal (if available through your property)\n"
                "- Check — made payable to your property management company\n"
                "- Money order\n"
                "- Electronic transfer (Zelle, ACH) — check with your property manager for details\n\n"
                "**Important reminders:**\n"
                "- Rent is typically due on the 1st of each month\n"
                "- Late fees may apply after any grace period specified in your lease\n"
                "- Always keep payment receipts for your records\n\n"
                "Contact your property manager for their specific accepted payment methods."
            )
            return response

        elif subtopic == "lease_terms":
            response = f"Here's a summary of common lease terms and policies, {name}:\n\n"
            response += (
                "**Key lease terms to know:**\n"
                "- **Rent due date:** Typically the 1st of each month\n"
                "- **Late fees:** Applied after the grace period (check your lease for specifics)\n"
                "- **Guest policy:** Guests staying over a certain number of days may need to be reported\n"
                "- **Pet policy:** Check your lease for pet allowances, deposits, and breed restrictions\n"
                "- **Noise hours:** Quiet hours are typically 10 PM to 8 AM\n"
                "- **Subletting:** Usually requires written permission from your landlord\n"
                "- **Maintenance:** Report issues promptly — you're responsible for tenant-caused damage\n"
                "- **Parking:** Use only your assigned spot(s)\n\n"
                "For the specific terms in your lease agreement, please refer to your signed lease document. "
                "If you need a copy, ask your property manager.\n\n"
                "Is there a specific policy you'd like more detail on?"
            )
            return response

        return ""

    def process_message(self, message: str) -> dict:
        """
        Process a user message and return Stacy's response.

        Returns dict with:
        - response: str (Stacy's text response)
        - actions: list of actions taken (notifications, maintenance requests, etc.)
        - intent: detected intent
        """
        # Save user message
        intent = self.detect_intent(message)
        self.save_message("user", message, intent)

        actions = []
        response = ""

        # Get conversation context
        history = self.get_conversation_history(10)
        last_intent = self.get_last_intent()

        if intent == "greeting":
            tenant_name = self.user.first_name
            unit_info = f" in Unit {self.unit.unit_number}" if self.unit else ""
            response = (
                f"Hi {tenant_name}! I'm Stacy, your property assistant. "
                f"I'm here to help you with anything you need{unit_info}. "
                f"I can help with:\n\n"
                f"- **Parking issues** (someone in your spot, vehicle questions)\n"
                f"- **Maintenance requests** (repairs, appliances, plumbing, etc.)\n"
                f"- **Lease questions** (rent, move-in/out, renewals)\n"
                f"- **General questions** about your property\n\n"
                f"What can I help you with today?"
            )
            self.save_message("assistant", response, "greeting")

        elif intent == "help_followup":
            last_issue_intent = None
            for msg in reversed(history):
                if msg.intent and msg.intent not in ["greeting", "help", "help_followup", "welcome"]:
                    last_issue_intent = msg.intent
                    break

            intent_descriptions = {
                "parking": "parking issue",
                "parking_awaiting_plate": "parking complaint",
                "maintenance": "maintenance request",
                "lease": "lease question",
                "lease_renewal": "lease renewal question",
                "lease_moveout": "move-out question",
                "lease_payment": "payment question",
                "lease_terms": "lease terms question",
                "complaint": "complaint",
            }

            desc = intent_descriptions.get(last_issue_intent, "previous issue")
            response = (
                f"Of course! Is this still regarding your {desc}, "
                f"or is there something new I can help you with?\n\n"
                f"Just let me know and I'll take care of it right away."
            )
            self.save_message("assistant", response, "help_followup")

        elif intent == "help":
            tenant_name = self.user.first_name
            response = (
                f"Absolutely, {tenant_name}! Here's everything I can help you with:\n\n"
                f"**Parking Issues:**\n"
                f"- Report someone parking in your spot\n"
                f"- Vehicle registration questions\n\n"
                f"**Maintenance:**\n"
                f"- Report broken appliances, plumbing, electrical issues\n"
                f"- Request repairs or inspections\n"
                f"- Check on existing maintenance requests\n\n"
                f"**Lease & Rent:**\n"
                f"- Questions about your lease agreement\n"
                f"- Rent payment information\n"
                f"- Move-in/move-out details\n\n"
                f"**General:**\n"
                f"- Property rules and policies\n"
                f"- Neighbor complaints\n"
                f"- Any other questions or concerns\n\n"
                f"Just describe what you need and I'll take care of it!"
            )
            self.save_message("assistant", response, "help")

        elif intent == "parking":
            response = (
                f"I'm sorry to hear someone's in your spot! "
                f"Let me help you resolve this right away.\n\n"
                f"Can you give me the **license plate number** of the vehicle parked in your spot?"
            )
            self.save_message("assistant", response, "parking_awaiting_plate")

        elif intent == "parking_plate_response":
            return self._handle_parking_plate(message, actions)

        elif intent == "maintenance":
            category = self.detect_maintenance_category(message)
            category_display = category.replace("_", " ").title()

            if self.tenant_profile:
                maint = MaintenanceRequest(
                    tenant_profile_id=self.tenant_profile.id,
                    property_id=self.property.id,
                    unit_id=self.unit.id if self.unit else None,
                    category=category,
                    description=message,
                    status="open",
                    priority="normal"
                )
                self.db.add(maint)
                self.db.commit()

                landlord = self.db.query(User).filter(User.id == self.property.landlord_id).first()
                if landlord:
                    landlord_msg = (
                        f"Maintenance Request - Unit {self.unit.unit_number if self.unit else 'N/A'}, "
                        f"{self.user.first_name} {self.user.last_name}: {category_display} issue. "
                        f"Description: {message}"
                    )
                    self.create_notification(
                        landlord.id, "sms", landlord_msg,
                        phone=landlord.phone
                    )
                    actions.append({
                        "type": "sms_landlord",
                        "to": landlord.phone,
                        "message": landlord_msg
                    })

                response = (
                    f"I'm sorry you're dealing with that! I've categorized this as a **{category_display}** issue "
                    f"and created a maintenance request for your unit.\n\n"
                    f"Here's what I've done:\n"
                    f"- Created maintenance ticket #{maint.id}\n"
                    f"- Notified your property manager\n"
                    f"- Flagged as **{category_display}** category\n\n"
                )

                if self.property.maintenance_email:
                    response += (
                        f"I'm also reaching out to the maintenance team to get this scheduled. "
                        f"You'll be updated once a repair date is confirmed.\n\n"
                    )
                    actions.append({
                        "type": "email_maintenance",
                        "to": self.property.maintenance_email,
                        "message": f"Maintenance request for Unit {self.unit.unit_number if self.unit else 'N/A'}: {message}"
                    })
                else:
                    response += (
                        f"Your property manager will coordinate the repair. "
                    )

                response += "Can you tell me a bit more about the issue? For example:\n"
                if category == "appliance":
                    response += "- What appliance is it? (fridge, stove, dishwasher, etc.)\n- When did it stop working?\n- Is it making any unusual noises?"
                elif category == "plumbing":
                    response += "- Where exactly is the leak/issue?\n- Is water actively flowing?\n- How long has this been happening?"
                elif category == "electrical":
                    response += "- Which room is affected?\n- Is it a single outlet or multiple?\n- Any burning smell?"
                elif category == "hvac":
                    response += "- Is it heating or cooling that's not working?\n- What temperature are you seeing?\n- When did you notice this?"
                elif category == "pest":
                    response += "- What type of pest have you seen?\n- Where in the unit are they?\n- How long have you noticed them?"
                else:
                    response += "- Where in the unit is this happening?\n- How urgent is this?\n- Any other details that might help?"
            else:
                response = "I'd love to help but I couldn't find your tenant profile. Please contact your property manager directly."

            self.save_message("assistant", response, "maintenance")

        elif intent == "lease":
            response = (
                f"I'd be happy to help with your lease question, {self.user.first_name}! "
            )
            if self.tenant_profile:
                if self.tenant_profile.lease_start and self.tenant_profile.lease_end:
                    response += (
                        f"\n\nHere's what I have on file:\n"
                        f"- **Lease Start:** {self.tenant_profile.lease_start.strftime('%B %d, %Y')}\n"
                        f"- **Lease End:** {self.tenant_profile.lease_end.strftime('%B %d, %Y')}\n"
                    )
                if self.unit and self.unit.rent_amount:
                    response += f"- **Monthly Rent:** ${self.unit.rent_amount:,.2f}\n"

                response += (
                    f"\nWhat specific question do you have about your lease? For example:\n"
                    f"- Renewal options\n"
                    f"- Move-out procedures\n"
                    f"- Payment methods\n"
                    f"- Lease terms and policies"
                )
            else:
                response += "I couldn't find your lease details. Let me connect you with your property manager."

            self.save_message("assistant", response, "lease")

        elif intent in ("lease_renewal", "lease_moveout", "lease_payment", "lease_terms"):
            response = self._build_lease_subtopic_response(intent)
            self.save_message("assistant", response, intent)

        elif intent == "complaint":
            response = (
                f"I'm sorry to hear that, {self.user.first_name}. "
                f"I want to make sure we address your concern properly.\n\n"
                f"Could you provide a bit more detail?\n"
                f"- **What's the issue?** (noise, smell, behavior, etc.)\n"
                f"- **When does it happen?** (time of day, frequency)\n"
                f"- **Which unit/area** is it coming from?\n\n"
                f"I'll document everything and notify your property manager."
            )
            self.save_message("assistant", response, "complaint")

        elif intent == "thanks":
            response = (
                f"You're welcome, {self.user.first_name}! I'm always here if you need anything. "
                f"Don't hesitate to reach out anytime — that's what I'm here for! Have a great day."
            )
            self.save_message("assistant", response, "thanks")

        elif intent == "confirmation":
            is_yes = message.strip().lower() in ["yes", "yeah", "yep", "sure", "ok", "okay", "y"]
            last_assistant_intent = self.get_last_intent()

            if last_assistant_intent == "maintenance" and is_yes:
                response = (
                    f"Perfect! I've escalated this and your property manager will follow up with the maintenance team. "
                    f"You'll be notified once a repair is scheduled. Is there anything else I can help with?"
                )
            elif last_assistant_intent == "lease_renewal" and is_yes:
                # Notify landlord about renewal interest
                landlord = self.db.query(User).filter(User.id == self.property.landlord_id).first() if self.property else None
                if landlord:
                    landlord_msg = (
                        f"Lease Renewal Interest - {self.user.first_name} {self.user.last_name} "
                        f"(Unit {self.unit.unit_number if self.unit else 'N/A'}) is interested in renewing their lease."
                    )
                    self.create_notification(landlord.id, "sms", landlord_msg, phone=landlord.phone)
                    actions.append({"type": "sms_landlord", "to": landlord.phone, "message": landlord_msg})
                response = (
                    f"Done! I've notified your property manager that you're interested in renewing your lease. "
                    f"They'll reach out to you with renewal options. Is there anything else I can help with?"
                )
            elif last_assistant_intent == "lease_moveout" and is_yes:
                landlord = self.db.query(User).filter(User.id == self.property.landlord_id).first() if self.property else None
                if landlord:
                    landlord_msg = (
                        f"Move-Out Notice - {self.user.first_name} {self.user.last_name} "
                        f"(Unit {self.unit.unit_number if self.unit else 'N/A'}) is planning to move out."
                    )
                    self.create_notification(landlord.id, "sms", landlord_msg, phone=landlord.phone)
                    actions.append({"type": "sms_landlord", "to": landlord.phone, "message": landlord_msg})
                response = (
                    f"I've notified your property manager about your move-out plans. "
                    f"They'll be in touch to coordinate the details. Is there anything else I can help with?"
                )
            elif is_yes:
                response = "Great! Is there anything else I can help you with?"
            else:
                response = "No problem! Let me know if there's anything else I can assist with."

            self.save_message("assistant", response, "confirmation")

        elif intent == "short_response":
            last_assistant_intent = self.get_last_intent()
            if last_assistant_intent == "parking_awaiting_plate":
                return self.process_plate_response(message)

            # Check if this could be a lease follow-up
            if last_assistant_intent in ("lease", "lease_renewal", "lease_moveout", "lease_payment", "lease_terms"):
                followup = self._try_resolve_lease_followup(message.lower().strip())
                if followup:
                    response = self._build_lease_subtopic_response(followup)
                    self.save_message("assistant", response, followup)
                    return {"response": response, "actions": actions, "intent": followup}

            response = (
                f"Thanks for that info! Could you tell me a bit more so I can help you better? "
                f"What issue are you experiencing?"
            )
            self.save_message("assistant", response, "general")

        else:
            # General catch-all — check if this could be a lease follow-up
            last_assistant_intent = self.get_last_intent()
            if last_assistant_intent in ("lease", "lease_renewal", "lease_moveout", "lease_payment", "lease_terms"):
                followup = self._try_resolve_lease_followup(message.lower().strip())
                if followup:
                    response = self._build_lease_subtopic_response(followup)
                    self.save_message("assistant", response, followup)
                    return {"response": response, "actions": actions, "intent": followup}

            response = (
                f"Thanks for reaching out, {self.user.first_name}! "
                f"I want to make sure I help you with the right thing.\n\n"
                f"Could you tell me more about what you need? I can help with:\n"
                f"- **Parking issues** — someone in your spot\n"
                f"- **Maintenance** — repairs, broken items, plumbing, etc.\n"
                f"- **Lease questions** — rent, renewals, policies\n"
                f"- **Complaints** — noise, neighbors, property concerns\n\n"
                f"Just describe the issue and I'll take it from there!"
            )
            self.save_message("assistant", response, "general")

        return {
            "response": response,
            "actions": actions,
            "intent": intent,
        }

    def _handle_parking_plate(self, message: str, actions: list) -> dict:
        """Handle a parking plate response — create complaint, violation, send emails."""
        plate = message.strip().upper()
        vehicle_data = self.find_vehicle_by_plate(plate)

        if vehicle_data:
            vehicle, offender_profile, offender_user = vehicle_data
            reporter_name = f"{self.user.first_name} {self.user.last_name}"
            offender_name = f"{offender_user.first_name} {offender_user.last_name}"
            reporter_unit = self.unit.unit_number if self.unit else "N/A"

            offender_unit_obj = self.db.query(Unit).filter(Unit.id == offender_profile.unit_id).first()
            offender_unit = offender_unit_obj.unit_number if offender_unit_obj else "N/A"

            # Create parking complaint
            complaint = ParkingComplaint(
                reporter_tenant_id=self.tenant_profile.id,
                property_id=self.property.id,
                offending_plate=plate,
                offending_tenant_id=offender_profile.id,
                status="notified",
                invoice_amount=self.property.parking_violation_fee
            )
            self.db.add(complaint)
            self.db.commit()
            self.db.refresh(complaint)

            # Create violation record (pending landlord review)
            violation_desc = (
                f"Parking violation: Vehicle (plate: {plate}) belonging to {offender_name} "
                f"(Unit {offender_unit}) was parked in {reporter_name}'s assigned spot (Unit {reporter_unit})."
            )
            violation = Violation(
                property_id=self.property.id,
                tenant_profile_id=offender_profile.id,
                parking_complaint_id=complaint.id,
                type="parking",
                description=violation_desc,
                status="pending",
            )
            self.db.add(violation)
            self.db.commit()

            # SMS notification to offending tenant
            offender_msg = (
                f"Hi {offender_user.first_name}, this is an automated message from your property management. "
                f"Your vehicle (plate: {plate}) is parked in someone else's assigned spot. "
                f"Please move your vehicle as soon as possible to avoid fines and possible towing."
            )
            self.create_notification(
                offender_user.id, "sms", offender_msg,
                phone=offender_user.phone
            )
            actions.append({
                "type": "sms_tenant",
                "to": offender_user.phone,
                "to_name": offender_name,
                "message": offender_msg
            })

            # Email violation notice to offending tenant
            send_violation_email(
                db=self.db,
                user_id=offender_user.id,
                property_id=self.property.id,
                to_email=offender_user.email,
                tenant_name=offender_name,
                property_name=self.property.name,
                violation_type="Parking",
                description=violation_desc,
                violation_date=datetime.datetime.utcnow().strftime("%B %d, %Y"),
            )
            violation.email_sent = True
            self.db.commit()

            # Notification to landlord
            landlord = self.db.query(User).filter(User.id == self.property.landlord_id).first()
            if landlord:
                landlord_msg = (
                    f"Parking Violation (Pending Review) - {offender_name} (Unit {offender_unit}, plate: {plate}) "
                    f"parked in {reporter_name}'s spot (Unit {reporter_unit}).\n"
                    f"{offender_name}'s cell: {offender_user.phone or 'N/A'}\n"
                    f"{reporter_name}'s cell: {self.user.phone or 'N/A'}\n"
                    f"A violation notice has been created and emailed to the tenant. "
                    f"Review this violation in your portal to dismiss or issue a fine."
                )
                self.create_notification(
                    landlord.id, "sms", landlord_msg,
                    phone=landlord.phone
                )
                actions.append({
                    "type": "sms_landlord",
                    "to": landlord.phone,
                    "to_name": f"{landlord.first_name} {landlord.last_name}",
                    "message": landlord_msg
                })

            response = (
                f"Got it! I found that plate number **{plate}** — it belongs to "
                f"**{offender_name}** in Unit {offender_unit}.\n\n"
                f"Here's what I've done:\n"
                f"- Sent {offender_user.first_name} a notification to move their vehicle immediately\n"
                f"- Emailed a violation notice to {offender_user.first_name}\n"
                f"- Notified your property manager about the complaint\n"
                f"- Created a violation record for landlord review\n\n"
                f"Your property manager will review the violation and decide whether to issue a fine. "
                f"Is there anything else I can help with?"
            )
        else:
            # Plate not found — still log it
            complaint = ParkingComplaint(
                reporter_tenant_id=self.tenant_profile.id,
                property_id=self.property.id,
                offending_plate=plate,
                status="open"
            )
            self.db.add(complaint)
            self.db.commit()
            self.db.refresh(complaint)

            # Create violation without tenant (unregistered vehicle)
            reporter_name = f"{self.user.first_name} {self.user.last_name}"
            violation_desc = (
                f"Parking violation: Unregistered vehicle (plate: {plate}) "
                f"parked in {reporter_name}'s assigned spot (Unit {self.unit.unit_number if self.unit else 'N/A'})."
            )
            violation = Violation(
                property_id=self.property.id,
                tenant_profile_id=None,
                parking_complaint_id=complaint.id,
                type="parking",
                description=violation_desc,
                status="pending",
            )
            self.db.add(violation)
            self.db.commit()

            landlord = self.db.query(User).filter(User.id == self.property.landlord_id).first()
            if landlord:
                landlord_msg = (
                    f"Parking Violation (Pending Review) - Unregistered vehicle (plate: {plate}) "
                    f"parked in {reporter_name}'s spot (Unit {self.unit.unit_number if self.unit else 'N/A'}).\n"
                    f"{reporter_name}'s cell: {self.user.phone or 'N/A'}"
                )
                self.create_notification(
                    landlord.id, "sms", landlord_msg,
                    phone=landlord.phone
                )
                actions.append({
                    "type": "sms_landlord",
                    "to": landlord.phone,
                    "message": landlord_msg
                })

            response = (
                f"I couldn't find plate **{plate}** registered to any tenant in your property. "
                f"This might be a visitor or unregistered vehicle.\n\n"
                f"I've notified your property manager and created a violation record. "
                f"They'll look into it and take action. Is there anything else you need?"
            )

        self.save_message("assistant", response, "parking_resolved")
        return {"response": response, "actions": actions, "intent": "parking_plate_response"}

    def process_plate_response(self, plate: str) -> dict:
        """Process a plate number response in parking context."""
        self.save_message("user", plate, "parking_plate_response")
        return self._handle_parking_plate(plate, [])


class StacyLandlordAssistant:
    """Stacy assistant for landlord-side operations."""

    def __init__(self, db: Session, user: User):
        self.db = db
        self.user = user

    def process_message(self, message: str) -> dict:
        """Process landlord messages."""
        msg = message.lower().strip()

        # Save message
        chat_msg = ChatMessage(
            user_id=self.user.id,
            role="user",
            content=message,
            intent="landlord_query"
        )
        self.db.add(chat_msg)
        self.db.commit()

        # Get stats
        properties = self.db.query(Property).filter(Property.landlord_id == self.user.id).all()
        open_maintenance = 0
        open_parking = 0
        total_tenants = 0
        pending_violations = 0

        for prop in properties:
            open_maintenance += self.db.query(MaintenanceRequest).filter(
                MaintenanceRequest.property_id == prop.id,
                MaintenanceRequest.status.in_(["open", "in_progress"])
            ).count()
            open_parking += self.db.query(ParkingComplaint).filter(
                ParkingComplaint.property_id == prop.id,
                ParkingComplaint.status.in_(["open", "notified"])
            ).count()
            total_tenants += self.db.query(TenantProfile).filter(
                TenantProfile.property_id == prop.id,
                TenantProfile.is_active == True
            ).count()
            pending_violations += self.db.query(Violation).filter(
                Violation.property_id == prop.id,
                Violation.status == "pending"
            ).count()

        response = (
            f"Hi {self.user.first_name}! Here's your property overview:\n\n"
            f"- **Properties:** {len(properties)}\n"
            f"- **Total Tenants:** {total_tenants}\n"
            f"- **Open Maintenance Requests:** {open_maintenance}\n"
            f"- **Open Parking Complaints:** {open_parking}\n"
            f"- **Pending Violations:** {pending_violations}\n\n"
            f"What would you like to do?"
        )

        resp_msg = ChatMessage(
            user_id=self.user.id,
            role="assistant",
            content=response,
            intent="landlord_overview"
        )
        self.db.add(resp_msg)
        self.db.commit()

        return {"response": response, "actions": [], "intent": "landlord_overview"}
