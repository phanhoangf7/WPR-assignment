const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;
const mysql = require("mysql2/promise");

const dbConfig = {
	host: "127.0.0.1",
	user: "root",
	password: "",
	port: 3306,
	database: "wpr2101040091", // Replace with your database name
};

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
	limits: {
		fileSize: 5 * 1024 * 1024, // 5MB limit
	},
	fileFilter: (req, file, cb) => {
		const allowedTypes = [
			".pdf",
			".doc",
			".docx",
			".txt",
			".jpg",
			".jpeg",
			".png",
		];
		const ext = path.extname(file.originalname).toLowerCase();
		if (allowedTypes.includes(ext)) {
			cb(null, true);
		} else {
			cb(new Error("Invalid file type"));
		}
	},
});

// Delete single email
router.delete("/emails/:id", async (req, res) => {
	const { id } = req.params;
	const userId = req.session.userId;

	try {
		// First, get the email to check ownership and get attachment info
		const email = await db.query(
			"SELECT * FROM emails WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)",
			[id, userId]
		);

		if (email.rows.length === 0) {
			return res.status(404).json({ error: "Email not found" });
		}

		const emailData = email.rows[0];

		// Determine which delete flag to update
		const updateField =
			emailData.sender_id === userId
				? "is_deleted_by_sender"
				: "is_deleted_by_recipient";

		// Update the deletion flag
		await db.query(`UPDATE emails SET ${updateField} = true WHERE id = $1`, [
			id,
		]);

		// Check if both sender and recipient have deleted the email
		const checkBothDeleted = await db.query(
			"SELECT * FROM emails WHERE id = $1 AND is_deleted_by_sender = true AND is_deleted_by_recipient = true",
			[id]
		);

		// If both have deleted, physically delete the email and its attachment
		if (checkBothDeleted.rows.length > 0 && emailData.attachment_path) {
			try {
				await fs.unlink(path.join(__dirname, "..", emailData.attachment_path));
			} catch (err) {
				console.error("Error deleting file:", err);
				// Continue execution even if file deletion fails
			}

			// Finally delete the email record
			await db.query("DELETE FROM emails WHERE id = $1", [id]);
		}

		res.json({ message: "Email deleted successfully" });
	} catch (error) {
		console.error("Error deleting email:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

// Bulk delete emails
router.delete("/emails/bulk-delete", async (req, res) => {
	const { emailIds } = req.body;
	const userId = req.session.userId;

	if (!Array.isArray(emailIds) || emailIds.length === 0) {
		return res.status(400).json({ error: "Invalid email IDs" });
	}

	try {
		// Begin transaction
		await db.query("BEGIN");

		for (const id of emailIds) {
			// Get email details
			const email = await db.query(
				"SELECT * FROM emails WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)",
				[id, userId]
			);

			if (email.rows.length > 0) {
				const emailData = email.rows[0];
				const updateField =
					emailData.sender_id === userId
						? "is_deleted_by_sender"
						: "is_deleted_by_recipient";

				// Update deletion flag
				await db.query(
					`UPDATE emails SET ${updateField} = true WHERE id = $1`,
					[id]
				);

				// Check if both have deleted
				const bothDeleted = await db.query(
					"SELECT * FROM emails WHERE id = $1 AND is_deleted_by_sender = true AND is_deleted_by_recipient = true",
					[id]
				);

				if (bothDeleted.rows.length > 0 && emailData.attachment_path) {
					try {
						await fs.unlink(
							path.join(__dirname, "..", emailData.attachment_path)
						);
					} catch (err) {
						console.error("Error deleting file:", err);
					}

					await db.query("DELETE FROM emails WHERE id = $1", [id]);
				}
			}
		}

		// Commit transaction
		await db.query("COMMIT");

		res.json({ message: "Emails deleted successfully" });
	} catch (error) {
		await db.query("ROLLBACK");
		console.error("Error in bulk delete:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

// Download attachment
router.get("/emails/:id/attachment", async (req, res) => {
	const { id } = req.params;
	const userId = req.session.userId;

	try {
		const email = await db.query(
			"SELECT attachment_path FROM emails WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)",
			[id, userId]
		);

		if (email.rows.length === 0 || !email.rows[0].attachment_path) {
			return res.status(404).send("Attachment not found");
		}

		const filePath = path.join(__dirname, "..", email.rows[0].attachment_path);
		res.download(filePath);
	} catch (error) {
		console.error("Error downloading attachment:", error);
		res.status(500).send("Error downloading file");
	}
});

module.exports = router;
