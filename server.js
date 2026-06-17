const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error("Falta DATABASE_URL no ambiente.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
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
  await query("INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [token, userId]);
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

    const result = await query(
      `
        SELECT s.token, u.id, u.nome, u.idade, u.sexo, u.telefone, u.cpf, u.email
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = $1
      `,
      [token]
    );

    if (result.rows.length === 0) {
      response.status(401).json({ message: "Sessão inválida." });
      return;
    }

    request.token = token;
    request.user = publicUser(result.rows[0]);
    next();
  } catch (error) {
    response.status(500).json({ message: "Erro ao validar sessão." });
  }
}

async function initializeDatabase() {
  await query(
    `
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        idade INTEGER NOT NULL,
        sexo TEXT NOT NULL,
        telefone TEXT UNIQUE,
        cpf TEXT NOT NULL UNIQUE,
        email TEXT UNIQUE,
        senha_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
  );

  await query(
    `
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
  );

  const usersWithEmail = await query(
    `
      SELECT id, email
      FROM users
      WHERE email IS NOT NULL
    `
  );

  for (const user of usersWithEmail.rows) {
    const normalized = normalizeEmail(user.email);
    if (normalized && normalized !== user.email) {
      await query("UPDATE users SET email = $1 WHERE id = $2", [normalized, user.id]);
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
      const insertResult = await query(
        `
          INSERT INTO users (nome, idade, sexo, telefone, cpf, email, senha_hash)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, nome, idade, sexo, telefone, cpf, email
        `,
        [nome, idade, sexo, telefone, cpf, email, senhaHash]
      );

      const user = insertResult.rows[0];
      const token = await createSession(user.id);
      response.status(201).json({ token, user: publicUser(user) });
    } catch (error) {
      if (error && error.code === "23505") {
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

      const result = await query(
        `
          SELECT id, nome, idade, sexo, telefone, cpf, email, senha_hash
          FROM users
          WHERE (email IS NOT NULL AND lower(email) IN ($1, $2))
             OR (telefone IS NOT NULL AND telefone = $3)
          LIMIT 1
        `,
        [emailRaw, emailCanonical, phoneNormalized]
      );

      if (result.rows.length === 0) {
        response.status(401).json({ message: "Login inválido." });
        return;
      }

      const user = result.rows[0];
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

      const result = await query(
        `
          SELECT id
          FROM users
          WHERE (email IS NOT NULL AND lower(email) IN ($1, $2))
             OR (telefone IS NOT NULL AND telefone = $3)
          LIMIT 1
        `,
        [emailRaw, emailCanonical, phoneNormalized]
      );

      if (result.rows.length === 0) {
        response.status(404).json({ message: "Usuário não encontrado." });
        return;
      }

      const user = result.rows[0];
      const senhaHash = await bcrypt.hash(novaSenha, 10);
      await query("UPDATE users SET senha_hash = $1 WHERE id = $2", [senhaHash, user.id]);
      await query("DELETE FROM sessions WHERE user_id = $1", [user.id]);

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
      await query("DELETE FROM sessions WHERE token = $1", [request.token]);
      response.json({ message: "Sessão encerrada." });
    } catch (error) {
      response.status(500).json({ message: "Erro ao encerrar sessão." });
    }
  });

  app.listen(PORT, function onListen() {
    // eslint-disable-next-line no-console
    console.log(`Backend iniciado em http://localhost:${PORT}`);
  });
}

startServer().catch(function onStartError(error) {
  // eslint-disable-next-line no-console
  console.error("Falha ao iniciar backend:", error);
  process.exit(1);
});
