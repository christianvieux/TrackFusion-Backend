// Backend/middlewares/errorMiddleware.js

export const errorMiddleware = (err, req, res, next) => {
    console.error(err);
    res.status(500).send({ error: err.message || "Internal Server Error" });
  };
  