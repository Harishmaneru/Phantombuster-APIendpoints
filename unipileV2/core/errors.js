/**
 * Error handling for v2 routes.
 *
 * v2 errors look like:
 *   { object: "Error", type: "api/invalid_parameters", status: 400,
 *     title: "...", detail: "...", req_id: "..." }
 *
 * Our routes keep the same response body the v1 handlers return
 * (`{ success: false, error, message }`), and add `code` = v2 `type`
 * so the frontend can branch on it if it wants to.
 */

const handleError = (err, res, context = {}) => {
  const upstream = err.response?.data;
  console.error("Unipile v2 API Error:", {
    ...context,
    status: err.response?.status || err.status,
    message: err.message,
    data: upstream,
    url: err.config?.url,
  });

  const status = err.response?.status || err.status || 500;

  if (upstream) {
    return res.status(status).json({
      success: false,
      error: upstream,
      message: upstream.detail || upstream.title || err.message,
      ...(upstream.type && { code: upstream.type }),
    });
  }

  return res.status(status).json({
    success: false,
    error: err.message || "Internal server error",
    ...(err.code && typeof err.code === "string" && { code: err.code }),
  });
};

/** Build an error carrying an HTTP status and a machine-readable code. */
const httpError = (status, code, message) => {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
};

module.exports = { handleError, httpError };
