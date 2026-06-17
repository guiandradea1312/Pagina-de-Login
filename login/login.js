// URL base da API do backend.
const URL_API = "/api";
// Chave do token de autenticação.
const CHAVE_TOKEN = "authToken";

// Referências para os elementos da interface de login.
const formularioLogin = document.getElementById("formularioLogin");
const campoIdentificador = document.getElementById("identificador");
const campoSenhaLogin = document.getElementById("senhaLogin");
const mensagemLogin = document.getElementById("mensagemLogin");

// Remove máscara/símbolos do telefone e deixa apenas números para comparar.
function normalizarTelefone(valor) {
  let digitos = valor.replace(/\D/g, "");
  if (digitos.length > 11 && digitos.startsWith("55")) {
    digitos = digitos.slice(2);
  }
  return digitos;
}

function normalizarGmail(valor) {
  const email = valor.trim().toLowerCase();
  if (!email.endsWith("@gmail.com")) {
    return email;
  }

  const local = email.split("@")[0];
  const canonical = local.split("+")[0].replace(/\./g, "");
  return `${canonical}@gmail.com`;
}

// Mostra mensagens de retorno na tela (erro ou sucesso).
function mostrarMensagem(texto, tipo) {
  mensagemLogin.textContent = texto;
  mensagemLogin.className = `mensagem ${tipo}`;
}

// Intercepta o envio do formulário para autenticar no backend.
formularioLogin.addEventListener("submit", async function (evento) {
  evento.preventDefault();

  const identificador = campoIdentificador.value.trim();
  const senha = campoSenhaLogin.value;

  if (!identificador) {
    mostrarMensagem("Informe Gmail, telefone ou CPF.", "erro");
    return;
  }

  // Se tiver "@", trata como e-mail; se não, trata como telefone.
  const eEmail = identificador.includes("@");
  const identificadorNormalizado = eEmail
    ? normalizarGmail(identificador)
    : normalizarTelefone(identificador);

  try {
    const resposta = await fetch(`${URL_API}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        identificador: identificadorNormalizado,
        senha: senha
      })
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      mostrarMensagem(dados.message || "Login inválido.", "erro");
      return;
    }

    // Salva token para uso nas próximas requisições.
    localStorage.setItem(CHAVE_TOKEN, dados.token);
    window.location.href = "../perfil/perfil.html";
  } catch (erro) {
    mostrarMensagem("Não foi possível conectar ao backend.", "erro");
  }
});