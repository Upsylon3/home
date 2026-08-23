// Express 4 does NOT catch errors thrown inside an async route handler —
// an unhandled rejection there crashes the entire Node process (verified
// directly: a throw inside a plain `async (req, res) => {}` handler takes
// the whole server down, not just that one request). Wrapping every async
// handler with this turns "an unexpected error kills the app for everyone"
// into "that one request gets a 500," which then flows into the normal
// error-handling middleware in server.js.
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
