// backend/smtpChecker.js

const fs = require("fs").promises;
const readline = require("readline");
const nodemailer = require("nodemailer");
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("worker_threads");

// Function to parse the file and extract email:password pairs
async function parseFile(filePath) {
  const fileStream = await fs.open(filePath, "r");
  const rl = readline.createInterface({
    input: fileStream.createReadStream(),
    crlfDelay: Infinity,
  });

  const accounts = [];
  for await (const line of rl) {
    const [email, password] = line.split(":");
    if (email && password) {
      accounts.push({ email, password });
    }
  }

  return accounts;
}

// Function to test SMTP connection
async function testSMTPConnection(email, password) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: email,
      pass: password,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  try {
    await transporter.verify();
    return { email, status: "working" };
  } catch (error) {
    return { email, status: "dead", error: error.message };
  }
}

// Worker thread function
function workerFunction(account) {
  testSMTPConnection(account.email, account.password).then((result) =>
    parentPort.postMessage(result)
  );
}

// Main function to check SMTP accounts
async function checkSMTPAccounts(filePath, concurrency = 5) {
  const accounts = await parseFile(filePath);
  const results = [];
  const workers = new Set();

  return new Promise((resolve, reject) => {
    function startWorker(account) {
      const worker = new Worker(__filename, {
        workerData: account,
      });
      workers.add(worker);

      worker.on("message", (result) => {
        results.push(result);
        workers.delete(worker);

        if (accounts.length > 0) {
          startWorker(accounts.pop());
        } else if (workers.size === 0) {
          resolve(results);
        }
      });

      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    }

    // Start initial batch of workers
    for (let i = 0; i < Math.min(concurrency, accounts.length); i++) {
      startWorker(accounts.pop());
    }
  });
}

if (isMainThread) {
  module.exports = { checkSMTPAccounts };
} else {
  workerFunction(workerData);
}
