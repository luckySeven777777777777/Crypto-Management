Realtime Database (RTDB) Structure - NEXBIT (recommended)

Top-level nodes:

/users/{uid}/
  - userid: string
  - created: timestamp (ms)
  - updated: timestamp (ms)
  - balance: number
  - lastUpdate: timestamp (ms)

/orders/{type}/{orderId}/
  - orderId: string
  - userId: string
  - amount: number
  - timestamp: number (ms)
  - time_us: string
  - status: string (pending/confirmed/cancelled)
  - ... other metadata

/recharge/  (optional mirror)
/withdraw/  (optional mirror)
/transactions/  (optional)

Notes:
- Strikingly widget should call POST /api/users/sync to ensure user exists in RTDB.
- Widget queries GET /api/balance/:uid to show balance.
- Administrative tools should update /users/{uid}/balance when performing top-ups or withdrawals.
- Orders should be saved under /orders/{type}/{orderId} using the provided endpoints.
