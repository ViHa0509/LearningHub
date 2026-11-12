from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.auth.passwords import MAX_LENGTH

Password = Annotated[str, Field(max_length=MAX_LENGTH)]
Email = Annotated[str, Field(max_length=320)]
Token = Annotated[str, Field(max_length=200)]


class ProviderStatus(BaseModel):
    configured: bool


class MailStatus(BaseModel):
    mode: Literal["smtp", "outbox"]


class AuthStatus(BaseModel):
    auth_required: bool
    has_owner: bool
    providers: dict[str, ProviderStatus]
    mail: MailStatus
    # The largest file the server takes; the app checks it before sending.
    max_upload_bytes: int


class MeOut(BaseModel):
    id: UUID
    email: str
    email_verified: bool
    role: str
    display_name: str | None
    bio: str | None
    avatar_url: str | None
    has_password: bool
    linked: list[str]


class SignupIn(BaseModel):
    email: Email
    password: Password
    display_name: str | None = Field(default=None, max_length=200)


class LoginIn(BaseModel):
    email: Email
    password: Password


class PasswordChangeIn(BaseModel):
    current: str = Field(default="", max_length=MAX_LENGTH)
    new: Password


class EmailIn(BaseModel):
    email: Email


class TokenIn(BaseModel):
    token: Token


class ResetIn(BaseModel):
    token: Token
    password: Password


class InvitationInfo(BaseModel):
    email: str
    expires_at: datetime


class AcceptIn(BaseModel):
    token: Token
    password: Password
    display_name: str | None = Field(default=None, max_length=200)


class MessageOut(BaseModel):
    message: str


class VerifiedOut(BaseModel):
    email_verified: bool


class SessionOut(BaseModel):
    id: UUID
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    user_agent: str | None
    ip: str | None
    current: bool


class RevokedOut(BaseModel):
    revoked: int
