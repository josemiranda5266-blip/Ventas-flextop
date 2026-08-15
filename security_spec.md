# Security Specification: POS Argentina

## 1. Data Invariants
- A **Business** can only be created by its administrators. No external user can access or write a business's private configuration.
- All documents inside `/businesses/{businessId}/...` must strictly enforce that the authenticated user's profile belongs to the same `businessId`.
- A user cannot modify their own role (privilege escalation protection). Only an existing user with the `ADMINISTRADOR` role in that same business can modify other users' roles.
- Stock changes must always generate a valid `StockMovement` (enforced at the application level and audited).
- A Sale cannot be modified or deleted after its status is marked `COMPLETED` or `REFUNDED` (terminal state locking).
- Timestamps such as `createdAt` and `updatedAt` must match the server's request time exactly.

---

## 2. The "Dirty Dozen" Payloads (Vulnerability Vector Simulation)

1. **Identity Spoofing: Creating user profile with arbitrary business ID**
   - *Attempt:* User `attacker_uid` tries to write a profile under `/businesses/legit_business/users/attacker_uid` but sets `businessId: 'other_business'`.
   - *Result:* `PERMISSION_DENIED` (enforced by checking path matching and user profile constraints).

2. **Privilege Escalation: User self-promoting to ADMINISTRADOR**
   - *Attempt:* Cajero `cajero_1` tries to update `/businesses/b1/users/cajero_1` setting `role: 'ADMINISTRADOR'`.
   - *Result:* `PERMISSION_DENIED` (only admins can modify roles).

3. **Cross-Tenant Reading: Accessing another business's products**
   - *Attempt:* Authenticated user in business `b1` queries products under `/businesses/b2/products`.
   - *Result:* `PERMISSION_DENIED` (each business path is isolated by checking `businessId` associated with user).

4. **Resource Poisoning: Injecting 2MB string as Category ID**
   - *Attempt:* Creating category with ID `A_very_very_long_string_designed_to_bloat_database_indexes_and_cause_denial_of_wallet...`
   - *Result:* `PERMISSION_DENIED` (ID length restricted by `isValidId()`).

5. **State Shortcutting: Rewriting a Completed Sale's total to $0**
   - *Attempt:* Changing a sale from 2026 under `/businesses/b1/sales/sale123` with status `COMPLETED` by sending `total: 0`.
   - *Result:* `PERMISSION_DENIED` (completed sales are locked).

6. **Temporal Spoofing: Forging custom client timestamp in stock movement**
   - *Attempt:* Writing a stock movement with `createdAt` set to a future date `2027-01-01`.
   - *Result:* `PERMISSION_DENIED` (must use `request.time`).

7. **Email Spoofing: Bypassing auth with unverified email**
   - *Attempt:* Accessing admin endpoints while logged in with a fake email where `email_verified` is `false`.
   - *Result:* `PERMISSION_DENIED` (verification required for critical operations).

8. **Shadow Field Injection: Adding `isSuperAdmin: true` to a user**
   - *Attempt:* Updating a user with unallowlisted attributes.
   - *Result:* `PERMISSION_DENIED` (enforced by `hasOnly()` on affected keys).

9. **Double-Spend/Replay: Modifying a completed cash session expected cash**
   - *Attempt:* Altering the cash session `/businesses/b1/branches/br1/cash_sessions/s1` which is in `CLOSED` status.
   - *Result:* `PERMISSION_DENIED` (closed sessions are immutable).

10. **PII Exfiltration: Blanket query on all customers**
    - *Attempt:* Unauthenticated or cross-tenant query on `/businesses/{any}/customers`.
    - *Result:* `PERMISSION_DENIED`.

11. **Orphaned Writes: Creating a SaleItem with nonexistent Sale**
    - *Attempt:* Attempting to write a sale item under a randomly generated sale ID path.
    - *Result:* `PERMISSION_DENIED`.

12. **Malicious Price Manipulation: Modifying product prices during sale creation**
    - *Attempt:* Creating a sale item with custom subtotal and price mismatching the true catalog product price.
    - *Result:* Prevented by validation rules in application backend and double-checked during fiscalization.

---

## 3. Test Runner Specification
The application code and unit tests will run within AI Studio verifying these security models. Below is the fortress rule set designed to reject these payloads.
