// URL base da API do backend.
const URL_API = "/api";
// Chave do token de autenticação.
const CHAVE_TOKEN = "authToken";

// Elementos da interface de cadastro.
const formularioRegistro = document.getElementById("formularioRegistro");
const mensagemRegistro = document.getElementById("mensagemRegistro");
const campoTelefone = document.getElementById("telefone");

// Remove qualquer caractere que não seja número.
function somenteNumeros(valor) {
  let digitos = valor.replace(/\D/g, "");
  if (digitos.length > 11 && digitos.startsWith("55")) {
    digitos = digitos.slice(2);
  }
  return digitos;
}

// Formata telefone para (XX) XXXXX-XXXX enquanto o usuário digita.
function formatarTelefone(valor) {
  const digitos = somenteNumeros(valor).slice(0, 11);

  if (digitos.length <= 2) return digitos ? `(${digitos}` : "";
  if (digitos.length <= 6) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`;
  if (digitos.length <= 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
}

// Mostra mensagens de erro/sucesso abaixo do formulário.
function mostrarMensagem(texto, tipo) {
  mensagemRegistro.textContent = texto;
  mensagemRegistro.className = `mensagem ${tipo}`;
}

// Máscara de telefone ao digitar.
campoTelefone.addEventListener("input", function (evento) {
  evento.target.value = formatarTelefone(evento.target.value);
});

// Processa o envio do formulário, valida dados e cadastra via backend.
formularioRegistro.addEventListener("submit", async function (evento) {
  evento.preventDefault();

  const nome = document.getElementById("nome").value.trim();
  const idade = document.getElementById("idade").value.trim();
  const sexo = document.getElementById("sexo").value;
  const cpf = somenteNumeros(document.getElementById("cpf").value.trim());
  const telefone = somenteNumeros(document.getElementById("telefone").value.trim());
  const email = document.getElementById("email").value.trim().toLowerCase();
  const senha = document.getElementById("senhaRegistro").value;

  // Regra: usuário precisa informar pelo menos telefone ou Gmail.
  if (!email && !telefone) {
    mostrarMensagem("Informe telefone ou Gmail para cadastro.", "erro");
    return;
  }

  // Regra: quando preenchido, e-mail deve ser Gmail.
  if (email && !email.endsWith("@gmail.com")) {
    mostrarMensagem("Informe um Gmail válido (ex: nome@gmail.com).", "erro");
    return;
  }

  // Regra: telefone deve ter DDD + número.
  if (telefone && telefone.length < 10) {
    mostrarMensagem("Telefone inválido. Informe DDD + número.", "erro");
    return;
  }

  // Regra: CPF deve ter 11 dígitos.
  if (cpf.length !== 11) {
    mostrarMensagem("CPF inválido. Informe 11 dígitos.", "erro");
    return;
  }

  try {
    const resposta = await fetch(`${URL_API}/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        nome: nome,
        idade: Number(idade),
        sexo: sexo,
        telefone: telefone,
        cpf: cpf,
        email: email,
        senha: senha
      })
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      mostrarMensagem(dados.message || "Não foi possível cadastrar.", "erro");
      return;
    }

    // Salva token da sessão recém-criada e redireciona para perfil.
    localStorage.setItem(CHAVE_TOKEN, dados.token);
    window.location.href = "../perfil/perfil.html";
  } catch (erro) {
    mostrarMensagem("Não foi possível conectar ao backend.", "erro");
  }
});