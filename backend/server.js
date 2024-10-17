// backend/server.js

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const multer = require("multer");
const nodemailer = require("nodemailer");
const cors = require("cors");
const dotenv = require("dotenv");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === "text/plain") {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only .txt files are allowed."), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 1024 * 1024 * 5, // 5MB limit
  },
});

// Routes
app.get("/", (req, res) => {
  res.send("Mailers Toolz API is running");
});

// File upload route
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const filePath = req.file.path;

  // File content validation
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      return res.status(500).json({ error: "Error reading file." });
    }

    const lines = data.split("\n");
    const invalidLines = [];

    lines.forEach((line, index) => {
      if (!line.includes("@gmail.com:")) {
        invalidLines.push(index + 1);
      }
    });

    if (invalidLines.length > 0) {
      fs.unlinkSync(filePath); // Delete the invalid file
      return res.status(400).json({
        error: "Invalid file format.",
        invalidLines: invalidLines,
      });
    }

    // If we reach here, the file is valid
    res.status(200).json({
      message: "File uploaded and validated successfully.",
      filename: req.file.filename,
    });

    // Emit a socket event to notify about successful upload
    io.emit("fileUploaded", { filename: req.file.filename });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ error: "File size limit exceeded. Maximum size is 5MB." });
    }
  }
  res.status(500).json({ error: err.message || "Something went wrong!" });
});

// Socket.IO connection
io.on("connection", (socket) => {
  console.log("New client connected");
  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
  });
});
