// routes/email.js
const express = require("express");
const router = express.Router();
const mysql = require("mysql2/promise");
const multer = require("multer");
const path = require("path");

// Configure multer for file uploads
const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, "uploads/");
	},
	filename: (req, file, cb) => {
		cb(null, Date.now() + path.extname(file.originalname));
	},
});

const upload = multer({ storage: storage });

// Database connection configuration
const dbConfig = {
	host: "127.0.0.1",
	user: "root",
	password: "",
	port: 3306,
	database: process.env.DB_NAME,
};

// Middleware to check if user is authenticated
const checkAuth = (req, res, next) => {
	if (!req.cookies.userId) {
		return res.status(403).render("error", {
			message: "Access denied. Please sign in first.",
			status: 403,
		});
	}
	next();
};

// Inbox page with pagination
router.get("/inbox", checkAuth, async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = 5;
		const offset = (page - 1) * limit;

		const connection = await mysql.createConnection(dbConfig);

		// Get total count of emails
		const [countResult] = await connection.execute(
			`SELECT COUNT(*) as total FROM emails 
       WHERE recipient_id = ? AND is_deleted_by_recipient = false`,
			[req.cookies.userId]
		);

		const totalEmails = countResult[0].total;
		const totalPages = Math.ceil(totalEmails / limit);

		// Get emails for current page
		const [emails] = await connection.execute(
			`SELECT e.*, u.full_name as sender_name 
       FROM emails e 
       JOIN users u ON e.sender_id = u.id 
       WHERE e.recipient_id = ? AND e.is_deleted_by_recipient = false 
       ORDER BY e.sent_at DESC 
       LIMIT ? OFFSET ?`,
			[req.cookies.userId, limit, offset]
		);

		await connection.end();

		res.render("inbox", {
			emails,
			currentPage: page,
			totalPages,
			user: { id: req.cookies.userId },
		});
	} catch (error) {
		res.status(500).render("error", {
			message: "Error loading inbox",
			error,
		});
	}
});

// Email detail page
router.get("/email/:id", checkAuth, async (req, res) => {
	try {
		const connection = await mysql.createConnection(dbConfig);

		const [emails] = await connection.execute(
			`SELECT e.*, 
              sender.full_name as sender_name,
              recipient.full_name as recipient_name
       FROM emails e 
       JOIN users sender ON e.sender_id = sender.id
       JOIN users recipient ON e.recipient_id = recipient.id
       WHERE e.id = ? AND (
         (e.sender_id = ? AND e.is_deleted_by_sender = false) OR
         (e.recipient_id = ? AND e.is_deleted_by_recipient = false)
       )`,
			[req.params.id, req.cookies.userId, req.cookies.userId]
		);

		if (emails.length === 0) {
			return res.status(404).render("error", {
				message: "Email not found",
				status: 404,
			});
		}

		await connection.end();

		res.render("email_detail", {
			email: emails[0],
			user: { id: req.cookies.userId },
		});
	} catch (error) {
		res.status(500).render("error", {
			message: "Error loading email",
			error,
		});
	}
});

// Outbox page with pagination
router.get("/outbox", checkAuth, async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = 5;
		const offset = (page - 1) * limit;

		const connection = await mysql.createConnection(dbConfig);

		// Get total count of sent emails
		const [countResult] = await connection.execute(
			`SELECT COUNT(*) as total FROM emails 
       WHERE sender_id = ? AND is_deleted_by_sender = false`,
			[req.cookies.userId]
		);

		const totalEmails = countResult[0].total;
		const totalPages = Math.ceil(totalEmails / limit);

		// Get sent emails for current page
		const [emails] = await connection.execute(
			`SELECT e.*, u.full_name as recipient_name 
       FROM emails e 
       JOIN users u ON e.recipient_id = u.id 
       WHERE e.sender_id = ? AND e.is_deleted_by_sender = false 
       ORDER BY e.sent_at DESC 
       LIMIT ? OFFSET ?`,
			[req.cookies.userId, limit, offset]
		);

		await connection.end();

		res.render("outbox", {
			emails,
			currentPage: page,
			totalPages,
			user: { id: req.cookies.userId },
		});
	} catch (error) {
		res.status(500).render("error", {
			message: "Error loading outbox",
			error,
		});
	}
});

// Compose page
router.get("/compose", checkAuth, async (req, res) => {
	try {
		const connection = await mysql.createConnection(dbConfig);

		// Get all users except current user for recipient dropdown
		const [users] = await connection.execute(
			`SELECT id, full_name, email FROM users WHERE id != ?`,
			[req.cookies.userId]
		);

		await connection.end();

		res.render("compose", {
			users,
			user: { id: req.cookies.userId },
		});
	} catch (error) {
		res.status(500).render("error", {
			message: "Error loading compose page",
			error,
		});
	}
});

// Handle email sending
router.post(
	"/send",
	checkAuth,
	upload.single("attachment"),
	async (req, res) => {
		try {
			const { recipient_id, subject, body } = req.body;
			const attachment_path = req.file ? req.file.path : null;

			if (!recipient_id) {
				return res.status(400).render("error", {
					message: "Recipient is required",
					status: 400,
				});
			}

			const connection = await mysql.createConnection(dbConfig);

			await connection.execute(
				`INSERT INTO emails (sender_id, recipient_id, subject, body, attachment_path, sent_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
				[
					req.cookies.userId,
					recipient_id,
					subject || "(no subject)",
					body,
					attachment_path,
				]
			);

			await connection.end();

			res.redirect("/inbox?message=Email sent successfully");
		} catch (error) {
			res.status(500).render("error", {
				message: "Error sending email",
				error,
			});
		}
	}
);

module.exports = router;
