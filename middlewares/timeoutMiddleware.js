// middlewares/timeoutMiddleware.js
const setCustomTimeout = (ms) => (req, res, next) => {
    req.setTimeout(ms); // Set timeout for the request
    res.setTimeout(ms); // Set timeout for the response
    next();
  };
  
  export default setCustomTimeout;
  