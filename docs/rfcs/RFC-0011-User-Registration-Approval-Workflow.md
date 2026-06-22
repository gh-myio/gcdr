# RFC-0011: User Registration and Approval Workflow

- **Status**: Implemented (MVP)
- **Created**: 2026-01-28
- **Author**: GCDR Team

## Summary

This RFC proposes a comprehensive user registration system with email verification, approval workflow, and account security features including automatic lockout after failed login attempts.

## Motivation

The current system lacks self-service user registration capabilities. New users must be created by administrators, which creates friction and doesn't scale well. Additionally, proper security measures for account lockout and email verification are needed to protect the system from unauthorized access.

### Current Pain Points

1. **No Self-Registration**: Users cannot create their own accounts
2. **No Email Verification**: Email addresses are not verified before account activation
3. **Limited Account States**: Current states don't support approval workflows
4. **No Automatic Lockout**: Failed login attempts don't trigger automatic account lockout
5. **No Password Reset Flow**: Password reset is not fully implemented

## Guide-level Explanation

### User Lifecycle States

The new user lifecycle consists of five states:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER LIFECYCLE STATES                              │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐      Email        ┌──────────────────┐     Admin      ┌─────────┐
  │ UNVERIFIED   │ ────Verified────► │ PENDING_APPROVAL │ ───Approves──► │ ACTIVE  │
  │              │      (6-digit)     │                  │                │         │
  └──────────────┘                    └──────────────────┘                └─────────┘
         │                                   │                                │
         │                                   │                                │
         │ Code Expired/                     │ Admin                          │ 6 Failed
         │ Invalid                           │ Rejects                        │ Logins
         ▼                                   ▼                                ▼
  ┌──────────────┐                    ┌──────────────┐                 ┌──────────┐
  │   DELETED    │                    │   INACTIVE   │                 │  LOCKED  │
  │ (auto-purge) │                    │              │                 │          │
  └──────────────┘                    └──────────────┘                 └──────────┘
                                             ▲                                │
                                             │                                │
                                             │ Admin                          │ Password
                                             │ Deactivates                    │ Reset
                                             │                                ▼
                                      ┌──────────────┐                 ┌──────────┐
                                      │    ACTIVE    │ ◄──────────────│  ACTIVE  │
                                      │              │   (unlocked)    │          │
                                      └──────────────┘                 └──────────┘
```

### State Descriptions

| State | Description | Transitions |
|-------|-------------|-------------|
| `UNVERIFIED` | New registration, email not verified | → PENDING_APPROVAL (verify email) |
| `PENDING_APPROVAL` | Email verified, awaiting admin approval | → ACTIVE (approve), → INACTIVE (reject) |
| `ACTIVE` | Fully active user | → INACTIVE (deactivate), → LOCKED (6 failed logins) |
| `INACTIVE` | Deactivated by admin or rejected | → ACTIVE (reactivate) |
| `LOCKED` | Locked due to failed login attempts | → ACTIVE (admin unlock or password reset) |

### Registration Flow

1. **User submits registration** with email, password, name
2. **System creates user** with status `UNVERIFIED`
3. **System sends 6-digit code** to email (valid for 15 minutes)
4. **User enters code** to verify email
5. **Status changes** to `PENDING_APPROVAL`
6. **Admin receives notification** of pending user
7. **Admin approves/rejects** the registration
8. **User notified** of approval decision

### Account Lockout Flow

1. **User attempts login** with wrong password
2. **Failed attempt counter** increments
3. **After 6 failures**, account status changes to `LOCKED`
4. **To unlock**, user must either:
   - Request admin to unlock manually, OR
   - Use password reset flow (receives 6-digit code, resets password)
5. **On successful unlock**, account returns to `ACTIVE`

### Password Reset Flow

1. **User requests password reset** with email
2. **System sends 6-digit code** to email (valid for 15 minutes)
3. **User enters code** and new password
4. **Password is updated**, failed attempts reset to 0
5. **If account was LOCKED**, status changes to `ACTIVE`

## Reference-level Explanation

### Database Schema Changes

#### User Status Enum Update

```sql
-- Update user_status enum to include new states
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'UNVERIFIED' BEFORE 'ACTIVE';
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL' AFTER 'UNVERIFIED';
ALTER TYPE user_status RENAME VALUE 'SUSPENDED' TO 'LOCKED';

-- Final enum values:
-- UNVERIFIED, PENDING_APPROVAL, ACTIVE, INACTIVE, LOCKED
```

#### Verification Tokens Table

```sql
CREATE TYPE verification_token_type AS ENUM (
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'ACCOUNT_UNLOCK'
);

CREATE TABLE verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Token data
  token_type verification_token_type NOT NULL,
  code_hash VARCHAR(64) NOT NULL,  -- SHA256 hash of 6-digit code

  -- Expiration
  expires_at TIMESTAMPTZ NOT NULL,

  -- Usage tracking
  used_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,

  -- Metadata
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_attempts CHECK (attempts <= max_attempts)
);

-- Indexes
CREATE INDEX idx_verification_tokens_user ON verification_tokens(user_id);
CREATE INDEX idx_verification_tokens_type ON verification_tokens(token_type);
CREATE INDEX idx_verification_tokens_expires ON verification_tokens(expires_at)
  WHERE used_at IS NULL;

-- Unique constraint: only one active token per user per type
CREATE UNIQUE INDEX idx_verification_tokens_active
  ON verification_tokens(user_id, token_type)
  WHERE used_at IS NULL AND expires_at > NOW();
```

#### User Security JSONB Schema Update

```typescript
interface UserSecurity {
  // Existing fields
  passwordHash?: string;
  mfaEnabled: boolean;
  mfaMethod?: 'totp' | 'sms' | 'email';
  mfaSecret?: string;
  mfaBackupCodes?: string[];

  // New fields for RFC-0011
  failedLoginAttempts: number;           // Counter for failed logins
  lastFailedLoginAt?: string;            // Timestamp of last failed attempt
  lockedAt?: string;                     // When account was locked
  lockedReason?: string;                 // Reason for lockout
  lockoutCount: number;                  // How many times account has been locked

  // Registration tracking
  registeredAt?: string;                 // Self-registration timestamp
  registrationIp?: string;               // IP used during registration
  emailVerifiedAt?: string;              // When email was verified
  approvedAt?: string;                   // When admin approved
  approvedBy?: string;                   // Admin who approved
  rejectedAt?: string;                   // When admin rejected
  rejectedBy?: string;                   // Admin who rejected
  rejectionReason?: string;              // Reason for rejection
}
```

### API Endpoints

#### 1. User Registration

```http
POST /auth/register
Content-Type: application/json
X-Tenant-Id: {tenant_id}

{
  "email": "user@example.com",
  "password": "SecureP@ss123",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+5511999999999",
  "customerId": "uuid-optional"  // Optional: associate with customer
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "email": "user@example.com",
    "status": "UNVERIFIED",
    "message": "Verification code sent to email",
    "expiresIn": 900
  }
}
```

**Validation Rules:**
- Email: Valid format, unique per tenant
- Password: Min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
- Name: Min 2 chars each

#### 2. Email Verification

```http
POST /auth/verify-email
Content-Type: application/json
X-Tenant-Id: {tenant_id}

{
  "email": "user@example.com",
  "code": "123456"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "status": "PENDING_APPROVAL",
    "message": "Email verified. Your registration is pending approval."
  }
}
```

**Error Responses:**
- 400: Invalid code format
- 401: Code expired or invalid
- 429: Too many attempts (max 5)

#### 3. Resend Verification Code

```http
POST /auth/resend-verification
Content-Type: application/json
X-Tenant-Id: {tenant_id}

{
  "email": "user@example.com"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "If the email exists and is unverified, a new code has been sent",
    "expiresIn": 900
  }
}
```

**Rate Limiting:**
- Max 3 resends per hour per email

#### 4. Password Reset Request

```http
POST /auth/forgot-password
Content-Type: application/json
X-Tenant-Id: {tenant_id}

{
  "email": "user@example.com"
}
```

**Response (200 OK - always, to prevent enumeration):**
```json
{
  "success": true,
  "data": {
    "message": "If the email exists, a reset code has been sent",
    "expiresIn": 900
  }
}
```

#### 5. Password Reset Confirmation

```http
POST /auth/reset-password
Content-Type: application/json
X-Tenant-Id: {tenant_id}

{
  "email": "user@example.com",
  "code": "123456",
  "newPassword": "NewSecureP@ss456"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Password reset successfully",
    "unlocked": true  // If account was locked, now unlocked
  }
}
```

#### 6. Admin: List Pending Approvals

```http
GET /admin/users/pending-approval
Authorization: Bearer {token}
X-Tenant-Id: {tenant_id}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "firstName": "John",
        "lastName": "Doe",
        "registeredAt": "2026-01-28T10:00:00Z",
        "emailVerifiedAt": "2026-01-28T10:05:00Z",
        "registrationIp": "192.168.1.1"
      }
    ],
    "total": 1
  }
}
```

#### 7. Admin: Approve User

```http
POST /admin/users/{userId}/approve
Authorization: Bearer {token}
X-Tenant-Id: {tenant_id}

{
  "assignRoles": ["viewer"],
  "customerId": "uuid-optional"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "status": "ACTIVE",
    "message": "User approved successfully"
  }
}
```

#### 8. Admin: Reject User

```http
POST /admin/users/{userId}/reject
Authorization: Bearer {token}
X-Tenant-Id: {tenant_id}

{
  "reason": "Unable to verify company affiliation"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "status": "INACTIVE",
    "message": "User registration rejected"
  }
}
```

#### 9. Admin: Unlock User

```http
POST /admin/users/{userId}/unlock
Authorization: Bearer {token}
X-Tenant-Id: {tenant_id}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "status": "ACTIVE",
    "failedLoginAttempts": 0,
    "message": "User account unlocked"
  }
}
```

### Login Flow Updates

```typescript
async login(tenantId: string, email: string, password: string, ...): Promise<LoginResponse> {
  const user = await this.userService.getByEmail(tenantId, email);

  // Check user status
  switch (user.status) {
    case 'UNVERIFIED':
      throw new UnauthorizedError('Please verify your email before logging in');

    case 'PENDING_APPROVAL':
      throw new UnauthorizedError('Your registration is pending approval');

    case 'INACTIVE':
      throw new UnauthorizedError('Your account has been deactivated');

    case 'LOCKED':
      throw new UnauthorizedError(
        'Your account is locked. Please reset your password or contact support.'
      );

    case 'ACTIVE':
      // Continue with login
      break;
  }

  // Verify password
  if (!verifyPassword(password, user.security.passwordHash)) {
    // Increment failed attempts
    const attempts = await this.incrementFailedAttempts(tenantId, user.id);

    if (attempts >= 6) {
      // Lock account
      await this.lockAccount(tenantId, user.id, 'Too many failed login attempts');
      throw new UnauthorizedError(
        'Account locked due to too many failed attempts. Please reset your password.'
      );
    }

    throw new UnauthorizedError(`Invalid credentials. ${6 - attempts} attempts remaining.`);
  }

  // Reset failed attempts on successful login
  await this.resetFailedAttempts(tenantId, user.id);

  // Continue with normal login flow...
}
```

### Verification Code Generation

```typescript
function generateVerificationCode(): string {
  // Generate cryptographically secure 6-digit code
  const buffer = crypto.randomBytes(4);
  const number = buffer.readUInt32BE(0) % 1000000;
  return number.toString().padStart(6, '0');
}

function hashVerificationCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}
```

### Email Templates

#### Email Verification

```
Subject: Verify your GCDR account

Hello {firstName},

Thank you for registering with GCDR. Please verify your email address by entering the following code:

{code}

This code expires in 15 minutes.

If you did not create an account, please ignore this email.

Best regards,
GCDR Team
```

#### Password Reset

```
Subject: Reset your GCDR password

Hello {firstName},

We received a request to reset your password. Enter the following code to proceed:

{code}

This code expires in 15 minutes.

If you did not request a password reset, please ignore this email and ensure your account is secure.

Best regards,
GCDR Team
```

#### Registration Approved

```
Subject: Your GCDR registration has been approved

Hello {firstName},

Great news! Your registration request has been approved.

You can now log in to GCDR at: {loginUrl}

Best regards,
GCDR Team
```

#### Registration Rejected

```
Subject: Your GCDR registration status

Hello {firstName},

We regret to inform you that your registration request has not been approved.

Reason: {rejectionReason}

If you have questions, please contact support.

Best regards,
GCDR Team
```

### Configuration Options

```typescript
interface RegistrationConfig {
  // Email verification
  verificationCodeExpiry: number;        // Default: 900 (15 minutes)
  maxVerificationAttempts: number;       // Default: 5
  maxResendPerHour: number;              // Default: 3

  // Account lockout
  maxFailedLoginAttempts: number;        // Default: 6
  lockoutDuration: number | null;        // null = permanent until reset

  // Registration
  requireApproval: boolean;              // Default: true
  allowedEmailDomains: string[] | null;  // null = any domain

  // Cleanup
  unverifiedPurgeDays: number;           // Default: 7
  expiredTokenPurgeDays: number;         // Default: 1
}
```

### Audit Events

| Event Type | Description |
|------------|-------------|
| `USER_REGISTERED` | New user self-registration |
| `USER_EMAIL_VERIFIED` | Email verification successful |
| `USER_VERIFICATION_FAILED` | Email verification failed |
| `USER_APPROVED` | Admin approved registration |
| `USER_REJECTED` | Admin rejected registration |
| `USER_LOCKED` | Account locked due to failed attempts |
| `USER_UNLOCKED` | Account unlocked by admin |
| `USER_PASSWORD_RESET_REQUESTED` | Password reset initiated |
| `USER_PASSWORD_RESET_COMPLETED` | Password reset successful |

### Security Considerations

1. **Rate Limiting**: All verification endpoints rate-limited
2. **Code Security**: 6-digit codes with max attempts prevent brute force
3. **Hash Storage**: Codes stored as SHA-256 hashes
4. **No Enumeration**: Consistent responses prevent email enumeration
5. **Audit Trail**: All actions logged for security review
6. **Token Expiry**: Short-lived tokens (15 min) reduce attack window
7. **IP Logging**: Registration and verification IPs tracked

## Drawbacks

1. **Increased Complexity**: More states and flows to manage
2. **Admin Overhead**: Manual approval required for each user
3. **Email Dependency**: Requires reliable email delivery

## Rationale and Alternatives

### Why Manual Approval?

- **Security**: Prevents unauthorized access to sensitive systems
- **Quality Control**: Ensures only legitimate users gain access
- **Compliance**: Meets enterprise security requirements

### Alternatives Considered

1. **Auto-approval with email verification only**
   - Rejected: Doesn't meet enterprise security requirements

2. **Invitation-only registration**
   - Partial adoption: Can be combined with this system

3. **OAuth/SSO only**
   - Partial adoption: Can be added alongside this system

## Implementation Checklist

### Phase 1: Database Schema
- [ ] Update user_status enum
- [ ] Create verification_tokens table
- [ ] Update user security JSONB schema
- [ ] Create Drizzle migrations

### Phase 2: Core Services
- [ ] Implement VerificationTokenService
- [ ] Update AuthService with new login checks
- [ ] Implement account lockout logic
- [ ] Implement failed attempts tracking

### Phase 3: Registration Endpoints
- [ ] POST /auth/register
- [ ] POST /auth/verify-email
- [ ] POST /auth/resend-verification

### Phase 4: Password Reset
- [ ] Update POST /auth/forgot-password
- [ ] Update POST /auth/reset-password

### Phase 5: Admin Endpoints
- [ ] GET /admin/users/pending-approval
- [ ] POST /admin/users/:id/approve
- [ ] POST /admin/users/:id/reject
- [ ] POST /admin/users/:id/unlock

### Phase 6: Email Integration
- [ ] Create email templates
- [ ] Integrate with email service
- [ ] Add email queue for reliability

### Phase 7: Observability
- [ ] Add audit events
- [ ] Add metrics
- [ ] Add alerts for suspicious activity

### Phase 8: Testing
- [ ] Unit tests for services
- [ ] Integration tests for endpoints
- [ ] E2E tests for complete flows

## Future Enhancements

1. **Auto-approval rules**: Approve users from specific domains automatically
2. **Bulk approval**: Admin can approve multiple users at once
3. **Invitation links**: Generate invitation links that bypass approval
4. **SSO integration**: Allow OAuth providers (Google, Microsoft)
5. **Temporary lockout**: Auto-unlock after configurable duration
