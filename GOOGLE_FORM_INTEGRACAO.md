# Integracao Google Forms -> API de Clientes

Este projeto agora possui um endpoint para receber dados do Google Forms e cadastrar cliente automaticamente.

## 1) Configurar chave da integracao no backend

Defina a variavel de ambiente:

- FORM_API_KEY: uma senha forte para a integracao (exemplo: minha-chave-123)

No Render:

1. Abra o servico.
2. Entre em Environment.
3. Adicione FORM_API_KEY.
4. Salve e faça redeploy.

## 2) Endpoint da API

Use este endpoint:

- POST /api/public/clientes

Exemplo de URL em producao:

- https://SEU-SERVICO.onrender.com/api/public/clientes

## 3) Criar Google Form

Crie um formulario com estes campos:

- Nome
- CPF
- Telefone
- Email
- Cidade

Dica:

- CPF: texto curto (permite com ou sem pontuacao)
- Telefone: texto curto

## 4) Vincular o formulario a uma planilha

No Google Forms:

1. Aba Respostas.
2. Clique para criar planilha de respostas.

## 5) Adicionar Apps Script na planilha

Na planilha de respostas:

1. Extensoes -> Apps Script.
2. Apague o conteudo e cole o codigo abaixo.
3. Troque API_URL e API_KEY.
4. Salve.

```javascript
const API_URL = "https://SEU-SERVICO.onrender.com/api/public/clientes";
const API_KEY = "SUA_FORM_API_KEY";

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function onFormSubmit(e) {
  const data = e && e.namedValues ? e.namedValues : {};

  const nome = (data["Nome"] && data["Nome"][0]) || "";
  const cpfRaw = (data["CPF"] && data["CPF"][0]) || "";
  const telefoneRaw = (data["Telefone"] && data["Telefone"][0]) || "";
  const email = ((data["Email"] && data["Email"][0]) || "").trim().toLowerCase();
  const cidade = (data["Cidade"] && data["Cidade"][0]) || "";

  const payload = {
    nome: nome,
    cpf: normalizeDigits(cpfRaw),
    telefone: normalizeDigits(telefoneRaw),
    email: email,
    cidade: cidade
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-form-api-key": API_KEY
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(API_URL, options);
  const code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw new Error("Falha ao enviar para API. HTTP " + code + " | " + response.getContentText());
  }
}
```

## 6) Criar gatilho (trigger)

No Apps Script:

1. Relogio/Triggers -> Add Trigger.
2. Function: onFormSubmit.
3. Event source: From spreadsheet.
4. Event type: On form submit.
5. Salve e autorize as permissoes.

## 7) Testar

1. Envie uma resposta teste no Google Form.
2. Abra a pagina Clientes do sistema.
3. Verifique se o cliente entrou na lista.

## Campos aceitos pela API

Obrigatorios:

- nome
- cpf
- cidade

Opcionais:

- telefone
- email

A API faz upsert por CPF (se ja existir, atualiza os dados).
