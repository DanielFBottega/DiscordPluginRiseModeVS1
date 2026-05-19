# Discord Pro Control for StreamDock 🎛️🔊

Este é um plugin altamente avançado e premium para o **StreamDock (Rise Mode / HotSpot)**. Ele utiliza o protocolo Discord RPC (Rich Presence & Voice Control) para fornecer controle analógico e digital completo sobre o áudio, voz, canais e usuários diretamente no seu deck físico.

Especialmente otimizado para o **Rise Mode Vision Sound 01**, suportando tanto as teclas LCD convencionais quanto os **Knobs (botões giratórios analógicos)** de forma inteligente e interativa.

---

## 🚀 Funcionalidades Premium

### 1. 🎛️ Integração Total com Knobs (Encoders Analógicos)
Otimização total para dispositivos com potenciômetros giratórios (como o Rise Mode Vision 01). Arraste as ações para os slots de knobs e aproveite:
* **Controle de Usuários (`usercontrol`):**
  * **Ao girar (Sem ninguém selecionado):** Ajusta automaticamente o volume **da pessoa que estiver falando no exato momento**! Se alguém estiver falando alto demais, basta girar o knob na hora para atenuar o volume dela.
  * **Ao girar (Com usuário selecionado):** Ajusta o volume individual do usuário selecionado.
  * **Ao pressionar:** Muta/Desmuta o usuário selecionado no canal de voz.
* **Volume Geral do Discord (`volumemute` / `deafen`):**
  * **Ao girar:** Ajusta o volume geral de saída do áudio do Discord (de `0%` a `200%`). O LCD correspondente mostra o nível em tempo real (ex: `VOL: 85%`).
  * **Ao pressionar:** Ativa ou desativa o **Deafen** (mutar áudio geral).
* **Ganho do Microfone (`micmute`):**
  * **Ao girar:** Ajusta o volume de captação (ganho) do seu microfone (de `0%` a `100%`).
  * **Ao pressionar:** Ativa ou desativa o **Mute** do seu microfone.

---

### 👥 2. Gerenciamento Completo de Usuários & Áudio
Navegue pelos amigos conectados ao seu canal de voz e controle o áudio individual com feedback visual dinâmico:
* **Lista de Usuários com Foto:** Os avatares e nomes reais dos membros do canal são desenhados diretamente nas teclas LCD.
* **Menu de Controle Individual:** Ao clicar em um usuário, abre-se um submenu de 6 botões:
  1. **Avatar/Nome:** Mostra quem você está controlando (clicar volta ao menu principal).
  2. **MUTE / UNMUTE:** Muta o usuário no seu cliente de áudio local.
  3. **VOL - / PAN ESQ:** Diminui o volume ou balanceia o áudio para a esquerda.
  4. **VOL + / PAN DIR:** Aumenta o volume ou balanceia o áudio para a direita.
  5. **RESET:** Redefine o volume para 100% e centraliza o balanço de áudio.
  6. **MODO DUAL (`VOL` / `PAN`):** Alterna dinamicamente as teclas 3 e 4 entre controle de Volume e controle de Pan (balanço de áudio).

---

### 🎨 3. Interface Visual Inteligente e Auto-explicativa
Nunca mais fique na dúvida sobre o estado do seu plugin. A interface foi desenhada para dar feedback imediato de forma limpa:
* **Feedbacks de Mute/Deafen:** Exibem dinamicamente o texto `MUTADO` ou `ATIVADO` abaixo do ícone correspondente.
* **Indicador de Fala (Speaking):** Acende em verde quando você ou qualquer amigo estiver falando no canal de voz, exibindo o nome de quem está falando. Se todos estiverem quietos, exibe a palavra `SILÊNCIO`.
* **Mensagens para Grades Vazias:**
  * Se você não estiver conectado a um canal de voz: Exibe a mensagem **`ENTRE EM UM CANAL DE VOZ`** centralizada no deck.
  * Se você estiver sozinho no canal: Exibe a mensagem **`CANAL VAZIO (SEM AMIGOS)`**.
* **Estado de Conexão (Perfil):** Mostra **`OFFLINE (CONECTANDO)`** se o Discord estiver fechado ou autenticando. Quando conectado, mostra seu avatar real e o status da redução de ruído Krisp (`Krisp: ON / OFF`).

---

### ⚡ 4. Robustez Técnica e Algoritmos Avançados
* **Ordenação Física por Grade:** O plugin detecta as coordenadas `row` e `column` das teclas do StreamDock. Independentemente da ordem aleatória em que o StreamDock registre os botões na inicialização, a interface e os cliques físicos são sempre mapeados linha por linha, esquerda para direita.
* **Resiliência a Reconexão:** Zera e reconstrói as inscrições de eventos do canal automaticamente em caso de queda de socket do Discord ou reinicialização do StreamDock.
* **Preservação de Estados Parciais:** Proteção com coalescência nula (`??`) e mesclagem incremental para que atualizações de volume ou mute enviadas pelo Discord não apaguem o status `speaking` ou revertam o volume `0` para `100`.

---

## 🛠️ Instalação & Configuração

1. Certifique-se de ter o [Node.js](https://nodejs.org/) instalado.
2. Clone este repositório na pasta de plugins do seu StreamDock:
   `%APPDATA%\HotSpot\StreamDock\plugins\com.daniel.discordpro.sdPlugin`
3. Instale as dependências:
   ```bash
   npm install
   ```
4. Crie uma aplicação no Discord Developer Portal:
   1. Acesse [Discord Developers](https://discord.com/developers/applications).
   2. Clique em **New Application** e dê um nome ao app.
   3. Vá na aba **OAuth2**.
   4. Adicione o Redirect URI: `http://localhost`.
   5. Copie o **Client ID** e o **Client Secret**.

5. Crie um arquivo `.env` na raiz do plugin com as credenciais obtidas:
   ```env
   CLIENT_ID=seu_client_id
   CLIENT_SECRET=seu_client_secret
   ```

6. Reinicie o software do seu StreamDock para que as novas regras de knobs do `manifest.json` sejam totalmente recarregadas!

---

## 📄 Licença

Este projeto está sob a licença MIT. Criado por Daniel Bottega.
