const express = require("express");
const router = express.Router();
const mysql = require("mysql2/promise");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");

// Database connection configuration
const dbConfig = {
	host: "127.0.0.1",
	user: "wpr",
	password: "fit2024",
	port: 3306,
	database: "wpr2101040091",
};

// Helper function to hash password with salt
const hashPassword = (password) => {
	const salt = crypto.randomBytes(16).toString("hex");
	const hash = crypto
		.pbkdf2Sync(password, salt, 1000, 64, "sha512")
		.toString("hex");
	return { hash, salt };
};

// Helper function to verify password
const verifyPassword = (password, hash, salt) => {
	const verifyHash = crypto
		.pbkdf2Sync(password, salt, 1000, 64, "sha512")
		.toString("hex");
	return hash === verifyHash;
};

// Helper function to validate email format
const isValidEmail = (email) => {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

// Helper function to generate session token
const generateSessionToken = () => {
	return crypto.randomBytes(32).toString("hex");
};

// Rate limiting implementation
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes

const checkLoginAttempts = (email) => {
	if (loginAttempts.has(email)) {
		const attempts = loginAttempts.get(email);
		if (
			attempts.count >= MAX_ATTEMPTS &&
			Date.now() - attempts.firstAttempt < LOCK_TIME
		) {
			return false;
		}
		if (Date.now() - attempts.firstAttempt >= LOCK_TIME) {
			loginAttempts.delete(email);
		}
	}
	return true;
};

const recordLoginAttempt = (email) => {
	if (!loginAttempts.has(email)) {
		loginAttempts.set(email, {
			count: 1,
			firstAttempt: Date.now(),
		});
	} else {
		const attempts = loginAttempts.get(email);
		attempts.count++;
	}
};

// Sign-in route
router.post("/signin", async (req, res) => {
	const { email, password } = req.body;

	// Basic validation
	if (!email || !password) {
		return res.render("signin", {
			error: "Email and password are required",
			email: email, // Preserve email input
		});
	}

	// Check rate limiting
	if (!checkLoginAttempts(email)) {
		return res.render("signin", {
			error: "Too many failed attempts. Please try again in 15 minutes",
			email: email,
		});
	}

	try {
		const connection = await mysql.createConnection(dbConfig);

		// Get user with email
		const [users] = await connection.execute(
			"SELECT id, full_name, email, password, salt FROM users WHERE email = ?",
			[email]
		);

		if (users.length !== 1) {
			recordLoginAttempt(email);
			await connection.end();
			return res.render("signin", {
				error: "Invalid email or password",
				email: email,
			});
		}

		const user = users[0];

		// Verify password
		if (!verifyPassword(password, user.password, user.salt)) {
			recordLoginAttempt(email);
			await connection.end();
			return res.render("signin", {
				error: "Invalid email or password",
				email: email,
			});
		}

		// Generate session token
		const sessionToken = generateSessionToken();

		// Store session in database
		await connection.execute(
			"INSERT INTO sessions (user_id, token, created_at, expires_at) VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 24 HOUR))",
			[user.id, sessionToken]
		);

		await connection.end();

		// Clear login attempts on successful login
		loginAttempts.delete(email);

		// Set secure cookie with session token
		res.cookie("session", sessionToken, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "strict",
			maxAge: 24 * 60 * 60 * 1000, // 24 hours
		});

		res.redirect("/inbox");
	} catch (error) {
		console.error("Sign-in error:", error);
		res.render("signin", {
			error: "An error occurred during sign-in",
			email: email,
		});
	}
});

// Sign-up route
router.post("/signup", async (req, res) => {
	const { full_name, email, password, password_confirm } = req.body;

	// Validation
	const errors = [];
	if (!full_name || !email || !password || !password_confirm) {
		errors.push("All fields are required");
	}
	if (!isValidEmail(email)) {
		errors.push("Invalid email format");
	}
	if (password.length < 6) {
		errors.push("Password must be at least 6 characters long");
	}
	if (password !== password_confirm) {
		errors.push("Passwords do not match");
	}

	if (errors.length > 0) {
		return res.render("signup", {
			errors,
			full_name,
			email,
		});
	}

	try {
		const connection = await mysql.createConnection(dbConfig);

		// Check if email already exists
		const [existingUsers] = await connection.execute(
			"SELECT id FROM users WHERE email = ?",
			[email]
		);

		if (existingUsers.length > 0) {
			await connection.end();
			return res.render("signup", {
				errors: ["Email address is already in use"],
				full_name,
				email,
			});
		}

		// Hash password with salt
		const { hash, salt } = hashPassword(password);

		// Insert new user
		await connection.execute(
			"INSERT INTO users (full_name, email, password, salt, created_at) VALUES (?, ?, ?, ?, NOW())",
			[full_name, email, hash, salt]
		);

		await connection.end();

		res.render("signup_success", {
			message: "Account created successfully! You can now sign in.",
		});
	} catch (error) {
		console.error("Sign-up error:", error);
		res.render("signup", {
			errors: ["An error occurred during sign-up"],
			full_name,
			email,
		});
	}
});

// Sign-out route
router.post("/signout", async (req, res) => {
	const sessionToken = req.cookies.session;

	if (sessionToken) {
		try {
			const connection = await mysql.createConnection(dbConfig);

			// Invalidate session in database
			await connection.execute("DELETE FROM sessions WHERE token = ?", [
				sessionToken,
			]);

			await connection.end();
		} catch (error) {
			console.error("Sign-out error:", error);
		}
	}

	res.clearCookie("session");
	res.redirect("/");
});

// Authentication middleware
const requireAuth = async (req, res, next) => {
	const sessionToken = req.cookies.session;

	if (!sessionToken) {
		return res.status(403).render("error", {
			message: "Access denied. Please sign in first.",
			status: 403,
		});
	}

	try {
		const connection = await mysql.createConnection(dbConfig);

		// Get valid session
		const [sessions] = await connection.execute(
			`SELECT s.user_id, u.full_name, u.email 
             FROM sessions s
             JOIN users u ON s.user_id = u.id
             WHERE s.token = ? AND s.expires_at > NOW()`,
			[sessionToken]
		);

		await connection.end();

		if (sessions.length === 0) {
			res.clearCookie("session");
			return res.redirect("/");
		}

		// Add user info to request
		req.user = {
			id: sessions[0].user_id,
			full_name: sessions[0].full_name,
			email: sessions[0].email,
		};

		next();
	} catch (error) {
		console.error("Auth middleware error:", error);
		res.clearCookie("session");
		res.redirect("/");
	}
};

module.exports = { router, requireAuth };
