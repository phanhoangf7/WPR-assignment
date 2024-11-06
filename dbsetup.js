require("dotenv").config();
const mysql = require("mysql2/promise");

// Database configuration
const DB_NAME = "wpr2101040091"; // Replace with your student ID
const DB_CONFIG = {
	host: "127.0.0.1",
	user: "root",
	password: "",
	port: 3306,
};

async function main() {
	try {
		// Create connection
		const connection = await mysql.createConnection(DB_CONFIG);

		// Create database if it doesn't exist
		await connection.query(`CREATE DATABASE IF NOT EXISTS ${DB_NAME}`);
		console.log(`Database ${DB_NAME} created or already exists`);

		// Use the database
		await connection.query(`USE ${DB_NAME}`);

		// Create users table
		await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                full_name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX email_idx (email)
            )
        `);
		console.log("Users table created or already exists");

		// Create emails table
		await connection.query(`
            CREATE TABLE IF NOT EXISTS emails (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sender_id INT NOT NULL,
                recipient_id INT NOT NULL,
                subject VARCHAR(255),
                body TEXT,
                attachment_path VARCHAR(255),
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_deleted_by_sender BOOLEAN DEFAULT FALSE,
                is_deleted_by_recipient BOOLEAN DEFAULT FALSE,
                FOREIGN KEY (sender_id) REFERENCES users(id),
                FOREIGN KEY (recipient_id) REFERENCES users(id),
                INDEX sender_idx (sender_id),
                INDEX recipient_idx (recipient_id)
            )
        `);
		console.log("Emails table created or already exists");

		// Clear existing data
		await connection.query("DELETE FROM emails");
		await connection.query("DELETE FROM users");

		// Insert sample users
		const usersResult = await connection.query(`
            INSERT INTO users (full_name, email, password) VALUES
            ('Admin User', 'a@a.com', '123'),
            ('John Doe', 'john@example.com', 'password123'),
            ('Jane Smith', 'jane@example.com', 'password456')
        `);
		console.log("Sample users inserted");

		// Get the inserted user IDs
		const [users] = await connection.query("SELECT id, email FROM users");
		const userMap = users.reduce((acc, user) => {
			acc[user.email] = user.id;
			return acc;
		}, {});

		// Insert sample emails
		const currentTime = new Date();
		const emailsToInsert = [
			// Emails received by a@a.com
			{
				sender_id: userMap["john@example.com"],
				recipient_id: userMap["a@a.com"],
				subject: "Welcome to the system",
				body: "Hello Admin, welcome to our email system!",
				sent_at: new Date(currentTime - 3600000).toISOString(), // 1 hour ago
			},
			{
				sender_id: userMap["jane@example.com"],
				recipient_id: userMap["a@a.com"],
				subject: "System Update",
				body: "We have updated the system with new features.",
				sent_at: new Date(currentTime - 7200000).toISOString(), // 2 hours ago
			},
			// Emails sent by a@a.com
			{
				sender_id: userMap["a@a.com"],
				recipient_id: userMap["john@example.com"],
				subject: "Re: Welcome to the system",
				body: "Thank you for the welcome message!",
				sent_at: new Date(currentTime - 1800000).toISOString(), // 30 minutes ago
			},
			{
				sender_id: userMap["a@a.com"],
				recipient_id: userMap["jane@example.com"],
				subject: "New feature request",
				body: "Can we add a new feature to the system?",
				sent_at: new Date(currentTime - 900000).toISOString(), // 15 minutes ago
			},
			// Additional emails between other users
			{
				sender_id: userMap["john@example.com"],
				recipient_id: userMap["jane@example.com"],
				subject: "Project meeting",
				body: "Let's schedule a meeting for next week.",
				sent_at: new Date(currentTime - 5400000).toISOString(), // 1.5 hours ago
			},
			{
				sender_id: userMap["jane@example.com"],
				recipient_id: userMap["john@example.com"],
				subject: "Re: Project meeting",
				body: "Sure, how about Monday at 10 AM?",
				sent_at: new Date(currentTime - 4500000).toISOString(), // 1.25 hours ago
			},
			{
				sender_id: userMap["john@example.com"],
				recipient_id: userMap["jane@example.com"],
				subject: "Document review",
				body: "Please review the attached document.",
				attachment_path: "/uploads/sample.pdf",
				sent_at: new Date(currentTime - 2700000).toISOString(), // 45 minutes ago
			},
			{
				sender_id: userMap["jane@example.com"],
				recipient_id: userMap["john@example.com"],
				subject: "Weekend plans",
				body: "Are you available this weekend for team building?",
				sent_at: new Date(currentTime - 1200000).toISOString(), // 20 minutes ago
			},
		];

		const emailValues = emailsToInsert.map((email) => [
			email.sender_id,
			email.recipient_id,
			email.subject,
			email.body,
			email.attachment_path || null,
			email.sent_at,
			false, // is_deleted_by_sender
			false, // is_deleted_by_recipient
		]);

		await connection.query(
			`
            INSERT INTO emails 
            (sender_id, recipient_id, subject, body, attachment_path, sent_at, is_deleted_by_sender, is_deleted_by_recipient)
            VALUES ?
        `,
			[emailValues]
		);

		console.log("Sample emails inserted");

		// Close the connection
		await connection.end();
		console.log("Database setup completed successfully");
	} catch (error) {
		console.error("Error setting up database:", error);
		process.exit(1);
	}
}

// Run the setup
main();
