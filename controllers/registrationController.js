import { establishUserSession } from "./authController.js";
import { completeRegistration } from "../services/registrationService.js";

export async function register(req, res) {
  const sessionRegistration = req.session.registration;
  const registrationGrant =
    req.body.registration_grant ||
    (sessionRegistration?.email === req.body.email
      ? sessionRegistration.registrationGrant
      : null);

  try {
    const user = await completeRegistration({
      email: req.body.email,
      username: req.body.username,
      password: req.body.password,
      registrationGrant,
    });

    delete req.session.registration;
    const sessionUser = establishUserSession(req, res, user);
    return res.status(201).json({
      result: user,
      user: sessionUser,
      message: "Successfully registered the user!",
    });
  } catch (error) {
    if (
      error.code === "23505" ||
      error.code === "REGISTRATION_CONFLICT"
    ) {
      return res.status(409).json({ error: "Username or email already exists" });
    }
    if (error.code === "INVALID_REGISTRATION_GRANT") {
      return res.status(400).json({ error: error.message });
    }

    console.error("Unable to complete registration", {
      code: error.code || "REGISTRATION_FAILED",
    });
    return res.status(500).json({ error: "Internal server error" });
  }
}
