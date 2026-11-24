const { Staff, Admin, Volunteer, Evaluation, Round, Transaction, Question } = require('../models');
const { ORGANIZER_LOCATIONS } = require('../constants');
const { signAdminToken } = require('../middleware/authMiddleware');
const {
  parsePaginationQuery,
  buildPaginationMeta,
  escapeRegex,
  formatVolunteerResponse,
  isValidObjectId,
} = require('../utils');

/**
 * Format Admin document for API responses, ensuring passwordHash is excluded.
 */
const formatAdminResponse = (admin) => ({
  id: admin._id.toString(),
  name: admin.name,
  username: admin.username,
  role: 'ADMIN',
  isActive: admin.isActive,
  createdAt: admin.createdAt,
  updatedAt: admin.updatedAt,
});

const USERNAME_REGEX = /^[a-z0-9_.-]+$/i;

const ORGANIZER_LOCATION_MESSAGE = `Location must be one of: ${ORGANIZER_LOCATIONS.join(', ')}.`;

// Match a location against the three event spots, case-insensitively, and
// return the canonical spelling; null when the value is not a valid spot.
const resolveOrganizerLocation = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const lowered = trimmed.toLowerCase();
  return ORGANIZER_LOCATIONS.find((location) => location.toLowerCase() === lowered) || null;
};

// Shared per-row validation for single and bulk organizer creation.
// Returns { ok: true, cleaned } or { ok: false, code, message }.
const validateVolunteerRow = (row) => {
  const name = typeof row?.name === 'string' ? row.name.trim() : '';
  if (name.length < 2) {
    return { ok: false, code: 'INVALID_NAME', message: 'Organizer name needs at least 2 letters.' };
  }
  const username = typeof row?.username === 'string' ? row.username.trim().toLowerCase() : '';
  if (username.length < 3) {
    return { ok: false, code: 'INVALID_USERNAME', message: 'Username needs at least 3 letters.' };
  }
  if (!USERNAME_REGEX.test(username)) {
    return { ok: false, code: 'INVALID_USERNAME_FORMAT', message: 'Username can only have letters, numbers, _, . and -.' };
  }
  if (!row || typeof row.password !== 'string' || row.password.length === 0) {
    return { ok: false, code: 'WEAK_PASSWORD', message: 'Password is required.' };
  }
  const assignedLab = resolveOrganizerLocation(row.assignedLab);
  if (!assignedLab) {
    return { ok: false, code: 'INVALID_ASSIGNED_LAB', message: ORGANIZER_LOCATION_MESSAGE };
  }
  return { ok: true, cleaned: { name, username, password: row.password, assignedLab } };
};

const MAX_BULK_VOLUNTEERS = 50;

/**
 * Admin Login Controller
 * Endpoint: POST /api/admin/login (also mounted at /api/auth/admin/login)
 * Access: Public
 */
const adminLogin = async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || typeof username !== 'string' || username.trim() === '' ||
      !password || typeof password !== 'string' || password === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_CREDENTIALS',
        message: 'Username and password are required.',
      });
    }

    const normalizedUsername = username.trim().toLowerCase();

    const admin = await Admin.findOne({
      username: normalizedUsername,
    });

    // 3. Generic authentication failure to prevent username enumeration
    if (!admin) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password.',
      });
    }

    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_DEACTIVATED',
        message: 'Admin account is switched off.',
      });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password.',
      });
    }

    const token = signAdminToken(admin._id);

    return res.status(200).json({
      success: true,
      message: 'Admin signed in.',
      token,
      admin: formatAdminResponse(admin),
    });
  } catch (error) {
    console.error('Admin login error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong while signing in. Please try again.',
    });
  }
};

/**
 * Get current authenticated Admin profile
 * Endpoint: GET /api/admin/me
 * Access: Protected (Admin only)
 */
const getAdminMe = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      admin: formatAdminResponse(req.admin),
    });
  } catch (error) {
    console.error('getAdminMe error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Could not load the admin profile.',
    });
  }
};

/**
 * Create Volunteer Account
 * Endpoint: POST /api/admin/volunteers
 * Access: Protected (Admin only)
 */
const createVolunteer = async (req, res) => {
  try {
    const body = req.body || {};

    const allowedFields = ['name', 'username', 'password', 'assignedLab'];
    const extraFields = Object.keys(body).filter((key) => !allowedFields.includes(key));
    if (extraFields.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'UNSUPPORTED_FIELDS',
        message: `This request has fields we do not use: ${extraFields.join(', ')}.`,
      });
    }

    const validation = validateVolunteerRow(body);
    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        code: validation.code,
        message: validation.message,
      });
    }

    const { name, username, password, assignedLab } = validation.cleaned;

    const existingStaff = await Staff.findOne({ username });
    if (existingStaff) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_USERNAME',
        message: 'An account with this username already exists.',
      });
    }

    // Organizer passwords are stored as plain text by the event team's
    // decision (the admin account stays bcrypt-hashed). Login accepts both
    // formats via Staff.comparePassword, so pre-existing hashed organizer
    // rows keep working with no migration.
    const volunteer = new Volunteer({
      name,
      username,
      passwordHash: password,
      role: 'VOLUNTEER',
      isActive: true,
      assignedLab,
    });

    await volunteer.save();

    return res.status(201).json({
      success: true,
      message: 'Organizer account added.',
      volunteer: formatVolunteerResponse(volunteer),
    });
  } catch (error) {
    console.error('Create volunteer error:', error.message);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_USERNAME',
        message: 'An account with this username already exists.',
      });
    }
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not add the organizer account.',
    });
  }
};

/**
 * Bulk Create Volunteer Accounts
 * Endpoint: POST /api/admin/volunteers/bulk
 * Access: Protected (Admin only)
 *
 * Accepts { volunteers: [{ name, username, password, assignedLab }, ...] }
 * (max 50 rows). Each row is validated with the same rules as single
 * creation; valid rows are created, invalid ones are skipped, and the
 * response reports every row's outcome. Existing accounts are never
 * overwritten.
 */
const createVolunteersBulk = async (req, res) => {
  try {
    const rows = req.body?.volunteers;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_BULK_PAYLOAD',
        message: 'Give at least one organizer.',
      });
    }
    if (rows.length > MAX_BULK_VOLUNTEERS) {
      return res.status(400).json({
        success: false,
        code: 'BULK_LIMIT_EXCEEDED',
        message: `Bulk add is limited to ${MAX_BULK_VOLUNTEERS} organizers per request.`,
      });
    }

    // One lookup for every username in the batch, so duplicates against
    // existing accounts are caught without a query per row.
    const batchUsernames = rows
      .map((row) => (typeof row?.username === 'string' ? row.username.trim().toLowerCase() : ''))
      .filter((username) => username !== '');
    const taken = new Set(
      (await Staff.find({ username: { $in: batchUsernames } }, 'username').lean()).map(
        (doc) => doc.username
      )
    );

    const results = [];
    let createdCount = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const displayUsername = typeof row?.username === 'string' ? row.username.trim() : '';
      const validation = validateVolunteerRow(row);
      if (!validation.ok) {
        results.push({ index, username: displayUsername, status: 'skipped', reason: validation.message });
        continue;
      }
      const { name, username, password, assignedLab } = validation.cleaned;
      if (taken.has(username)) {
        results.push({
          index,
          username,
          status: 'skipped',
          reason: 'An account with this username already exists.',
        });
        continue;
      }
      try {
        // Plain-text organizer password, same as single creation.
        const volunteer = new Volunteer({
          name,
          username,
          passwordHash: password,
          role: 'VOLUNTEER',
          isActive: true,
          assignedLab,
        });
        await volunteer.save();
        taken.add(username);
        createdCount += 1;
        results.push({ index, username, status: 'created', reason: null });
      } catch (saveError) {
        if (saveError.code === 11000) {
          taken.add(username);
          results.push({
            index,
            username,
            status: 'skipped',
            reason: 'An account with this username already exists.',
          });
        } else {
          throw saveError;
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: `Bulk add complete: ${createdCount} created, ${rows.length - createdCount} skipped.`,
      summary: { total: rows.length, created: createdCount, skipped: rows.length - createdCount },
      results,
    });
  } catch (error) {
    console.error('Bulk create volunteers error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not add the organizers.',
    });
  }
};

/**
 * List Volunteer Accounts
 * Endpoint: GET /api/admin/volunteers
 * Access: Protected (Admin only)
 */
const listVolunteers = async (req, res) => {
  try {
    const query = req.query || {};
    const filter = {};
    let searchRegex = null;

    if (query.isActive !== undefined) {
      if (typeof query.isActive !== 'string') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ACTIVE_FILTER',
          message: "isActive query filter must be either 'true' or 'false'.",
        });
      }
      const activeStr = query.isActive.trim().toLowerCase();
      if (activeStr !== 'true' && activeStr !== 'false') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ACTIVE_FILTER',
          message: "isActive query filter must be either 'true' or 'false'.",
        });
      }
      filter.isActive = activeStr === 'true';
    }

    if (query.search !== undefined) {
      if (typeof query.search !== 'string') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_SEARCH_QUERY',
          message: 'Search words must be text.',
        });
      }
      const trimmedSearch = query.search.trim();
      if (trimmedSearch.length > 100) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_SEARCH_QUERY',
          message: 'Search words must be 100 letters or less.',
        });
      }
      if (trimmedSearch !== '') {
        searchRegex = new RegExp(escapeRegex(trimmedSearch), 'i');
        filter.$or = [
          { name: searchRegex },
          { username: searchRegex },
          { assignedLab: searchRegex },
        ];
      }
    }

    const hasPagination = query.page !== undefined || query.limit !== undefined;
    let paginationInput = null;
    if (hasPagination) {
      paginationInput = parsePaginationQuery(query);
      if (paginationInput.error) {
        return res.status(paginationInput.error.status).json({
          success: false,
          code: paginationInput.error.code,
          message: paginationInput.error.message,
        });
      }
    }

    const rawVolunteers = await Volunteer.find(filter).sort({ createdAt: -1 });
    const filteredVolunteers = (Array.isArray(rawVolunteers) ? rawVolunteers : []).filter((vol) => {
      if (vol.role && vol.role.toUpperCase() !== 'VOLUNTEER') return false;
      if (filter.isActive !== undefined && Boolean(vol.isActive) !== filter.isActive) return false;
      if (searchRegex) {
        const matches =
          searchRegex.test(vol.name || '') ||
          searchRegex.test(vol.username || '') ||
          searchRegex.test(vol.assignedLab || '');
        if (!matches) return false;
      }
      return true;
    });

    if (hasPagination) {
      const { page, limit, skip } = paginationInput;
      const pagedVolunteers = filteredVolunteers.slice(skip, skip + limit);
      return res.status(200).json({
        success: true,
        count: pagedVolunteers.length,
        pagination: buildPaginationMeta(page, limit, filteredVolunteers.length),
        volunteers: pagedVolunteers.map(formatVolunteerResponse),
      });
    }

    return res.status(200).json({
      success: true,
      count: filteredVolunteers.length,
      volunteers: filteredVolunteers.map(formatVolunteerResponse),
    });
  } catch (error) {
    console.error('List volunteers error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not load the organizer list.',
    });
  }
};

/**
 * View Volunteer Details
 * Endpoint: GET /api/admin/volunteers/:id
 * Access: Protected (Admin only)
 */
const getVolunteerById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'That organizer ID does not look right.',
      });
    }

    const volunteer = await Volunteer.findById(id);

    if (!volunteer) {
      return res.status(404).json({
        success: false,
        code: 'VOLUNTEER_NOT_FOUND',
        message: 'No organizer account with that ID.',
      });
    }

    return res.status(200).json({
      success: true,
      volunteer: formatVolunteerResponse(volunteer, { includePassword: true }),
    });
  } catch (error) {
    console.error('Get volunteer by ID error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not load the organizer details.',
    });
  }
};

/**
 * Deactivate Volunteer Account
 * Endpoint: PATCH /api/admin/volunteers/:id/deactivate
 * Access: Protected (Admin only)
 */
const deactivateVolunteer = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'That organizer ID does not look right.',
      });
    }

    const volunteer = await Volunteer.findById(id);

    if (!volunteer) {
      return res.status(404).json({
        success: false,
        code: 'VOLUNTEER_NOT_FOUND',
        message: 'No organizer account with that ID.',
      });
    }

    volunteer.isActive = false;
    await volunteer.save();

    return res.status(200).json({
      success: true,
      message: 'Organizer account switched off.',
      volunteer: formatVolunteerResponse(volunteer),
    });
  } catch (error) {
    console.error('Deactivate volunteer error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not switch off the organizer account.',
    });
  }
};

/**
 * Reactivate Volunteer Account
 * Endpoint: PATCH /api/admin/volunteers/:id/reactivate
 * Access: Protected (Admin only)
 */
const reactivateVolunteer = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'That organizer ID does not look right.',
      });
    }

    const volunteer = await Volunteer.findById(id);

    if (!volunteer) {
      return res.status(404).json({
        success: false,
        code: 'VOLUNTEER_NOT_FOUND',
        message: 'No organizer account with that ID.',
      });
    }

    volunteer.isActive = true;
    await volunteer.save();

    return res.status(200).json({
      success: true,
      message: 'Organizer account switched on.',
      volunteer: formatVolunteerResponse(volunteer),
    });
  } catch (error) {
    console.error('Reactivate volunteer error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not switch on the organizer account.',
    });
  }
};

/**
 * Permanently Delete Volunteer Account
 * Endpoint: DELETE /api/admin/volunteers/:id
 * Access: Protected (Admin only)
 *
 * Refused with 409 while any competition record still references this
 * organizer (evaluations, rounds, transactions, questions they created):
 * deleting would erase who ran those rounds. Deactivate instead; only
 * organizers with no linked records can be deleted. Never deletes an ADMIN.
 */
const deleteVolunteer = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'That organizer ID does not look right.',
      });
    }

    const volunteer = await Volunteer.findById(id);

    if (!volunteer || volunteer.role?.toUpperCase() !== 'VOLUNTEER') {
      return res.status(404).json({
        success: false,
        code: 'VOLUNTEER_NOT_FOUND',
        message: 'No organizer account with that ID.',
      });
    }

    const [evaluationLinks, roundLinks, transactionLinks, questionLinks] = await Promise.all([
      Evaluation.countDocuments({
        $or: [{ evaluatedBy: id }, { settledBy: id }, { progressedBy: id }],
      }),
      Round.countDocuments({
        $or: [{ startedBy: id }, { 'timerExtensions.extendedBy': id }],
      }),
      Transaction.countDocuments({ performedBy: id }),
      Question.countDocuments({ createdBy: id }),
    ]);
    const linkedCount = evaluationLinks + roundLinks + transactionLinks + questionLinks;
    if (linkedCount > 0) {
      return res.status(409).json({
        success: false,
        code: 'VOLUNTEER_HAS_LINKED_RECORDS',
        message: `Cannot delete this organizer: ${linkedCount} competition record(s) still use this account. Switch the account off instead.`,
      });
    }

    await Volunteer.deleteOne({ _id: id });

    return res.status(200).json({
      success: true,
      message: 'Organizer account deleted for good.',
    });
  } catch (error) {
    console.error('Delete volunteer error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not delete the organizer account.',
    });
  }
};

/**
 * Shared validation and target lookup for Admin volunteer mutation handlers.
 * Ensures valid ObjectId, JSON object body, allowed fields only, and VOLUNTEER discriminator match.
 */
const resolveVolunteerMutationTarget = async (req, allowedFields) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return {
      error: {
        status: 400,
        code: 'INVALID_ID',
        message: 'That organizer ID does not look right.',
      },
    };
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      error: {
        status: 400,
        code: 'INVALID_PAYLOAD',
        message: 'The request must be a list of details.',
      },
    };
  }

  const bodyKeys = Object.keys(body);
  const extraFields = bodyKeys.filter((key) => !allowedFields.includes(key));
  if (extraFields.length > 0) {
    return {
      error: {
        status: 400,
        code: 'UNSUPPORTED_FIELDS',
        message: `This request has fields we do not use: ${extraFields.join(', ')}.`,
      },
    };
  }

  const volunteer = await Volunteer.findById(id);
  if (!volunteer || volunteer.role?.toUpperCase() !== 'VOLUNTEER') {
    return {
      error: {
        status: 404,
        code: 'VOLUNTEER_NOT_FOUND',
        message: 'No organizer account with that ID.',
      },
    };
  }

  return { volunteer, body, bodyKeys };
};

/**
 * Update Permitted Volunteer Information (name and/or assignedLab)
 * Endpoints: PUT /api/admin/volunteers/:id, PATCH /api/admin/volunteers/:id
 * Access: Protected (Admin only)
 */
const updateVolunteer = async (req, res) => {
  try {
    const resolved = await resolveVolunteerMutationTarget(req, ['name', 'assignedLab']);
    if (resolved.error) {
      return res.status(resolved.error.status).json({
        success: false,
        code: resolved.error.code,
        message: resolved.error.message,
      });
    }

    const { volunteer, body, bodyKeys } = resolved;

    if (bodyKeys.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'NO_UPDATE_FIELDS',
        message: "Provide at least one field to update: 'name' or 'assignedLab'.",
      });
    }

    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length < 2)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_NAME',
        message: 'Organizer name needs at least 2 letters.',
      });
    }

    if (
      body.assignedLab !== undefined &&
      resolveOrganizerLocation(body.assignedLab) === null
    ) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ASSIGNED_LAB',
        message: ORGANIZER_LOCATION_MESSAGE,
      });
    }

    if (body.name !== undefined) {
      volunteer.name = body.name.trim();
    }
    if (body.assignedLab !== undefined) {
      volunteer.assignedLab = resolveOrganizerLocation(body.assignedLab);
    }

    await volunteer.save();

    return res.status(200).json({
      success: true,
      message: 'Organizer details saved.',
      volunteer: formatVolunteerResponse(volunteer),
    });
  } catch (error) {
    console.error('Update volunteer error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not save the organizer details.',
    });
  }
};

/**
 * Reset Volunteer Password Securely
 * Endpoint: PATCH /api/admin/volunteers/:id/reset-password
 * Access: Protected (Admin only)
 */
const resetVolunteerPassword = async (req, res) => {
  try {
    const resolved = await resolveVolunteerMutationTarget(req, ['newPassword', 'password']);
    if (resolved.error) {
      return res.status(resolved.error.status).json({
        success: false,
        code: resolved.error.code,
        message: resolved.error.message,
      });
    }

    const { volunteer, body } = resolved;

    if (body.newPassword !== undefined && body.password !== undefined) {
      return res.status(400).json({
        success: false,
        code: 'AMBIGUOUS_PASSWORD_FIELDS',
        message: "Provide either 'newPassword' or 'password', not both.",
      });
    }

    const candidatePassword = body.newPassword !== undefined ? body.newPassword : body.password;
    if (!candidatePassword || typeof candidatePassword !== 'string') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_PASSWORD',
        message: 'New password is required.',
      });
    }

    if (candidatePassword.trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'WEAK_PASSWORD',
        message: 'Password cannot be empty.',
      });
    }

    // Plain-text organizer password, same as creation (admin stays hashed).
    volunteer.passwordHash = candidatePassword;
    await volunteer.save();

    return res.status(200).json({
      success: true,
      message: 'Organizer password changed.',
      volunteer: formatVolunteerResponse(volunteer),
    });
  } catch (error) {
    console.error('Reset volunteer password error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not change the organizer password.',
    });
  }
};

module.exports = {
  adminLogin,
  getAdminMe,
  createVolunteer,
  createVolunteersBulk,
  listVolunteers,
  getVolunteerById,
  updateVolunteer,
  resetVolunteerPassword,
  deactivateVolunteer,
  reactivateVolunteer,
  deleteVolunteer,
  formatAdminResponse,
};