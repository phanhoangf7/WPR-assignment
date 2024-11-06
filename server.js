const express = require("express");
const exphbs = require("express-handlebars");
const mysql = require("mysql2/promise");
const cookieParser = require("cookie-parser");
const path = require("path");
require("dotenv").config();
const emailRoutes = require("./routes/email");

const app = express();
app.use("/", emailRoutes);
// Database connection pool
const pool = mysql.createPool({
	host: process.env.DB_HOST,
	user: process.env.DB_USER,
	password: process.env.DB_PASS,
	database: process.env.DB_NAME,
	port: process.env.DB_PORT,
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0,
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// Configure Handlebars
const hbs = exphbs.create({
	layoutsDir: path.join(__dirname, "views/layouts"),
	partialsDir: path.join(__dirname, "views/partials"),
	extname: ".handlebars", // Note the dot before handlebars
	defaultLayout: "main",
});

// Use the hbs instance as the view engine
app.engine("handlebars", hbs.engine);
app.set("view engine", "handlebars");

// Make the database pool available in all routes
app.use((req, res, next) => {
	req.db = pool;
	next();
});

// Authentication middleware
const authenticateUser = async (req, res, next) => {
	const userId = req.cookies.userId;
	if (!userId) {
		// If accessing a protected route, redirect to signin
		if (req.path !== "/" && req.path !== "/signup") {
			return res.redirect("/");
		}
		return next();
	}

	try {
		const [rows] = await req.db.query("SELECT * FROM users WHERE id = ?", [
			userId,
		]);
		if (rows.length > 0) {
			req.user = rows[0];
			next();
		} else {
			res.clearCookie("userId");
			res.redirect("/");
		}
	} catch (error) {
		console.error("Auth error:", error);
		res.status(500).render("error", {
			message: "Authentication error",
			error: { status: 500 },
		});
	}
};

// Routes
app.get("/signin", async (req, res) => {
	if (req.user) {
		return res.redirect("/inbox");
	}
	res.render("signin");
});

app.get("/signup", (req, res) => {
	if (req.user) {
		return res.redirect("/inbox");
	}
	res.render("signup");
});

// Protected routes
app.use(authenticateUser);

app.get("/inbox", async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = 5;
		const offset = (page - 1) * limit;

		const [emails] = await req.db.query(
			`
            SELECT 
                e.*,
                u.full_name as sender_name
            FROM emails e
            JOIN users u ON e.sender_id = u.id
            WHERE e.recipient_id = ? 
            AND e.is_deleted_by_recipient = FALSE
            ORDER BY e.sent_at DESC
            LIMIT ? OFFSET ?
        `,
			[req.user.id, limit, offset]
		);

		const [totalRows] = await req.db.query(
			"SELECT COUNT(*) as count FROM emails WHERE recipient_id = ? AND is_deleted_by_recipient = FALSE",
			[req.user.id]
		);

		const totalPages = Math.ceil(totalRows[0].count / limit);

		res.render("inbox", {
			emails,
			pagination: {
				current: page,
				pages: totalPages,
			},
			user: req.user,
		});
	} catch (error) {
		console.error("Inbox error:", error);
		res.status(500).render("error", {
			message: "Error loading inbox",
			error: { status: 500 },
		});
	}
});

// Error handling
app.use((req, res, next) => {
	res.status(404).render("error", {
		message: "Page not found",
		error: { status: 404 },
	});
});

app.use((err, req, res, next) => {
	console.error(err.stack);
	res.status(500).render("error", {
		message: err.message,
		error: { status: 500 },
	});
});
const { router: authRouter, requireAuth } = require("./routes/auth");
app.use(authRouter);

// Protected routes
app.use("/inbox", requireAuth);
app.use("/outbox", requireAuth);
app.use("/compose", requireAuth);
app.use("/email", requireAuth);

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
// Start server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
