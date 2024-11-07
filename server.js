const express = require("express");
const { engine } = require("express-handlebars");
const mysql = require("mysql2/promise");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const path = require("path");
const dotenv = require("dotenv");
// Load environment variables
dotenv.config();

const app = express();
const PORT = 8000;

// Configure multer for file uploads
const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, "uploads/");
	},
	filename: (req, file, cb) => {
		cb(null, Date.now() + "-" + file.originalname);
	},
});

const upload = multer({
	storage: storage,
	limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Database connection pool
const pool = mysql.createPool({
	host: "127.0.0.1",
	user: "root",
	password: "",
	database: "wpr2101040091", // Replace with your database name
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0,
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));
const hbs = engine({
	helpers: {
		formatDate: function (date) {
			if (!date) {
				return "";
			}
			return new Date(date).toLocaleDateString("en-US");
		},
	},
});
// Handlebars setup
app.engine("handlebars", hbs);
app.set("view engine", "handlebars");
app.set("views", "./views");

// Authentication middleware
const requireAuth = async (req, res, next) => {
	const userId = req.cookies.userId;
	if (!userId) {
		return res.status(403).render("error", {
			message: "Access denied. Please sign in first.",
			layout: false,
		});
	}
	try {
		const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [
			userId,
		]);
		if (rows.length === 0) {
			res.clearCookie("userId");
			return res.status(403).render("error", {
				message: "Invalid session. Please sign in again.",
				layout: false,
			});
		}
		req.user = rows[0];
		next();
	} catch (error) {
		console.error("Auth middleware error:", error);
		res.status(500).render("error", {
			message: "Server error",
			layout: false,
		});
	}
};

// Routes
app.get("/signin", async (req, res) => {
	res.render("signin", { layout: false });
});
app.get("/", async (req, res) => {
	const userId = req.cookies.userId;
	if (userId) {
		return res.redirect("/inbox");
	}
	res.render("signin", { layout: false });
});

app.post("/signin", async (req, res) => {
	const { email, password } = req.body;
	try {
		const [rows] = await pool.query(
			"SELECT * FROM users WHERE email = ? AND password = ?",
			[email, password]
		);
		if (rows.length === 0) {
			return res.render("signin", {
				error: "Invalid email or password",
				layout: false,
			});
		}
		res.cookie("userId", rows[0].id, { httpOnly: true });
		res.redirect("/inbox");
	} catch (error) {
		console.error("Sign-in error:", error);
		res.status(500).render("signin", {
			error: "Server error",
			layout: false,
		});
	}
});

app.get("/signup", async (req, res) => {
	res.render("signup", { layout: false });
});

app.post("/signup", async (req, res) => {
	const { fullName, email, password, confirmPassword } = req.body;

	// Validation
	if (!fullName || !email || !password || !confirmPassword) {
		return res.render("signup", {
			error: "All fields are required",
			layout: false,
		});
	}
	if (password.length < 6) {
		return res.render("signup", {
			error: "Password must be at least 6 characters",
			layout: false,
		});
	}
	if (password !== confirmPassword) {
		return res.render("signup", {
			error: "Passwords do not match",
			layout: false,
		});
	}

	try {
		// Check for existing email
		const [existing] = await pool.query(
			"SELECT id FROM users WHERE email = ?",
			[email]
		);
		if (existing.length > 0) {
			return res.render("signup", {
				error: "Email already exists",
				layout: false,
			});
		}

		// Create new user
		await pool.query(
			"INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)",
			[fullName, email, password]
		);
		res.redirect("/signin");
		res.render("signup", {
			success: "Account created successfully! Please sign in.",
			layout: false,
		});
	} catch (error) {
		console.error("Sign-up error:", error);
		res.status(500).render("signup", {
			error: "Server error",
			layout: false,
		});
	}
});
// Sign-out route
app.get("/signout", async (req, res) => {
	res.render("signout", { layout: false });
});
app.post("/signout", async (req, res) => {
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

	// Clear the session cookie
	res.clearCookie("session");
	res.redirect("/signin");
});

app.get("/inbox", requireAuth, async (req, res) => {
	const page = parseInt(req.query.page) || 1;
	const limit = 5;
	const offset = (page - 1) * limit;

	try {
		const [emails] = await pool.query(
			`SELECT e.*, u.full_name as sender_name 
       FROM emails e 
       JOIN users u ON e.sender_id = u.id 
       WHERE e.recipient_id = ? AND e.is_deleted_by_recipient = FALSE 
       ORDER BY e.sent_at DESC 
       LIMIT ? OFFSET ?`,
			[req.user.id, limit, offset]
		);

		const [countResult] = await pool.query(
			"SELECT COUNT(*) as total FROM emails WHERE recipient_id = ? AND is_deleted_by_recipient = FALSE",
			[req.user.id]
		);
		const totalPages = Math.ceil(countResult[0].total / limit);

		res.render("inbox", {
			user: req.user,
			emails,
			pagination: {
				current: page,
				total: totalPages,
			},
		});
	} catch (error) {
		console.error("Inbox error:", error);
		res.status(500).render("error", { message: "Server error" });
	}
});

app.get("/outbox", requireAuth, async (req, res) => {
	const page = parseInt(req.query.page) || 1;
	const limit = 5;
	const offset = (page - 1) * limit;

	try {
		const [emails] = await pool.query(
			`SELECT e.*, u.full_name as recipient_name 
       FROM emails e 
       JOIN users u ON e.recipient_id = u.id 
       WHERE e.sender_id = ? AND e.is_deleted_by_sender = FALSE 
       ORDER BY e.sent_at DESC 
       LIMIT ? OFFSET ?`,
			[req.user.id, limit, offset]
		);

		const [countResult] = await pool.query(
			"SELECT COUNT(*) as total FROM emails WHERE sender_id = ? AND is_deleted_by_sender = FALSE",
			[req.user.id]
		);
		const totalPages = Math.ceil(countResult[0].total / limit);

		res.render("outbox", {
			user: req.user,
			emails,
			pagination: {
				current: page,
				total: totalPages,
			},
		});
	} catch (error) {
		console.error("Outbox error:", error);
		res.status(500).render("error", { message: "Server error" });
	}
});

app.get("/compose", requireAuth, async (req, res) => {
	try {
		const [users] = await pool.query(
			"SELECT id, full_name, email FROM users WHERE id != ?",
			[req.user.id]
		);
		res.render("compose", { user: req.user, recipients: users });
	} catch (error) {
		console.error("Compose error:", error);
		res.status(500).render("error", { message: "Server error" });
	}
});

app.post(
	"/email/send",
	requireAuth,
	upload.single("attachment"),
	async (req, res) => {
		const { recipient, subject, body } = req.body;
		const attachmentPath = req.file ? req.file.path : null;

		if (!recipient) {
			return res.render("compose", {
				error: "Recipient is required",
				user: req.user,
			});
		}

		try {
			await pool.query(
				`INSERT INTO emails (sender_id, recipient_id, subject, body, attachment_path) 
       VALUES (?, ?, ?, ?, ?)`,
				[
					req.user.id,
					recipient,
					subject || "(no subject)",
					body,
					attachmentPath,
				]
			);
			res.redirect("/outbox");
		} catch (error) {
			console.error("Send email error:", error);
			res.status(500).render("error", { message: "Server error" });
		}
	}
);

app.get("/email/:id", requireAuth, async (req, res) => {
	try {
		const [emails] = await pool.query(
			`SELECT e.*, 
              s.full_name as sender_name, 
              s.email as sender_email,
              r.full_name as recipient_name,
              r.email as recipient_email
       FROM emails e 
       JOIN users s ON e.sender_id = s.id 
       JOIN users r ON e.recipient_id = r.id 
       WHERE e.id = ? AND (
         (e.sender_id = ? AND e.is_deleted_by_sender = FALSE) OR 
         (e.recipient_id = ? AND e.is_deleted_by_recipient = FALSE)
       )`,
			[req.params.id, req.user.id, req.user.id]
		);

		if (emails.length === 0) {
			return res.status(404).render("error", { message: "Email not found" });
		}

		res.render("email_detail", {
			user: req.user,
			email: emails[0],
		});
	} catch (error) {
		console.error("Email detail error:", error);
		res.status(500).render("error", { message: "Server error" });
	}
});

app.delete("/api/emails", requireAuth, async (req, res) => {
	const { ids, location } = req.body;
	if (!ids || !Array.isArray(ids)) {
		return res.status(400).json({ error: "Invalid request" });
	}

	try {
		const field =
			location === "inbox" ? "is_deleted_by_recipient" : "is_deleted_by_sender";
		const userField = location === "inbox" ? "recipient_id" : "sender_id";

		await pool.query(
			`UPDATE emails SET ${field} = TRUE 
       WHERE id IN (?) AND ${userField} = ?`,
			[ids, req.user.id]
		);
		res.json({ success: true });
	} catch (error) {
		console.error("Delete emails error:", error);
		res.status(500).json({ error: "Server error" });
	}
});

// Start server
app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
