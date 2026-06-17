// URL base da API do backend.
const URL_API = "http://localhost:3000/api";

// Elementos principais da tela de recuperação.
const formularioRecuperacao = document.getElementById("formularioRecuperacao");
const mensagemRecuperacao = document.getElementById("mensagemRecuperacao");

// Remove máscara do telefone para comparação correta.
function normalizarTelefone(valor) {
  let digitos = valor.replace(/\D/g, "");
  if (digitos.length > 11 && digitos.startsWith("55")) {
    digitos = digitos.slice(2);
  }
  return digitos;
}

// Mostra mensagens de erro ou sucesso para o usuário.
function mostrarMensagem(texto, tipo) {
  mensagemRecuperacao.textContent = texto;
  mensagemRecuperacao.className = `mensagem ${tipo}`;
}

// Processa o formulário e altera a senha do usuário no backend.
formularioRecuperacao.addEventListener("submit", async function (evento) {
  evento.preventDefault();

  const identificador = document.getElementById("identificadorRecuperacao").value.trim();
  const novaSenha = document.getElementById("novaSenha").value;
  const confirmarSenha = document.getElementById("confirmarSenha").value;

  // Valida se confirmação de senha é igual à nova senha.
  if (novaSenha !== confirmarSenha) {
    mostrarMensagem("As senhas não conferem.", "erro");
    return;
  }

  const eEmail = identificador.includes("@");
  const identificadorNormalizado = eEmail
    ? identificador.toLowerCase()
    : normalizarTelefone(identificador);

  try {
    const resposta = await fetch(`${URL_API}/auth/forgot-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        identificador: identificadorNormalizado,
        novaSenha: novaSenha
      })
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      mostrarMensagem(dados.message || "Não foi possível atualizar a senha.", "erro");
      return;
    }

    mostrarMensagem("Senha atualizada com sucesso.", "sucesso");
  } catch (erro) {
    mostrarMensagem("Não foi possível conectar ao backend.", "erro");
  }
});