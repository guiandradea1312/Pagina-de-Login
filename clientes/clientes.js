const URL_API = "/api";
const CHAVE_TOKEN = "authToken";

const formularioCliente = document.getElementById("formCliente");
const formularioImportacao = document.getElementById("formImportacao");
const formularioFiltro = document.getElementById("formFiltro");
const botaoLimpar = document.getElementById("botaoLimpar");
const botaoSair = document.getElementById("botaoSair");
const botaoCancelarEdicao = document.getElementById("botaoCancelarEdicao");
const botaoSalvarCliente = document.getElementById("botaoSalvarCliente");
const tituloFormularioCliente = document.getElementById("tituloFormularioCliente");
const mensagemCliente = document.getElementById("mensagemCliente");
const mensagemImportacao = document.getElementById("mensagemImportacao");
const listaClientes = document.getElementById("listaClientes");
const totalClientes = document.getElementById("totalClientes");
const statusImportacao = document.getElementById("statusImportacao");
const filtroAtivo = document.getElementById("filtroAtivo");
let clienteEmEdicaoId = null;

function somenteNumeros(valor) {
  let digitos = String(valor || "").replace(/\D/g, "");
  if (digitos.length > 11 && digitos.startsWith("55")) {
    digitos = digitos.slice(2);
  }
  return digitos;
}

function formatarCpf(valor) {
  const digitos = somenteNumeros(valor).slice(0, 11);
  if (digitos.length !== 11) return valor || "-";
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

function formatarTelefone(valor) {
  const digitos = somenteNumeros(valor).slice(0, 11);
  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return valor || "-";
}

function mostrarMensagem(elemento, texto, tipo) {
  elemento.textContent = texto;
  elemento.className = `mensagem ${tipo}`;
}

function limparMensagem(elemento) {
  elemento.textContent = "";
  elemento.className = "mensagem";
}

function obterToken() {
  return localStorage.getItem(CHAVE_TOKEN);
}

function aplicarFiltroAtivo() {
  const nome = document.getElementById("filtroNome").value.trim();
  const cidade = document.getElementById("filtroCidade").value.trim();

  if (nome && cidade) {
    filtroAtivo.textContent = `Nome: ${nome} | Cidade: ${cidade}`;
    return { nome, cidade };
  }

  if (nome) {
    filtroAtivo.textContent = `Nome: ${nome}`;
    return { nome, cidade: "" };
  }

  if (cidade) {
    filtroAtivo.textContent = `Cidade: ${cidade}`;
    return { nome: "", cidade };
  }

  filtroAtivo.textContent = "Nenhum";
  return { nome: "", cidade: "" };
}

function preencherFormularioCliente(cliente) {
  document.getElementById("nome").value = cliente.nome || "";
  document.getElementById("cpf").value = formatarCpf(cliente.cpf || "");
  document.getElementById("telefone").value = formatarTelefone(cliente.telefone || "");
  document.getElementById("email").value = cliente.email || "";
  document.getElementById("cidade").value = cliente.cidade || "";
}

function ativarModoEdicao(cliente) {
  clienteEmEdicaoId = cliente.id;
  preencherFormularioCliente(cliente);
  tituloFormularioCliente.textContent = "Editar cliente";
  botaoSalvarCliente.textContent = "Atualizar cliente";
  botaoCancelarEdicao.classList.remove("escondido");
  formularioCliente.scrollIntoView({ behavior: "smooth", block: "start" });
}

function limparModoEdicao() {
  clienteEmEdicaoId = null;
  tituloFormularioCliente.textContent = "Cadastrar cliente";
  botaoSalvarCliente.textContent = "Salvar cliente";
  botaoCancelarEdicao.classList.add("escondido");
}

function renderizarClientes(clientes) {
  listaClientes.innerHTML = "";

  if (!clientes.length) {
    const linha = document.createElement("tr");
    linha.className = "linha-vazia";
    linha.innerHTML = '<td colspan="6">Nenhum cliente encontrado.</td>';
    listaClientes.appendChild(linha);
    totalClientes.textContent = "0";
    return;
  }

  const fragmento = document.createDocumentFragment();

  clientes.forEach(function (cliente) {
    const linha = document.createElement("tr");

    const celulaNome = document.createElement("td");
    celulaNome.textContent = cliente.nome || "-";

    const celulaCpf = document.createElement("td");
    celulaCpf.textContent = formatarCpf(cliente.cpf);

    const celulaTelefone = document.createElement("td");
    celulaTelefone.textContent = formatarTelefone(cliente.telefone);

    const celulaEmail = document.createElement("td");
    celulaEmail.textContent = cliente.email || "-";

    const celulaCidade = document.createElement("td");
    celulaCidade.textContent = cliente.cidade || "-";

    const celulaAcoes = document.createElement("td");
    const acoes = document.createElement("div");
    acoes.className = "acoes-linha";

    const botaoEditar = document.createElement("button");
    botaoEditar.type = "button";
    botaoEditar.className = "botao-acao";
    botaoEditar.textContent = "Editar";
    botaoEditar.addEventListener("click", function () {
      ativarModoEdicao(cliente);
    });

    const botaoApagar = document.createElement("button");
    botaoApagar.type = "button";
    botaoApagar.className = "botao-acao botao-apagar";
    botaoApagar.textContent = "Apagar";
    botaoApagar.addEventListener("click", async function () {
      const token = obterToken();
      if (!token) {
        window.location.href = "../login/login.html";
        return;
      }

      const confirmado = window.confirm(`Deseja apagar o cliente ${cliente.nome || "selecionado"}?`);
      if (!confirmado) {
        return;
      }

      try {
        const resposta = await fetch(`${URL_API}/clientes/${cliente.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` }
        });

        const dados = await resposta.json();
        if (!resposta.ok) {
          mostrarMensagem(mensagemCliente, dados.message || "Não foi possível apagar o cliente.", "erro");
          return;
        }

        if (clienteEmEdicaoId === cliente.id) {
          formularioCliente.reset();
          limparModoEdicao();
        }

        mostrarMensagem(mensagemCliente, dados.message || "Cliente apagado com sucesso.", "sucesso");
        await carregarClientes();
      } catch (erro) {
        mostrarMensagem(mensagemCliente, "Não foi possível conectar ao backend.", "erro");
      }
    });

    acoes.appendChild(botaoEditar);
    acoes.appendChild(botaoApagar);
    celulaAcoes.appendChild(acoes);

    linha.appendChild(celulaNome);
    linha.appendChild(celulaCpf);
    linha.appendChild(celulaTelefone);
    linha.appendChild(celulaEmail);
    linha.appendChild(celulaCidade);
    linha.appendChild(celulaAcoes);
    fragmento.appendChild(linha);
  });

  listaClientes.appendChild(fragmento);
  totalClientes.textContent = String(clientes.length);
}

async function carregarClientes() {
  const token = obterToken();
  if (!token) {
    window.location.href = "../login/login.html";
    return;
  }

  const filtros = aplicarFiltroAtivo();
  const parametros = new URLSearchParams();

  if (filtros.nome) {
    parametros.set("nome", filtros.nome);
  }

  if (filtros.cidade) {
    parametros.set("cidade", filtros.cidade);
  }

  try {
    const resposta = await fetch(`${URL_API}/clientes?${parametros.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resposta.ok) {
      localStorage.removeItem(CHAVE_TOKEN);
      window.location.href = "../login/login.html";
      return;
    }

    const dados = await resposta.json();
    renderizarClientes(dados.clientes || []);
  } catch (erro) {
    mostrarMensagem(mensagemCliente, "Não foi possível carregar os clientes.", "erro");
  }
}

formularioCliente.addEventListener("submit", async function (evento) {
  evento.preventDefault();

  const token = obterToken();
  if (!token) {
    window.location.href = "../login/login.html";
    return;
  }

  const nome = document.getElementById("nome").value.trim();
  const cpf = somenteNumeros(document.getElementById("cpf").value);
  const telefone = somenteNumeros(document.getElementById("telefone").value);
  const email = document.getElementById("email").value.trim();
  const cidade = document.getElementById("cidade").value.trim();

  if (cpf.length !== 11) {
    mostrarMensagem(mensagemCliente, "CPF inválido.", "erro");
    return;
  }

  try {
    const resposta = await fetch(
      clienteEmEdicaoId ? `${URL_API}/clientes/${clienteEmEdicaoId}` : `${URL_API}/clientes`,
      {
      method: clienteEmEdicaoId ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ nome, cpf, telefone, email, cidade })
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      mostrarMensagem(mensagemCliente, dados.message || "Não foi possível salvar.", "erro");
      return;
    }

    mostrarMensagem(
      mensagemCliente,
      dados.message || (clienteEmEdicaoId ? "Cliente atualizado." : "Cliente salvo."),
      "sucesso"
    );
    formularioCliente.reset();
    limparModoEdicao();
    await carregarClientes();
  } catch (erro) {
    mostrarMensagem(mensagemCliente, "Não foi possível conectar ao backend.", "erro");
  }
});

botaoCancelarEdicao.addEventListener("click", function () {
  formularioCliente.reset();
  limparModoEdicao();
  limparMensagem(mensagemCliente);
});

formularioImportacao.addEventListener("submit", async function (evento) {
  evento.preventDefault();

  const token = obterToken();
  if (!token) {
    window.location.href = "../login/login.html";
    return;
  }

  const arquivo = document.getElementById("arquivoExcel").files[0];
  if (!arquivo) {
    mostrarMensagem(mensagemImportacao, "Selecione um arquivo Excel.", "erro");
    return;
  }

  const formData = new FormData();
  formData.append("arquivo", arquivo);

  try {
    statusImportacao.textContent = "Importando...";
    const resposta = await fetch(`${URL_API}/clientes/importar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      statusImportacao.textContent = "Falha";
      mostrarMensagem(mensagemImportacao, dados.message || "Não foi possível importar.", "erro");
      return;
    }

    const totalErros = (dados.erros || []).length;
    statusImportacao.textContent = `Processados: ${dados.processados || 0}`;
    mostrarMensagem(
      mensagemImportacao,
      totalErros > 0
        ? `Importação concluída com ${totalErros} linha(s) com erro.`
        : "Importação concluída com sucesso.",
      totalErros > 0 ? "erro" : "sucesso"
    );

    formularioImportacao.reset();
    await carregarClientes();
  } catch (erro) {
    statusImportacao.textContent = "Falha";
    mostrarMensagem(mensagemImportacao, "Não foi possível conectar ao backend.", "erro");
  }
});

formularioFiltro.addEventListener("submit", async function (evento) {
  evento.preventDefault();
  await carregarClientes();
});

botaoLimpar.addEventListener("click", async function () {
  document.getElementById("filtroNome").value = "";
  document.getElementById("filtroCidade").value = "";
  await carregarClientes();
});

botaoSair.addEventListener("click", async function () {
  const token = obterToken();

  if (token) {
    try {
      await fetch(`${URL_API}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (erro) {
      // Limpeza local continua mesmo sem resposta do servidor.
    }
  }

  localStorage.removeItem(CHAVE_TOKEN);
  window.location.href = "../login/login.html";
});

carregarClientes();