// WHY THIS FILE EXISTS (for newcomers)
//
// A route handler that is `async` returns a Promise. If something inside it
// throws, that Promise is "rejected". Without help, the request would just
// hang forever, because nothing is listening for the rejection.
//
// asyncHandler wraps a handler so any rejection is passed to `next(err)`,
// which hands the error to the error-handling middleware at the bottom of
// app.js. Wrap every async route with it and errors become proper responses.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
