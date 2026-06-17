// URL base da API e chave do token.
const URL_API = "/api";
const CHAVE_TOKEN = "authToken";

// Formata telefone para exibição amigável no perfil.
function formatarTelefone(valor) {
  const digitos = (valor || "").replace(/\D/g, "");
  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return valor || "-";
}

// Formata CPF para o padrão 000.000.000-00.
function formatarCpf(valor) {
  const digitos = (valor || "").replace(/\D/g, "");
  if (digitos.length !== 11) return valor || "-";
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

// Gera iniciais do nome para o avatar do cabeçalho.
function obterIniciais(nome) {
  const nomeCompleto = (nome || "").trim();
  if (!nomeCompleto) return "US";
  return nomeCompleto
    .split(/\s+/)
    .slice(0, 2)
    .map(function (parte) { return parte.charAt(0).toUpperCase(); })
    .join("");
}

// Preenche todos os elementos da interface com os dados do usuário.
function preencherPerfil(usuario) {
  document.getElementById("nome").textContent = usuario.nome || "-";
  document.getElementById("idade").textContent = usuario.idade || "-";
  document.getElementById("sexo").textContent = usuario.sexo || "-";
  document.getElementById("telefone").textContent = formatarTelefone(usuario.telefone);
  document.getElementById("cpf").textContent = formatarCpf(usuario.cpf);
  document.getElementById("email").textContent = usuario.email || "-";
  document.getElementById("nomeTitulo").textContent = usuario.nome || "usuário";
  document.getElementById("iniciaisUsuario").textContent = obterIniciais(usuario.nome);
  // Tags do cabeçalho indicam se email/telefone foram cadastrados.
  document.getElementById("tagEmail").textContent = usuario.email ? "Gmail cadastrado" : "Sem Gmail";
  document.getElementById("tagTelefone").textContent = usuario.telefone ? "Telefone cadastrado" : "Sem telefone";
}

// Carrega usuário autenticado a partir do backend usando token.
async function carregarPerfil() {
  const token = localStorage.getItem(CHAVE_TOKEN);
  if (!token) {
    window.location.href = "../login/login.html";
    return;
  }

  try {
    const resposta = await fetch(`${URL_API}/users/me`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!resposta.ok) {
      localStorage.removeItem(CHAVE_TOKEN);
      window.location.href = "../login/login.html";
      return;
    }

    const dados = await resposta.json();
    preencherPerfil(dados.user);
  } catch (erro) {
    window.location.href = "../login/login.html";
  }
}

carregarPerfil();

// Botão de logout encerra sessão no backend e remove token local.
document.getElementById("botaoSair").addEventListener("click", async function () {
  const token = localStorage.getItem(CHAVE_TOKEN);

  if (token) {
    try {
      await fetch(`${URL_API}/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
    } catch (erro) {
      // Mesmo com erro de rede, continua limpeza local.
    }
  }

  localStorage.removeItem(CHAVE_TOKEN);
  window.location.href = "../login/login.html";
});