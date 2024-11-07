const express = require("express");
const router = express.Router();
const authController = require("./auth");
const inboxController = require("./inbox");
const outboxController = require("./outbox");
const emailController = require("./email");
const security = require("../middleware/security");

// Web Routes
router.get("/", authController.getSignInPage);
router.get("/signup", authController.getSignUpPage);
router.get("/inbox", security.checkAuthentication, inboxController.getInbox);
router.get("/outbox", security.checkAuthentication, outboxController.getOutbox);
router.get(
	"/compose",
	security.checkAuthentication,
	emailController.getComposeForm
);
router.get(
	"/email/:id",
	security.checkAuthentication,
	security.checkEmailAccess,
	emailController.getEmailDetails
);

router.post("/signin", authController.handleSignIn);
router.post(
	"/signup",
	security.validateSignupInput,
	authController.handleSignUp
);
router.post("/signout", authController.handleSignOut);
router.post(
	"/email/send",
	security.validateEmailInput,
	security.csrfProtection,
	emailController.sendEmail
);

module.exports = router;
