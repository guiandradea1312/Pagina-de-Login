const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");
const multer = require("multer");
const { Pool: PgPool } = require("pg");
const { newDb } = require("pg-mem");
const xlsx = require("xlsx");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const LOCAL_DB_MODE = process.env.LOCAL_DB_MODE || "memory";
const LOCAL_DATA_FILE = path.join(__dirname, "local-data.json");
const FORM_API_KEY = process.env.FORM_API_KEY || "";

function getPoolConfig() {
  if (DATABASE_URL) {
    return {
      connectionString: DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
    };
  }

  return {
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || "postgres",
    ssl: false
  };
}

function createPool() {
  if (DATABASE_URL) {
    return {
      pool: new PgPool(getPoolConfig()),
      mode: "remote-postgres",
      ready: Promise.resolve()
    };
  }

  if (LOCAL_DB_MODE === "postgres") {
    return {
      pool: new PgPool(getPoolConfig()),
      mode: "local-postgres",
      ready: Promise.resolve()
    };
  }

  const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
  const { Client: MemoryClient } = memoryDb.adapters.createPg();
  const memoryClient = new MemoryClient();
  return {
    pool: memoryClient,
    mode: "memory",
    ready: memoryClient.connect()
  };
}

const { pool, mode: dbMode, ready: dbReady } = createPool();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

function isMemoryMode() {
  return dbMode === "memory";
}

async function persistLocalData() {
  if (!isMemoryMode()) {
    return;
  }

  const usersResult = await query(
    `
      SELECT id, nome, idade, sexo, telefone, cpf, email, senha_hash, created_at
      FROM users
      ORDER BY id
    `
  );

  const clientsResult = await query(
    `
      SELECT id, nome, cpf, telefone, email, cidade, created_at, updated_at
      FROM clients
      ORDER BY id
    `
  );

  const payload = {
    users: usersResult.rows,
    clients: clientsResult.rows
  };

  await fs.writeFile(LOCAL_DATA_FILE, JSON.stringify(payload, null, 2), "utf8");
}

async function loadLocalData() {
  if (!isMemoryMode()) {
    return;
  }

  let parsed;

  try {
    const content = await fs.readFile(LOCAL_DATA_FILE, "utf8");
    parsed = JSON.parse(content);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  const users = Array.isArray(parsed.users) ? parsed.users : [];
  const clients = Array.isArray(parsed.clients) ? parsed.clients : [];

  for (const user of users) {
    await query(
      `
        INSERT INTO users (nome, idade, sexo, telefone, cpf, email, senha_hash, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (cpf) DO NOTHING
      `,
      [
        user.nome,
        user.idade,
        user.sexo,
        user.telefone,
        user.cpf,
        user.email,
        user.senha_hash,
        user.created_at
      ]
    );
  }

  for (const client of clients) {
    await query(
      `
        INSERT INTO clients (nome, cpf, telefone, email, cidade, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (cpf) DO NOTHING
      `,
      [
        client.nome,
        client.cpf,
        client.telefone,
        client.email,
        client.cidade,
        client.created_at,
        client.updated_at
      ]
    );
  }
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

function publicClient(client) {
  return {
    id: client.id,
    nome: client.nome,
    cpf: client.cpf,
    telefone: client.telefone,
    email: client.email,
    cidade: client.cidade,
    created_at: client.created_at
  };
}

function normalizeSearchText(value = "") {
  return String(value).trim();
}

function normalizeColumnName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getRowValue(row, aliases = []) {
  const entries = Object.entries(row || {});

  for (const alias of aliases) {
    const normalizedAlias = normalizeColumnName(alias);

    for (const [key, value] of entries) {
      if (normalizeColumnName(key) === normalizedAlias) {
        return value;
      }
    }
  }

  return undefined;
}

function normalizeClientEmail(value = "") {
  return toNullable(String(value).trim().toLowerCase());
}

function parseClientRow(row) {
  return {
    nome: toNullable(getRowValue(row, ["nome", "nome completo"])),
    cpf: normalizeCpf(getRowValue(row, ["cpf"])),
    telefone: toNullable(normalizePhone(getRowValue(row, ["telefone", "celular"]))),
    email: normalizeClientEmail(getRowValue(row, ["email", "e-mail"])),
    cidade: toNullable(getRowValue(row, ["cidade", "municipio", "município"]))
  };
}

function parseClientPayload(payload) {
  return {
    nome: toNullable(
      payload.nome
      || payload.Nome
      || payload["Nome completo"]
      || payload.nomeCompleto
    ),
    cpf: normalizeCpf(payload.cpf || payload.CPF),
    telefone: toNullable(normalizePhone(payload.telefone || payload.Telefone || payload.celular || payload.Celular)),
    email: normalizeClientEmail(payload.email || payload.Email || payload["E-mail"]),
    cidade: toNullable(payload.cidade || payload.Cidade || payload.municipio || payload.Municipio)
  };
}

function isClientRowEmpty(client) {
  return !client.nome
    && !client.cpf
    && !client.telefone
    && !client.email
    && !client.cidade;
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

  await query(
    `
      CREATE TABLE IF NOT EXISTS clients (
        id BIGSERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        cpf TEXT NOT NULL UNIQUE,
        telefone TEXT,
        email TEXT,
        cidade TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
  );

  await query("CREATE INDEX IF NOT EXISTS clients_nome_idx ON clients (lower(nome))");
  await query("CREATE INDEX IF NOT EXISTS clients_cidade_idx ON clients (lower(cidade))");

  await loadLocalData();

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
  await dbReady;
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

      if (email) {
        const emailCandidates = await query(
          `
            SELECT id, email
            FROM users
            WHERE email IS NOT NULL
          `
        );

        const duplicatedCanonical = emailCandidates.rows.some(function (row) {
          return normalizeEmail(row.email) === email;
        });

        if (duplicatedCanonical) {
          response.status(409).json({ message: "Já existe usuário com este e-mail, telefone ou CPF." });
          return;
        }
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
      await persistLocalData();
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

  app.get("/api/clientes", authMiddleware, async function listClients(request, response) {
    try {
      const nome = normalizeSearchText(request.query.nome);
      const cidade = normalizeSearchText(request.query.cidade);
      const conditions = [];
      const values = [];

      if (nome) {
        values.push(`%${nome}%`);
        conditions.push(`nome ILIKE $${values.length}`);
      }

      if (cidade) {
        values.push(`%${cidade}%`);
        conditions.push(`cidade ILIKE $${values.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const result = await query(
        `
          SELECT id, nome, cpf, telefone, email, cidade, created_at
          FROM clients
          ${whereClause}
          ORDER BY nome ASC, created_at DESC
        `,
        values
      );

      response.json({ clientes: result.rows.map(publicClient) });
    } catch (error) {
      response.status(500).json({ message: "Erro ao listar clientes." });
    }
  });

  app.post("/api/clientes", authMiddleware, async function createClient(request, response) {
    try {
      const nome = toNullable(request.body.nome);
      const cpf = normalizeCpf(request.body.cpf);
      const telefone = toNullable(normalizePhone(request.body.telefone));
      const email = normalizeClientEmail(request.body.email);
      const cidade = toNullable(request.body.cidade);

      if (!nome || !cpf || !cidade) {
        response.status(400).json({ message: "Informe nome, CPF e cidade." });
        return;
      }

      if (cpf.length !== 11) {
        response.status(400).json({ message: "CPF inválido." });
        return;
      }

      if (telefone && (telefone.length < 10 || telefone.length > 11)) {
        response.status(400).json({ message: "Telefone inválido." });
        return;
      }

      const result = await query(
        `
          INSERT INTO clients (nome, cpf, telefone, email, cidade)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (cpf)
          DO UPDATE SET
            nome = EXCLUDED.nome,
            telefone = EXCLUDED.telefone,
            email = EXCLUDED.email,
            cidade = EXCLUDED.cidade,
            updated_at = NOW()
          RETURNING id, nome, cpf, telefone, email, cidade, created_at
        `,
        [nome, cpf, telefone, email, cidade]
      );

      await persistLocalData();
      response.status(201).json({ message: "Cliente salvo com sucesso.", client: publicClient(result.rows[0]) });
    } catch (error) {
      response.status(500).json({ message: "Erro ao cadastrar cliente." });
    }
  });

  app.put("/api/clientes/:id", authMiddleware, async function updateClient(request, response) {
    try {
      const id = Number(request.params.id);
      const nome = toNullable(request.body.nome);
      const cpf = normalizeCpf(request.body.cpf);
      const telefone = toNullable(normalizePhone(request.body.telefone));
      const email = normalizeClientEmail(request.body.email);
      const cidade = toNullable(request.body.cidade);

      if (!Number.isInteger(id) || id <= 0) {
        response.status(400).json({ message: "Cliente inválido." });
        return;
      }

      if (!nome || !cpf || !cidade) {
        response.status(400).json({ message: "Informe nome, CPF e cidade." });
        return;
      }

      if (cpf.length !== 11) {
        response.status(400).json({ message: "CPF inválido." });
        return;
      }

      if (telefone && (telefone.length < 10 || telefone.length > 11)) {
        response.status(400).json({ message: "Telefone inválido." });
        return;
      }

      const result = await query(
        `
          UPDATE clients
          SET nome = $1,
              cpf = $2,
              telefone = $3,
              email = $4,
              cidade = $5,
              updated_at = NOW()
          WHERE id = $6
          RETURNING id, nome, cpf, telefone, email, cidade, created_at
        `,
        [nome, cpf, telefone, email, cidade, id]
      );

      if (result.rows.length === 0) {
        response.status(404).json({ message: "Cliente não encontrado." });
        return;
      }

      await persistLocalData();
      response.json({ message: "Cliente atualizado com sucesso.", client: publicClient(result.rows[0]) });
    } catch (error) {
      if (error && error.code === "23505") {
        response.status(409).json({ message: "Já existe cliente com este CPF." });
        return;
      }

      response.status(500).json({ message: "Erro ao atualizar cliente." });
    }
  });

  app.delete("/api/clientes/:id", authMiddleware, async function deleteClient(request, response) {
    try {
      const id = Number(request.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        response.status(400).json({ message: "Cliente inválido." });
        return;
      }

      const result = await query(
        `
          DELETE FROM clients
          WHERE id = $1
          RETURNING id
        `,
        [id]
      );

      if (result.rows.length === 0) {
        response.status(404).json({ message: "Cliente não encontrado." });
        return;
      }

      await persistLocalData();
      response.json({ message: "Cliente apagado com sucesso." });
    } catch (error) {
      response.status(500).json({ message: "Erro ao apagar cliente." });
    }
  });

  app.post("/api/public/clientes", async function createClientPublic(request, response) {
    try {
      if (!FORM_API_KEY) {
        response.status(503).json({ message: "Integração pública indisponível." });
        return;
      }

      const informedKey = toNullable(
        request.headers["x-form-api-key"]
        || request.query.key
        || request.body.apiKey
      );

      if (!informedKey || informedKey !== FORM_API_KEY) {
        response.status(401).json({ message: "Chave de integração inválida." });
        return;
      }

      const cliente = parseClientPayload(request.body || {});

      if (!cliente.nome || !cliente.cpf || !cliente.cidade) {
        response.status(400).json({ message: "Informe nome, CPF e cidade." });
        return;
      }

      if (cliente.cpf.length !== 11) {
        response.status(400).json({ message: "CPF inválido." });
        return;
      }

      if (cliente.telefone && (cliente.telefone.length < 10 || cliente.telefone.length > 11)) {
        response.status(400).json({ message: "Telefone inválido." });
        return;
      }

      const result = await query(
        `
          INSERT INTO clients (nome, cpf, telefone, email, cidade)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (cpf)
          DO UPDATE SET
            nome = EXCLUDED.nome,
            telefone = EXCLUDED.telefone,
            email = EXCLUDED.email,
            cidade = EXCLUDED.cidade,
            updated_at = NOW()
          RETURNING id, nome, cpf, telefone, email, cidade, created_at
        `,
        [cliente.nome, cliente.cpf, cliente.telefone, cliente.email, cliente.cidade]
      );

      await persistLocalData();
      response.status(201).json({ message: "Cliente recebido com sucesso.", client: publicClient(result.rows[0]) });
    } catch (error) {
      response.status(500).json({ message: "Erro ao cadastrar cliente pela integração." });
    }
  });

  app.post("/api/clientes/importar", authMiddleware, upload.single("arquivo"), async function importClients(request, response) {
    try {
      if (!request.file) {
        response.status(400).json({ message: "Envie um arquivo Excel." });
        return;
      }

      const workbook = xlsx.read(request.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];

      if (!sheetName) {
        response.status(400).json({ message: "O arquivo não possui planilhas." });
        return;
      }

      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
      const erros = [];
      let processados = 0;

      for (let indice = 0; indice < rows.length; indice += 1) {
        const linha = indice + 2;
        const cliente = parseClientRow(rows[indice]);

        if (isClientRowEmpty(cliente)) {
          // Linhas completamente vazias da planilha devem ser ignoradas.
          continue;
        }

        if (!cliente.nome || !cliente.cpf || !cliente.cidade) {
          erros.push({ linha, message: "Informe nome, CPF e cidade." });
          continue;
        }

        if (cliente.cpf.length !== 11) {
          erros.push({ linha, message: "CPF inválido." });
          continue;
        }

        if (cliente.telefone && (cliente.telefone.length < 10 || cliente.telefone.length > 11)) {
          erros.push({ linha, message: "Telefone inválido." });
          continue;
        }

        await query(
          `
            INSERT INTO clients (nome, cpf, telefone, email, cidade)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (cpf)
            DO UPDATE SET
              nome = EXCLUDED.nome,
              telefone = EXCLUDED.telefone,
              email = EXCLUDED.email,
              cidade = EXCLUDED.cidade,
              updated_at = NOW()
          `,
          [cliente.nome, cliente.cpf, cliente.telefone, cliente.email, cliente.cidade]
        );
        processados += 1;
      }

      await persistLocalData();

      response.json({
        message: "Importação concluída.",
        processados,
        erros
      });
    } catch (error) {
      response.status(500).json({ message: "Erro ao importar clientes." });
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
      let candidates = [];

      if (isEmail) {
        const emailRaw = identificador.toLowerCase().trim();
        const emailCanonical = normalizeEmail(identificador);
        const result = await query(
          `
            SELECT id, nome, idade, sexo, telefone, cpf, email, senha_hash
            FROM users
            WHERE email IS NOT NULL
          `
        );

        candidates = result.rows.filter(function (user) {
          const storedRaw = String(user.email || "").trim().toLowerCase();
          const storedCanonical = normalizeEmail(user.email || "");
          return storedRaw === emailRaw
            || storedRaw === emailCanonical
            || storedCanonical === emailRaw
            || storedCanonical === emailCanonical;
        });
      } else {
        const identifierDigits = normalizePhone(identificador);
        const cpfDigits = normalizeCpf(identificador);
        const result = await query(
          `
            SELECT id, nome, idade, sexo, telefone, cpf, email, senha_hash
            FROM users
            WHERE telefone IS NOT NULL OR cpf IS NOT NULL
          `
        );

        candidates = result.rows.filter(function (user) {
          return normalizePhone(user.telefone || "") === identifierDigits
            || normalizeCpf(user.cpf || "") === cpfDigits;
        });
      }

      if (candidates.length === 0) {
        response.status(401).json({ message: "Login inválido." });
        return;
      }

      let authenticatedUser = null;
      for (const candidate of candidates) {
        // Garante o usuário correto quando há mais de um possível match canônico.
        // eslint-disable-next-line no-await-in-loop
        const passwordMatch = await bcrypt.compare(senha, candidate.senha_hash);
        if (passwordMatch) {
          authenticatedUser = candidate;
          break;
        }
      }

      if (!authenticatedUser) {
        response.status(401).json({ message: "Login inválido." });
        return;
      }

      const token = await createSession(authenticatedUser.id);
      response.json({ token, user: publicUser(authenticatedUser) });
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

      await persistLocalData();

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
    console.log(`Backend iniciado em http://localhost:${PORT} (db: ${dbMode})`);
  });
}

startServer().catch(function onStartError(error) {
  // eslint-disable-next-line no-console
  console.error("Falha ao iniciar backend:", error);
  process.exit(1);
});
