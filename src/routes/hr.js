const express = require("express");
const { query } = require("../db/pool");
const { authRequired } = require("../middleware/auth");
const { requireRole } = require("../middleware/rbac");
const { httpError } = require("../utils/httpError");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authRequired, requireRole("HR"));



// ---------------- HR Department list & members ----------------
router.get("/departments", asyncHandler(async (req, res) => {
  const r = await query("SELECT id, name FROM departments ORDER BY name ASC");
  res.json({ ok: true, departments: r.rows });
}));

router.get("/departments/:id/members", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw httpError(400, "Invalid department id");

  const r = await query(
    `SELECT 
        e.emp_no,
        e.full_name AS name,
        COALESCE(rt.route_name,'') AS route_name,
        COALESCE(sr.sub_name,'') AS sub_route_name
     FROM employees e
     LEFT JOIN routes rt ON rt.id = e.default_route_id
     LEFT JOIN sub_routes sr ON sr.id = e.default_sub_route_id
     WHERE e.department_id = $1
     ORDER BY e.emp_no ASC, e.full_name ASC`,
    [id]
  );

  res.json({ ok: true, members: r.rows });
}));
// --------------------------------------------------------------

router.get("/requests/ta-assigned", asyncHandler(async (req, res) => {
  const r = await query(
    "SELECT tr.*, 'සියලු දෙපාර්තමේන්තු' as department_name FROM transport_requests tr WHERE tr.is_daily_master=TRUE AND tr.status IN ('TA_ASSIGNED','TA_ASSIGNED_PENDING_HR') ORDER BY tr.request_date DESC, tr.created_at DESC LIMIT 50"
  );
  res.json({ ok: true, requests: r.rows });
}));


// Overbook override approval (vehicle capacity +1/+2) - HR gate
router.post("/requests/:id/overbook/approve", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const userId = req.user.user_id;

  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [id]);
  if (r.rowCount === 0) throw httpError(404, "ඉල්ලීම හමු නොවීය");
  if (r.rows[0].status !== "TA_ASSIGNED_PENDING_HR") throw httpError(400, "ඔවරයිඩ් අනුමැතිය අවශ්‍ය ඉල්ලීමක් නොවේ");

  await query("UPDATE request_assignments SET overbook_status='APPROVED' WHERE request_id=$1 AND COALESCE(overbook_amount,0) > 0", [id]);
  await query("UPDATE transport_requests SET status='TA_ASSIGNED' WHERE id=$1", [id]);
  await query("INSERT INTO approvals_audit (request_id, action_by_user_id, action) VALUES ($1,$2,'HR_OVERBOOK_APPROVE')", [id, userId]);

  res.json({ ok: true });
}));

router.post("/requests/:id/overbook/reject", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const userId = req.user.user_id;

  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [id]);
  if (r.rowCount === 0) throw httpError(404, "ඉල්ලීම හමු නොවීය");
  if (r.rows[0].status !== "TA_ASSIGNED_PENDING_HR") throw httpError(400, "ඔවරයිඩ් ප්‍රතික්ෂේප කළ හැක්කේ Pending HR ඉල්ලීම් සඳහා පමණයි");

  await query("UPDATE request_assignments SET overbook_status='REJECTED' WHERE request_id=$1 AND COALESCE(overbook_amount,0) > 0", [id]);
  await query("UPDATE transport_requests SET status='TA_FIX_REQUIRED' WHERE id=$1", [id]);
  await query("INSERT INTO approvals_audit (request_id, action_by_user_id, action) VALUES ($1,$2,'HR_OVERBOOK_REJECT')", [id, userId]);

  res.json({ ok: true, needs_fix: true });
}));


router.post("/requests/:id/final-approve", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const userId = req.user.user_id;

  const r = await query("SELECT status FROM transport_requests WHERE id=$1", [id]);
  if (r.rowCount === 0) throw httpError(404, "ඉල්ලීම හමු නොවීය");
  if (r.rows[0].status !== "TA_ASSIGNED") throw httpError(400, "අවසාන අනුමැතිය දිය හැක්කේ TA_ASSIGNED ඉල්ලීම් සඳහා පමණයි (ඔවරයිඩ් Pending නම් පළමුව අනුමත/ප්‍රතික්ෂේප කරන්න)");

  await query("UPDATE transport_requests SET status='HR_FINAL_APPROVED' WHERE id=$1", [id]);
  await query("INSERT INTO approvals_audit (request_id, action_by_user_id, action) VALUES ($1,$2,'HR_FINAL_APPROVE')", [id, userId]);

  res.json({ ok: true });
}));

module.exports = router;
