---
applyTo: '**'
---
Provide project context and coding guidelines that AI should follow when generating code, answering questions, or reviewing changes.


# 📌 Regras obrigatórias para Discord.js (painéis, botões, embeds, ephemeral)

Estas regras **são padrão absoluto** e **devem sempre ser aplicadas** em qualquer geração de código que envolva:  
Botões • Select Menus • Embeds • Interações • Painéis • Fluxos multi-etapas.


---

# ✅ 1. Regras sobre interações e tempo limite (3 segundos)

### **Sempre iniciar handlers de botões com:**
```js
await interaction.deferUpdate();
```

Isso evita o erro de timeout (“This interaction failed”) após 3 segundos.

### **NUNCA usar `reply()`** após já ter respondido a interação inicial.  
Use `editReply()` ou `followUp()` conforme o caso.


---

# ✅ 2. Atualização de painéis (mensagem única)

### Sempre usar:
```js
await interaction.editReply({ ... })
```

Para manter uma **única mensagem / único painel**, evitando criar novas mensagens.

### Avisos/erros que não devem quebrar o painel:
```js
await interaction.followUp({ ephemeral: true, ... });
```

### Evitar:
- `interaction.reply()` em botões
- `interaction.update()` em ações que podem demorar
- Criar novas mensagens ao alterar o estado do painel


---

# ✅ 3. Manipulação correta de mensagens ephemeral

- Nunca tentar acessar, editar ou buscar mensagens ephemeral via `.fetch()`, `.messages`, `.channel.messages` etc.
- Mensagens ephemeral **só podem ser manipuladas via `interaction`**.
- Nunca tentar editar um embed ephemeral “antigo”.
- Se precisar atualizar algo, **sempre edite a mesma ephemeral original com `editReply()`**.


---

# ✅ 4. Filosofia principal: Máquina de Estados

Sempre projetar interações como:

### **Uma única mensagem → vários estados**

Ou seja:

- Nada de criar mensagens extras
- Nada de poluir o chat
- Nada de múltiplas caixas de embed aparecendo

O painel muda, não aparece outro.

Exemplos de estados:

- Estado 1: menu principal  
- Estado 2: pedir texto  
- Estado 3: confirmar  
- Estado 4: voltar ao menu  

Cada estado é simplesmente um:

```js
await interaction.editReply({ embeds: [...], components: [...] });
```


---

# ✅ 5. Coleta de texto sem criar mensagens novas (Regra Nova)

Quando o usuário precisar “digitar algo” (nome, cor, ID etc):

### ❌ Nunca usar promptText() criando novas mensagens.  
### ❌ Nunca usar reply() para pedir o texto.  
### ❌ Nunca criar 2, 3 ou mais mensagens no chat.

### ✔️ Sempre seguir este fluxo:

1. **Editar o painel** para o modo “digite sua resposta”  
   (SEM mandar mensagens novas)

2. Usar um `MessageCollector` para capturar a resposta do usuário.

3. Após receber o texto:  
   - Processar  
   - Confirmar  
   - E **editar o mesmo painel** novamente  
   (SEM mandar mensagens novas)

4. Opcional: apagar a mensagem digitada pelo usuário para manter o chat limpo.


### Exemplo de coleta:

```js
const collector = interaction.channel.createMessageCollector({
  filter: (m) => m.author.id === interaction.user.id,
  time: 60000,
  max: 1
});

collector.on('collect', async (m) => {
  const value = m.content;

  // processar value...

  await interaction.editReply({
    embeds: [...],
    components: [...]
  });

  m.delete().catch(() => {});
});
```

Esse método **não cria novos embeds**, não entope o chat e mantém um **painel profissional**.


---

# ✅ 6. Nunca quebrar a UI

As prioridades SEMPRE são:

1. `deferUpdate()`  
2. `editReply()`  
3. `followUp({ ephemeral: true })`

Nunca algo diferente, exceto quando realmente inevitável (como enviar a primeira resposta da interação).


---

# 🎯 Resumo Final

A IA deve **sempre gerar código assim**:

- Uma única mensagem que representa o painel  
- Cada mudança é feita por `editReply()`  
- Nunca enviar mensagens desnecessárias  
- Nunca usar `reply()` depois da primeira resposta  
- Nunca usar `update()` em operações longas  
- Sempre `deferUpdate()` imediatamente  
- Coleta de texto → sempre via MessageCollector + editReply  
- Nunca tentar mexer em mensagens ephemeral via fetch  
- Sempre manter tudo dentro de uma **máquina de estados**

**Objetivo: UI limpa, organizada, fluida, sem erros e sem poluir o chat.**

