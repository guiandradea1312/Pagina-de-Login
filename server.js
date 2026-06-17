const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "database.sqlite");
const db = new sqlite3.Database(DB_PATH);

function run(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function get(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, function onGet(error, row) {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function all(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, function onAll(error, rows) {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

function normalizePhone(value = "") {
  let digits = String(value).replace(/\D/g, "");
  if (digits.length > 11 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  return digits;
}

function normalizeCpf(value = "") {
  return String(value).replace(/\D/g, "");
}

function normalizeEmail(value = "") {
  const email = String(value).trim().toLowerCase();
  if (!email) {
    return "";
  }

  if (!email.endsWith("@gmail.com")) {
    return email;
  }

  const localPart = email.split("@")[0];
  const canonicalLocal = localPart.split("+")[0].replace(/\./g, "");
  return `${canonicalLocal}@gmail.com`;
}

function toNullable(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function publicUser(user) {
  return {
    id: user.id,
    nome: user.nome,
    idade: user.idade,
    sexo: user.sexo,
    telefone: user.telefone,
    cpf: user.cpf,
    email: user.email
  };
}

async function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  await run("INSERT INTO sessions (token, user_id) VALUES (?, ?)", [token, userId]);
  return token;
}

async function authMiddleware(request, response, next) {
  try {
    const authorization = request.headers.authorization || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : authorization;

    if (!token) {
      response.status(401).json({ message: "Token não informado." });
      return;
    }

    const session = await get(
      `
        SELECT s.token, u.id, u.nome, u.idade, u.sexo, u.telefone, u.cpf, u.email
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
      `,
      [token]
    );

    if (!session) {
      response.status(401).json({ message: "Sessão inválida." });
      return;
    }

    request.token = token;
    request.user = publicUser(session);
    next();
  } catch (error) {
    response.status(500).json({ message: "Erro ao validar sessão." });
  }
}

async function initializeDatabase() {
  await run(
    `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        idade INTEGER NOT NULL,
        sexo TEXT NOT NULL,
        telefone TEXT UNIQUE,
        cpf TEXT NOT NULL UNIQUE,
        email TEXT UNIQUE,
        senha_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
  );

  await run(
    `
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `
  );

  const usersWithEmail = await all(
    `
      SELECT id, email
      FROM users
      WHERE email IS NOT NULL
    `
  );

  for (const user of usersWithEmail) {
    const normalized = normalizeEmail(user.email);
    if (normalized && normalized !== user.email) {
      await run("UPDATE users SET email = ? WHERE id = ?", [normalized, user.id]);
    }
  }
}

async function startServer() {
  await initializeDatabase();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(__dirname));

  app.get("/", function root(request, response) {
    response.redirect("/login/login.html");
  });

  app.get("/api/health", function health(request, response) {
    response.json({ status: "ok" });
  });

  app.post("/api/auth/register", async function register(request, response) {
    try {
      const nome = toNullable(request.body.nome);
      const idade = Number(request.body.idade);
      const sexo = toNullable(request.body.sexo);
      const cpf = normalizeCpf(request.body.cpf);
      const telefone = toNullable(normalizePhone(request.body.telefone));
      const emailRaw = toNullable(request.body.email);
      const email = emailRaw ? normalizeEmail(emailRaw) : null;
      const senha = toNullable(request.body.senha);

      if (!nome || !sexo || !senha || !idade) {
        response.status(400).json({ message: "Preencha os campos obrigatórios." });
        return;
      }

      if (!email && !telefone) {
        response.status(400).json({ message: "Informe telefone ou Gmail para cadastro." });
        return;
      }

      if (email && !email.endsWith("@gmail.com")) {
        response.status(400).json({ message: "Informe um Gmail válido." });
        return;
      }

      if (telefone && (telefone.length < 10 || telefone.length > 11)) {
        response.status(400).json({ message: "Telefone inválido." });
        return;
      }

      if (cpf.length !== 11) {
        response.status(400).json({ message: "CPF inválido." });
        return;
      }

      if (senha.length < 6) {
        response.status(400).json({ message: "A senha deve ter pelo menos 6 caracteres." });
        return;
      }

      const senhaHash = await bcrypt.hash(senha, 10);
      const insertResult = await run(
        `
          INSERT INTO users (nome, idade, sexo, telefone, cpf, email, senha_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [nome, idade, sexo, telefone, cpf, email, senhaHash]
      );

      const user = await get(
        `
          SELECT id, nome, idade, sexo, telefone, cpf, email
          FROM users
          WHERE id = ?
        `,
        [insertResult.lastID]
      );

      const token = await createSession(user.id);
      response.status(201).json({ token, user: publicUser(user) });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        response.status(409).json({ message: "Já existe usuário com este e-mail, telefone ou CPF." });
        return;
      }
      response.status(500).json({ message: "Erro ao cadastrar usuário." });
    }
  });

  app.post("/api/auth/login", async function login(request, response) {
    try {
      const identificador = toNullable(request.body.identificador);
      const senha = toNullable(request.body.senha);

      if (!identificador || !senha) {
        response.status(400).json({ message: "Informe identificador e senha." });
        return;
      }

      const isEmail = identificador.includes("@");
      const emailRaw = isEmail ? identificador.toLowerCase() : "__NO_EMAIL__";
      const emailCanonical = isEmail ? normalizeEmail(identificador) : "__NO_EMAIL__";
      const phoneNormalized = isEmail ? "__NO_PHONE__" : normalizePhone(identificador);

      const user = await get(
        `
          SELECT id, nome, idade, sexo, telefone, cpf, email, senha_hash
          FROM users
          WHERE (email IS NOT NULL AND lower(email) IN (?, ?))
             OR (telefone IS NOT NULL AND telefone = ?)
        `,
        [emailRaw, emailCanonical, phoneNormalized]
      );

      if (!user) {
        response.status(401).json({ message: "Login inválido." });
        return;
      }

      const passwordMatch = await bcrypt.compare(senha, user.senha_hash);
      if (!passwordMatch) {
        response.status(401).json({ message: "Login inválido." });
        return;
      }

      const token = await createSession(user.id);
      response.json({ token, user: publicUser(user) });
    } catch (error) {
      response.status(500).json({ message: "Erro ao efetuar login." });
    }
  });

  app.post("/api/auth/forgot-password", async function forgotPassword(request, response) {
    try {
      const identificador = toNullable(request.body.identificador);
      const novaSenha = toNullable(request.body.novaSenha);

      if (!identificador || !novaSenha) {
        response.status(400).json({ message: "Informe identificador e nova senha." });
        return;
      }

      if (novaSenha.length < 6) {
        response.status(400).json({ message: "A nova senha deve ter ao menos 6 caracteres." });
        return;
      }

      const isEmail = identificador.includes("@");
      const emailRaw = isEmail ? identificador.toLowerCase() : "__NO_EMAIL__";
      const emailCanonical = isEmail ? normalizeEmail(identificador) : "__NO_EMAIL__";
      const phoneNormalized = isEmail ? "__NO_PHONE__" : normalizePhone(identificador);

      const user = await get(
        `
          SELECT id
          FROM users
          WHERE (email IS NOT NULL AND lower(email) IN (?, ?))
             OR (telefone IS NOT NULL AND telefone = ?)
        `,
        [emailRaw, emailCanonical, phoneNormalized]
      );

      if (!user) {
        response.status(404).json({ message: "Usuário não encontrado." });
        return;
      }

      const senhaHash = await bcrypt.hash(novaSenha, 10);
      await run("UPDATE users SET senha_hash = ? WHERE id = ?", [senhaHash, user.id]);
      await run("DELETE FROM sessions WHERE user_id = ?", [user.id]);

      response.json({ message: "Senha atualizada com sucesso." });
    } catch (error) {
      response.status(500).json({ message: "Erro ao atualizar senha." });
    }
  });

  app.get("/api/users/me", authMiddleware, async function me(request, response) {
    response.json({ user: request.user });
  });

  app.post("/api/auth/logout", authMiddleware, async function logout(request, response) {
    try {
      await run("DELETE FROM sessions WHERE token = ?", [request.token]);
      response.json({ message: "Sessão encerrada." });
    } catch (error) {
      response.status(500).json({ message: "Erro ao encerrar sessão." });
    }
  });

  const httpServer = app.listen(PORT, function onListen() {
    // eslint-disable-next-line no-console
    console.log(`Backend iniciado em http://localhost:${PORT}`);
  });

  httpServer.on("close", function onClose() {
    // eslint-disable-next-line no-console
    console.log("Servidor HTTP foi encerrado.");
  });
}

startServer().catch(function onStartError(error) {
  // eslint-disable-next-line no-console
  console.error("Falha ao iniciar backend:", error);
  process.exit(1);
});
